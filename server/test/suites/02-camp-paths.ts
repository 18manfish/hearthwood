import {
  Grid, decodeTiles, isWaterTile, BUILDINGS, PROTOCOL_VERSION, ISLAND_SIZE, TERRA_REACH, Tile, applyTerrain, distToTile, relocationCost, placeError, classifyWater, FISH, DIRS, SEA_LEVEL, WADE_FLOOR, terraformError, terraformChanges, applyTerrainAndWater,
  type RoomView, type ServerMessage, type WorldObject, type BuildingType,
} from '@hearthwood/shared';
import { Bot, BASE, PORT, check, sleep, http, state, enterAndBack, exitTo, type Ctx } from '../harness.ts';

export async function run(ctx: Ctx) {
  const { A } = ctx;
  console.log('Crafting & day-one camp');
  await A.chat('/kit');
  await A.wait('inv');
  A.send({ t: 'dev', cmd: 'give', args: ['fence', '2'] });
  for (const r of ['stone_axe', 'shovel', 'fishing_rod']) check((await A.act({ k: 'craft', recipe: r })).ok, `crafted ${r}`);
  check(!(await A.act({ k: 'craft', recipe: 'shovel' })).ok, 'cannot craft a duplicate tool');
  const t2 = A.nearest('tree', (o) => o.stage === 2)!;
  await A.walkTo(t2.x, t2.z);
  let felled = false;
  for (let i = 0; i < 4; i++) felled = (await A.act({ k: 'chop', id: t2.id })).msg === 'Timber!' || felled;
  check(felled && A.objects.get(t2.id)?.kind === 'stump', 'tree felled into a stump after 4 hits');
  check((await A.act({ k: 'dig', id: t2.id })).ok && !A.objects.has(t2.id), 'stump dug up');
  const rocks = [...A.objects.values()].filter((o) => o.kind === 'rock' && !o.hits).sort((p, q) => Math.hypot(p.x - A.x, p.z - A.z) - Math.hypot(q.x - A.x, q.z - A.z));
  let r2rock = rocks[0];
  for (const r of rocks) if (await A.walkTo(r.x, r.z)) { r2rock = r; break; }
  let crumbled = false;
  for (let i = 0; i < 8 && !crumbled; i++) crumbled = (await A.act({ k: 'hit', id: r2rock.id })).msg === 'The rock crumbled away.';
  check(crumbled && !A.objects.has(r2rock.id), 'depleted rock disappears');
  // Nearest bush we can actually walk to (cliffs may be in the way).
  const bushes = [...A.objects.values()].filter((o) => o.kind === 'bush').sort((p, q) => Math.hypot(p.x - A.x, p.z - A.z) - Math.hypot(q.x - A.x, q.z - A.z));
  let bush = bushes[0];
  for (const b of bushes) if (await A.walkTo(b.x, b.z)) { bush = b; break; }
  const picked = await A.act({ k: 'forage', id: bush.id });
  check(picked.ok && !A.objects.has(bush.id), 'picked bush disappears');
  // Block the bush's old spot with furniture so the respawn must move.
  const fence = await A.act({ k: 'place', item: 'fence', x: bush.x, z: bush.z, rot: 0 });
  A.send({ t: 'dev', cmd: 'respawn', args: [] });
  const back = await A.wait('oAdd', (m) => m.o.some((o) => o.kind === 'rock' || o.kind === 'bush'), 3000).catch(() => null);
  await sleep(300);
  const newBush = [...A.objects.values()].find((o) => o.kind === 'bush' && Math.abs(o.x - bush.x) <= 6 && Math.abs(o.z - bush.z) <= 6 && o.id !== bush.id && o.id.startsWith('k'));
  check(!!back, 'resources respawn later (dev: respawn now)');
  check(!fence.ok || (newBush && (newBush.x !== bush.x || newBush.z !== bush.z)), 'blocked respawn spot → resource appears on another free tile');
  let spotP: [number, number] | null = null;
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const x = Math.floor(A.x) + dx, z = Math.floor(A.z) + dz;
    if (A.grid.canPlace(x, z) && ![...A.objects.values()].some((o) => (o.kind === 'tree' || o.kind === 'stump') && Math.abs(o.x - x) <= 1 && Math.abs(o.z - z) <= 1)) { spotP = [x, z]; break; }
  }
  if (spotP) {
    const plant = await A.act({ k: 'plant', x: spotP[0], z: spotP[1] });
    check(plant.ok, `sapling planted${plant.ok ? '' : ` (${plant.err})`}`);
  }

  console.log('Paths');
  let pv: [number, number] | null = null;
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [2, 0], [0, 2]]) {
    const x = Math.floor(A.x) + dx, z = Math.floor(A.z) + dz;
    if (A.grid.canPave(x, z) && !A.grid.path(x, z) && Math.floor(A.x) !== x) { pv = [x, z]; break; }
  }
  if (pv) {
    const clay0 = A.inv.clay ?? 0;
    check((await A.act({ k: 'pave', x: pv[0], z: pv[1], path: 1 })).ok, 'dirt path laid (shovel)');
    await A.wait('paths', (m) => m.l.some((e) => e[0] === pv![0] && e[1] === pv![1] && e[2] === 1)).catch(() => null);
    check((await A.act({ k: 'pave', x: pv[0], z: pv[1], path: 4 })).ok, 'swapped for a brick path');
    await sleep(100);
    check((A.inv.clay ?? 0) === clay0 - 2, 'brick path cost 2 clay');
    check(!(await A.act({ k: 'plant', x: pv[0], z: pv[1] })).ok, 'cannot plant a tree on a path');
    check((await A.act({ k: 'unpave', x: pv[0], z: pv[1] })).ok, 'path removed');
    await sleep(100);
    check((A.inv.clay ?? 0) === clay0, 'removing a path refunds its materials');
    const far = await A.act({ k: 'pave', x: Math.min(A.grid.size - 1, Math.floor(A.x) + 12), z: Math.floor(A.z), path: 1 });
    check(!far.ok, 'paving far away is refused');
  }

  for (const b of ['tent', 'campfire', 'workbench'] as const) {
    const res = await A.build(b);
    check(res.ok, `built ${b}${res.ok ? '' : ` (${res.err})`}`);
  }
  const q = await A.wait('quest', (m) => m.q.chapter === 2, 3000).catch(() => null);
  check(!!q, 'chapter 1 complete → chapter 2 (starter house)');
}
