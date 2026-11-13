import {
  Grid, decodeTiles, isWaterTile, BUILDINGS, PROTOCOL_VERSION, ISLAND_SIZE, TERRA_REACH, Tile, applyTerrain, distToTile, relocationCost, placeError, classifyWater, FISH, DIRS, SEA_LEVEL, WADE_FLOOR, terraformError, terraformChanges, applyTerrainAndWater,
  type RoomView, type ServerMessage, type WorldObject, type BuildingType,
} from '@hearthwood/shared';
import { Bot, BASE, PORT, check, sleep, http, state, enterAndBack, exitTo, type Ctx } from '../harness.ts';

export async function run(ctx: Ctx) {
  const { A, C } = ctx;
  console.log('Accounts');
  {
    const reg = await http('POST', '/api/register', { username: 'Tester_1', password: 'correct horse' });
    check(reg.status === 200 && !!reg.body.token, 'register with username & password');
    check((await http('POST', '/api/register', { username: 'tester_1', password: 'whatever123' })).status === 409, 'usernames are unique (case-insensitive)');
    check((await http('POST', '/api/register', { username: 'x', password: 'whatever123' })).status === 400, 'too-short username refused');
    check((await http('POST', '/api/login', { username: 'tester_1', password: 'wrong password' })).status === 401, 'wrong password refused');
    const login = await http('POST', '/api/login', { username: 'TESTER_1', password: 'correct horse' });
    check(login.status === 200 && login.body.token !== reg.body.token, 'login issues a new token');
    const me = await http('GET', '/api/me', undefined, login.body.token as string);
    check(me.body.username === 'Tester_1', '/api/me knows who you are');
    await http('POST', '/api/logout', {}, login.body.token as string);
    check((await http('GET', '/api/me', undefined, login.body.token as string)).status === 401, 'logout revokes the token');
  }

  console.log('Admin API');
  {
    const list = await http('GET', '/api/admin/players', undefined, A.token);
    check(list.status === 200 && (list.body.players as { id: string }[]).some((p) => p.id === A.self.id), 'admin lists players (everyone is admin in dev mode)');
    const r1 = await http('PATCH', `/api/admin/players/${A.self.id}`, { coins: 12345, inv: { wood: 7, bogus_item: 1 } }, A.token);
    check(r1.status === 400, 'admin edits are validated (unknown item)');
    await http('PATCH', `/api/admin/players/${A.self.id}`, { coins: 12345 }, A.token);
    const invMsg = await A.wait('inv', (m) => m.coins === 12345).catch(() => null);
    check(!!invMsg, 'online player sees admin coin change immediately');
    const isl = await http('GET', `/api/admin/islands/${A.self.homeIslandId}`, undefined, A.token);
    check(isl.status === 200 && (isl.body.size as number) === 72 && typeof isl.body.tiles === 'string', 'admin island view has the map data');
    const ren = await http('PATCH', `/api/admin/islands/${A.self.homeIslandId}`, { name: 'Admin Isle' }, A.token);
    check(ren.status === 200, 'admin renamed the island');
    const roomMsg = await A.wait('room', (m) => m.room.name === 'Admin Isle').catch(() => null);
    check(!!roomMsg, 'players on the island get the reloaded island');
    const bad = await http('PATCH', `/api/admin/islands/${A.self.homeIslandId}`, { terrain: { tiles: '123', levels: '0', ramps: '0' } }, A.token);
    check(bad.status === 400, 'bad terrain data refused');
    const D = new Bot('D');
    await D.connect();
    await D.create('desert', 'Dora');
    await http('PATCH', `/api/admin/players/${D.self.id}`, { banned: { reason: 'testing' } }, A.token);
    const banned = await D.wait('err', (m) => m.code === 'kicked' || m.code === 'banned').catch(() => null);
    check(!!banned, 'banned player is disconnected');
    const D2 = new Bot('D2');
    D2.ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
    await new Promise((res) => (D2.ws.onopen = res));
    D2.ws.onmessage = (ev) => D2.onMsg(JSON.parse(String(ev.data)));
    D2.send({ t: 'hello', token: D.token, v: PROTOCOL_VERSION });
    check(!!(await D2.wait('err', (m) => m.code === 'banned').catch(() => null)), 'banned player can’t log back in');
    const audit = await http('GET', '/api/admin/audit', undefined, A.token);
    check((audit.body.entries as { action: string }[]).some((e) => e.action === 'player.edit'), 'admin actions are in the audit log');
    check((await http('GET', '/api/admin/players', undefined, 'nonsense')).status === 401, 'admin API needs a login');
  }

  console.log('Game data');
  {
    const gd = await http('GET', '/api/dev/gamedata', undefined, A.token);
    const items = (gd.body.current as { items: { id: string; buy?: number }[] }).items;
    items.find((i) => i.id === 'bench')!.buy = 999;
    const put = await http('PUT', '/api/dev/gamedata/items', { data: items }, A.token);
    check(put.status === 200, 'game data table saved');
    const pub = await http('GET', '/api/gamedata');
    check((pub.body.items as { id: string; buy?: number }[] | undefined)?.find((i) => i.id === 'bench')?.buy === 999, 'clients receive the changed price');
    const vill = (gd.body.current as { villagers: unknown[] }).villagers.slice(1);
    check((await http('PUT', '/api/dev/gamedata/villagers', { data: vill }, A.token)).status === 400, 'removing a built-in villager is refused');
    check((await http('DELETE', '/api/dev/gamedata/items', undefined, A.token)).status === 200 && !('items' in (await http('GET', '/api/gamedata')).body), 'table reset to built-in data');
  }

  console.log('Abuse protection');
  for (let i = 0; i < 200; i++) C.send({ t: 'ping', ct: i });
  await sleep(500);
  const pongs = C.inbox.filter((m) => m.t === 'pong').length;
  check(pongs < 200 && pongs > 0, `rate limiter dropped excess messages (${pongs}/200 answered)`);
}
