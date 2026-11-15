// Gifts in the mailbox: letters from the game with items and coins. Admins send them
// by hand (to one player, everyone online, or everyone), or set up automatic gifts
// (store.giftRules) that go out when their trigger fires:
//   • welcome     – right after character creation
//   • login       – while in the game: once, or again each local day / week
//   • scheduled   – at a set moment, to every player (offline ones find it next time)
//   • milestones  – account age, a building finished, a story chapter, journal entries, friends
// Each player gets a rule's letter at most once per period (PlayerRecord.gifts).
// Milestones and logins are checked when they can change (login, building finished,
// chapter paid, a catch, a new friend) and every half minute for everyone online.

import { localTime, type GiftLetter, type GiftRule, type MailView } from '@hearthwood/shared';
import crypto from 'node:crypto';
import { logger } from '../../log.ts';
import type { MailRecord, PlayerRecord } from '../../types.ts';
import type { Game } from '../Game.ts';
import { albumOf } from './views.ts';

const log = logger('gifts');

/** The parts of the game gifts need (action handlers see a narrower Game). */
type G = Pick<Game, 'store' | 'online' | 'rooms'>;

/** Gift letters may go past the normal 50-letter mailbox limit, but not without end. */
const MAILBOX_HARD_LIMIT = 200;

/** What the client sees of a letter. */
export function mailView(m: MailRecord): MailView {
  const v: MailView = { id: m.id, from: m.from, fromName: m.fromName, text: m.text, at: m.at };
  if (m.item) { v.item = m.item; v.n = m.n; }
  if (m.giftId) v.gift = true;
  if (m.items?.length) v.items = m.items;
  if (m.coins) v.coins = m.coins;
  return v;
}
export const mailList = (p: PlayerRecord) => p.mail.map(mailView);

/** Put a gift letter in a player's mailbox (and tell them if they're online). */
export function deliverGift(game: G, p: PlayerRecord, letter: GiftLetter, giftId: string, now = Date.now()): boolean {
  if (p.mail.length >= MAILBOX_HARD_LIMIT) {
    log.warn('gift not delivered: mailbox full', { player: p.id, gift: giftId });
    return false;
  }
  p.mail.push({
    id: `g${now.toString(36)}${crypto.randomBytes(4).toString('hex')}`,
    from: '', fromName: letter.fromName, text: letter.text, at: now, giftId,
    items: letter.items.map((x) => ({ ...x })), coins: letter.coins || undefined,
  });
  game.store.markPlayer(p.id);
  const s = game.online.get(p.id);
  if (s) {
    s.send({ t: 'mail', list: mailList(p) });
    s.send({ t: 'toast', text: letter.items.length || letter.coins ? '🎁 A gift arrived in your mail! (L)' : 'You’ve got mail! 📬', kind: 'good' });
  }
  return true;
}

/** Players who can receive gifts. */
const receivers = (game: G) => [...game.store.players.values()].filter((p) => p.created && !p.banned);

/** Send a letter by hand. Returns how many players got it. */
export function sendGiftNow(game: G, letter: GiftLetter, to: 'all' | 'online' | string[], by: string): number {
  const now = Date.now();
  const list = to === 'all' ? receivers(game) : to === 'online' ? receivers(game).filter((p) => game.online.has(p.id))
    : to.map((id) => game.store.players.get(id)).filter((p): p is PlayerRecord => !!p && p.created);
  let n = 0;
  for (const p of list) if (deliverGift(game, p, letter, 'manual', now)) n++;
  log.info('gift sent by hand', { by, to: Array.isArray(to) ? to.length : to, delivered: n });
  return n;
}

/** The period a rule counts in for this player right now: 'once', a local day or a week. */
function periodKey(rule: GiftRule, p: PlayerRecord, now: number): string {
  if (rule.trigger.kind !== 'login' || rule.trigger.repeat === 'once') return 'once';
  const day = localTime(now, p.geo?.tz || 'UTC').dayKey;
  if (rule.trigger.repeat === 'daily') return day;
  // Weeks start on Monday (1970-01-01 was a Thursday).
  const [y, m, d] = day.split('-').map(Number);
  return `w${Math.floor((Date.UTC(y, m - 1, d) / 86400_000 + 3) / 7)}`;
}

const inWindow = (rule: GiftRule, now: number) => (rule.from === undefined || now >= rule.from) && (rule.until === undefined || now < rule.until);

/** Buildings the player has finished on their home island (the live room if it's loaded). */
function builtTypes(game: G, p: PlayerRecord, now: number): Set<string> {
  const id = p.homeIslandId;
  if (!id) return new Set();
  const live = game.rooms.get(id);
  const list = live ? [...live.buildings.values()] : game.store.islands.get(id)?.buildings ?? [];
  return new Set(list.filter((b) => b.completeAt <= now).map((b) => b.type));
}

/** Has the player reached this rule's milestone (or, for login rules, simply: are they here)? */
function reached(game: G, rule: GiftRule, p: PlayerRecord, now: number, cause: GiftCause, built: () => Set<string>): boolean {
  const t = rule.trigger;
  switch (t.kind) {
    case 'welcome': return cause === 'created';
    case 'login': return game.online.has(p.id) || cause === 'login';
    case 'scheduled': return false; // goes out to everyone at once (scheduledTick)
    case 'accountAge': return now - p.createdAt >= t.days * 86400_000;
    case 'built': return built().has(t.building);
    case 'chapter': return p.chapterRewarded >= t.chapter;
    case 'album': {
      const a = albumOf(p);
      return Object.keys(a.fish).length + Object.keys(a.birds).length >= t.count;
    }
    case 'friends': return p.friends.length >= t.count;
  }
}

/** Why gifts are being checked: some triggers only fire on their own event. */
export type GiftCause = 'login' | 'created' | 'progress' | 'tick';

/** Send every automatic gift this player is due. */
export function checkGifts(game: G, p: PlayerRecord, cause: GiftCause, now = Date.now()) {
  if (!p.created || p.banned) return;
  let built: Set<string> | null = null;
  const lazyBuilt = () => (built ??= builtTypes(game, p, now));
  for (const rule of game.store.giftRules()) {
    if (!rule.enabled || rule.trigger.kind === 'scheduled' || !inWindow(rule, now)) continue;
    const key = periodKey(rule, p, now);
    if ((p.gifts ??= {})[rule.id] === key) continue;
    if (!reached(game, rule, p, now, cause, lazyBuilt)) continue;
    p.gifts[rule.id] = key;
    if (deliverGift(game, p, rule.letter, rule.id, now)) {
      rule.sent++;
      game.store.saveGiftRule(rule);
      log.info('automatic gift sent', { rule: rule.id, player: p.id, trigger: rule.trigger.kind, period: key });
    }
  }
}

/** Scheduled gifts whose moment has come go to every player at once. */
function scheduledTick(game: G, now: number) {
  for (const rule of game.store.giftRules()) {
    if (!rule.enabled || rule.fired || rule.trigger.kind !== 'scheduled' || now < rule.trigger.at) continue;
    let n = 0;
    // Past "until" (the server was down through the whole window): skip rather than send late.
    if (rule.until === undefined || now < rule.until)
      for (const p of receivers(game)) {
        if ((p.gifts ??= {})[rule.id]) continue;
        p.gifts[rule.id] = 'once';
        if (deliverGift(game, p, rule.letter, rule.id, now)) n++;
      }
    rule.fired = true;
    rule.sent += n;
    rule.updatedAt = now;
    game.store.saveGiftRule(rule);
    log.info('scheduled gift sent', { rule: rule.id, delivered: n });
  }
}

/** Every half minute: scheduled gifts, then everyone online (new day, event started, milestones). */
export function giftTick(game: G, now = Date.now()) {
  if (!game.store.giftRules().length) return;
  scheduledTick(game, now);
  for (const s of game.online.values()) if (s.player) checkGifts(game, s.player, 'tick', now);
}
