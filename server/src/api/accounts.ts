// HTTP API: registering, logging in and out, the account's email address.

import { PROTOCOL_VERSION, normalizeEmail } from '@hearthwood/shared';
import { config } from '../config.ts';
import { credentialError, hashToken } from '../auth.ts';
import { HttpError, bearer, clientIp, readJson } from '../http.ts';
import { logger } from '../log.ts';
import { emailStatus, startEmail, verifyEmail } from '../game/services/email.ts';
import { type Api, limiter } from './context.ts';

const log = logger('api');

export function accountRoutes(api: Api) {
  const { r, game, store, who } = api;
  const allowRegister = limiter(config.registerPerHourPerIp, 3600_000);
  const allowLogin = limiter(20, 10 * 60_000);
  const allowEmail = limiter(20, 3600_000);

  r.on('GET', '/api/health', () => ({ ok: true, protocol: PROTOCOL_VERSION, online: game.online.size, guests: config.allowGuests, dev: config.devFast }));

  r.on('POST', '/api/register', async ({ req }) => {
    const body = await readJson(req, 4096);
    const ip = clientIp(req);
    const guest = !body.username && !body.password;
    if (guest && !config.allowGuests) throw new HttpError(400, 'Choose a username and password to register.');
    if (!guest) {
      const bad = credentialError(body.username, body.password);
      if (bad) throw new HttpError(400, bad);
      const email = normalizeEmail(body.email);
      if (!email) throw new HttpError(400, 'Enter your email address – you’ll get a code to confirm it.');
      if (store.emailTaken(email)) throw new HttpError(409, 'Another account already uses that email address.');
    }
    if (!allowRegister(ip)) {
      log.warn('registration rate limit hit', { ip });
      throw new HttpError(429, 'Too many new accounts from this address. Try later.');
    }
    const out = guest ? game.register() : game.register(body.username as string, body.password as string);
    if ('error' in out) throw new HttpError(409, out.error);
    log.info('account registered', { player: out.playerId, username: guest ? undefined : body.username, guest: guest || undefined, ip });
    if (guest) return out;
    // Mail the confirmation code right away (the account can't play until it's entered).
    const sent = await startEmail(game, store.players.get(out.playerId)!, body.email);
    return { ...out, emailSent: 'error' in sent ? null : sent.sentTo, emailError: 'error' in sent ? sent.error : undefined, devCode: 'devCode' in sent ? sent.devCode : undefined };
  });

  r.on('POST', '/api/login', async ({ req }) => {
    const body = await readJson(req, 4096);
    const ip = clientIp(req);
    if (!allowLogin(ip)) throw new HttpError(429, 'Too many login attempts. Wait a few minutes.');
    if (typeof body.username !== 'string' || typeof body.password !== 'string') throw new HttpError(400, 'Enter your username (or email) and password.');
    const out = game.login(body.username, body.password);
    if ('error' in out) {
      log.info('login failed', { username: body.username, ip });
      throw new HttpError(401, out.error);
    }
    log.info('logged in', { player: out.playerId, ip });
    return out;
  });

  /** A guest account (made in dev mode) picks a username + password. */
  r.on('POST', '/api/account', async ({ req }) => {
    const p = who(req);
    const body = await readJson(req, 4096);
    const bad = credentialError(body.username, body.password);
    if (bad) throw new HttpError(400, bad);
    const err = game.claimAccount(p, body.username as string, body.password as string);
    if (err) throw new HttpError(409, err);
    log.info('guest account registered', { player: p.id, username: body.username });
    return { ok: true, username: p.username };
  });

  r.on('POST', '/api/logout', ({ req }) => {
    const t = bearer(req);
    if (t) store.removeToken(hashToken(t));
    return { ok: true };
  });

  r.on('GET', '/api/me', ({ req }) => {
    const p = who(req);
    return { id: p.id, username: p.username ?? null, name: p.name, admin: game.isAdmin(p), dev: config.devFast, ...emailStatus(p) };
  });

  /** Ask for a code to confirm (or change to) this email address. */
  r.on('POST', '/api/email', async ({ req }) => {
    const p = who(req);
    const body = await readJson(req, 4096);
    if (!allowEmail(clientIp(req))) throw new HttpError(429, 'Too many codes asked for from this address. Try later.');
    const r = await startEmail(game, p, body.email);
    if ('error' in r) throw new HttpError(400, r.error);
    return { ok: true, ...r };
  });
  /** Enter the code from the email. */
  r.on('POST', '/api/email/verify', async ({ req }) => {
    const p = who(req);
    const body = await readJson(req, 4096);
    const r = verifyEmail(game, p, body.code);
    if ('error' in r) throw new HttpError(400, r.error);
    return { ok: true, email: r.email };
  });
}

