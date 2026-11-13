import {
  Grid, decodeTiles, isWaterTile, BUILDINGS, PROTOCOL_VERSION, ISLAND_SIZE, TERRA_REACH, Tile, applyTerrain, distToTile, relocationCost, placeError, classifyWater, FISH, DIRS, SEA_LEVEL, WADE_FLOOR, terraformError, terraformChanges, applyTerrainAndWater,
  type RoomView, type ServerMessage, type WorldObject, type BuildingType,
} from '@hearthwood/shared';
import { Bot, BASE, PORT, check, sleep, http, state, enterAndBack, exitTo, type Ctx } from '../harness.ts';

export async function run(ctx: Ctx) {
  const { A, B } = ctx;
  console.log('Builders & residents');
  {
    B.send({ t: 'travel', to: { kind: 'island', id: A.self.homeIslandId } });
    await B.wait('room', (m) => m.room.id === A.self.homeIslandId);
    const spot = [Math.floor(B.x) + 1, Math.floor(B.z)];
    check(!(await B.act({ k: 'pave', x: spot[0], z: spot[1], path: 2 })).ok, 'visitors can’t build');
    B.send({ t: 'dev', cmd: 'kit', args: [] }); // stone for gravel paths
    await sleep(300);
    A.send({ t: 'role', id: B.self.id, role: 'builder' });
    check(!!(await B.wait('room', (m) => m.room.role === 'builder').catch(() => null)), 'owner made Bob a builder');
    let paved = false;
    outerP: for (let r = 1; r <= 5; r++) for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      const x = Math.floor(B.x) + dx, z = Math.floor(B.z) + dz;
      if (B.grid.canPave(x, z) && !B.grid.path(x, z)) { paved = (await B.act({ k: 'pave', x, z, path: 2 })).ok; if (paved) break outerP; }
    }
    check(paved, 'builders can build (paths) on the island');
    A.send({ t: 'role', id: B.self.id, role: 'resident' });
    check(!!(await B.wait('room', (m) => m.room.role === 'resident' && m.room.canHarvest).catch(() => null)), 'owner made Bob a resident (can gather too)');
    const tentB = await B.build('tent');
    check(tentB.ok, `a resident builds their own tent ${tentB.err ?? ''}`);
    const mine = B.room.buildings.find((b) => b.type === 'tent' && b.ownerId === B.self.id);
    check(!!mine, 'the tent belongs to the resident');
    A.send({ t: 'role', id: B.self.id, role: 'none' });
    check(!!(await B.wait('room', (m) => m.room.role === 'visitor').catch(() => null)), 'owner can take the rights back');
  }

  console.log('Location & time zone');
  {
    A.send({ t: 'geo', lat: 35.7, lon: 139.7, tz: 'Asia/Tokyo' });
    const self = await A.wait('self', (m) => m.you.geo.tz === 'Asia/Tokyo').catch(() => null);
    check(!!self && self.you.geo.lat === 35.5, 'location saved (rounded to ~50 km)');
    check(!!(await A.wait('env', (m) => m.env.geo.tz === 'Asia/Tokyo').catch(() => null)), 'the island now follows that time zone');
    A.send({ t: 'geo', lat: 0, lon: 0, tz: 'Not/AZone' });
    check(!!(await A.wait('toast', (m) => /Unknown time zone/.test(m.text)).catch(() => null)), 'unknown time zones are refused');
  }

  console.log('News');
  {
    const n0 = await http('GET', '/api/news');
    check((n0.body.news as { title: string }[]).some((n) => /Welcome/.test(n.title)), 'start screen has a welcome news box');
    const created = await http('POST', '/api/admin/news', { title: 'Patch 1.1', body: 'Rivers!', icon: '🏞️', pinned: true }, A.token);
    check(created.status === 200, 'admin writes a news box');
    const n1 = await http('GET', '/api/news');
    check((n1.body.news as { title: string; pinned: boolean }[])[0]?.title === 'Patch 1.1', 'pinned news comes first');
    await http('PUT', `/api/admin/news/${created.body.id}`, { title: 'Patch 1.1', body: 'x', published: false }, A.token);
    check(!((await http('GET', '/api/news')).body.news as { title: string }[]).some((n) => n.title === 'Patch 1.1'), 'drafts stay hidden');
    check((await http('POST', '/api/admin/news', { title: 'x', body: 'y' })).status === 401, 'only admins edit news');
  }
}
