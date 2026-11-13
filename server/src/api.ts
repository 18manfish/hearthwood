// HTTP API: accounts, public game data, the admin tool and (dev mode only)
// the game creation tool.

import {
  ACCESS_LEVELS, BIOME_IDS, BUILDINGS, DEFAULT_GAME_DATA, GAME_TABLES, HOTBAR_TOOLS, ITEMS, PERMITS, PROTOCOL_VERSION, VILLAGERS, FRIENDSHIP_MAX,
  applyGameData, decodeTiles, encodeTiles, generateIsland, isBiome, isBuildingType, normalizeHotbar, snapshotGameData, validateGameData, villagerDef,
  type Access, type Building, type GameData, type GameTable, type WorldObject,
} from '@hearthwood/shared';
import crypto from 'node:crypto';
import { config } from './config.ts';
import { credentialError, hashPassword, hashToken, USERNAME_RE } from './auth.ts';
import { HttpError, Router, bearer, clientIp, readJson } from './http.ts';
import { logger } from './log.ts';
import type { Game } from './game/Game.ts';
import type { NewsRow, Store } from './store.ts';
import type { IslandRecord, PlayerRecord, VillagerRecord } from './types.ts';

const log = logger('api');

/** Sliding-window limiter keyed by IP (or anything). */
function limiter(max: number, windowMs: number) {
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

const OBJ_KINDS = ['tree', 'stump', 'rock', 'bush', 'mushroom', 'flower', 'furniture', 'decor'];

export function buildApi(game: Game, store: Store): Router {
  const r = new Router();
  const allowRegister = limiter(config.registerPerHourPerIp, 3600_000);
  const allowLogin = limiter(20, 10 * 60_000);

  /** The logged-in player behind a bearer token. */
  const who = (req: Parameters<typeof bearer>[0]): PlayerRecord => {
    const t = bearer(req);
    const p = t ? store.playerByToken(hashToken(t)) : undefined;
    if (!p) throw new HttpError(401, 'Please log in.');
    return p;
  };
  const admin = (req: Parameters<typeof bearer>[0]): PlayerRecord => {
    const p = who(req);
    if (!game.isAdmin(p)) throw new HttpError(403, 'Admins only.');
    if (game.banReason(p)) throw new HttpError(403, 'Banned.');
    return p;
  };
  const actor = (p: PlayerRecord) => p.username ?? p.id;

  // ── Accounts ────────────────────────────────────────────────────────────
  r.on('GET', '/api/health', () => ({ ok: true, protocol: PROTOCOL_VERSION, online: game.online.size, guests: config.allowGuests, dev: config.devFast }));

  r.on('POST', '/api/register', async ({ req }) => {
    const body = await readJson(req, 4096);
    const ip = clientIp(req);
    const guest = !body.username && !body.password;
    if (guest && !config.allowGuests) throw new HttpError(400, 'Choose a username and password to register.');
    if (!guest) {
      const bad = credentialError(body.username, body.password);
      if (bad) throw new HttpError(400, bad);
    }
    if (!allowRegister(ip)) {
      log.warn('registration rate limit hit', { ip });
      throw new HttpError(429, 'Too many new accounts from this address. Try later.');
    }
    const out = guest ? game.register() : game.register(body.username as string, body.password as string);
    if ('error' in out) throw new HttpError(409, out.error);
    log.info('account registered', { player: out.playerId, username: guest ? undefined : body.username, guest: guest || undefined, ip });
    return out;
  });

  r.on('POST', '/api/login', async ({ req }) => {
    const body = await readJson(req, 4096);
    const ip = clientIp(req);
    if (!allowLogin(ip)) throw new HttpError(429, 'Too many login attempts. Wait a few minutes.');
    if (typeof body.username !== 'string' || typeof body.password !== 'string') throw new HttpError(400, 'Enter your username and password.');
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
    return { id: p.id, username: p.username ?? null, name: p.name, admin: game.isAdmin(p), dev: config.devFast };
  });

  // ── News boxes on the start screen ─────────────────────────────────────
  const newsView = (n: NewsRow) => ({ id: n.id, title: n.title, body: n.body, icon: n.icon ?? '📰', created: n.created, updated: n.updated, author: n.author, pinned: !!n.pinned, published: !!n.published, imageOnly: !!n.image_only });
  r.on('GET', '/api/news', () => ({ news: store.news().map(newsView) }));
  r.on('GET', '/api/admin/news', ({ req }) => {
    admin(req);
    return { news: store.news(true).map(newsView) };
  });
  const readNews = async (req: Parameters<typeof readJson>[0]) => {
    const b = await readJson(req, 64 * 1024);
    return {
      title: str(b.title, 1, 120, 'Title'),
      body: str(b.body, 0, 60000, 'Text'),
      icon: typeof b.icon === 'string' && b.icon.length <= 16 ? b.icon || '📰' : '📰',
      pinned: b.pinned === true,
      published: b.published !== false,
      imageOnly: b.imageOnly === true,
    };
  };
  r.on('POST', '/api/admin/news', async ({ req }) => {
    const me = admin(req);
    const id = store.saveNews(await readNews(req), actor(me));
    store.audit(actor(me), 'news.create', String(id));
    return { ok: true, id };
  });
  r.on('PUT', '/api/admin/news/:id', async ({ req, params }) => {
    const me = admin(req);
    const id = Number(params.id);
    if (!store.news(true).some((n) => n.id === id)) throw new HttpError(404, 'No such news box.');
    store.saveNews({ ...(await readNews(req)), id }, actor(me));
    store.audit(actor(me), 'news.edit', String(id));
    return { ok: true, id };
  });
  // Images inside news boxes: uploaded as a data URL, served as plain files.
  const IMAGE_TYPES: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };
  r.on('POST', '/api/admin/news/images', async ({ req }) => {
    const me = admin(req);
    const b = await readJson(req, 8 * 1024 * 1024);
    const m = typeof b.data === 'string' ? /^data:(image\/[a-z]+);base64,([A-Za-z0-9+/=]+)$/.exec(b.data) : null;
    if (!m || !IMAGE_TYPES[m[1]]) throw new HttpError(400, 'Send a PNG, JPEG, WebP or GIF image.');
    const data = Buffer.from(m[2], 'base64');
    if (!data.length || data.length > 5 * 1024 * 1024) throw new HttpError(413, 'Images can be at most 5 MB.');
    const id = `${crypto.randomBytes(9).toString('base64url')}.${IMAGE_TYPES[m[1]]}`;
    store.saveNewsImage(id, m[1], data, actor(me));
    store.audit(actor(me), 'news.image', id, { bytes: data.length });
    return { ok: true, id, url: `/api/news/images/${id}` };
  });
  r.on('GET', '/api/news/images/:id', ({ res, params }) => {
    const img = /^[A-Za-z0-9_-]+\.[a-z]+$/.test(params.id) ? store.newsImage(params.id) : undefined;
    if (!img) throw new HttpError(404, 'No such image.');
    res.writeHead(200, { 'content-type': img.mime, 'content-length': img.data.byteLength, 'cache-control': 'public, max-age=31536000, immutable', 'x-content-type-options': 'nosniff' });
    res.end(Buffer.from(img.data));
  });
  r.on('DELETE', '/api/admin/news/:id', ({ req, params }) => {
    const me = admin(req);
    store.deleteNews(Number(params.id));
    store.audit(actor(me), 'news.delete', params.id);
    return { ok: true };
  });

  // ── Game data (everyone needs it to play) ──────────────────────────────
  r.on('GET', '/api/gamedata', () => game.gameDataOverrides);

  // ── Admin: players ──────────────────────────────────────────────────────
  const summary = (p: PlayerRecord) => {
    const isl = p.homeIslandId ? store.islands.get(p.homeIslandId) : undefined;
    return {
      id: p.id, username: p.username ?? null, name: p.name, role: p.role ?? 'player', banned: !!p.banned, online: game.online.has(p.id),
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
      .filter((p) => !q || [p.id, p.name, p.username ?? '', p.code].some((s) => s.toLowerCase().includes(q)))
      .sort((a, b) => Number(game.online.has(b.id)) - Number(game.online.has(a.id)) || b.lastSeen - a.lastSeen)
      .slice(0, 500);
    return { total: store.players.size, players: list.map(summary) };
  });

  r.on('GET', '/api/admin/players/:id', ({ req, params }) => {
    admin(req);
    const p = findPlayer(params.id);
    const { passHash: _ph, ...safe } = p;
    return { player: { ...safe, hasPassword: !!p.passHash }, summary: summary(p) };
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

  // ── Admin: islands ──────────────────────────────────────────────────────
  const findIsland = (id: string) => {
    const i = store.islands.get(id);
    if (!i) throw new HttpError(404, 'No such island.');
    return i;
  };

  r.on('GET', '/api/admin/islands', ({ req, url }) => {
    admin(req);
    const q = (url.searchParams.get('q') ?? '').toLowerCase();
    const list = [...store.islands.values()]
      .filter((i) => !q || [i.id, i.name, store.players.get(i.ownerId)?.name ?? ''].some((s) => s.toLowerCase().includes(q)))
      .slice(0, 500)
      .map((i) => ({
        id: i.id, name: i.name, biome: i.biome, owner: { id: i.ownerId, name: store.players.get(i.ownerId)?.name ?? '?' }, access: i.access,
        size: i.size ?? 48, buildings: i.buildings.length, villagers: i.villagers.length, villagerIds: i.villagers.map((v) => v.defId), loaded: game.rooms.has(i.id),
        visitors: game.rooms.get(i.id)?.sessions.size ?? 0, createdAt: i.createdAt,
      }));
    return { total: store.islands.size, islands: list };
  });

  r.on('GET', '/api/admin/islands/:id', ({ req, params }) => {
    admin(req);
    const rec = findIsland(params.id);
    return game.adminIslandView(rec);
  });

  /** One villager on an island, with the names of the players they know. */
  r.on('GET', '/api/admin/islands/:id/villagers/:vid', ({ req, params }) => {
    admin(req);
    const rec = findIsland(params.id);
    const view = game.adminIslandView(rec);
    const v = rec.villagers.find((x) => x.defId === params.vid);
    if (!v) throw new HttpError(404, 'That villager doesn’t live on this island.');
    const houses = view.record.buildings.filter((b) => b.type === 'villager_house').map((b) => ({ id: b.id, x: b.x, z: b.z, villagerId: b.villagerId ?? null }));
    const live = view.villagers.find((x) => x.id === v.defId) ?? null;
    const friends = Object.entries(v.friendship).map(([pid, f]) => {
      const pl = store.players.get(pid);
      return { id: pid, name: pl?.name ?? null, username: pl?.username ?? null, online: game.online.has(pid), ...f };
    }).sort((a, b) => b.pts - a.pts);
    return {
      island: { id: rec.id, name: rec.name, biome: rec.biome, loaded: view.loaded },
      owner: view.owner, villager: v, live, houses, friends,
      others: rec.villagers.filter((x) => x.defId !== v.defId).map((x) => x.defId),
    };
  });

  r.on('PATCH', '/api/admin/islands/:id', async ({ req, params }) => {
    const me = admin(req);
    const rec = findIsland(params.id);
    const body = await readJson(req);
    game.syncIsland(rec.id); // pull live state into the record first
    const changed = applyIslandPatch(store, rec, body);
    store.markIsland(rec.id);
    game.reloadIsland(rec.id);
    store.audit(actor(me), 'island.edit', rec.id, { fields: changed });
    log.info('admin edited island', { admin: actor(me), island: rec.id, fields: changed });
    return { ok: true, changed, island: game.adminIslandView(rec) };
  });

  r.on('GET', '/api/admin/audit', ({ req, url }) => {
    admin(req);
    return { entries: store.auditLog(Number(url.searchParams.get('limit')) || 200) };
  });

  // ── Game creation tool (dev mode only) ──────────────────────────────────
  const dev = (req: Parameters<typeof bearer>[0]) => {
    if (!config.devFast) throw new HttpError(404, 'Not found');
    return who(req);
  };

  r.on('GET', '/api/dev/gamedata', ({ req }) => {
    dev(req);
    return { current: snapshotGameData(), defaults: DEFAULT_GAME_DATA, overridden: store.gameDataInfo() };
  });

  r.on('PUT', '/api/dev/gamedata/:table', async ({ req, params }) => {
    const me = dev(req);
    const table = params.table as GameTable;
    if (!GAME_TABLES.includes(table)) throw new HttpError(404, 'Unknown table.');
    const body = await readJson(req);
    const next = { ...snapshotGameData(), [table]: body.data } as GameData;
    const errors = validateGameData(next);
    if (errors.length) throw new HttpError(400, errors.join('\n'));
    game.setGameData({ [table]: body.data }, actor(me));
    return { ok: true };
  });

  r.on('DELETE', '/api/dev/gamedata/:table', ({ req, params }) => {
    const me = dev(req);
    const table = params.table as GameTable;
    if (!GAME_TABLES.includes(table)) throw new HttpError(404, 'Unknown table.');
    game.resetGameData([table], actor(me));
    return { ok: true };
  });

  /** Import a whole data set (e.g. a file exported from another server). */
  r.on('PUT', '/api/dev/gamedata', async ({ req }) => {
    const me = dev(req);
    const body = await readJson(req);
    const data = body.data as Partial<GameData>;
    if (!data || typeof data !== 'object') throw new HttpError(400, 'Expected { data: {...} }');
    const tables = GAME_TABLES.filter((t) => t in data);
    const next = { ...snapshotGameData(), ...data } as GameData;
    const errors = validateGameData(next);
    if (errors.length) throw new HttpError(400, errors.join('\n'));
    game.setGameData(Object.fromEntries(tables.map((t) => [t, data[t]])), actor(me));
    return { ok: true, tables };
  });

  return r;
}

// ── Patch helpers (validate everything an admin sends) ───────────────────────

const int = (v: unknown, min: number, max: number, what: string) => {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) throw new HttpError(400, `${what} must be a whole number between ${min} and ${max}.`);
  return v;
};
const str = (v: unknown, min: number, max: number, what: string) => {
  if (typeof v !== 'string' || v.length < min || v.length > max) throw new HttpError(400, `${what} must be ${min}–${max} characters.`);
  return v;
};
const COLOR = /^#[0-9a-fA-F]{6}$/;

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
  set('gender', () => {
    if (b.gender !== 'boy' && b.gender !== 'girl') throw new HttpError(400, 'Gender must be boy or girl.');
    p.gender = b.gender;
  });
  set('hat', () => {
    if (b.hat !== null && (typeof b.hat !== 'string' || ITEMS[b.hat]?.wear !== 'hat')) throw new HttpError(400, 'Not a hat.');
    p.hat = b.hat as string | null;
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

function applyIslandPatch(store: Store, rec: IslandRecord, b: Record<string, unknown>): string[] {
  const changed: string[] = [];
  const size = rec.size ?? 48;
  const set = (k: string, fn: () => void) => {
    if (k in b) {
      fn();
      changed.push(k);
    }
  };
  const inside = (x: unknown, z: unknown, what: string) => {
    int(x, 0, size - 1, `${what} x`);
    int(z, 0, size - 1, `${what} z`);
  };
  set('name', () => (rec.name = str(b.name, 2, 20, 'Island name')));
  set('access', () => {
    if (!(ACCESS_LEVELS as readonly unknown[]).includes(b.access)) throw new HttpError(400, 'Unknown access level.');
    rec.access = b.access as Access;
  });
  set('inviteCode', () => {
    const c = str(b.inviteCode, 4, 12, 'Invite code').toUpperCase();
    if (!/^[A-Z0-9]+$/.test(c)) throw new HttpError(400, 'Invite codes are letters and digits.');
    if (c !== rec.inviteCode && store.codeTaken(c)) throw new HttpError(409, 'That code is taken.');
    store.setInviteCode(rec, c);
  });
  set('biome', () => {
    if (!isBiome(b.biome)) throw new HttpError(400, `Biome must be one of ${BIOME_IDS.join(', ')}.`);
    rec.biome = b.biome;
  });
  set('seed', () => (rec.seed = int(b.seed, 0, 2 ** 31 - 1, 'Seed')));
  set('foundedDayKey', () => {
    if (typeof b.foundedDayKey !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(b.foundedDayKey)) throw new HttpError(400, 'Founding day must be YYYY-MM-DD.');
    rec.foundedDayKey = b.foundedDayKey;
  });
  set('map', () => {
    const m = b.map as { x?: unknown; y?: unknown };
    rec.map = { x: int(m?.x, 0, 1000, 'Map x'), y: int(m?.y, 0, 560, 'Map y') };
  });
  set('objects', () => {
    if (!Array.isArray(b.objects)) throw new HttpError(400, 'Objects must be a list.');
    const ids = new Set<string>();
    const list = b.objects as WorldObject[];
    for (const o of list) {
      if (typeof o?.id !== 'string' || ids.has(o.id)) throw new HttpError(400, 'Every object needs a unique id.');
      ids.add(o.id);
      if (!OBJ_KINDS.includes(o.kind)) throw new HttpError(400, `Object ${o.id}: unknown kind.`);
      inside(o.x, o.z, `Object ${o.id}`);
      if ((o.kind === 'furniture' || o.kind === 'decor') && (typeof o.item !== 'string' || (o.kind === 'furniture' && !ITEMS[o.item]))) throw new HttpError(400, `Object ${o.id}: unknown item.`);
    }
    rec.objects = list;
  });
  set('buildings', () => {
    if (!Array.isArray(b.buildings)) throw new HttpError(400, 'Buildings must be a list.');
    const ids = new Set<string>();
    const list = b.buildings as Building[];
    for (const bd of list) {
      if (typeof bd?.id !== 'string' || ids.has(bd.id)) throw new HttpError(400, 'Every building needs a unique id.');
      ids.add(bd.id);
      if (!isBuildingType(bd.type)) throw new HttpError(400, `Building ${bd.id}: unknown type.`);
      inside(bd.x, bd.z, `Building ${bd.id}`);
      bd.w = BUILDINGS[bd.type].w;
      bd.h = BUILDINGS[bd.type].h;
      if (typeof bd.completeAt !== 'number') bd.completeAt = 0;
      if (bd.villagerId !== undefined && !villagerDef(bd.villagerId)) throw new HttpError(400, `Building ${bd.id}: unknown villager.`);
    }
    if (!list.some((x) => x.type === 'dock')) throw new HttpError(400, 'An island needs its dock.');
    rec.buildings = list;
  });
  set('villagers', () => {
    if (!Array.isArray(b.villagers)) throw new HttpError(400, 'Villagers must be a list.');
    const list = b.villagers as VillagerRecord[];
    const seen = new Set<string>();
    for (const v of list) {
      if (!VILLAGERS.some((d) => d.id === v?.defId) || seen.has(v.defId)) throw new HttpError(400, `Unknown or duplicate villager "${v?.defId}".`);
      seen.add(v.defId);
      if (typeof v.houseId !== 'string') throw new HttpError(400, `Villager ${v.defId} needs a house id.`);
      v.friendship ??= {};
      if (typeof v.friendship !== 'object' || Array.isArray(v.friendship)) throw new HttpError(400, `Villager ${v.defId}: friendship must be an object.`);
      for (const [pid, f] of Object.entries(v.friendship)) {
        if (!f || typeof f.pts !== 'number' || !Number.isFinite(f.pts)) throw new HttpError(400, `Villager ${v.defId}: friendship with ${pid} needs points.`);
        f.pts = Math.max(0, Math.min(FRIENDSHIP_MAX, Math.round(f.pts)));
      }
      v.movedInAt ??= Date.now();
    }
    rec.villagers = list;
  });
  // Terrain: tile / level / ramp arrays as digit strings (same encoding as the game).
  set('terrain', () => {
    if (b.terrain === null) return void delete rec.terrain;
    const t = b.terrain as { tiles?: unknown; levels?: unknown; ramps?: unknown };
    const n = size * size;
    for (const k of ['tiles', 'levels', 'ramps'] as const) if (typeof t?.[k] !== 'string' || (t[k] as string).length !== n || !/^[0-9]+$/.test(t[k] as string)) throw new HttpError(400, `terrain.${k} must be ${n} digits.`);
    const tiles = decodeTiles(t.tiles as string), levels = decodeTiles(t.levels as string), ramps = decodeTiles(t.ramps as string);
    if (tiles.some((v) => v > 8) || levels.some((v) => v > 3) || ramps.some((v) => v > 4)) throw new HttpError(400, 'Terrain values out of range.');
    rec.terrain = { tiles: encodeTiles(tiles), levels: encodeTiles(levels), ramps: encodeTiles(ramps) };
  });
  set('paths', () => {
    if (typeof b.paths !== 'string' || b.paths.length !== size * size || !/^[0-5]+$/.test(b.paths)) throw new HttpError(400, `paths must be ${size * size} digits 0–5.`);
    rec.paths = b.paths;
  });
  set('clearRespawns', () => (rec.respawns = []));
  // Start over: fresh terrain and resources from the (possibly new) seed / biome. Villagers move out.
  set('regenerate', () => {
    if (b.regenerate !== true) return;
    const L = generateIsland(rec.seed, rec.biome, { variant: 'home', elevation: (rec.gen ?? 1) >= 2, size });
    rec.objects = L.objects;
    rec.buildings = L.buildings;
    rec.villagers = [];
    rec.interiors = {};
    rec.respawns = [];
    delete rec.terrain;
    delete rec.paths;
  });
  return changed;
}
