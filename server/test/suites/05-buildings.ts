import {
  Grid, decodeTiles, isWaterTile, BUILDINGS, PROTOCOL_VERSION, ISLAND_SIZE, TERRA_REACH, Tile, applyTerrain, distToTile, relocationCost, placeError, classifyWater, FISH, DIRS, SEA_LEVEL, WADE_FLOOR, terraformError, terraformChanges, applyTerrainAndWater,
  type RoomView, type ServerMessage, type WorldObject, type BuildingType,
} from '@hearthwood/shared';
import { Bot, BASE, PORT, check, sleep, http, state, enterAndBack, exitTo, type Ctx } from '../harness.ts';

export async function run(ctx: Ctx) {
  const { A } = ctx;
  console.log('Moving buildings');
  {
    const fire = A.room.buildings.find((b) => b.type === 'campfire')!;
    A.send({ t: 'dev', cmd: 'coins', args: ['2000'] });
    await sleep(300);
    const coins0 = A.coins;
    let moved = false;
    for (const [x, z] of A.freeSpots('campfire').filter(([x, z]) => Math.hypot(x - fire.x, z - fire.z) > 3).slice(0, 30)) {
      if (!(await A.walkTo(x - 1, z, false))) continue;
      const r = await A.act({ k: 'relocate', id: fire.id, x, z });
      if (!r.ok) continue;
      await sleep(200);
      const now = A.room.buildings.find((b) => b.id === fire.id)!;
      check(now.x === x && now.z === z, 'campfire moved to its new spot');
      check(A.coins === coins0 - relocationCost(fire.w, fire.h), 'moving cost coins');
      moved = true;
      break;
    }
    check(moved, 'a building can be moved');
    const dock = A.room.buildings.find((b) => b.type === 'dock')!;
    check(!(await A.act({ k: 'relocate', id: dock.id, x: 5, z: 5 })).ok, 'the dock cannot be moved');
  }

  console.log('Tent interior');
  const islandId = A.room.id;
  const tent = A.room.buildings.find((b) => b.type === 'tent')!;
  // From behind the tent you can't get in – only through the door.
  if (await A.walkTo(tent.x, tent.z - 1, false)) {
    A.send({ t: 'travel', to: { kind: 'enter', id: tent.id } });
    check(!!(await A.wait('toast', (m) => /front of the door/.test(m.text)).catch(() => null)), 'buildings are entered through the door only');
  }
  await A.walkTo(tent.x, tent.z + tent.h, false);
  A.send({ t: 'travel', to: { kind: 'enter', id: tent.id } });
  await A.wait('room', (m) => m.room.kind === 'interior');
  check(A.room.kind === 'interior' && A.room.interior === 'tent', 'entered the tent');
  check(A.room.buildings.some((b) => b.type === 'bed') && A.room.canDecorate && !A.room.canBuild, 'tent has a bed; can decorate but not build inside');
  const chest = A.room.buildings.find((b) => b.type === 'chest')!;
  await A.walkTo(chest.x, chest.z + 1, false);
  check((await A.act({ k: 'sell', item: 'stone', n: 1 })).ok, 'sell box (chest) works inside');
  A.send({ t: 'travel', to: { kind: 'exit' } });
  await A.wait('room', (m) => m.room.kind === 'island');
  check(A.room.id === islandId && Math.abs(A.z - (tent.z + tent.h + 0.45)) < 0.6, 'exit puts you back in front of the tent');

  console.log('Village growth');
  const cab = await A.build('cabin');
  check(cab.ok, `starter house construction started ${cab.err ?? ''}`);
  check(!(await A.build('town_hall')).ok, 'town hall requires a finished house');
  await A.chat('/finish');
  await sleep(300);
  const th = await A.build('town_hall');
  check(th.ok, `town hall construction started ${th.err ?? ''}`);
  await A.chat('/finish');
  await sleep(300);
  await A.chat('/kit');
  const vh = await A.build('villager_house');
  check(vh.ok, `villager house construction started ${vh.err ?? ''}`);
  await A.chat('/finish');
  const vAdd = await A.wait('vAdd');
  const vid = vAdd.v[0].id;
  check(!!vid, `a villager moved in (${vid})`);

  console.log('Interiors');
  const hall = A.room.buildings.find((b) => b.type === 'town_hall')!;
  const thIn = await enterAndBack(A, hall);
  const counter = thIn?.buildings.find((b) => b.type === 'counter');
  check(thIn?.interior === 'town_hall' && counter?.role === 'town_hall', 'entered the Town Hall, which has a service counter');
  if (counter) {
    await A.walkTo(counter.x, counter.z + 1, false);
    check((await A.act({ k: 'sell', item: 'stone', n: 1 })).ok, 'selling works at the Town Hall counter');
    const again = await A.act({ k: 'permit', id: 'permit_cliff' });
    check(!again.ok && /already/.test(again.err ?? ''), 'permits are sold at the Town Hall counter (no double purchase)');
  }
  await exitTo(A);
  check(/Town Hall/.test((await A.act({ k: 'permit', id: 'permit_water' })).err ?? ''), 'permits can only be bought at the counter');
  const vHouse = A.room.buildings.find((b) => b.type === 'villager_house' && b.villagerId);
  if (vHouse) {
    const vIn = await enterAndBack(A, vHouse);
    check(vIn?.interior === 'villager' && !!vIn.theme && vIn.objects.filter((o) => o.kind === 'decor').length >= 6, `villager house is furnished & themed (${vIn?.name})`);
    check(!vIn?.canDecorate, 'you cannot rearrange a villager’s furniture');
    await exitTo(A);
  }

  // Shops: services live at the counter inside.
  await A.chat('/kit');
  const ts = await A.build('tool_store');
  check(ts.ok, `tool store construction started ${ts.err ?? ''}`);
  await A.chat('/finish');
  await sleep(300);
  const store = A.room.buildings.find((b) => b.type === 'tool_store');
  if (store) {
    const outside = await A.act({ k: 'buy', shop: 'tool_store', item: 'sapling', n: 1 });
    check(!outside.ok, 'shops no longer serve you from outside');
    const sIn2 = await enterAndBack(A, store);
    const ctr = sIn2?.buildings.find((b) => b.type === 'counter');
    check(sIn2?.interior === 'shop' && ctr?.role === 'tool_store', 'tool store interior has a shop counter');
    if (ctr) {
      await A.walkTo(ctr.x, ctr.z + 1, false);
      const bought = await A.act({ k: 'buy', shop: 'tool_store', item: 'sapling', n: 1 });
      check(bought.ok, `bought a sapling at the counter ${bought.err ?? ''}`);
    }
    await exitTo(A);
  }
  Object.assign(ctx, { vAdd, vid });
}
