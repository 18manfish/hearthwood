// Gathering: shaking and chopping trees, digging, breaking rocks, foraging, planting.

import {
  BIOMES, distToTile, TREES, type WorldObject,
} from '@hearthwood/shared';
import { config } from '../../config.ts';
import * as inv from '../inventory.ts';
import { type ActionResult, type Ctx, fail, getObj, give, type Handlers, harvestGuard, isResult, log, rngFor } from './context.ts';

export const gatherHandlers: Pick<Handlers, 'shake' | 'chop' | 'dig' | 'hit' | 'forage' | 'plant'> = {
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
    const o = getObj(ctx, a.id, ['bush', 'mushroom', 'flower', 'washed']);
    if (isResult(o)) return o;
    const gained: Record<string, number> = {};
    if (o.kind === 'washed') {
      if (o.bottle) return openBottle(ctx, o);
      if (!give(ctx, gained, o.item ?? 'seashell', 1)) return fail('Your pockets are full of those.');
      ctx.room.removeObject(o.id);
      return { ok: true, gained };
    }
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
};

/** A message in a bottle washed up: the island owner reads it (it goes to their letters) and keeps the bottle. */
function openBottle(ctx: Ctx, o: WorldObject): ActionResult {
  const rec = ctx.room.record;
  if (!rec || ctx.room.ownerId !== ctx.p.id) return fail('This bottle washed up for the island’s owner.');
  const b = rec.bottles?.find((x) => x.id === o.bottle);
  ctx.room.removeObject(o.id);
  rec.bottles = (rec.bottles ?? []).filter((x) => x.id !== o.bottle);
  const gained: Record<string, number> = {};
  give(ctx, gained, 'message_bottle', 1);
  if (!b) return { ok: true, gained, msg: 'The bottle was empty.' };
  ctx.p.mail.push({ id: `m${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`, from: '', fromName: `${b.fromName} (🍾 message in a bottle)`, text: b.text, at: ctx.now });
  ctx.game.store.bottleOpened(b.id);
  ctx.game.store.markIsland(rec.id);
  ctx.s.send({ t: 'mail', list: ctx.p.mail });
  log.info('bottle opened', { bottle: b.id, by: ctx.p.id });
  return { ok: true, gained, msg: `🍾 A message in a bottle from ${b.fromName}! It’s in your letters (L).` };
}
