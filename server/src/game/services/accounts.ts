// Accounts: registering, logging in, tokens, bans and kicks, admins, the first hello,
// character creation and deleting a player.

import {
  type ClientMessage, type Gender, hashString, ISLAND_SIZE, isValidTimeZone, localTime, type Look, makeCode, PROTOCOL_VERSION, type TravelTarget,
  OUTFIT_SETS, setOutfit,
  HAIR_STYLES, LOOK_VERSION,
} from '@hearthwood/shared';
import crypto from 'node:crypto';
import { config } from '../../config.ts';
import { logger } from '../../log.ts';
import { Room } from '../Room.ts';
import { Session } from '../Session.ts';
import * as inv from '../inventory.ts';
import { hashToken, hashPassword, newToken, verifyPassword } from '../../auth.ts';
import type { IslandRecord, PlayerRecord } from '../../types.ts';
import type { Game } from '../Game.ts';
import { islandRooms, mapSpot } from './rooms.ts';
import { disconnect } from './router.ts';
import { pushFriendsToFriendsOf, sanitize, sendFriends } from './social.ts';
import { enterIsland, travel } from './travel.ts';
import { selfView } from './views.ts';

const log = logger('game');

export const DEFAULT_LOOK: Look = { skin: '#f1c27d', hair: 'short', hairColor: '#5a3a1e', eyes: '#2b1d14', shirt: '#3498db', pants: '#34495e', shoes: '#8d6e63' };

export function uniqueCode(game: Game, len = 6) {
  for (;;) {
    const c = makeCode(len, () => crypto.randomInt(0, 1 << 30) / (1 << 30));
    if (!game.store.codeTaken(c)) return c;
  }
}

/** Create an account (username + password, or a guest in dev mode) and log it in. */
export function register(game: Game, username?: string, password?: string): { token: string; playerId: string } | { error: string } {
  if (username && game.store.playerByUsername(username)) return { error: 'That username is taken.' };
  const id = `p_${crypto.randomBytes(6).toString('hex')}`;
  const now = Date.now();
  const p: PlayerRecord = {
    id, name: 'Newcomer', code: uniqueCode(game), createdAt: now, lastSeen: now, created: false,
    gender: 'boy', look: DEFAULT_LOOK, hat: null, geo: { lat: 47, lon: 8, tz: 'UTC' }, homeIslandId: null,
    coins: 0, inv: {}, crafted: {}, friends: [], reqIn: [], reqOut: [], mail: [], chapterRewarded: 0,
  };
  if (username && password) {
    p.passHash = hashPassword(password);
    p.role = config.adminUsers.includes(username.toLowerCase()) ? 'admin' : 'player';
  }
  game.store.addPlayer(p);
  if (username) game.store.setUsername(p, username);
  return { token: issueToken(game, p), playerId: id };
}

export function issueToken(game: Game, p: PlayerRecord) {
  const token = newToken();
  game.store.addToken(p.id, hashToken(token));
  return token;
}

/** Username + password → a fresh login token. */
export function login(game: Game, username: string, password: string): { token: string; playerId: string } | { error: string } {
  const p = game.store.playerByUsername(username);
  // Same work and message whether or not the account exists.
  const ok = verifyPassword(password, p?.passHash ?? 'scrypt$16384$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=');
  if (!p || !ok) return { error: 'Wrong username or password.' };
  const ban = banReason(game, p);
  if (ban) return { error: ban };
  return { token: issueToken(game, p), playerId: p.id };
}

/** A guest account picks a username and password (required outside dev mode). */
export function claimAccount(game: Game, p: PlayerRecord, username: string, password: string): string | null {
  if (p.username) return 'This account already has a username.';
  if (!game.store.setUsername(p, username)) return 'That username is taken.';
  p.passHash = hashPassword(password);
  p.role ??= config.adminUsers.includes(username.toLowerCase()) ? 'admin' : 'player';
  game.store.markPlayer(p.id);
  return null;
}

export function banReason(game: Game, p: PlayerRecord): string | null {
  const b = p.banned;
  if (!b) return null;
  if (b.until && b.until < Date.now()) {
    delete p.banned;
    game.store.markPlayer(p.id);
    return null;
  }
  return `This account is banned${b.until ? ` until ${new Date(b.until).toISOString().slice(0, 16).replace('T', ' ')} UTC` : ''}: ${b.reason || 'no reason given'}`;
}

export function isAdmin(game: Game, p: PlayerRecord) {
  return p.role === 'admin' || (!!p.username && config.adminUsers.includes(p.username.toLowerCase())) || config.devFast;
}

/** Disconnect a player (if online). */
export function kick(game: Game, playerId: string, msg: string) {
  const s = game.online.get(playerId);
  if (!s) return false;
  s.send({ t: 'err', code: 'kicked', msg });
  s.ws.close(4009, 'kicked');
  return true;
}

export function hello(game: Game, s: Session, token: string, v: number) {
  if (v !== PROTOCOL_VERSION) {
    log.info('outdated client', { ip: s.ip, version: v });
    s.send({ t: 'err', code: 'version', msg: 'Your game client is out of date – please refresh.' });
    return s.ws.close(4002, 'version');
  }
  if (s.player) return;
  const hash = hashToken(token);
  const p = game.store.playerByToken(hash);
  if (!p) {
    log.warn('login with unknown token', { ip: s.ip });
    s.send({ t: 'err', code: 'auth', msg: 'Please log in again.' });
    return s.ws.close(4003, 'auth');
  }
  const ban = banReason(game, p);
  if (ban) {
    log.info('banned player refused', { player: p.id });
    s.send({ t: 'err', code: 'banned', msg: ban });
    return s.ws.close(4010, 'banned');
  }
  if (!p.username && !config.devFast) {
    // Guest accounts from dev mode must register before playing on a real server.
    s.send({ t: 'err', code: 'register', msg: 'Pick a username and password to keep playing.' });
    return s.ws.close(4011, 'register');
  }
  game.store.touchToken(hash);
  const prev = game.online.get(p.id);
  if (prev) {
    log.info('session replaced by new login', { player: p.id });
    prev.send({ t: 'err', code: 'replaced', msg: 'You logged in somewhere else.' });
    prev.ws.close(4004, 'replaced');
    disconnect(game, prev);
  }
  s.player = p;
  game.online.set(p.id, s);
  log.info('player connected', { player: p.id, name: p.name, ip: s.ip, online: game.online.size });
  p.lastSeen = Date.now();
  if (p.created && needsRecreate(p)) {
    // New character model: redo the looks before playing (everything else stays).
    s.send({ t: 'welcome', you: null, serverTime: Date.now(), dev: config.devFast, recreate: { name: p.name, gender: p.gender, look: p.look } });
    return;
  }
  s.send({ t: 'welcome', you: p.created ? selfView(game, p) : null, serverTime: Date.now(), dev: config.devFast });
  if (p.created) {
    sendFriends(game, s);
    s.send({ t: 'mail', list: p.mail });
    pushFriendsToFriendsOf(game, p);
    enterIsland(game, s, p.homeIslandId!);
  }
}

/** Characters made before the current character model have to be redone. */
export function needsRecreate(p: PlayerRecord) {
  return p.created && (p.lookVersion ?? 1) < LOOK_VERSION;
}

/** New looks for an existing character (asked for in the welcome); then into the game as usual. */
export function recreateCharacter(game: Game, s: Session, m: Extract<ClientMessage, { t: 'recreate' }>) {
  const p = s.player!;
  if (!needsRecreate(p)) return s.send({ t: 'err', code: 'exists', msg: 'Your character is up to date.' });
  if (!(HAIR_STYLES[m.gender] as readonly string[]).includes(m.look.hair)) return s.send({ t: 'err', code: 'bad_look', msg: 'Pick a hairstyle for your character.' });
  p.gender = m.gender as Gender;
  p.look = m.look;
  dressInSet(p, m.outfit);
  p.lookVersion = LOOK_VERSION;
  game.store.markPlayer(p.id);
  log.info('character recreated', { player: p.id });
  s.send({ t: 'welcome', you: selfView(game, p), serverTime: Date.now(), dev: config.devFast });
  sendFriends(game, s);
  s.send({ t: 'mail', list: p.mail });
  pushFriendsToFriendsOf(game, p);
  enterIsland(game, s, p.homeIslandId!);
}

/** Give a starter set (keep anything you already own) and wear it. */
function dressInSet(p: PlayerRecord, setId: string | undefined) {
  const set = OUTFIT_SETS.find((x) => x.id === setId);
  if (set) for (const item of set.items) if (inv.count(p, item) < 1) inv.add(p, item, 1);
  p.outfit = set ? setOutfit(set.id) : {};
  p.hat = p.outfit.hat ?? null;
}

export function createCharacter(game: Game, s: Session, m: Extract<ClientMessage, { t: 'create' }>) {
  const p = s.player!;
  if (p.created) return s.send({ t: 'err', code: 'exists', msg: 'Character already created.' });
  if (!(m.gender === 'boy' ? ['short', 'spiky', 'curly', 'buzz'] : ['long', 'ponytail', 'bob', 'pigtails']).includes(m.look.hair))
    return s.send({ t: 'err', code: 'bad_look', msg: 'Pick a hairstyle for your character.' });
  const tz = isValidTimeZone(m.geo.tz) ? m.geo.tz : 'UTC';
  // Store location coarsely (≈ 50 km) – enough for sun & seasons, kinder to privacy.
  p.geo = { lat: Math.round(m.geo.lat * 2) / 2, lon: Math.round(m.geo.lon * 2) / 2, tz };
  p.name = sanitize(game, m.name);
  p.gender = m.gender as Gender;
  p.look = m.look;
  // Starter clothes: yours to keep, and you're wearing them.
  dressInSet(p, m.outfit);
  p.lookVersion = LOOK_VERSION;
  p.created = true;
  p.coins = 100;
  const now = Date.now();
  const day = localTime(now, tz).dayKey;
  const seed = hashString(`${p.id}:${now}`);
  const island: IslandRecord = {
    gen: 2,
    size: ISLAND_SIZE,
    id: `i_${crypto.randomBytes(6).toString('hex')}`,
    ownerId: p.id,
    name: sanitize(game, m.islandName),
    biome: m.biome,
    seed,
    map: mapSpot(game, m.biome, seed),
    createdAt: now,
    foundedDayKey: day,
    lastDayKey: day,
    access: 'friends',
    inviteCode: uniqueCode(game, 8),
    objects: [],
    buildings: [],
    villagers: [],
    nextId: 100000,
  };
  // Materialise the generated layout into the record.
  const tmp = new Room({ id: island.id, kind: 'island', name: island.name, biome: island.biome, ownerId: p.id, ownerName: p.name, geo: p.geo, seed, elevation: true, size: ISLAND_SIZE });
  island.objects = [...tmp.objects.values()];
  island.buildings = [...tmp.buildings.values()];
  game.store.addIsland(island);
  log.info('character created', { player: p.id, name: p.name, island: island.id, biome: island.biome });
  p.homeIslandId = island.id;
  game.store.markPlayer(p.id);
  s.send({ t: 'welcome', you: selfView(game, p), serverTime: now, dev: config.devFast });
  sendFriends(game, s);
  s.send({ t: 'mail', list: p.mail });
  enterIsland(game, s, island.id);
  s.send({ t: 'toast', text: `Welcome to ${island.name}! Check your goals (G).`, kind: 'good' });
}

/** Remove a player for good: their island goes too; friends forget them. */
export function deletePlayer(game: Game, id: string) {
  const p = game.store.players.get(id);
  if (!p) return;
  kick(game, id, 'Your account was deleted.');
  for (const isl of [...game.store.islands.values()].filter((i) => i.ownerId === id)) {
    for (const r of islandRooms(game, isl.id)) {
      for (const s of [...r.sessions]) if (s.player?.id !== id) travel(game, s, { kind: 'shared', id: 'harbor' } as TravelTarget);
      game.rooms.delete(r.id);
    }
    game.store.deleteIsland(isl.id);
  }
  for (const other of game.store.players.values()) {
    const before = other.friends.length + other.reqIn.length + other.reqOut.length;
    other.friends = other.friends.filter((f) => f !== id);
    other.reqIn = other.reqIn.filter((f) => f !== id);
    other.reqOut = other.reqOut.filter((f) => f !== id);
    if (other.friends.length + other.reqIn.length + other.reqOut.length !== before) game.store.markPlayer(other.id);
  }
  game.store.deletePlayer(id);
}
