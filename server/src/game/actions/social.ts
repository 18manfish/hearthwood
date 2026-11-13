// Letters and messages in bottles.

import {
  BOTTLE_COOLDOWN_MS, BOTTLE_MAX_DELAY_MS, BOTTLE_MIN_DELAY_MS, Tile,
} from '@hearthwood/shared';
import { config } from '../../config.ts';
import * as inv from '../inventory.ts';
import { fail, give, type Handlers, log, nearCompleted } from './context.ts';

export const socialHandlers: Pick<Handlers, 'mail' | 'takeMail' | 'bottle'> = {
  mail(ctx, a) {
    if (ctx.room.kind !== 'island' && ctx.room.kind !== 'shared') return fail('Find a mailbox first.');
    if (!nearCompleted(ctx, ['mailbox'])) return fail('Stand next to a mailbox.');
    if (ctx.room.kind === 'shared' || ctx.room.isOwner(ctx.p.id)) {
      // Your own (or the town's public) mailbox: write to any friend.
      // Your own mailbox: write to any friend.
      if (!ctx.p.friends.includes(a.to)) return fail('You can only send mail to friends.');
    } else if (a.to !== ctx.room.ownerId) {
      // Someone else's mailbox: you can leave a letter for its owner.
      return fail('This mailbox only takes letters for its owner.');
    }
    if (a.to === ctx.p.id) return fail('You can’t write to yourself.');
    const to = ctx.game.store.players.get(a.to);
    if (!to) return fail('Unknown player.');
    if (to.mail.length >= 50) return fail(`${to.name}’s mailbox is full.`);
    const n = a.n ?? 1;
    if (a.item) {
      if (inv.count(ctx.p, a.item) < n) return fail('You don’t have that.');
      inv.remove(ctx.p, a.item, n);
    }
    const text = ctx.game.sanitize(a.text);
    to.mail.push({ id: `m${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`, from: ctx.p.id, fromName: ctx.p.name, text, item: a.item, n: a.item ? n : undefined, at: ctx.now });
    ctx.game.store.markPlayer(to.id);
    ctx.game.notifyMail(to.id);
    return { ok: true, msg: `Letter sent to ${to.name}!` };
  },
  takeMail(ctx, a) {
    const idx = ctx.p.mail.findIndex((m) => m.id === a.mailId);
    if (idx < 0) return fail('No such letter.');
    const m = ctx.p.mail[idx];
    const gained: Record<string, number> = {};
    if (m.item && m.n) {
      if (!inv.canAdd(ctx.p, m.item, m.n)) return fail('You can’t carry the attachment.');
      give(ctx, gained, m.item, m.n);
    }
    ctx.p.mail.splice(idx, 1);
    ctx.s.send({ t: 'mail', list: ctx.p.mail });
    return { ok: true, gained };
  },
  bottle(ctx, a) {
    if (inv.count(ctx.p, 'message_bottle') < 1) return fail('You need a Message Bottle (2 sea glass + 1 fiber).');
    const g = ctx.room.grid;
    const tx = Math.floor(ctx.s.x), tz = Math.floor(ctx.s.z);
    let sea = false;
    for (let dz = -3; dz <= 3 && !sea; dz++) for (let dx = -3; dx <= 3 && !sea; dx++) sea = g.tile(tx + dx, tz + dz) === Tile.Sea;
    if (!sea || ctx.room.kind === 'interior') return fail('Walk down to the sea to throw it in.');
    const wait = (ctx.p.lastBottleAt ?? 0) + BOTTLE_COOLDOWN_MS - ctx.now;
    if (wait > 0 && !config.devFast) return fail(`Let the last one drift off first (${Math.ceil(wait / 60000)} min).`);
    const text = ctx.game.sanitize(a.text).trim();
    if (!text) return fail('Write something first.');
    inv.remove(ctx.p, 'message_bottle', 1);
    ctx.p.lastBottleAt = ctx.now;
    const delay = BOTTLE_MIN_DELAY_MS + Math.random() * (BOTTLE_MAX_DELAY_MS - BOTTLE_MIN_DELAY_MS);
    const id = `bt_${ctx.now.toString(36)}${Math.floor(Math.random() * 1e9).toString(36)}`;
    ctx.game.store.addBottle({ id, fromId: ctx.p.id, fromName: ctx.p.name, text, deliverAt: ctx.now + delay / config.timeFactor });
    log.info('bottle thrown', { player: ctx.p.id, bottle: id, hours: Math.round(delay / 360000) / 10 });
    return { ok: true, msg: '🍾 Off it goes! It will wash up on someone’s beach within a day.' };
  },
};
