// Building and moving houses, placing furniture, laying and lifting paths.

import {
  type Building, BUILDINGS, type BuildingType, distToTile, ENTERABLE, ITEMS, MAX_VILLAGERS, nearBuilding, PATH_REACH, pathDef, placeError, relocationCost, VILLAGER_HOUSE_MONTH_ONE_LIMIT, VILLAGER_HOUSE_MONTH_TWO_MIN_DAY,
} from '@hearthwood/shared';
import { config } from '../../config.ts';
import * as inv from '../inventory.ts';
import { type ActionResult, type Ctx, fail, getObj, give, type Handlers, isResult, log } from './context.ts';

export const buildHandlers: Pick<Handlers, 'build' | 'relocate' | 'demolish' | 'place' | 'pickup' | 'pave' | 'unpave'> = {
  build(ctx, a) {
    const def = BUILDINGS[a.type];
    if (!ctx.room.canBuild(ctx.p.id)) return fail('You can only build on your own island.');
    if (def.fixed) return fail('That can’t be built.');
    const day = ctx.room.islandDay(ctx.now);
    for (const req of def.requires) {
      if (ctx.room.completedCount(req, ctx.now) < 1) return fail(`Requires a finished ${BUILDINGS[req].name}.`);
    }
    if (!config.ignoreDayGates && day < def.minDay) return fail(`${def.name} unlocks on island day ${def.minDay} (today is day ${day}).`);
    // Everyone who lives here may have their own tent and house.
    const personal = a.type === 'tent' || a.type === 'cabin';
    const houseOwner = (b: Building) => b.ownerId ?? ctx.room.ownerId;
    const builder = ctx.room.isOwner(ctx.p.id) || ctx.room.isResident(ctx.p.id) ? ctx.p.id : ctx.room.ownerId!;
    if (personal && !ctx.room.isOwner(ctx.p.id) && !ctx.room.isResident(ctx.p.id)) return fail('Only the owner and residents can build homes here.');
    const existing = personal ? [...ctx.room.buildings.values()].filter((b) => b.type === a.type && houseOwner(b) === builder).length : ctx.room.totalCount(a.type);
    let max = def.max;
    if (a.type === 'villager_house' && !config.ignoreDayGates && day < VILLAGER_HOUSE_MONTH_TWO_MIN_DAY) max = VILLAGER_HOUSE_MONTH_ONE_LIMIT;
    if (existing >= max) {
      return fail(a.type === 'villager_house' && max < def.max ? `More houses unlock on day ${VILLAGER_HOUSE_MONTH_TWO_MIN_DAY}.` : `You already have the maximum number of ${def.name}s.`);
    }
    if (a.type === 'villager_house' && ctx.room.villagers.size + ctx.room.totalCount('villager_house') - ctx.room.completedCount('villager_house') >= MAX_VILLAGERS)
      return fail('Your village is full.');
    const where = placementError(ctx, a.type, a.x, a.z, def.w, def.h);
    if (where) return fail(where);
    if (!inv.removeAll(ctx.p, def.cost)) return fail('Not enough materials.');
    const b: Building = {
      id: ctx.room.newId('b'), type: a.type, x: a.x, z: a.z, w: def.w, h: def.h,
      completeAt: ctx.now + (def.buildMinutes * 60000) / config.timeFactor,
    };
    if (personal && builder !== ctx.room.ownerId) b.ownerId = builder;
    ctx.room.addBuilding(b);
    const mins = Math.round((def.buildMinutes) / config.timeFactor);
    return { ok: true, msg: def.buildMinutes ? `Construction started! Ready in about ${mins >= 60 ? `${Math.round(mins / 60)}h` : `${Math.max(1, mins)} min`}.` : `${def.name} built!` };
  },
  relocate(ctx, a) {
    const room = ctx.room;
    if (!room.canBuild(ctx.p.id)) return fail('You can only move buildings on your own island.');
    const b = room.buildings.get(a.id);
    if (!b) return fail('That building isn’t there any more.');
    if (BUILDINGS[b.type].fixed || b.type === 'dock') return fail('That can’t be moved.');
    if (b.ownerId && b.ownerId !== ctx.p.id && !room.isOwner(ctx.p.id)) return fail('That’s someone else’s home.');
    if (b.x === a.x && b.z === a.z) return fail('It’s already there.');
    const cost = relocationCost(b.w, b.h);
    if (ctx.p.coins < cost) return fail(`Moving it costs ${cost} coins.`);
    // Check the new spot as if the building weren't standing where it is now.
    room.grid.removeBuilding(b);
    const where = placementError(ctx, b.type, a.x, a.z, b.w, b.h);
    room.grid.addBuilding(b);
    if (where) return fail(where);
    for (const v of room.villagers.values())
      if (v.x >= a.x - 0.3 && v.x <= a.x + b.w + 0.3 && v.z >= a.z - 0.3 && v.z <= a.z + b.h + 0.3) return fail('A villager is in the way.');
    ctx.p.coins -= cost;
    room.moveBuilding(b, a.x, a.z);
    log.info('building moved', { player: ctx.p.id, island: room.id, building: b.type, to: [a.x, a.z], cost });
    return { ok: true, msg: `${BUILDINGS[b.type].name} moved! (−${cost} coins)` };
  },
  demolish(ctx, a) {
    if (!ctx.room.canBuild(ctx.p.id)) return fail('Not your island.');
    const b = ctx.room.buildings.get(a.id);
    if (!b) return fail('Nothing there.');
    if (b.ownerId && b.ownerId !== ctx.p.id && !ctx.room.isOwner(ctx.p.id)) return fail('That’s someone else’s home.');
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
};

/** Where a building of this size may not go (null = fine). Shared by building and moving. */
function placementError(ctx: Ctx, type: BuildingType, x: number, z: number, w: number, h: number): string | null {
  const grid = ctx.room.grid;
  const bad = placeError(grid, type, x, z);
  if (bad) return bad;
  if (ENTERABLE.includes(type)) {
    // The door (south side) must open onto walkable ground on the same cliff level.
    const lvl = grid.level(x, z);
    for (let dx = 0; dx < w; dx++) {
      const tx = x + dx, tz = z + h;
      if (!grid.walkableTile(tx, tz) || grid.level(tx, tz) !== lvl || grid.ramp(tx, tz) >= 0) return 'The door needs open ground in front of it.';
    }
  }
  // Must be close to the player and not on top of anyone.
  if (Math.hypot(ctx.s.x - (x + w / 2), ctx.s.z - (z + h / 2)) > 6) return 'Move closer to where you want it.';
  for (const other of ctx.room.sessions) {
    if (other.x >= x - 0.3 && other.x <= x + w + 0.3 && other.z >= z - 0.3 && other.z <= z + h + 0.3) return 'Someone is standing there.';
  }
  return null;
}

function paveGuard(ctx: Ctx, x: number, z: number): ActionResult | null {
  if (!ctx.room.canBuild(ctx.p.id)) return fail('You can only lay paths on your own island.');
  if (!ctx.room.grid.inBounds(x, z)) return fail('Out of bounds.');
  if (distToTile(ctx.s.x, ctx.s.z, x, z) > PATH_REACH) return fail('Too far away.');
  // Painting sends many tiles quickly – allow ~16 per second.
  if (ctx.now - ctx.s.lastPaveAt < 55) return fail('Slow down!');
  ctx.s.lastPaveAt = ctx.now;
  return null;
}
