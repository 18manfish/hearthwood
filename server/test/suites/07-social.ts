import {
  Grid, decodeTiles, isWaterTile, BUILDINGS, PROTOCOL_VERSION, ISLAND_SIZE, TERRA_REACH, Tile, applyTerrain, distToTile, relocationCost, placeError, classifyWater, FISH, DIRS, SEA_LEVEL, WADE_FLOOR, terraformError, terraformChanges, applyTerrainAndWater,
  type RoomView, type ServerMessage, type WorldObject, type BuildingType,
} from '@hearthwood/shared';
import { Bot, BASE, PORT, check, sleep, http, state, enterAndBack, exitTo, type Ctx } from '../harness.ts';

export async function run(ctx: Ctx) {
  const { A } = ctx;
  console.log('Multiplayer, access control & friends');
  const B = new Bot('B');
  await B.connect();
  await B.create('tropical', 'Bob');
  check(B.room.biome === 'tropical', 'Bob starts on a tropical island');
  B.send({ t: 'travel', to: { kind: 'island', id: A.room.id } });
  const denied = await B.wait('toast', (m) => /isn.t open/.test(m.text));
  check(/isn.t open/.test(denied.text), 'Bob cannot visit a friends-only island');
  B.send({ t: 'friend', op: 'request', code: A.self.code });
  await A.wait('friends', (m) => m.incoming.length === 1);
  A.send({ t: 'friend', op: 'accept', id: B.self.id });
  const fr = await B.wait('friends', (m) => m.list.length === 1);
  check(fr.list[0].name === 'Alice', 'friend request accepted');
  B.send({ t: 'travel', to: { kind: 'island', id: A.room.id } });
  await B.wait('room');
  check(B.room.id === A.room.id && !B.room.canHarvest, 'friend can visit but not harvest');
  const pAdd = await A.wait('pAdd');
  check(pAdd.p.name === 'Bob', 'Alice sees Bob arrive');

  console.log('Mailbox');
  const mb = await A.build('mailbox');
  check(mb.ok, `mailbox built ${mb.err ?? ''}`);
  const box = A.room.buildings.find((b) => b.type === 'mailbox');
  if (box) {
    await A.walkTo(box.x, box.z + 1, false);
    const sent = await A.act({ k: 'mail', to: B.self.id, text: 'Welcome to my island!', item: 'stone', n: 1 });
    check(sent.ok, `Alice mails Bob from her mailbox ${sent.err ?? ''}`);
    const got = await B.wait('mail', (m) => m.list.some((x) => x.text === 'Welcome to my island!')).catch(() => null);
    check(!!got, 'Bob receives the letter with a gift');
    await B.walkTo(box.x, box.z + 1, false);
    const toOther = await B.act({ k: 'mail', to: 'p_000000000000', text: 'x' });
    check(!toOther.ok, 'a visitor can only post letters to the mailbox owner');
    const back = await B.act({ k: 'mail', to: A.self.id, text: 'Thanks Alice!' });
    check(back.ok, `Bob leaves a letter in Alice’s mailbox ${back.err ?? ''}`);
    const gotA = await A.wait('mail', (m) => m.list.some((x) => x.text === 'Thanks Alice!')).catch(() => null);
    check(!!gotA, 'Alice gets the visitor’s letter');
  }
  const bt = B.nearest('tree', (o) => o.stage === 2)!;
  await B.walkTo(bt.x, bt.z);
  check(!(await B.act({ k: 'shake', id: bt.id })).ok, 'visitor cannot shake trees');
  B.send({ t: 'move', seq: ++B.seq, x: B.x, z: B.z + 0.2, r: 1 });
  const ps = await A.wait('ps', (m) => m.l.some((e) => e[0] === B.self.id));
  check(!!ps, 'Alice receives Bob’s movement');
  B.send({ t: 'chat', text: 'hi \u0007alice‮!' });
  const ch = await A.wait('chat', (m) => m.name === 'Bob');
  check(ch.text === 'hi alice!', 'chat is relayed and sanitised');

  const C = new Bot('C');
  await C.connect();
  await C.create('desert', 'Cleo');
  A.send({ t: 'access', access: 'invite' });
  await A.wait('self', (m) => m.you.access === 'invite');
  C.send({ t: 'travel', to: { kind: 'island', id: A.room.id } });
  check(!!(await C.wait('toast', (m) => /isn.t open/.test(m.text)).catch(() => null)), 'stranger blocked without invite code');
  C.send({ t: 'travel', to: { kind: 'code', code: A.self.inviteCode } });
  await C.wait('room');
  check(C.room.id === A.room.id, 'invite code grants entry');
  A.send({ t: 'kick', id: C.self.id });
  await C.wait('room');
  check(C.room.id !== A.room.id, 'owner can send visitors home');

  C.send({ t: 'travel', to: { kind: 'shared', id: 'harbor' } });
  await C.wait('room');
  check(C.room.kind === 'shared', 'shared location reachable by anyone');
  console.log('Harbor Town: billboard & public mailbox');
  check(C.room.buildings.some((b) => b.type === 'billboard') && C.room.buildings.filter((b) => b.type === 'shack').length >= 5, 'harbor has a billboard and a hillside of houses');
  check(/[12]/.test(C.room.levels) && C.room.paths.includes('4'), 'harbor has terraces and a brick plaza');
  const bb = C.room.buildings.find((b) => b.type === 'billboard')!;
  const far2 = await new Promise<boolean>((res) => { C.send({ t: 'board', op: 'post', text: 'too far' }); C.wait('toast', (m) => /Walk up/.test(m.text), 2000).then(() => res(true)).catch(() => res(false)); });
  check(far2, 'posting requires standing at the billboard');
  check(await C.walkTo(bb.x, bb.z + 1, false), 'walked to the billboard');
  C.send({ t: 'board', op: 'post', text: 'Selling turnips \u0007cheap!' });
  const board = await C.wait('board', (m) => m.posts.some((n) => n.name === 'Cleo')).catch(() => null);
  check(board?.posts[0].text === 'Selling turnips cheap!', 'note pinned (sanitised) and broadcast');
  C.send({ t: 'board', op: 'post', text: 'spam' });
  check(!!(await C.wait('toast', (m) => /another note/.test(m.text)).catch(() => null)), 'post cooldown enforced');
  B.send({ t: 'travel', to: { kind: 'shared', id: 'harbor' } });
  await B.wait('room', (m) => m.room.kind === 'shared');
  check(B.room.board?.[0]?.text === 'Selling turnips cheap!', 'new arrivals see the billboard notes');
  B.send({ t: 'board', op: 'delete', id: board!.posts[0].id });
  check(!!(await B.wait('toast', (m) => /own notes/.test(m.text)).catch(() => null)), 'cannot take down someone else’s note');
  C.send({ t: 'board', op: 'delete', id: board!.posts[0].id });
  check(!!(await C.wait('board', (m) => !m.posts.some((n) => n.id === board!.posts[0].id)).catch(() => null)), 'author can take down their note');
  const hm = B.room.buildings.find((b) => b.type === 'mailbox')!;
  await B.walkTo(hm.x, hm.z + 1, false);
  const pub = await B.act({ k: 'mail', to: A.self.id, text: 'Greetings from the harbour!' });
  check(pub.ok, `public mailbox sends to a friend ${pub.err ?? ''}`);

  const shackB = C.room.buildings.find((b) => b.type === 'shack')!;
  const sIn = await enterAndBack(C, shackB);
  check(sIn?.interior === 'shack' && (sIn?.objects.length ?? 0) > 5, 'harbor cottages can be entered');
  await exitTo(C);
  check(C.room.id === 'shared_harbor', 'leaving a cottage returns to the harbour');

  C.send({ t: 'map' });
  const map = await C.wait('map');
  check(map.islands.some((i) => i.mine) && !map.islands.some((i) => i.name === 'Alice Isle'), 'map hides non-public islands from strangers');

  console.log('Dev season override');
  A.send({ t: 'dev', cmd: 'season', args: ['winter'] });
  const envW = await A.wait('env', (m) => m.env.season === 'winter').catch(() => null);
  check(!!envW, 'dev command forces the island season');
  A.send({ t: 'dev', cmd: 'season', args: ['wet'] });
  const envN = await A.wait('env').catch(() => null);
  check(envN?.env.season !== 'wet', 'season not valid for the climate is refused (back to real calendar)');
  Object.assign(ctx, { B, C });
}
