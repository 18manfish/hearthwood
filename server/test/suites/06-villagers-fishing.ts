import {
  Grid, decodeTiles, isWaterTile, BUILDINGS, PROTOCOL_VERSION, ISLAND_SIZE, TERRA_REACH, Tile, applyTerrain, distToTile, relocationCost, placeError, classifyWater, FISH, DIRS, SEA_LEVEL, WADE_FLOOR, terraformError, terraformChanges, applyTerrainAndWater,
  type RoomView, type ServerMessage, type WorldObject, type BuildingType,
} from '@hearthwood/shared';
import { Bot, BASE, PORT, check, sleep, http, state, enterAndBack, exitTo, type Ctx } from '../harness.ts';

export async function run(ctx: Ctx) {
  const { A, vAdd, vid } = ctx;
  console.log('Villagers');
  const vs = vAdd.v[0];
  await A.walkTo(Math.floor(vs.x), Math.floor(vs.z));
  // Villagers wander; follow the latest broadcast position.
  let talk = null;
  for (let i = 0; i < 6 && !talk; i++) {
    const pos = [...A.inbox].reverse().find((m) => m.t === 'vs' && m.l.some((e) => e[0] === vid)) as Extract<ServerMessage, { t: 'vs' }> | undefined;
    const e = pos?.l.find((x) => x[0] === vid);
    if (e && e[4] === 1) break; // night – indoors
    if (e) await A.walkTo(Math.floor(e[1]), Math.floor(e[2]));
    const r = await A.act({ k: 'talk', vid });
    if (r.ok) talk = await A.wait('talk');
  }
  if (talk) {
    check(talk.v.points >= 2, `talking raises friendship (“${talk.v.line}”)`);
    const g = await A.act({ k: 'gift', vid, item: 'wood' });
    if (g.ok) {
      const t3 = await A.wait('talk');
      check(!!t3.v.reaction, `gift reaction: ${t3.v.reaction}`);
      check(!(await A.act({ k: 'gift', vid, item: 'wood' })).ok, 'only one gift per villager per day');
    }
  } else console.log('  (villagers are asleep at this local hour – skipped talk test)');

  console.log('Fishing');
  let castTile: [number, number] | null = null;
  let stand: [number, number] | null = null;
  outer: for (let z = 1; z < A.grid.size - 1; z++)
    for (let x = 1; x < A.grid.size - 1; x++) {
      if (!A.grid.walkableTile(x, z)) continue;
      for (const [dx, dz] of [[0, 1], [1, 0], [0, -1], [-1, 0]]) {
        if (isWaterTile(A.grid.tile(x + dx, z + dz)) && A.grid.tile(x + dx, z + dz) === 3) {
          stand = [x, z]; castTile = [x + dx, z + dz]; break outer;
        }
      }
    }
  if (stand && castTile) {
    await A.walkTo(stand[0], stand[1], false);
    let caught = false;
    for (let i = 0; i < 3 && !caught; i++) {
      const c = await A.act({ k: 'cast', x: castTile[0], z: castTile[1] });
      if (!c.ok || c.msg) { console.log('  cast:', c.err ?? c.msg); break; }
      const bite = await A.wait('bite', () => true, 8000);
      A.send({ t: 'act', seq: ++A.seq, a: { k: 'reel', castId: bite.castId } });
      const f = await A.wait('fish', () => true, 3000).catch(() => null);
      caught = !!f?.ok;
      if (f) check(f.ok, f.msg);
    }
    // Reeling early fails.
    const c2 = await A.act({ k: 'cast', x: castTile[0], z: castTile[1] });
    if (c2.ok && !c2.msg) {
      const early = await A.act({ k: 'reel', castId: 'c999999' });
      check(!early.ok, 'reeling a cast that is not yours is rejected');
    }
  }
}
