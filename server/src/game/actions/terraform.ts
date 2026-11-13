// Terraforming: cliffs, ramps and stairs, digging and filling water.

import {
  distToTile, isRampOp, PERMIT_BY_ID, TERRA_PERMIT, TERRA_REACH, terraformChanges, terraformError, Tile,
} from '@hearthwood/shared';
import { fail, type Handlers } from './context.ts';

export const terraformHandlers: Pick<Handlers, 'terra'> = {
  terra(ctx, a) {
    const room = ctx.room;
    if (!room.canBuild(ctx.p.id)) return fail('You can only reshape your own island.');
    const grid = room.grid;
    if (!grid.inBounds(a.x, a.z)) return fail('Out of bounds.');
    if (distToTile(ctx.s.x, ctx.s.z, a.x, a.z) > TERRA_REACH) return fail('Too far away.');
    const permit = PERMIT_BY_ID[TERRA_PERMIT[a.op]];
    // Builders and residents may use the island owner's permits.
    const owner = ctx.game.store.players.get(room.ownerId ?? '');
    if (!(ctx.p.permits ?? []).includes(permit.id) && !(owner?.permits ?? []).includes(permit.id)) return fail(`You need a ${permit.name} – buy one at the Town Hall.`);
    if (ctx.now - ctx.s.lastPaveAt < 120) return fail('Slow down!');
    ctx.s.lastPaveAt = ctx.now;
    const err = terraformError(grid, a.op, a.x, a.z, a.dir ?? -1);
    if (err) return fail(err);
    // Never bury or drown anyone standing there (or walking there).
    if (a.op === 'raise' || a.op === 'water' || (isRampOp(a.op) && grid.tile(a.x, a.z) !== Tile.Ramp)) {
      const on = (px: number, pz: number) => Math.abs(px - (a.x + 0.5)) < 0.75 && Math.abs(pz - (a.z + 0.5)) < 0.75;
      for (const s of room.sessions) if (on(s.x, s.z)) return fail(s === ctx.s ? 'Step off that spot first.' : 'Someone is standing there.');
      for (const v of room.villagers.values()) if (on(v.x, v.z) || on(v.tx, v.tz)) return fail('A villager is in the way.');
    }
    room.setTerrain(terraformChanges(grid, a.op, a.x, a.z, a.dir ?? -1));
    return { ok: true };
  },
};
