import type { MailView } from '@hearthwood/shared';
import { Bot, check, sleep, http, type Ctx } from '../harness.ts';

export async function run(ctx: Ctx) {
  const { A } = ctx;
  console.log('Gifts in the mailbox');
  const gifts = (b: Bot, pred: (m: MailView) => boolean) => b.inbox.filter((m) => m.t === 'mail').flatMap((m) => (m as { list: MailView[] }).list).filter(pred);
  const letter = { fromName: 'Test Team', text: 'Thanks for playing!', items: [{ item: 'wood', n: 3 }, { item: 'stone', n: 2 }], coins: 50 };

  // By hand.
  check((await http('POST', '/api/admin/gifts/send', { to: [A.self.id], letter: { ...letter, items: [{ item: 'bogus', n: 1 }] } }, A.token)).status === 400, 'gift letters are validated (unknown item)');
  check((await http('POST', '/api/admin/gifts/send', { to: 'nobody', letter }, A.token)).status === 400, 'gift needs recipients');
  const sent = await http('POST', '/api/admin/gifts/send', { to: [A.self.id], letter }, A.token);
  const mail = await A.wait('mail', (m) => m.list.some((l) => l.gift && l.fromName === 'Test Team'));
  const g = mail.list.find((l) => l.gift && l.fromName === 'Test Team')!;
  check(sent.body.sent === 1 && g.items?.length === 2 && g.coins === 50, 'a gift sent by hand arrives with items and coins');
  const inv0 = (await http('GET', `/api/admin/players/${A.self.id}`, undefined, A.token)).body.player as { inv: Record<string, number>; coins: number };
  const wood0 = inv0.inv.wood ?? 0, stone0 = inv0.inv.stone ?? 0, coins0 = inv0.coins;
  const took = await A.act({ k: 'takeMail', mailId: g.id });
  check(took.ok && A.inv.wood === wood0 + 3 && A.inv.stone === stone0 + 2 && A.coins === coins0 + 50, 'taking it gives every item and the coins');

  // Automatic: a welcome package for new players.
  const mk = async (rule: Record<string, unknown>) => (await http('POST', '/api/admin/gifts', rule, A.token)).body.rule as { id: string };
  const welcome = await mk({ name: 'Welcome', trigger: { kind: 'welcome' }, letter: { fromName: 'Mayor', text: 'Welcome!', items: [{ item: 'flower_pot', n: 1 }], coins: 0 } });
  check(!!welcome?.id, 'an automatic gift is set up');
  check((await http('POST', '/api/admin/gifts', { name: 'x', trigger: { kind: 'built', building: 'nope' }, letter }, A.token)).status === 400, 'automatic gifts are validated (unknown building)');
  const W = new Bot('W');
  await W.connect();
  await W.create('tropical', 'Wren');
  const wm = await W.wait('mail', (m) => m.list.some((l) => l.text === 'Welcome!')).catch(() => null);
  check(!!wm, 'a new player finds the welcome gift');
  await sleep(200);
  check(!gifts(A, (l) => l.text === 'Welcome!').length, 'existing players don’t get the welcome gift');

  // Logging in every day; a milestone; one that's over; a scheduled one.
  await mk({ name: 'Daily', trigger: { kind: 'login', repeat: 'daily' }, letter: { ...letter, text: 'Daily coins', items: [] } });
  await mk({ name: 'Friendly', trigger: { kind: 'friends', count: 1 }, letter: { ...letter, text: 'Friends!', items: [] } });
  await mk({ name: 'Over', trigger: { kind: 'login', repeat: 'once' }, until: Date.now() - 1000, letter: { ...letter, text: 'Too late', items: [] } });
  await mk({ name: 'Soon', trigger: { kind: 'scheduled', at: Date.now() + 1500 }, letter: { ...letter, text: 'Happy holidays', items: [] } });
  const daily = await A.wait('mail', (m) => m.list.some((l) => l.text === 'Daily coins'), 8000).catch(() => null);
  check(!!daily, 'players in the game get the daily gift');
  const fr = await A.wait('mail', (m) => m.list.some((l) => l.text === 'Friends!'), 8000).catch(() => null);
  check(!!fr && !gifts(W, (l) => l.text === 'Friends!').length, 'a milestone gift goes to those who reached it (has a friend)');
  const sched = await W.wait('mail', (m) => m.list.some((l) => l.text === 'Happy holidays'), 8000).catch(() => null);
  check(!!sched && gifts(A, (l) => l.text === 'Happy holidays').length > 0, 'a scheduled gift reaches everyone');
  await sleep(3500); // another round of checks
  const last = { list: ((await http('GET', `/api/admin/players/${A.self.id}`, undefined, A.token)).body.player as { mail: MailView[] }).mail };
  check(last.list.filter((l) => l.text === 'Daily coins').length === 1 && last.list.filter((l) => l.text === 'Happy holidays').length === 1, 'each gift arrives once (per day)');
  check(!last.list.some((l) => l.text === 'Too late'), 'a gift past its end date isn’t sent');
  const rules = (await http('GET', '/api/admin/gifts', undefined, A.token)).body.rules as { id: string; name: string; sent: number; fired?: boolean }[];
  const soon = rules.find((r) => r.name === 'Soon');
  check(!!soon?.fired && soon.sent >= 2, `the admin sees what was sent (${soon?.sent} scheduled letters)`);
  check((await http('DELETE', `/api/admin/gifts/${welcome.id}`, undefined, A.token)).status === 200, 'an automatic gift can be deleted');
  for (const r of rules) await http('DELETE', `/api/admin/gifts/${r.id}`, undefined, A.token);
  W.ws.close();
}
