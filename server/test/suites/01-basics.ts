import {
  Grid, decodeTiles, isWaterTile, BUILDINGS, PROTOCOL_VERSION, ISLAND_SIZE, TERRA_REACH, Tile, applyTerrain, distToTile, relocationCost, placeError, classifyWater, FISH, DIRS, SEA_LEVEL, WADE_FLOOR, terraformError, terraformChanges, applyTerrainAndWater,
  type RoomView, type ServerMessage, type WorldObject, type BuildingType,
} from '@hearthwood/shared';
import { Bot, BASE, PORT, check, sleep, http, state, enterAndBack, exitTo, type Ctx } from '../harness.ts';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../../src/store.ts';
import type { PlayerRecord } from '../../src/types.ts';

export async function run(ctx: Ctx) {
  console.log('Accounts & character creation');
  const A = new Bot('A');
  const w = await A.connect();
  check(w.t === 'welcome' && w.you === null, 'new account needs character creation');
  A.send({ t: 'move', seq: 1, x: 1, z: 1, r: 0 });
  check((await A.wait('err')).code === 'no_character', 'actions rejected before character exists');
  A.send({ t: 'create', name: 'X', islandName: 'Isle', gender: 'boy', biome: 'mars', look: {}, geo: {} });
  check((await A.wait('err')).code === 'bad_message', 'invalid create payload rejected by schema');
  const look = { skin: '#f1c27d', hair: 'ponytail', hairColor: '#5a3a1e', eyes: '#2b1d14', shirt: '#e74c3c', pants: '#34495e', shoes: '#8d6e63' };
  const geo = { lat: 47.37, lon: 8.54, tz: 'Europe/Zurich' };
  let badDates = 0;
  for (const birthday of [undefined, '2001-02-29', '1899-12-31', `${new Date().getFullYear() + 1}-01-01`, '14.03.1990']) {
    A.send({ t: 'create', name: 'Alice', islandName: 'Isle', gender: 'girl', biome: 'grassland', look, geo, birthday });
    if ((await A.wait('err')).code === 'bad_message') badDates++;
  }
  check(badDates === 5, 'a missing or impossible birthday is refused');
  await A.create('grassland', 'Alice', '2000-02-29');
  check(A.room.kind === 'island' && A.room.canHarvest, 'Alice lands on her own island');
  check(A.self.birthday === '2000-02-29', 'her birthday is saved with the character');
  {
    // Characters made before birthdays existed get 1 January 1970.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hw-bday-'));
    const old = new Store(dir);
    old.load();
    old.addPlayer({ id: 'p_old', code: 'OLDCODE1', name: 'Oldie', created: true, mail: [], inv: {}, friends: [], reqIn: [], reqOut: [] } as unknown as PlayerRecord);
    old.addPlayer({ id: 'p_new', code: 'NEWCODE1', name: 'Newbie', created: false, mail: [], inv: {}, friends: [], reqIn: [], reqOut: [] } as unknown as PlayerRecord);
    old.close();
    const again = new Store(dir);
    again.load();
    check(again.players.get('p_old')?.birthday === '1970-01-01' && again.players.get('p_new')?.birthday === undefined, 'existing characters get 1 January 1970 as their birthday');
    again.flush();
    again.close();
    const third = new Store(dir);
    third.load();
    check(third.players.get('p_old')?.birthday === '1970-01-01', '… and it is saved');
    third.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
  check(/[12]/.test(A.room.levels) && /[1-4]/.test(A.room.ramps), 'island has cliff levels and ramps');

  console.log('Elevation');
  // Find a cliff edge: level-0 tile next to a level-1 tile that is not a ramp.
  let edge: [number, number, number, number] | null = null;
  for (let z = 1; z < A.grid.size - 1 && !edge; z++)
    for (let x = 1; x < A.grid.size - 1 && !edge; x++) {
      if (!A.grid.walkableTile(x, z) || A.grid.level(x, z) !== 0 || A.grid.ramp(x, z) >= 0) continue;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]])
        if (A.grid.walkableTile(x + dx, z + dz) && A.grid.level(x + dx, z + dz) === 1 && A.grid.ramp(x + dx, z + dz) < 0) { edge = [x, z, dx, dz]; break; }
    }
  if (edge && (await A.walkTo(edge[0], edge[1], false))) {
    const [ex, ez, dx, dz] = edge;
    let blocked = false;
    for (let i = 1; i <= 6; i++) {
      A.send({ t: 'move', seq: ++A.seq, x: ex + 0.5 + dx * 0.25 * i, z: ez + 0.5 + dz * 0.25 * i, r: 0 });
      await sleep(110);
      if (A.inbox.some((m) => m.t === 'corr')) { blocked = true; break; }
    }
    check(blocked, 'walking up a cliff wall is rejected');
    A.inbox = A.inbox.filter((m) => m.t !== 'corr');
  }
  // A ramp leads up.
  let rampTile: [number, number] | null = null;
  for (let z = 0; z < A.grid.size && !rampTile; z++) for (let x = 0; x < A.grid.size; x++) if (A.grid.ramp(x, z) >= 0 && A.grid.level(x, z) === 0) { rampTile = [x, z]; break; }
  if (rampTile) {
    const d = [[0, -1], [1, 0], [0, 1], [-1, 0]][A.grid.ramp(rampTile[0], rampTile[1])];
    const ok = await A.walkTo(rampTile[0] + d[0], rampTile[1] + d[1], false);
    check(ok && !A.inbox.some((m) => m.t === 'corr') && A.grid.level(Math.floor(A.x), Math.floor(A.z)) === 1, 'climbing a ramp reaches the plateau');
    await A.walkTo(Math.floor(A.room.spawn.x), Math.floor(A.room.spawn.z) - 3, false);
  }

  console.log('Movement validation');
  A.send({ t: 'move', seq: 2, x: A.x + 15, z: A.z, r: 0 });
  const corr = await A.wait('corr');
  check(!!corr, 'teleport attempt is corrected by the server');
  A.send({ t: 'move', seq: 3, x: A.x, z: A.z + 0.3, r: 0 });
  await sleep(200);
  check(!A.inbox.some((m) => m.t === 'corr'), 'normal step accepted');
  A.z += 0.3;

  console.log('Gathering without tools');
  const tree = A.nearest('tree', (o) => o.stage === 2)!;
  await A.walkTo(tree.x, tree.z);
  const shake = await A.act({ k: 'shake', id: tree.id });
  check(shake.ok && (shake.gained?.wood ?? 0) >= 1, 'shaking a tree drops a branch');
  const chopNoAxe = await A.act({ k: 'chop', id: tree.id });
  check(!chopNoAxe.ok, `chopping without an axe is refused (“${chopNoAxe.err}”)`);
  const rock = A.nearest('rock')!;
  await A.walkTo(rock.x, rock.z);
  const r1 = await A.act({ k: 'hit', id: rock.id });
  const r2 = await A.act({ k: 'hit', id: rock.id });
  const r3 = await A.act({ k: 'hit', id: rock.id });
  check(r1.ok && r2.ok && !r3.ok, 'only two loose stones per rock by hand');
  const far = A.nearest('tree', (o) => Math.hypot(o.x - A.x, o.z - A.z) > 6)!;
  const farRes = await A.act({ k: 'shake', id: far.id });
  check(!farRes.ok && farRes.err === 'Too far away.', 'distance is validated');
  Object.assign(ctx, { A });
}
