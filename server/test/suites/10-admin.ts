import {
  PROTOCOL_VERSION,
} from '@hearthwood/shared';
import { Bot, PORT, check, codeFor, mails, sleep, http, type Ctx } from '../harness.ts';

export async function run(ctx: Ctx) {
  const { A, C } = ctx;
  console.log('Accounts');
  {
    const reg = await http('POST', '/api/register', { username: 'Tester_1', password: 'correct horse', email: 'Tester@Example.org ' });
    check(reg.status === 200 && !!reg.body.token && reg.body.emailSent === 'tester@example.org', 'register with username, email & password');
    check((await http('POST', '/api/register', { username: 'tester_1', password: 'whatever123', email: 'other@example.org' })).status === 409, 'usernames are unique (case-insensitive)');
    check((await http('POST', '/api/register', { username: 'x', password: 'whatever123', email: 'x@example.org' })).status === 400, 'too-short username refused');
    check((await http('POST', '/api/register', { username: 'Noemail', password: 'whatever123' })).status === 400
      && (await http('POST', '/api/register', { username: 'Bademail', password: 'whatever123', email: 'not-an-address' })).status === 400, 'an email address is required (and checked)');
    // The code arrives by email (sent through SMTP with a login).
    await sleep(300);
    const mail = mails.find((m) => m.to === 'tester@example.org');
    const code = codeFor('tester@example.org');
    check(!!code && mail!.auth === 'mailer:secret' && mail!.text.includes(code) && mail!.from === 'noreply@hearthwood.test', 'the confirmation code is emailed over SMTP');
    const tok = reg.body.token as string;
    const gate = new Bot('T');
    gate.ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
    await new Promise((res) => (gate.ws.onopen = res));
    gate.ws.onmessage = (ev) => gate.onMsg(JSON.parse(String(ev.data)));
    gate.send({ t: 'hello', token: tok, v: PROTOCOL_VERSION });
    check(!!(await gate.wait('err', (m) => m.code === 'email').catch(() => null)), 'an account can’t play before its email is confirmed');
    const me0 = await http('GET', '/api/me', undefined, tok);
    check(me0.body.needed === true && (me0.body.pending as { email: string }).email === 'tester@example.org', '/api/me says the email is still to confirm');
    check((await http('POST', '/api/email', { email: 'tester@example.org' }, tok)).status === 400, 'a new code only after a minute');
    const wrong = code === '000000' ? '111111' : '000000';
    const bad = await http('POST', '/api/email/verify', { code: wrong }, tok);
    check(bad.status === 400 && /4 tries left/.test(bad.body.error as string), 'a wrong code is refused (tries counted)');
    check((await http('POST', '/api/email/verify', { code: ` ${code!.slice(0, 3)} ${code!.slice(3)} ` }, tok)).status === 200, 'the right code confirms the address');
    const me1 = await http('GET', '/api/me', undefined, tok);
    check(me1.body.email === 'tester@example.org' && me1.body.needed === false, 'the address is confirmed');
    check((await http('POST', '/api/register', { username: 'Copycat', password: 'whatever123', email: 'TESTER@example.org' })).status === 409, 'a confirmed email belongs to one account');
    gate.ws.close();
    check((await http('POST', '/api/login', { username: 'tester_1', password: 'wrong password' })).status === 401, 'wrong password refused');
    const login = await http('POST', '/api/login', { username: 'TESTER_1', password: 'correct horse' });
    check(login.status === 200 && login.body.token !== reg.body.token, 'login issues a new token');
    const byMail = await http('POST', '/api/login', { username: 'Tester@example.org', password: 'correct horse' });
    check(byMail.status === 200 && byMail.body.playerId === login.body.playerId, 'log in with the email address instead of the username');
    check((await http('POST', '/api/login', { username: 'tester@example.org', password: 'wrong password' })).status === 401, '… but still only with the right password');
    const me = await http('GET', '/api/me', undefined, login.body.token as string);
    check(me.body.username === 'Tester_1', '/api/me knows who you are');
    await http('POST', '/api/logout', {}, login.body.token as string);
    check((await http('GET', '/api/me', undefined, login.body.token as string)).status === 401, 'logout revokes the token');
    // The mail server refusing the address: nothing sent, and the player can try again at once.
    const bounce = await http('POST', '/api/register', { username: 'Bouncer', password: 'whatever123', email: 'gone@bounce.test' });
    check(bounce.status === 200 && bounce.body.emailSent === null && typeof bounce.body.emailError === 'string', 'a refused address is reported');
    check((await http('POST', '/api/email', { email: 'bouncer@example.org' }, bounce.body.token as string)).status === 200, '… and another one can be tried straight away');
    // An admin can set an address (counts as confirmed).
    const adm = await http('PATCH', `/api/admin/players/${bounce.body.playerId}`, { email: 'bouncer@admin.test' }, A.token);
    const am = await http('GET', '/api/me', undefined, bounce.body.token as string);
    check(adm.status === 200 && am.body.email === 'bouncer@admin.test' && am.body.needed === false, 'an admin can set a player’s email');
    check((await http('PATCH', `/api/admin/players/${bounce.body.playerId}`, { email: 'tester@example.org' }, A.token)).status === 409, '… but not one another account has');
  }

  console.log('Admin API');
  {
    const list = await http('GET', '/api/admin/players', undefined, A.token);
    check(list.status === 200 && (list.body.players as { id: string }[]).some((p) => p.id === A.self.id), 'admin lists players (everyone is admin in dev mode)');
    const r1 = await http('PATCH', `/api/admin/players/${A.self.id}`, { coins: 12345, inv: { wood: 7, bogus_item: 1 } }, A.token);
    check(r1.status === 400, 'admin edits are validated (unknown item)');
    check((await http('PATCH', `/api/admin/players/${A.self.id}`, { birthday: '1990-13-01' }, A.token)).status === 400, 'admin birthday edits are validated');
    await http('PATCH', `/api/admin/players/${A.self.id}`, { birthday: '1985-07-04' }, A.token);
    check(((await http('GET', `/api/admin/players/${A.self.id}`, undefined, A.token)).body.player as { birthday: string }).birthday === '1985-07-04', 'admin can set a birthday');
    await http('PATCH', `/api/admin/players/${A.self.id}`, { coins: 12345 }, A.token);
    const invMsg = await A.wait('inv', (m) => m.coins === 12345).catch(() => null);
    check(!!invMsg, 'online player sees admin coin change immediately');
    const isl = await http('GET', `/api/admin/islands/${A.self.homeIslandId}`, undefined, A.token);
    check(isl.status === 200 && (isl.body.size as number) === 72 && typeof isl.body.tiles === 'string', 'admin island view has the map data');
    const ren = await http('PATCH', `/api/admin/islands/${A.self.homeIslandId}`, { name: 'Admin Isle' }, A.token);
    check(ren.status === 200, 'admin renamed the island');
    const roomMsg = await A.wait('room', (m) => m.room.name === 'Admin Isle').catch(() => null);
    check(!!roomMsg, 'players on the island get the reloaded island');
    const objects = ((await http('GET', `/api/admin/islands/${A.self.homeIslandId}`, undefined, A.token)).body.record as { objects: unknown[] }).objects;
    const putObjects = (extra: object[]) => http('PATCH', `/api/admin/islands/${A.self.homeIslandId}`, { objects: [...objects, ...extra] }, A.token);
    check((await putObjects([{ id: 'wtest', kind: 'washed', item: 'seashell', x: 36, z: 36, rot: 0 }])).status === 200, 'an island with something washed up on it can be saved');
    check((await putObjects([{ id: 'wtest', kind: 'bird', bird: 'bird_sparrow', x: 36, z: 36, rot: 0 }])).status === 400, 'birds are not saved with an island');
    check((await putObjects([])).status === 200, 'and the objects can be put back');
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
    // Old characters (made before the new character model) redo their looks at login.
    {
      const D = new Bot('E');
      await D.connect();
      await D.create('desert', 'Edda');
      const island = D.self.homeIslandId;
      const coins = D.self.coins;
      check((await http('PATCH', `/api/admin/players/${D.self.id}`, { recreate: true }, A.token)).status === 200, 'admin can ask for a character redo');
      check(!!(await D.wait('err', (m) => m.code === 'kicked').catch(() => null)), 'an online player is sent back to log in');
      const R = new Bot('R');
      R.ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
      await new Promise((res) => (R.ws.onopen = res));
      R.ws.onmessage = (ev) => R.onMsg(JSON.parse(String(ev.data)));
      R.send({ t: 'hello', token: D.token, v: PROTOCOL_VERSION });
      const w = await R.wait('welcome').catch(() => null);
      check(!!w && !w.you && w.recreate?.name === 'Edda', 'the welcome asks to redo the character (name kept)');
      R.send({ t: 'act', seq: 1, a: { k: 'wear', item: null } });
      check(!!(await R.wait('err', (m) => m.code === 'recreate').catch(() => null)), 'nothing else works until it is redone');
      R.send({ t: 'recreate', gender: 'boy', outfit: 'winter', look: { skin: '#a8714a', hair: 'curly', hairColor: '#2b1d14', eyes: '#2b1d14', shirt: '#ecf0f1', pants: '#34495e', shoes: '#000000', eyeShape: 'wide', mouth: 'cat' } });
      const w2 = await R.wait('welcome', (m) => !!m.you).catch(() => null);
      check(!!w2?.you && w2.you.gender === 'boy' && w2.you.look.eyeShape === 'wide' && w2.you.outfit.outer === 'coat_wool', 'the new looks and starter set are saved');
      check(w2?.you?.homeIslandId === island && w2?.you?.coins === coins, 'island and coins stay the same');
      check(!!(await R.wait('room').catch(() => null)), 'then into the island as usual');
      R.ws.close();
    }
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
