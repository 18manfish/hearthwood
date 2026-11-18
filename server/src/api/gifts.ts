// HTTP API (admin): gifts in the mailbox – sent by hand, or automatically by rules.

import { parseGiftLetter, parseGiftTrigger, GIFT_LIMITS, type GiftRule } from '@hearthwood/shared';
import crypto from 'node:crypto';
import { HttpError, readJson } from '../http.ts';
import { logger } from '../log.ts';
import { deliverGift, sendGiftNow } from '../game/services/gifts.ts';
import { type Api, str } from './context.ts';

const log = logger('api');

export function giftRoutes(api: Api) {
  const { r, game, store, admin, actor } = api;
  const readRule = async (req: Parameters<typeof readJson>[0]) => {
    const b = await readJson(req, 32 * 1024);
    const letter = parseGiftLetter(b.letter);
    if (typeof letter === 'string') throw new HttpError(400, letter);
    const trigger = parseGiftTrigger(b.trigger);
    if (typeof trigger === 'string') throw new HttpError(400, trigger);
    const time = (v: unknown, what: string) => {
      if (v === undefined || v === null || v === '') return undefined;
      if (typeof v !== 'number' || !Number.isFinite(v)) throw new HttpError(400, `${what}: not a date.`);
      return v;
    };
    const from = time(b.from, 'From'), until = time(b.until, 'Until');
    if (from !== undefined && until !== undefined && until <= from) throw new HttpError(400, 'Until must be after From.');
    return { name: str(b.name, 1, GIFT_LIMITS.name, 'Name'), enabled: b.enabled !== false, trigger, letter, from, until };
  };
  r.on('GET', '/api/admin/gifts', ({ req }) => {
    admin(req);
    return { rules: store.giftRules() };
  });
  r.on('POST', '/api/admin/gifts', async ({ req }) => {
    const me = admin(req);
    const v = await readRule(req);
    const now = Date.now();
    const rule: GiftRule = { id: `gift_${crypto.randomBytes(5).toString('hex')}`, ...v, createdAt: now, updatedAt: now, author: actor(me), sent: 0 };
    store.saveGiftRule(rule);
    store.audit(actor(me), 'gift.create', rule.id, { name: rule.name, trigger: rule.trigger });
    log.info('gift rule created', { admin: actor(me), rule: rule.id, trigger: rule.trigger.kind });
    return { rule };
  });
  r.on('PUT', '/api/admin/gifts/:id', async ({ req, params }) => {
    const me = admin(req);
    const old = store.giftRules().find((x) => x.id === params.id);
    if (!old) throw new HttpError(404, 'No such gift.');
    const v = await readRule(req);
    // A scheduled gift moved to another moment goes out again then.
    const refire = v.trigger.kind === 'scheduled' && (old.trigger.kind !== 'scheduled' || old.trigger.at !== v.trigger.at);
    const rule: GiftRule = { ...old, ...v, from: v.from, until: v.until, updatedAt: Date.now(), author: actor(me), fired: refire ? false : old.fired };
    store.saveGiftRule(rule);
    store.audit(actor(me), 'gift.edit', rule.id, { name: rule.name, trigger: rule.trigger, enabled: rule.enabled });
    return { rule };
  });
  r.on('DELETE', '/api/admin/gifts/:id', ({ req, params }) => {
    const me = admin(req);
    if (!store.giftRules().some((x) => x.id === params.id)) throw new HttpError(404, 'No such gift.');
    store.deleteGiftRule(params.id);
    store.audit(actor(me), 'gift.delete', params.id);
    return { ok: true };
  });
  /** Send a letter right now: to everyone, everyone online, or a list of players. */
  r.on('POST', '/api/admin/gifts/send', async ({ req }) => {
    const me = admin(req);
    const b = await readJson(req, 32 * 1024);
    const letter = parseGiftLetter(b.letter);
    if (typeof letter === 'string') throw new HttpError(400, letter);
    let to: 'all' | 'online' | string[];
    if (b.to === 'all' || b.to === 'online') to = b.to;
    else if (Array.isArray(b.to) && b.to.length && b.to.length <= 1000 && b.to.every((x) => typeof x === 'string' && store.players.has(x))) to = b.to as string[];
    else throw new HttpError(400, 'Pick who gets it.');
    const sent = sendGiftNow(game, letter, to, actor(me));
    store.audit(actor(me), 'gift.send', Array.isArray(to) ? to.join(',').slice(0, 200) : to, { sent, items: letter.items, coins: letter.coins });
    return { ok: true, sent };
  });
  /** Try a letter on yourself (doesn't count as the rule having been sent to you). */
  r.on('POST', '/api/admin/gifts/test', async ({ req }) => {
    const me = admin(req);
    const b = await readJson(req, 32 * 1024);
    const letter = parseGiftLetter(b.letter);
    if (typeof letter === 'string') throw new HttpError(400, letter);
    if (!me.created) throw new HttpError(400, 'Make a character first.');
    deliverGift(game, me, letter, 'test');
    return { ok: true };
  });
}

