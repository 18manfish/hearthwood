// Email addresses: every account with a username needs a confirmed one to play.
// Registering (or, for older accounts, the first login) asks for an address; the
// server mails a 6-digit code, and entering it confirms the address. A confirmed
// address can then be used to log in instead of the username.
//
// Codes are stored only as a hash, expire after 30 minutes and allow 5 wrong tries.
// A new code can be asked for once a minute, at most 10 times a day per account.

import { EMAIL_CODE_LENGTH, normalizeEmail } from '@hearthwood/shared';
import crypto from 'node:crypto';
import { config } from '../../config.ts';
import { logger } from '../../log.ts';
import { mailConfig, sendMail } from '../../mail.ts';
import type { PlayerRecord } from '../../types.ts';
import type { Game } from '../Game.ts';

const log = logger('email');

const CODE_TTL_MS = 30 * 60_000;
const MAX_TRIES = 5;
const RESEND_MS = 60_000;
const SENDS_PER_DAY = 10;

const hash = (code: string) => crypto.createHash('sha256').update(code).digest('hex');

/** Does this account have to confirm an email before it can play? (Dev-mode guests don't.) */
export function needsEmail(p: PlayerRecord) {
  return !!p.username && !p.email;
}

/** What the client may know about the account's email. */
export function emailStatus(p: PlayerRecord) {
  return { email: p.email ?? null, pending: p.emailPending ? { email: p.emailPending.email, sentAt: p.emailPending.sentAt } : null, needed: needsEmail(p) };
}

type G = Pick<Game, 'store'>;

/**
 * Mail a confirmation code to this address. Returns an error message, or what to tell
 * the player (and, on a dev server without mail set up, the code itself).
 */
export async function startEmail(game: G, p: PlayerRecord, raw: unknown, now = Date.now()): Promise<{ error: string } | { sentTo: string; devCode?: string }> {
  const email = normalizeEmail(raw);
  if (!email) return { error: 'That doesn’t look like an email address.' };
  if (p.email === email) return { error: 'That address is already confirmed.' };
  if (game.store.emailTaken(email, p.id)) return { error: 'Another account already uses that email address.' };
  const day = new Date(now).toISOString().slice(0, 10);
  const prev = p.emailPending;
  const sends = prev && prev.day === day ? prev.sends : 0;
  if (prev && now - prev.sentAt < RESEND_MS) return { error: `Please wait ${Math.ceil((RESEND_MS - (now - prev.sentAt)) / 1000)} s before asking for another code.` };
  if (sends >= SENDS_PER_DAY) return { error: 'Too many codes today – try again tomorrow.' };
  const code = String(crypto.randomInt(0, 10 ** EMAIL_CODE_LENGTH)).padStart(EMAIL_CODE_LENGTH, '0');
  p.emailPending = { email, codeHash: hash(code), expires: now + CODE_TTL_MS, tries: 0, sentAt: now, day, sends: sends + 1 };
  game.store.markPlayer(p.id);
  const who = p.username ?? p.name;
  try {
    await sendMail({
      to: email,
      subject: `Your Hearthwood code: ${code}`,
      text: `Hello ${who}!\n\nYour code to confirm this email address for Hearthwood is:\n\n    ${code}\n\nEnter it in the game within 30 minutes. If you didn’t ask for this, you can ignore this email.\n\n🌿 Hearthwood`,
    });
  } catch {
    // Let them try again straight away – nothing was sent.
    p.emailPending.sentAt = 0;
    return { error: 'The email couldn’t be sent. Check the address, or try again later.' };
  }
  log.info('confirmation code sent', { player: p.id, email });
  return { sentTo: email, devCode: config.devFast && !mailConfig ? code : undefined };
}

/** Check a code; on success the address is the account's confirmed email. */
export function verifyEmail(game: G, p: PlayerRecord, raw: unknown, now = Date.now()): { error: string } | { email: string } {
  const pend = p.emailPending;
  if (!pend) return { error: 'Ask for a code first.' };
  if (now > pend.expires) return { error: 'That code has expired – ask for a new one.' };
  if (pend.tries >= MAX_TRIES) return { error: 'Too many wrong tries – ask for a new code.' };
  const code = typeof raw === 'string' ? raw.replace(/\s+/g, '') : '';
  const a = Buffer.from(hash(code)), b = Buffer.from(pend.codeHash);
  if (!/^\d+$/.test(code) || !crypto.timingSafeEqual(a, b)) {
    pend.tries++;
    game.store.markPlayer(p.id);
    const left = MAX_TRIES - pend.tries;
    return { error: left > 0 ? `That code isn’t right (${left} ${left === 1 ? 'try' : 'tries'} left).` : 'Too many wrong tries – ask for a new code.' };
  }
  if (!game.store.setEmail(p, pend.email)) return { error: 'Another account confirmed that address first.' };
  delete p.emailPending;
  game.store.markPlayer(p.id);
  log.info('email confirmed', { player: p.id, email: pend.email });
  return { email: pend.email };
}
