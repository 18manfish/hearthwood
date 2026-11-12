// Server-side validation and execution of every player action.
// Rule of thumb: never trust the client – check ownership, distance, tools,
// inventory, cooldowns and world state before mutating anything.

import {
  BIOMES, BUILDINGS, ENTERABLE, FISH, ITEMS, MAX_VILLAGERS, RECIPES, SHOP_STOCK, TREES, VILLAGER_HOUSE_MONTH_ONE_LIMIT,
  VILLAGER_HOUSE_MONTH_TWO_MIN_DAY, FRIENDSHIP_GIFT_DISLIKE, FRIENDSHIP_GIFT_LIKE, FRIENDSHIP_GIFT_LOVE,
  FRIENDSHIP_GIFT_NEUTRAL, FRIENDSHIP_TALK, FRIENDSHIP_MAX, FRIENDSHIP_BIRTHDAY_BONUS, HAIR_STYLES,
  Rng, Tile, PATH_REACH, pathDef, distToTile, friendshipLevel, isWaterTile, nearBuilding, villagerDef, villagerLine, hashMany,
  type Action, type BuildingType, type TalkView, type WorldObject, type Building,
} from '@hearthwood/shared';
import { config } from '../config.ts';
import type { Game } from './Game.ts';
import type { Room } from './Room.ts';
import type { Session } from './Session.ts';
import type { PlayerRecord } from '../types.ts';
import * as inv from './inventory.ts';

export interface ActionResult {
  ok: boolean;
  err?: string;
  msg?: string;
  gained?: Record<string, number>;
}

interface Ctx {
  game: Game;
  s: Session;
  room: Room;
  p: PlayerRecord;
  now: number;
}

const fail = (err: string): ActionResult => ({ ok: false, err });
const HARVEST_COOLDOWN_MS = 280;

function near(ctx: Ctx, o: { x: number; z: number }, reach = config.reach) {
  return distToTile(ctx.s.x, ctx.s.z, o.x, o.z) <= reach;
}

function getObj(ctx: Ctx, id: string, kind?: WorldObject['kind'] | WorldObject['kind'][]): WorldObject | ActionResult {
  const o = ctx.room.objects.get(id);
  if (!o) return fail('That isn’t there any more.');
  if (kind && !(Array.isArray(kind) ? kind.includes(o.kind) : o.kind === kind)) return fail('You can’t do that to this.');
  if (!near(ctx, o)) return fail('Too far away.');
  return o;
}

function isResult(v: unknown): v is ActionResult {
  return typeof v === 'object' && v !== null && 'ok' in v;
}

function harvestGuard(ctx: Ctx): ActionResult | null {
  if (!ctx.room.canHarvest(ctx.p.id)) return fail('Only the island owner can gather resources here.');
  if (ctx.now - ctx.s.lastActAt < HARVEST_COOLDOWN_MS) return fail('Slow down!');
  ctx.s.lastActAt = ctx.now;
  return null;
}

function give(ctx: Ctx, gained: Record<string, number>, id: string, n: number) {
  const k = inv.add(ctx.p, id, n);
  if (k > 0) gained[id] = (gained[id] ?? 0) + k;
  return k;
}

function nearCompleted(ctx: Ctx, types: BuildingType[]): Building | undefined {
  for (const b of ctx.room.buildings.values()) {
    if (types.includes(b.type) && b.completeAt <= ctx.now && nearBuilding(b, ctx.s.x, ctx.s.z, config.buildingReach)) return b;
  }
  return undefined;
}

function rngFor(ctx: Ctx) {
  return new Rng(hashMany(ctx.room.id, ctx.p.id, ctx.now, Math.random()));
}

// ── Handlers ────────────────────────────────────────────────────────────────

const handlers: { [K in Action['k']]: (ctx: Ctx, a: Extract<Action, { k: K }>) => ActionResult } = {
  shake(ctx, a) {
    const g = harvestGuard(ctx);
    if (g) return g;
    const o = getObj(ctx, a.id, 'tree');
    if (isResult(o)) return o;
    if ((o.stage ?? 2) < 2) return fail('This tree is still too young.');
    const gained: Record<string, number> = {};
    const fruit = TREES[o.species!].fruit;
    if (fruit && (o.fruit ?? 0) > 0) give(ctx, gained, fruit, o.fruit!);
    const today = ctx.room.env(ctx.now).dayKey;
    if (o.shook !== today) give(ctx, gained, 'wood', 1);
    if (!Object.keys(gained).length) return { ok: true, msg: 'Nothing fell out.' };
    o.fruit = 0;
    o.shook = today;
    ctx.room.updateObject(o);
    return { ok: true, gained };
  },

  chop(ctx, a) {
    const g = harvestGuard(ctx);
    if (g) return g;
    const o = getObj(ctx, a.id, 'tree');
    if (isResult(o)) return o;
    const power = inv.toolPower(ctx.p, 'axe');
    if (!power) return fail('You need an axe.');
    if ((o.stage ?? 2) < 2) return fail('Let it grow first!');
    const gained: Record<string, number> = {};
    const hitsToFell = power >= 2 ? 2 : 4;
    o.hits = (o.hits ?? 0) + 1;
    give(ctx, gained, TREES[o.species!].shape === 'cactus' ? 'fiber' : 'wood', 1);
    if (o.hits >= hitsToFell) {
      const rng = rngFor(ctx);
      give(ctx, gained, 'wood', rng.int(1, 2));
      if (rng.chance(0.35)) give(ctx, gained, 'sapling', 1);
      ctx.room.replaceObject(o, (t) => {
        t.kind = 'stump';
        t.hits = 0;
        t.fruit = 0;
        t.decayAt = ctx.now + (config.stumpDecayMinutes * 60000) / config.timeFactor;
        delete t.stage;
        delete t.shook;
        delete t.growAt;
      });
      return { ok: true, gained, msg: 'Timber!' };
    }
    ctx.room.updateObject(o);
    return { ok: true, gained };
  },

  dig(ctx, a) {
    const g = harvestGuard(ctx);
    if (g) return g;
    const o = getObj(ctx, a.id, 'stump');
    if (isResult(o)) return o;
    if (!inv.toolPower(ctx.p, 'shovel')) return fail('You need a shovel.');
    const gained: Record<string, number> = {};
    give(ctx, gained, 'wood', 1);
    if (rngFor(ctx).chance(0.6)) give(ctx, gained, 'sapling', 1);
    ctx.room.removeObject(o.id);
    // A wild tree will sprout again somewhere around here later.
    ctx.room.scheduleRespawn('tree', o.x, o.z, ctx.now);
    return { ok: true, gained };
  },

  hit(ctx, a) {
    const g = harvestGuard(ctx);
    if (g) return g;
    const o = getObj(ctx, a.id, 'rock');
    if (isResult(o)) return o;
    const power = inv.toolPower(ctx.p, 'shovel');
    const limit = power === 0 ? 2 : config.rockHits[power >= 2 ? 1 : 0];
    if ((o.hits ?? 0) >= limit) return fail('No loose stones left. A shovel would help!');
    o.hits = (o.hits ?? 0) + 1;
    const gained: Record<string, number> = {};
    const rng = rngFor(ctx);
    give(ctx, gained, 'stone', 1);
    if (power > 0) {
      const ore = ctx.room.biome === 'desert' ? 0.16 : 0.08;
      if (rng.chance(0.3)) give(ctx, gained, 'clay', 1);
      if (rng.chance(ore * power)) give(ctx, gained, 'iron_ore', 1);
    }
    if (power > 0 && o.hits >= limit) {
      // Depleted: the rock crumbles and a new one appears later.
      ctx.room.removeObject(o.id);
      ctx.room.scheduleRespawn('rock', o.x, o.z, ctx.now);
      return { ok: true, gained, msg: 'The rock crumbled away.' };
    }
    ctx.room.updateObject(o);
    return { ok: true, gained };
  },

  forage(ctx, a) {
    const g = harvestGuard(ctx);
    if (g) return g;
    const o = getObj(ctx, a.id, ['bush', 'mushroom', 'flower']);
    if (isResult(o)) return o;
    const gained: Record<string, number> = {};
    if (o.kind === 'bush') {
      if (!o.ripe) return fail('Nothing to pick until tomorrow.');
      give(ctx, gained, BIOMES[ctx.room.biome].bushItem, 2);
      give(ctx, gained, 'fiber', 2);
      // Picked clean: the bush disappears and regrows later.
      ctx.room.removeObject(o.id);
      ctx.room.scheduleRespawn('bush', o.x, o.z, ctx.now);
    } else if (o.kind === 'mushroom') {
      give(ctx, gained, o.rare ? 'glowcap' : 'mushroom', 1);
      ctx.room.removeObject(o.id);
    } else {
      give(ctx, gained, 'flower', 1);
      give(ctx, gained, 'fiber', 1);
      ctx.room.removeObject(o.id);
    }
    return { ok: true, gained };
  },

  plant(ctx, a) {
    if (!ctx.room.canBuild(ctx.p.id)) return fail('Plant saplings on your own island.');
    if (inv.count(ctx.p, 'sapling') < 1) return fail('You have no saplings.');
    if (distToTile(ctx.s.x, ctx.s.z, a.x, a.z) > config.reach) return fail('Too far away.');
    if (!ctx.room.grid.canSpawn(a.x, a.z)) return fail(ctx.room.grid.path(a.x, a.z) ? 'Trees don’t grow on paths.' : 'Can’t plant there.');
    // Keep trees from touching each other.
    for (const o of ctx.room.objects.values()) {
      if ((o.kind === 'tree' || o.kind === 'stump') && Math.abs(o.x - a.x) <= 1 && Math.abs(o.z - a.z) <= 1) return fail('Too close to another tree.');
    }
    const footInside = Math.floor(ctx.s.x) === a.x && Math.floor(ctx.s.z) === a.z;
    if (footInside) return fail('Step aside first.');
    inv.remove(ctx.p, 'sapling', 1);
    const rng = rngFor(ctx);
    const species = rng.weighted(BIOMES[ctx.room.biome].trees, (t) => t.weight)!.species;
    ctx.room.addObject({
      id: ctx.room.newId('t'), kind: 'tree', x: a.x, z: a.z, species, stage: 0, hits: 0, fruit: 0,
      growAt: ctx.now + (config.treeStageMinutes * 60000) / config.timeFactor,
    });
    return { ok: true, msg: 'Planted! It will grow over the next days.' };
  },

  cast(ctx, a) {
    if (!inv.toolPower(ctx.p, 'rod')) return fail('You need a fishing rod.');
    const t = ctx.room.grid.tile(a.x, a.z);
    if (!isWaterTile(t)) return fail('That’s not water.');
    if (distToTile(ctx.s.x, ctx.s.z, a.x, a.z) > config.castReach) return fail('Too far to cast.');
    ctx.s.clearCast();
    const env = ctx.room.env(ctx.now);
    const def = BIOMES[ctx.room.biome];
    const pool = (t === Tile.Pond ? def.freshFish : def.seaFish)
      .map((id) => FISH.find((f) => f.id === id)!)
      .filter((f) => {
        if (f.seasons && !f.seasons.includes(env.season)) return false;
        if (f.hours) {
          const [a0, b0] = f.hours;
          const inside = a0 < b0 ? env.hour >= a0 && env.hour < b0 : env.hour >= a0 || env.hour < b0;
          if (!inside) return false;
        }
        return true;
      });
    const rng = rngFor(ctx);
    // Rain makes fish hungrier.
    const fish = rng.weighted(pool, (f) => f.rarity * (env.weather === 'rain' && f.rarity < 3 ? 2 : 1))?.id ?? null;
    const power = inv.toolPower(ctx.p, 'rod');
    const cast = {
      id: ctx.room.newId('c'),
      biteAt: ctx.now + rng.range(config.biteMinMs, config.biteMaxMs),
      window: config.biteWindowMs + (power - 1) * 400,
      fish,
      bitten: false,
    } as NonNullable<Session['cast']>;
    ctx.s.cast = cast;
    if (fish) {
      cast.timer = setTimeout(() => {
        if (ctx.s.cast !== cast) return;
        cast.bitten = true;
        cast.biteAt = Date.now(); // measure the window from the real send time
        ctx.s.send({ t: 'bite', castId: cast.id, window: cast.window });
        cast.timer = setTimeout(() => {
          if (ctx.s.cast === cast) {
            ctx.s.cast = null;
            ctx.s.send({ t: 'fish', castId: cast.id, ok: false, msg: 'It got away…' });
          }
        }, cast.window + config.netGraceMs + 1500);
      }, cast.biteAt - ctx.now);
    }
    return { ok: true, msg: fish ? undefined : 'Nothing seems to be biting here right now.' };
  },

  reel(ctx, a) {
    const c = ctx.s.cast;
    if (!c || c.id !== a.castId) return fail('You’re not fishing.');
    ctx.s.clearCast();
    if (!c.bitten || ctx.now < c.biteAt) return { ok: true, msg: 'Too early – the fish swam off.' };
    if (ctx.now > c.biteAt + c.window + config.netGraceMs) return { ok: true, msg: 'Too slow – it got away.' };
    const gained: Record<string, number> = {};
    if (!give(ctx, gained, c.fish!, 1)) return fail('Your pockets are full of those.');
    ctx.s.send({ t: 'fish', castId: c.id, ok: true, item: c.fish!, msg: `You caught a ${ITEMS[c.fish!].name}!` });
    return { ok: true, gained };
  },

  craft(ctx, a) {
    const r = RECIPES.find((x) => x.id === a.recipe);
    if (!r) return fail('Unknown recipe.');
    const times = a.n ?? 1;
    if (r.station !== 'hand') {
      if (ctx.room.kind !== 'island' || !ctx.room.isOwner(ctx.p.id)) return fail(`Use your own ${BUILDINGS[r.station].name}.`);
      if (!nearCompleted(ctx, [r.station])) return fail(`Stand next to your ${BUILDINGS[r.station].name}.`);
    }
    const outDef = ITEMS[r.output];
    if (!inv.canAdd(ctx.p, r.output, r.qty * times)) return fail(outDef.stack === 1 ? `You already have a ${outDef.name}.` : 'You can’t carry more.');
    const need = inv.resolveIngredients(ctx.p, r.ingredients, times);
    if (!need) return fail('Missing ingredients.');
    inv.removeAll(ctx.p, need);
    const gained: Record<string, number> = {};
    give(ctx, gained, r.output, r.qty * times);
    ctx.p.crafted[r.output] = (ctx.p.crafted[r.output] ?? 0) + r.qty * times;
    return { ok: true, gained, msg: `Made ${outDef.name}${times * r.qty > 1 ? ` ×${times * r.qty}` : ''}!` };
  },

  build(ctx, a) {
    const def = BUILDINGS[a.type];
    if (!ctx.room.canBuild(ctx.p.id)) return fail('You can only build on your own island.');
    if (def.fixed) return fail('That can’t be built.');
    const day = ctx.room.islandDay(ctx.now);
    for (const req of def.requires) {
      if (ctx.room.completedCount(req, ctx.now) < 1) return fail(`Requires a finished ${BUILDINGS[req].name}.`);
    }
    if (!config.ignoreDayGates && day < def.minDay) return fail(`${def.name} unlocks on island day ${def.minDay} (today is day ${day}).`);
    const existing = ctx.room.totalCount(a.type);
    let max = def.max;
    if (a.type === 'villager_house' && !config.ignoreDayGates && day < VILLAGER_HOUSE_MONTH_TWO_MIN_DAY) max = VILLAGER_HOUSE_MONTH_ONE_LIMIT;
    if (existing >= max) {
      return fail(a.type === 'villager_house' && max < def.max ? `More houses unlock on day ${VILLAGER_HOUSE_MONTH_TWO_MIN_DAY}.` : `You already have the maximum number of ${def.name}s.`);
    }
    if (a.type === 'villager_house' && ctx.room.villagers.size + ctx.room.totalCount('villager_house') - ctx.room.completedCount('villager_house') >= MAX_VILLAGERS)
      return fail('Your village is full.');
    if (!ctx.room.grid.canPlace(a.x, a.z, def.w, def.h)) return fail('Not enough free space there.');
    if (ENTERABLE.includes(a.type)) {
      // The door (south side) must open onto walkable ground on the same cliff level.
      const lvl = ctx.room.grid.level(a.x, a.z);
      for (let dx = 0; dx < def.w; dx++) {
        const tx = a.x + dx, tz = a.z + def.h;
        if (!ctx.room.grid.walkableTile(tx, tz) || ctx.room.grid.level(tx, tz) !== lvl || ctx.room.grid.ramp(tx, tz) >= 0) return fail('The door needs open ground in front of it.');
      }
    }
    // Must be built close to the player and not on top of anyone.
    const cx = a.x + def.w / 2;
    const cz = a.z + def.h / 2;
    if (Math.hypot(ctx.s.x - cx, ctx.s.z - cz) > 6) return fail('Move closer to where you want to build.');
    for (const other of ctx.room.sessions) {
      if (other.x >= a.x - 0.3 && other.x <= a.x + def.w + 0.3 && other.z >= a.z - 0.3 && other.z <= a.z + def.h + 0.3)
        return fail('Someone is standing there.');
    }
    if (!inv.removeAll(ctx.p, def.cost)) return fail('Not enough materials.');
    const b: Building = {
      id: ctx.room.newId('b'), type: a.type, x: a.x, z: a.z, w: def.w, h: def.h,
      completeAt: ctx.now + (def.buildMinutes * 60000) / config.timeFactor,
    };
    ctx.room.addBuilding(b);
    const mins = Math.round((def.buildMinutes) / config.timeFactor);
    return { ok: true, msg: def.buildMinutes ? `Construction started! Ready in about ${mins >= 60 ? `${Math.round(mins / 60)}h` : `${Math.max(1, mins)} min`}.` : `${def.name} built!` };
  },

  demolish(ctx, a) {
    if (!ctx.room.canBuild(ctx.p.id)) return fail('Not your island.');
    const b = ctx.room.buildings.get(a.id);
    if (!b) return fail('Nothing there.');
    if (BUILDINGS[b.type].fixed || b.type === 'town_hall' || b.type === 'cabin') return fail('That building is too important to remove.');
    if (!nearBuilding(b, ctx.s.x, ctx.s.z, config.buildingReach)) return fail('Too far away.');
    if (b.type === 'villager_house' && b.villagerId) return fail('Someone lives there!');
    // 50% refund.
    for (const [id, n] of Object.entries(BUILDINGS[b.type].cost)) inv.add(ctx.p, id, Math.floor(n / 2));
    ctx.room.removeBuilding(b.id);
    return { ok: true, msg: 'Removed. You got half the materials back.' };
  },

  place(ctx, a) {
    if (!ctx.room.canDecorate(ctx.p.id)) return fail('You can only decorate your own island and home.');
    const def = ITEMS[a.item];
    if (!def.placeable) return fail('That can’t be placed.');
    if (inv.count(ctx.p, a.item) < 1) return fail('You don’t have that.');
    if (distToTile(ctx.s.x, ctx.s.z, a.x, a.z) > config.reach + 0.5) return fail('Too far away.');
    if (Math.floor(ctx.s.x) === a.x && Math.floor(ctx.s.z) === a.z) return fail('Step aside first.');
    if (!ctx.room.grid.canPlace(a.x, a.z)) return fail('Can’t place it there.');
    inv.remove(ctx.p, a.item, 1);
    ctx.room.addObject({ id: ctx.room.newId('u'), kind: 'furniture', x: a.x, z: a.z, item: a.item, rot: a.rot });
    return { ok: true };
  },

  pickup(ctx, a) {
    if (!ctx.room.canDecorate(ctx.p.id)) return fail('That isn’t yours.');
    const o = getObj(ctx, a.id, 'furniture');
    if (isResult(o)) return o;
    const gained: Record<string, number> = {};
    if (!give(ctx, gained, o.item!, 1)) return fail('You can’t carry more.');
    ctx.room.removeObject(o.id);
    return { ok: true, gained };
  },

  talk(ctx, a) {
    const v = ctx.room.villagers.get(a.vid);
    const rec = ctx.room.record?.villagers.find((x) => x.defId === a.vid);
    const def = villagerDef(a.vid);
    if (!v || !rec || !def) return fail('Nobody here by that name.');
    if (v.home) return fail(`${def.name} is asleep at home.`);
    if (Math.hypot(v.x - ctx.s.x, v.z - ctx.s.z) > config.reach + 0.6) return fail('Get a little closer.');
    const env = ctx.room.env(ctx.now);
    const f = (rec.friendship[ctx.p.id] ??= { pts: 0 });
    const birthday = env.dayKey.slice(5) === def.birthday;
    if (f.talkDay !== env.dayKey) {
      f.talkDay = env.dayKey;
      f.pts = Math.min(FRIENDSHIP_MAX, f.pts + FRIENDSHIP_TALK);
    }
    // Villagers pause to chat.
    v.tx = v.x;
    v.tz = v.z;
    v.idleUntil = ctx.now + 8000;
    v.r = Math.atan2(ctx.s.x - v.x, ctx.s.z - v.z);
    v.dirty = true;
    const lvl = friendshipLevel(f.pts);
    const line = villagerLine(def, lvl.level, { player: ctx.p.name, weather: env.weather, hour: env.hour, seed: hashMany(env.dayKey, ctx.p.id, a.vid), birthday });
    ctx.game.levelUpCheck(ctx.s, ctx.room, rec.defId, f);
    ctx.game.store.markIsland(ctx.room.id);
    sendTalk(ctx, a.vid, line, f);
    return { ok: true };
  },

  gift(ctx, a) {
    const v = ctx.room.villagers.get(a.vid);
    const rec = ctx.room.record?.villagers.find((x) => x.defId === a.vid);
    const def = villagerDef(a.vid);
    if (!v || !rec || !def) return fail('Nobody here by that name.');
    if (v.home) return fail(`${def.name} is asleep.`);
    if (Math.hypot(v.x - ctx.s.x, v.z - ctx.s.z) > config.reach + 0.6) return fail('Get a little closer.');
    if (inv.count(ctx.p, a.item) < 1) return fail('You don’t have that.');
    const env = ctx.room.env(ctx.now);
    const f = (rec.friendship[ctx.p.id] ??= { pts: 0 });
    if (f.giftDay === env.dayKey) return fail(`${def.name} already got a gift from you today.`);
    const it = ITEMS[a.item];
    let delta = FRIENDSHIP_GIFT_NEUTRAL;
    let reaction: TalkView['reaction'] = 'neutral';
    let line = `Oh, a ${it.name}. Thanks, ${ctx.p.name}.`;
    if (def.loves.includes(a.item)) {
      delta = FRIENDSHIP_GIFT_LOVE; reaction = 'love';
      line = `A ${it.name}?! I LOVE these! You’re the best, ${def.catchphrase}!`;
    } else if (it.tags.some((t) => def.likes.includes(t))) {
      delta = FRIENDSHIP_GIFT_LIKE; reaction = 'like';
      line = `Ooh, a ${it.name}! That’s really thoughtful, ${def.catchphrase}.`;
    } else if (it.tags.some((t) => def.dislikes.includes(t))) {
      delta = FRIENDSHIP_GIFT_DISLIKE; reaction = 'dislike';
      line = `Um... a ${it.name}. I’m not really into those, ${def.catchphrase}.`;
    }
    if (env.dayKey.slice(5) === def.birthday && delta > 0) {
      delta += FRIENDSHIP_BIRTHDAY_BONUS;
      line += ' And on my birthday, too!';
    }
    inv.remove(ctx.p, a.item, 1);
    f.giftDay = env.dayKey;
    f.pts = Math.max(0, Math.min(FRIENDSHIP_MAX, f.pts + delta));
    ctx.game.levelUpCheck(ctx.s, ctx.room, rec.defId, f);
    ctx.game.store.markIsland(ctx.room.id);
    sendTalk(ctx, a.vid, line, f, reaction);
    return { ok: true };
  },

  buy(ctx, a) {
    const stock = SHOP_STOCK[a.shop];
    if (!stock || !stock.includes(a.item)) return fail('Not sold here.');
    if (ctx.room.kind !== 'island') return fail('No shop here.');
    if (!nearCompleted(ctx, [a.shop])) return fail(`Visit the ${BUILDINGS[a.shop].name}.`);
    const price = ITEMS[a.item].buy!;
    if (!inv.canAdd(ctx.p, a.item, a.n)) return fail('You can’t carry that many.');
    if (ctx.p.coins < price * a.n) return fail('Not enough coins.');
    ctx.p.coins -= price * a.n;
    const gained: Record<string, number> = {};
    give(ctx, gained, a.item, a.n);
    return { ok: true, gained, msg: `Bought ${ITEMS[a.item].name} for ${price * a.n} coins.` };
  },

  sell(ctx, a) {
    if (!ctx.room.canDecorate(ctx.p.id)) return fail('Sell items at home.');
    if (!nearCompleted(ctx, ['tent', 'cabin', 'town_hall', 'chest'])) return fail('Sell at your storage chest, house or town hall.');
    if (inv.count(ctx.p, a.item) < a.n) return fail('You don’t have that many.');
    if (ctx.p.hat === a.item && inv.count(ctx.p, a.item) <= a.n) ctx.p.hat = null;
    const price = ITEMS[a.item].sell * a.n;
    inv.remove(ctx.p, a.item, a.n);
    ctx.p.coins += price;
    return { ok: true, msg: `Sold for ${price} coins.` };
  },

  wear(ctx, a) {
    if (a.item !== null && (ITEMS[a.item].wear !== 'hat' || inv.count(ctx.p, a.item) < 1)) return fail('You can’t wear that.');
    ctx.p.hat = a.item;
    ctx.game.broadcastLook(ctx.s);
    return { ok: true };
  },

  restyle(ctx, a) {
    if (!nearCompleted(ctx, ['clothing_shop'])) return fail('Visit a Clothing Shop.');
    if (!(HAIR_STYLES[ctx.p.gender] as readonly string[]).includes(a.look.hair)) return fail('Invalid hairstyle.');
    const cost = 200;
    if (ctx.p.coins < cost) return fail(`A makeover costs ${cost} coins.`);
    ctx.p.coins -= cost;
    ctx.p.look = a.look;
    ctx.game.broadcastLook(ctx.s);
    return { ok: true, msg: 'Looking fresh!' };
  },

  mail(ctx, a) {
    if (ctx.room.kind !== 'island') return fail('Find a mailbox on an island.');
    if (!nearCompleted(ctx, ['mailbox'])) return fail('Stand next to a mailbox.');
    if (ctx.room.isOwner(ctx.p.id)) {
      // Your own mailbox: write to any friend.
      if (!ctx.p.friends.includes(a.to)) return fail('You can only send mail to friends.');
    } else if (a.to !== ctx.room.ownerId) {
      // Someone else's mailbox: you can leave a letter for its owner.
      return fail('This mailbox only takes letters for its owner.');
    }
    if (a.to === ctx.p.id) return fail('You can’t write to yourself.');
    const to = ctx.game.store.players.get(a.to);
    if (!to) return fail('Unknown player.');
    if (to.mail.length >= 50) return fail(`${to.name}’s mailbox is full.`);
    const n = a.n ?? 1;
    if (a.item) {
      if (inv.count(ctx.p, a.item) < n) return fail('You don’t have that.');
      inv.remove(ctx.p, a.item, n);
    }
    const text = ctx.game.sanitize(a.text);
    to.mail.push({ id: `m${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`, from: ctx.p.id, fromName: ctx.p.name, text, item: a.item, n: a.item ? n : undefined, at: ctx.now });
    ctx.game.store.markPlayer(to.id);
    ctx.game.notifyMail(to.id);
    return { ok: true, msg: `Letter sent to ${to.name}!` };
  },

  pave(ctx, a) {
    const g = paveGuard(ctx, a.x, a.z);
    if (g) return g;
    const def = pathDef(a.path)!;
    const grid = ctx.room.grid;
    const current = grid.path(a.x, a.z);
    if (current === a.path) return { ok: true };
    if (!grid.canPave(a.x, a.z)) return fail('You can’t lay a path there.');
    if (def.tool === 'shovel' && !inv.toolPower(ctx.p, 'shovel')) return fail('You need a shovel to dig a dirt path.');
    if (!inv.hasAll(ctx.p, def.cost)) return fail(`Not enough materials for ${def.name}.`);
    // Swapping one path for another refunds the old one.
    if (current) for (const [id, n] of Object.entries(pathDef(current)!.cost)) inv.add(ctx.p, id, n);
    inv.removeAll(ctx.p, def.cost);
    ctx.room.setPath(a.x, a.z, a.path);
    return { ok: true };
  },

  unpave(ctx, a) {
    const g = paveGuard(ctx, a.x, a.z);
    if (g) return g;
    const current = ctx.room.grid.path(a.x, a.z);
    if (!current) return { ok: true };
    for (const [id, n] of Object.entries(pathDef(current)!.cost)) inv.add(ctx.p, id, n);
    ctx.room.setPath(a.x, a.z, 0);
    return { ok: true };
  },

  takeMail(ctx, a) {
    const idx = ctx.p.mail.findIndex((m) => m.id === a.mailId);
    if (idx < 0) return fail('No such letter.');
    const m = ctx.p.mail[idx];
    const gained: Record<string, number> = {};
    if (m.item && m.n) {
      if (!inv.canAdd(ctx.p, m.item, m.n)) return fail('You can’t carry the attachment.');
      give(ctx, gained, m.item, m.n);
    }
    ctx.p.mail.splice(idx, 1);
    ctx.s.send({ t: 'mail', list: ctx.p.mail });
    return { ok: true, gained };
  },
};

function paveGuard(ctx: Ctx, x: number, z: number): ActionResult | null {
  if (!ctx.room.canBuild(ctx.p.id)) return fail('You can only lay paths on your own island.');
  if (!ctx.room.grid.inBounds(x, z)) return fail('Out of bounds.');
  if (distToTile(ctx.s.x, ctx.s.z, x, z) > PATH_REACH) return fail('Too far away.');
  // Painting sends many tiles quickly – allow ~16 per second.
  if (ctx.now - ctx.s.lastPaveAt < 55) return fail('Slow down!');
  ctx.s.lastPaveAt = ctx.now;
  return null;
}

function sendTalk(ctx: Ctx, vid: string, line: string, f: { pts: number; talkDay?: string; giftDay?: string }, reaction?: TalkView['reaction']) {
  const env = ctx.room.env(ctx.now);
  const lvl = friendshipLevel(f.pts);
  ctx.s.send({
    t: 'talk',
    v: { vid, line, points: f.pts, level: lvl.level, levelName: lvl.name, next: lvl.next, talkedToday: f.talkDay === env.dayKey, giftedToday: f.giftDay === env.dayKey, reaction },
  });
}

export function runAction(game: Game, s: Session, a: Action): ActionResult {
  const room = s.room;
  const p = s.player;
  if (!room || !p) return fail('Not in the world.');
  const ctx: Ctx = { game, s, room, p, now: Date.now() };
  const h = handlers[a.k] as (ctx: Ctx, a: Action) => ActionResult;
  return h(ctx, a);
}
