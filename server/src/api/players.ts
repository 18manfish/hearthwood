// HTTP API (admin): looking up and editing players.

import { HOTBAR_TOOLS, ITEMS, PERMITS, isValidBirthday, normalizeEmail, normalizeHotbar, cleanOutfit, outfitOf } from '@hearthwood/shared';
import { hashPassword, USERNAME_RE } from '../auth.ts';
import { HttpError, readJson } from '../http.ts';
import { logger } from '../log.ts';
import type { Game } from '../game/Game.ts';
import type { Store } from '../store.ts';
import type { PlayerRecord } from '../types.ts';
import { type Api, COLOR, int, str } from './context.ts';

const log = logger('api');

export function playerRoutes(api: Api) {
  const { r, game, store, admin, actor } = api;
  const summary = (p: PlayerRecord) => {
    const isl = p.homeIslandId ? store.islands.get(p.homeIslandId) : undefined;
    return {
      id: p.id, username: p.username ?? null, email: p.email ?? null, name: p.name, role: p.role ?? 'player', banned: !!p.banned, online: game.online.has(p.id),
      coins: p.coins, island: isl ? { id: isl.id, name: isl.name, biome: isl.biome } : null, createdAt: p.createdAt, lastSeen: p.lastSeen,
      room: game.online.get(p.id)?.room?.id ?? null,
    };
  };
  const findPlayer = (id: string) => {
    const p = store.players.get(id);
    if (!p) throw new HttpError(404, 'No such player.');
    return p;
  };

  r.on('GET', '/api/admin/players', ({ req, url }) => {
    admin(req);
    const q = (url.searchParams.get('q') ?? '').toLowerCase();
    const list = [...store.players.values()]
      .filter((p) => !q || [p.id, p.name, p.username ?? '', p.code, p.email ?? ''].some((s) => s.toLowerCase().includes(q)))
      .sort((a, b) => Number(game.online.has(b.id)) - Number(game.online.has(a.id)) || b.lastSeen - a.lastSeen)
      .slice(0, 500);
    return { total: store.players.size, players: list.map(summary) };
  });

  r.on('GET', '/api/admin/players/:id', ({ req, params }) => {
    admin(req);
    const p = findPlayer(params.id);
    const { passHash: _ph, emailPending, ...safe } = p;
    return { player: { ...safe, hasPassword: !!p.passHash, emailPending: emailPending ? { email: emailPending.email, sentAt: emailPending.sentAt } : null }, summary: summary(p) };
  });

  r.on('PATCH', '/api/admin/players/:id', async ({ req, params }) => {
    const me = admin(req);
    const p = findPlayer(params.id);
    const body = await readJson(req);
    const changed = applyPlayerPatch(game, store, p, body, me);
    store.audit(actor(me), 'player.edit', p.id, { fields: changed });
    log.info('admin edited player', { admin: actor(me), player: p.id, fields: changed });
    return { ok: true, changed };
  });

  r.on('POST', '/api/admin/players/:id/kick', async ({ req, params }) => {
    const me = admin(req);
    const p = findPlayer(params.id);
    const body = await readJson(req, 4096);
    const done = game.kick(p.id, typeof body.message === 'string' && body.message ? body.message.slice(0, 200) : 'You were disconnected by an admin.');
    store.audit(actor(me), 'player.kick', p.id);
    return { ok: done };
  });

  r.on('POST', '/api/admin/players/:id/logout-all', ({ req, params }) => {
    const me = admin(req);
    const p = findPlayer(params.id);
    store.removeTokensOf(p.id);
    game.kick(p.id, 'Your sessions were ended by an admin. Please log in again.');
    store.audit(actor(me), 'player.logout-all', p.id);
    return { ok: true };
  });

  r.on('DELETE', '/api/admin/players/:id', ({ req, params }) => {
    const me = admin(req);
    const p = findPlayer(params.id);
    if (p.id === me.id) throw new HttpError(400, 'You can’t delete your own account here.');
    game.deletePlayer(p.id);
    store.audit(actor(me), 'player.delete', p.id, { name: p.name, username: p.username });
    log.warn('admin deleted player', { admin: actor(me), player: p.id });
    return { ok: true };
  });
}

// Everything an admin may change about a player, validated field by field.
function applyPlayerPatch(game: Game, store: Store, p: PlayerRecord, b: Record<string, unknown>, me: PlayerRecord): string[] {
  const changed: string[] = [];
  const set = (k: string, fn: () => void) => {
    if (k in b) {
      fn();
      changed.push(k);
    }
  };
  set('name', () => (p.name = str(b.name, 2, 16, 'Name')));
  set('username', () => {
    const u = str(b.username, 3, 20, 'Username');
    if (!USERNAME_RE.test(u)) throw new HttpError(400, 'Usernames are 3–20 letters, digits or _.');
    if (!store.setUsername(p, u)) throw new HttpError(409, 'That username is taken.');
  });
  set('password', () => {
    const pw = str(b.password, 8, 200, 'Password');
    p.passHash = hashPassword(pw);
    store.removeTokensOf(p.id); // log out everywhere
    game.kick(p.id, 'Your password was changed by an admin. Please log in again.');
  });
  set('coins', () => (p.coins = int(b.coins, 0, 99_999_999, 'Coins')));
  set('inv', () => {
    const inv = b.inv as Record<string, unknown>;
    if (typeof inv !== 'object' || !inv) throw new HttpError(400, 'Inventory must be an object.');
    const out: Record<string, number> = {};
    for (const [id, n] of Object.entries(inv)) {
      if (!ITEMS[id]) throw new HttpError(400, `Unknown item "${id}".`);
      const q = int(n, 0, 9999, `Amount of ${id}`);
      if (q > 0) out[id] = q;
    }
    p.inv = out;
  });
  set('permits', () => {
    const list = b.permits;
    if (!Array.isArray(list) || list.some((x) => !PERMITS.some((pm) => pm.id === x))) throw new HttpError(400, 'Unknown permit.');
    p.permits = [...new Set(list as string[])];
  });
  set('hotbar', () => {
    if (!Array.isArray(b.hotbar) || b.hotbar.some((x) => x !== null && !(HOTBAR_TOOLS as readonly unknown[]).includes(x))) throw new HttpError(400, 'Bad hotbar.');
    p.hotbar = normalizeHotbar(b.hotbar);
  });
  set('album', () => {
    const a = b.album as PlayerRecord['album'];
    if (!a || typeof a.fish !== 'object' || typeof a.birds !== 'object') throw new HttpError(400, 'Album needs { fish: {}, birds: {} }.');
    p.album = a;
  });
  set('look', () => {
    const l = b.look as Record<string, unknown>;
    for (const k of ['skin', 'hairColor', 'eyes', 'shirt', 'pants', 'shoes']) if (typeof l?.[k] !== 'string' || !COLOR.test(l[k] as string)) throw new HttpError(400, `look.${k} must be #rrggbb.`);
    if (typeof l.hair !== 'string') throw new HttpError(400, 'look.hair missing.');
    p.look = l as unknown as PlayerRecord['look'];
  });
  set('recreate', () => {
    // Make them redo their character (looks only) at their next login – right now if they're online.
    if (b.recreate !== true) throw new HttpError(400, 'recreate must be true.');
    p.lookVersion = 1;
    game.kick(p.id, 'Time for a new look! Log in again to redo your character.');
  });
  set('gender', () => {
    if (b.gender !== 'boy' && b.gender !== 'girl') throw new HttpError(400, 'Gender must be boy or girl.');
    p.gender = b.gender;
  });
  set('hat', () => {
    if (b.hat !== null && (typeof b.hat !== 'string' || ITEMS[b.hat]?.wear !== 'hat')) throw new HttpError(400, 'Not a hat.');
    p.hat = b.hat as string | null;
    p.outfit = { ...outfitOf(p), hat: p.hat ?? undefined };
    if (!p.hat) delete p.outfit.hat;
  });
  set('outfit', () => {
    p.outfit = cleanOutfit(b.outfit);
    p.hat = p.outfit.hat ?? null;
  });
  set('role', () => {
    if (b.role !== 'admin' && b.role !== 'player') throw new HttpError(400, 'Role must be admin or player.');
    if (p.id === me.id && b.role !== 'admin') throw new HttpError(400, 'You can’t remove your own admin role.');
    p.role = b.role;
  });
  set('banned', () => {
    if (b.banned === null || b.banned === false) return void delete p.banned;
    const ban = b.banned as { reason?: unknown; until?: unknown };
    if (p.id === me.id) throw new HttpError(400, 'You can’t ban yourself.');
    p.banned = { reason: typeof ban.reason === 'string' ? ban.reason.slice(0, 200) : '', until: typeof ban.until === 'number' ? ban.until : undefined, by: me.username ?? me.id };
    game.kick(p.id, `You were banned: ${p.banned.reason || 'no reason given'}`);
  });
  set('chapterRewarded', () => (p.chapterRewarded = int(b.chapterRewarded, 0, 99, 'Chapter')));
  set('email', () => {
    // Set by an admin: counts as confirmed (empty removes it – the player is asked again).
    if (b.email === null || b.email === '') return void store.setEmail(p, null);
    const email = normalizeEmail(b.email);
    if (!email) throw new HttpError(400, 'Email: not a valid address.');
    if (!store.setEmail(p, email)) throw new HttpError(409, 'Another account already uses that email address.');
    delete p.emailPending;
  });
  set('birthday', () => {
    if (!isValidBirthday(b.birthday)) throw new HttpError(400, 'Birthday: a date from 1900 until today.');
    p.birthday = b.birthday;
  });
  set('mail', () => {
    if (!Array.isArray(b.mail)) throw new HttpError(400, 'Mail must be a list.');
    p.mail = b.mail as PlayerRecord['mail'];
  });
  set('homeIslandId', () => {
    if (b.homeIslandId !== null && (typeof b.homeIslandId !== 'string' || !store.islands.has(b.homeIslandId))) throw new HttpError(400, 'No such island.');
    p.homeIslandId = b.homeIslandId as string | null;
  });
  if (changed.length) {
    store.markPlayer(p.id);
    game.refreshPlayer(p.id);
  }
  return changed;
}

