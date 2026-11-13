import {
  Grid, decodeTiles, isWaterTile, BUILDINGS, PROTOCOL_VERSION, ISLAND_SIZE, TERRA_REACH, Tile, applyTerrain, distToTile, relocationCost, placeError, classifyWater, FISH, DIRS, SEA_LEVEL, WADE_FLOOR, terraformError, terraformChanges, applyTerrainAndWater,
  type RoomView, type ServerMessage, type WorldObject, type BuildingType,
} from '@hearthwood/shared';
import { Bot, BASE, PORT, check, sleep, http, state, enterAndBack, exitTo, type Ctx } from '../harness.ts';

export async function run(ctx: Ctx) {
  const { A } = ctx;
  console.log('Terraforming');
  check(A.grid.size === ISLAND_SIZE && ISLAND_SIZE === 72, 'new islands are 72×72 (1.5× the old 48)');
  {
    // Find a flat, empty 5×6 patch near the player: T gets raised, R below it becomes a ramp.
    const g = A.grid;
    const flat = (x: number, z: number) => g.tile(x, z) === Tile.Ground && g.level(x, z) === 0 && g.occupied[z * g.size + x] === 0 && !g.reserved[z * g.size + x] && !g.path(x, z);
    let spot: [number, number] | null = null;
    // Any flat patch on the island, nearest first; then walk up beside it.
    const patches: [number, number][] = [];
    for (let z = 3; z < g.size - 4; z++)
      for (let x = 3; x < g.size - 4; x++) {
        let ok = true;
        for (let zz = z - 2; zz <= z + 3 && ok; zz++) for (let xx = x - 2; xx <= x + 2 && ok; xx++) ok = flat(xx, zz);
        if (ok) patches.push([x, z]);
      }
    patches.sort((p, q) => Math.hypot(p[0] - A.x, p[1] - A.z) - Math.hypot(q[0] - A.x, q[1] - A.z));
    for (const [x, z] of patches.slice(0, 15)) {
      if (!(await A.walkTo(x + 3, z, false).catch(() => false))) continue;
      const away = (tx: number, tz: number) => Math.hypot(tx + 0.5 - A.x, tz + 0.5 - A.z) > 1.3;
      if (away(x, z) && away(x, z + 1) && distToTile(A.x, A.z, x, z) <= TERRA_REACH - 0.5 && distToTile(A.x, A.z, x, z + 1) <= TERRA_REACH - 0.5) {
        spot = [x, z];
        break;
      }
    }
    check(!!spot, 'found a flat spot to terraform');
    if (spot) {
      const [tx, tz] = spot;
      const noTool = await A.act({ k: 'terra', op: 'raise', x: tx, z: tz });
      check(!noTool.ok && /Permit/.test(noTool.err ?? ''), 'terraforming needs a Town Hall permit');
      A.send({ t: 'dev', cmd: 'permits', args: [] });
      await A.wait('self', (m) => m.you.permits.length === 2);
      const me = await A.act({ k: 'terra', op: 'raise', x: Math.floor(A.x), z: Math.floor(A.z) });
      check(!me.ok, 'cannot raise the ground you stand on');
      const up = await A.act({ k: 'terra', op: 'raise', x: tx, z: tz });
      check(up.ok, `cliff raised${up.ok ? '' : ` (${up.err})`}`);
      await A.wait('terrain', (m) => m.l.some((c) => c[0] === tx && c[1] === tz)).catch(() => null);
      check(A.grid.level(tx, tz) === 1, 'raised tile is one level up');
      const twice = await A.act({ k: 'terra', op: 'raise', x: tx, z: tz });
      check(!twice.ok, 'cliffs rise one level at a time (neighbours first)');
      const ramp = await A.act({ k: 'terra', op: 'ramp', x: tx, z: tz + 1, dir: 0 });
      check(ramp.ok, `ramp built up to the new cliff${ramp.ok ? '' : ` (${ramp.err})`}`);
      await sleep(150);
      check(A.grid.ramp(tx, tz + 1) === 0 && A.grid.stepOk(tx, tz + 1, tx, tz), 'the ramp connects both levels');
      check(!(await A.act({ k: 'terra', op: 'lower', x: tx, z: tz })).ok, 'cannot lower a ramp landing');
      for (const [op, style] of [['stairs_stone', 1], ['stairs_wood', 2], ['stairs_log', 3]] as const) {
        const st = await A.act({ k: 'terra', op, x: tx, z: tz + 1 });
        await sleep(120);
        check(st.ok && A.grid.rampStyle(tx, tz + 1) === style && A.grid.ramp(tx, tz + 1) === 0, `ramp turned into ${op.replace('_', ' ')}${st.ok ? '' : ` (${st.err})`}`);
      }
      check(!(await A.act({ k: 'terra', op: 'stairs_log', x: tx, z: tz + 1 })).ok, 'same stairs again is refused');
      check(A.grid.stepOk(tx, tz + 1, tx, tz), 'stairs still connect both levels');
      check((await A.act({ k: 'terra', op: 'unramp', x: tx, z: tz + 1 })).ok, 'ramp removed');
      check((await A.act({ k: 'terra', op: 'lower', x: tx, z: tz })).ok, 'cliff lowered again');
      check((await A.act({ k: 'terra', op: 'water', x: tx, z: tz })).ok, 'pond dug');
      await sleep(150);
      check(A.grid.tile(tx, tz) === Tile.Pond, 'tile is water now');
      check((await A.act({ k: 'terra', op: 'land', x: tx, z: tz })).ok, 'pond filled in');
      const far = await A.act({ k: 'terra', op: 'raise', x: Math.min(A.grid.size - 3, Math.floor(A.x) + 15), z: Math.floor(A.z) });
      check(!far.ok, 'terraforming far away is refused');
      // Leave one raised tile so persistence can be checked after a reload.
      check((await A.act({ k: 'terra', op: 'raise', x: tx, z: tz })).ok, 'raised again (kept for the save check)');
      state.terraSpot = spot;
      state.terraIsland = A.room.id;
    }
  }
}
