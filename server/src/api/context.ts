// What every group of HTTP routes gets: the router, the game, and the guards that
// say who is asking. Also the validators for what admins send.

import { config } from '../config.ts';
import { hashToken } from '../auth.ts';
import { HttpError, Router, bearer } from '../http.ts';
import type { Game } from '../game/Game.ts';
import type { Store } from '../store.ts';
import type { PlayerRecord } from '../types.ts';

type Req = Parameters<typeof bearer>[0];

export interface Api {
  r: Router;
  game: Game;
  store: Store;
  /** The logged-in player behind a bearer token. */
  who(req: Req): PlayerRecord;
  /** The same, and they must be an admin. */
  admin(req: Req): PlayerRecord;
  /** The same, on a dev server only (the game creation tool). */
  dev(req: Req): PlayerRecord;
  /** How a player is named in the audit log. */
  actor(p: PlayerRecord): string;
}

export function makeApi(game: Game, store: Store): Api {
  const who = (req: Req): PlayerRecord => {
    const t = bearer(req);
    const p = t ? store.playerByToken(hashToken(t)) : undefined;
    if (!p) throw new HttpError(401, 'Please log in.');
    return p;
  };
  const admin = (req: Req): PlayerRecord => {
    const p = who(req);
    if (!game.isAdmin(p)) throw new HttpError(403, 'Admins only.');
    if (game.banReason(p)) throw new HttpError(403, 'Banned.');
    return p;
  };
  const dev = (req: Req) => {
    if (!config.devFast) throw new HttpError(404, 'Not found');
    return who(req);
  };
  return { r: new Router(), game, store, who, admin, dev, actor: (p) => p.username ?? p.id };
}

/** Sliding-window limiter keyed by IP (or anything). */
export function limiter(max: number, windowMs: number) {
  const hits = new Map<string, number[]>();
  return (key: string) => {
    const now = Date.now();
    const list = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
    if (list.length >= max) return false;
    list.push(now);
    hits.set(key, list);
    if (hits.size > 10000) hits.clear();
    return true;
  };
}

// ── Validators (everything an admin sends is checked) ────────────────────────

export const int = (v: unknown, min: number, max: number, what: string) => {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) throw new HttpError(400, `${what} must be a whole number between ${min} and ${max}.`);
  return v;
};
export const str = (v: unknown, min: number, max: number, what: string) => {
  if (typeof v !== 'string' || v.length < min || v.length > max) throw new HttpError(400, `${what} must be ${min}–${max} characters.`);
  return v;
};
export const COLOR = /^#[0-9a-fA-F]{6}$/;
