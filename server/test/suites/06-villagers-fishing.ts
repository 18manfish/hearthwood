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
    // You can only fish at a fish shadow.
    const shadowNear = () => [...A.objects.values()].some((o) => o.kind === 'fish' && Math.max(Math.abs(o.x - castTile![0]), Math.abs(o.z - castTile![1])) <= 1);
    if (!shadowNear()) check(!(await A.act({ k: 'cast', x: castTile[0], z: castTile[1] })).ok, 'casting where there is no fish shadow is refused');
    let caught = false;
    for (let i = 0; i < 3 && !caught; i++) {
      const spot = await A.fishShadow(castTile[0], castTile[1]);
      check(spot?.size === 'medium', 'ponds have (medium) fish shadows to cast at');
      const c = await A.act({ k: 'cast', x: castTile[0], z: castTile[1] });
      if (!c.ok || c.msg) { console.log('  cast:', c.err ?? c.msg); break; }
      const bite = await A.wait('bite', () => true, 8000);
      A.send({ t: 'act', seq: ++A.seq, a: { k: 'reel', castId: bite.castId } });
      const f = await A.wait('fish', () => true, 3000).catch(() => null);
      caught = !!f?.ok;
      if (f) check(f.ok, f.msg);
      if (caught && spot) {
        await sleep(200);
        check(!A.objects.has(spot.id), 'the shadow is gone once its fish is caught');
        check(FISH.find((x) => x.id === f!.item)?.water === 'pond', `a pond shadow gives a pond fish (${f!.item})`);
      }
    }
    // Reeling early fails.
    await A.fishShadow(castTile[0], castTile[1]);
    const c2 = await A.act({ k: 'cast', x: castTile[0], z: castTile[1] });
    if (c2.ok && !c2.msg) {
      const early = await A.act({ k: 'reel', castId: 'c999999' });
      check(!early.ok, 'reeling a cast that is not yours is rejected');
    }
  }
  // Sea shadows come in three sizes, and each size has its own fish.
  let seaStand: [number, number] | null = null, seaTile: [number, number] | null = null;
  outerS: for (let z = 1; z < A.grid.size - 1; z++)
    for (let x = 1; x < A.grid.size - 1; x++) {
      if (!A.grid.walkableTile(x, z)) continue;
      for (const [dx, dz] of [[0, 1], [1, 0], [0, -1], [-1, 0]])
        if (A.grid.tile(x + dx * 2, z + dz * 2) === Tile.Sea && A.grid.tile(x + dx, z + dz) === Tile.Sea) {
          if (!(await A.walkTo(x, z, false))) continue outerS;
          seaStand = [x, z]; seaTile = [x + dx * 2, z + dz * 2]; break outerS;
        }
    }
  if (seaStand && seaTile) {
    A.inbox = A.inbox.filter((m) => m.t !== 'bite' && m.t !== 'fish');
    const spot = await A.fishShadow(seaTile[0], seaTile[1], 'small');
    if (spot) {
      const c = await A.act({ k: 'cast', x: seaTile[0], z: seaTile[1] });
      if (c.ok && !c.msg) {
        const bite = await A.wait('bite', () => true, 8000);
        A.send({ t: 'act', seq: ++A.seq, a: { k: 'reel', castId: bite.castId } });
        const f = await A.wait('fish', () => true, 3000).catch(() => null);
        const def = FISH.find((x) => x.id === f?.item);
        check(!!def && def.water === 'sea' && (def.shadow ?? 'medium') === spot.size, `a ${spot.size} sea shadow gives a ${spot.size} sea fish (${f?.item})`);
      } else console.log('  sea cast:', c.err ?? c.msg);
    }
  }
}
