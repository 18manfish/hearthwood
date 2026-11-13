// The authoritative game server: connections, rooms, travel, social graph,
// progression. All state changes happen here or in actions.ts.

import crypto from 'node:crypto';
import type { WebSocket } from 'ws';
import {
  BIOMES, BUILDINGS, ISLAND_SIZE, LEGACY_ISLAND_SIZE, DEFAULT_HOTBAR, normalizeHotbar, PERMITS, type Album, CHAPTERS, ITEMS, MYSTERY_TOUR_COST, PROTOCOL_VERSION, SHARED_LOCATIONS, VILLAGERS,
  ACCESS_LEVELS, BIOME_IDS, ENTERABLE, DEV_COMMANDS, SEASONS_BY_MODEL, BOARD_MAX_POSTS, BOARD_POST_COOLDOWN_MS, interiorSpecFor, Rng, nearBuilding, atDoor, wrapAngle, SchemaError, chapterDone, clientMessageParser, friendshipLevel, goalDone, hashString,
  isValidTimeZone, localTime, makeCode, parse, sharedLocation, villagerDef,
  type Building, type ClientMessage, type FriendView, type MapIsland, type ProgressInput, type QuestView,
  GAME_TABLES, DEFAULT_GAME_DATA, applyGameData, snapshotGameData, validateGameData, encodeTiles,
  type GameData, type GameTable, type SelfView, type TravelTarget, type Look, type Gender, type DevCommand, type Weather, type Season,
} from '@hearthwood/shared';
import { config } from '../config.ts';
import { hashToken, hashPassword, newToken, verifyPassword } from '../auth.ts';
import { logger } from '../log.ts';

const log = logger('game');
import type { Store } from '../store.ts';
import type { Friendship, IslandRecord, PlayerRecord } from '../types.ts';
import { Room } from './Room.ts';
import { Session } from './Session.ts';
import { runAction } from './actions/index.ts';
import * as inv from './inventory.ts';

const DEFAULT_LOOK: Look = { skin: '#f1c27d', hair: 'short', hairColor: '#5a3a1e', eyes: '#2b1d14', shirt: '#3498db', pants: '#34495e', shoes: '#8d6e63' };

export { hashToken };

export class Game {
  readonly rooms = new Map<string, Room>();
  readonly online = new Map<string, Session>();
  private timers: NodeJS.Timeout[] = [];

  constructor(readonly store: Store) {}

  // ── Lifecycle ───────────────────────────────────────────────────────────
  start() {
    for (const loc of SHARED_LOCATIONS) this.sharedRoom(loc.id);
    this.timers.push(setInterval(() => this.fastTick(), 1000 / config.tickHz));
    this.timers.push(setInterval(() => this.villagerTick(), 1000 / config.villagerHz));
    this.timers.push(setInterval(() => this.slowTick(), 2000));
    this.timers.push(setInterval(() => this.flush(), config.saveIntervalMs));
    this.timers.push(setInterval(() => this.deliverBottles(), 15_000));
  }

  stop() {
    for (const t of this.timers) clearInterval(t);
    this.flush();
  }

  private fastTick() {
    for (const r of this.rooms.values()) r.positionTick();
  }

  private lastVillagerTick = Date.now();
  private villagerTick() {
    const now = Date.now();
    const dt = Math.min(0.5, (now - this.lastVillagerTick) / 1000);
    this.lastVillagerTick = now;
    for (const r of this.rooms.values()) r.villagerTick(dt, now);
  }

  private slowTick() {
    const now = Date.now();
    for (const [id, r] of this.rooms) {
      r.slowTick(now);
      // Villagers come home in the evening (and head out in the morning) while you visit.
      if (r.interior?.spec.style === 'villager') {
        const parent = this.rooms.get(r.interior.parentId);
        const b = parent?.buildings.get(r.interior.buildingId);
        if (parent && b) this.syncVillagerAtHome(parent, r, b);
      }
      // Unload idle rooms (islands are lazily caught up when they load again).
      if (r.sessions.size === 0 && r.kind !== 'shared' && now - r.emptySince > 60000) {
        if (r.syncRecord()) this.store.markIsland(r.id);
        this.rooms.delete(id);
        log.debug('room unloaded', { room: id });
      }
    }
  }

  flush() {
    for (const r of this.rooms.values()) if (r.syncRecord()) this.store.markIsland(r.id);
    this.store.flush();
  }

  // ── Accounts ────────────────────────────────────────────────────────────
  private uniqueCode(len = 6) {
    for (;;) {
      const c = makeCode(len, () => crypto.randomInt(0, 1 << 30) / (1 << 30));
      if (!this.store.codeTaken(c)) return c;
    }
  }

  /** Create an account (username + password, or a guest in dev mode) and log it in. */
  register(username?: string, password?: string): { token: string; playerId: string } | { error: string } {
    if (username && this.store.playerByUsername(username)) return { error: 'That username is taken.' };
    const id = `p_${crypto.randomBytes(6).toString('hex')}`;
    const now = Date.now();
    const p: PlayerRecord = {
      id, name: 'Newcomer', code: this.uniqueCode(), createdAt: now, lastSeen: now, created: false,
      gender: 'boy', look: DEFAULT_LOOK, hat: null, geo: { lat: 47, lon: 8, tz: 'UTC' }, homeIslandId: null,
      coins: 0, inv: {}, crafted: {}, friends: [], reqIn: [], reqOut: [], mail: [], chapterRewarded: 0,
    };
    if (username && password) {
      p.passHash = hashPassword(password);
      p.role = config.adminUsers.includes(username.toLowerCase()) ? 'admin' : 'player';
    }
    this.store.addPlayer(p);
    if (username) this.store.setUsername(p, username);
    return { token: this.issueToken(p), playerId: id };
  }

  issueToken(p: PlayerRecord) {
    const token = newToken();
    this.store.addToken(p.id, hashToken(token));
    return token;
  }

  /** Username + password → a fresh login token. */
  login(username: string, password: string): { token: string; playerId: string } | { error: string } {
    const p = this.store.playerByUsername(username);
    // Same work and message whether or not the account exists.
    const ok = verifyPassword(password, p?.passHash ?? 'scrypt$16384$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=');
    if (!p || !ok) return { error: 'Wrong username or password.' };
    const ban = this.banReason(p);
    if (ban) return { error: ban };
    return { token: this.issueToken(p), playerId: p.id };
  }

  /** A guest account picks a username and password (required outside dev mode). */
  claimAccount(p: PlayerRecord, username: string, password: string): string | null {
    if (p.username) return 'This account already has a username.';
    if (!this.store.setUsername(p, username)) return 'That username is taken.';
    p.passHash = hashPassword(password);
    p.role ??= config.adminUsers.includes(username.toLowerCase()) ? 'admin' : 'player';
    this.store.markPlayer(p.id);
    return null;
  }

  banReason(p: PlayerRecord): string | null {
    const b = p.banned;
    if (!b) return null;
    if (b.until && b.until < Date.now()) {
      delete p.banned;
      this.store.markPlayer(p.id);
      return null;
    }
    return `This account is banned${b.until ? ` until ${new Date(b.until).toISOString().slice(0, 16).replace('T', ' ')} UTC` : ''}: ${b.reason || 'no reason given'}`;
  }

  isAdmin(p: PlayerRecord) {
    return p.role === 'admin' || (!!p.username && config.adminUsers.includes(p.username.toLowerCase())) || config.devFast;
  }

  /** Disconnect a player (if online). */
  kick(playerId: string, msg: string) {
    const s = this.online.get(playerId);
    if (!s) return false;
    s.send({ t: 'err', code: 'kicked', msg });
    s.ws.close(4009, 'kicked');
    return true;
  }

  // ── Connections ─────────────────────────────────────────────────────────
  handleConnection(ws: WebSocket, ip: string) {
    const s = new Session(ws, ip);
    log.debug('socket opened', { ip });
    const helloTimer = setTimeout(() => {
      if (!s.player) {
        log.info('hello timeout', { ip });
        ws.close(4001, 'hello timeout');
      }
    }, config.helloTimeoutMs);

    ws.on('pong', () => (s.alive = true));
    const hb = setInterval(() => {
      if (!s.alive) {
        log.info('heartbeat lost', { player: s.player?.id, ip });
        return ws.terminate();
      }
      s.alive = false;
      ws.ping();
    }, config.heartbeatMs);

    ws.on('message', (data, isBinary) => {
      if (isBinary) return s.strike();
      if (!s.allowMessage()) return;
      let msg: ClientMessage;
      try {
        msg = parse(clientMessageParser, JSON.parse(data.toString()));
      } catch (e) {
        s.strike();
        log.warn('rejected message', { player: s.player?.id, ip, reason: e instanceof SchemaError ? e.message : 'malformed JSON' });
        s.send({ t: 'err', code: 'bad_message', msg: e instanceof SchemaError ? e.message : 'Malformed message' });
        return;
      }
      try {
        this.onMessage(s, msg);
      } catch (e) {
        log.error('handler error', { player: s.player?.id, type: msg.t, err: e });
        s.send({ t: 'err', code: 'server', msg: 'Something went wrong.' });
      }
    });

    ws.on('close', (code, reason) => {
      log.info('disconnected', { player: s.player?.id, name: s.player?.name, ip, code, reason: reason.toString() || undefined });
      clearTimeout(helloTimer);
      clearInterval(hb);
      this.disconnect(s);
    });
  }

  private disconnect(s: Session) {
    s.clearCast();
    s.room?.leave(s);
    if (s.player && this.online.get(s.player.id) === s) {
      this.online.delete(s.player.id);
      s.player.lastSeen = Date.now();
      this.store.markPlayer(s.player.id);
      this.pushFriendsToFriendsOf(s.player);
    }
  }

  private onMessage(s: Session, m: ClientMessage) {
    if (m.t === 'ping') return s.send({ t: 'pong', ct: m.ct, st: Date.now() });
    if (m.t === 'hello') return this.hello(s, m.token, m.v);
    const p = s.player;
    if (!p) return s.send({ t: 'err', code: 'auth', msg: 'Say hello first.' });
    if (m.t === 'create') return this.createCharacter(s, m);
    if (!p.created) return s.send({ t: 'err', code: 'no_character', msg: 'Create your character first.' });

    switch (m.t) {
      case 'move': return this.move(s, m.x, m.z, m.r);
      case 'act': {
        const res = runAction(this, s, m.a);
        if (!res.ok) log.debug('action refused', { player: p.id, action: m.a.k, err: res.err });
        s.send({ t: 'res', seq: m.seq, ...res });
        if (res.ok) this.afterAction(s, m.a.k);
        return;
      }
      case 'travel': return this.travel(s, m.to);
      case 'chat': return this.chat(s, m.text);
      case 'friend': return this.friendOp(s, m.op, m.code, m.id);
      case 'access': {
        const isl = this.homeIsland(p);
        if (!isl) return;
        isl.access = m.access;
        this.store.markIsland(isl.id);
        this.sendSelf(s);
        s.send({ t: 'toast', text: `Visitors: ${accessLabel(m.access)}`, kind: 'good' });
        return;
      }
      case 'newInvite': {
        const isl = this.homeIsland(p);
        if (!isl) return;
        this.store.setInviteCode(isl, this.uniqueCode(8));
        this.sendSelf(s);
        return;
      }
      case 'kick': {
        const room = s.room;
        const target = this.online.get(m.id);
        if (!room || !room.isOwner(p.id) || room.kind !== 'island' || !target || target.room !== room || target === s) return;
        if (room.isResident(m.id)) return s.send({ t: 'toast', text: 'Residents live here – remove their residency first.', kind: 'warn' });
        log.info('visitor sent home', { owner: p.id, visitor: m.id, room: room.id });
        target.send({ t: 'toast', text: `${p.name} sent you home.`, kind: 'warn' });
        this.travel(target, { kind: 'home' });
        return;
      }
      case 'map': return s.send({ t: 'map', islands: this.mapFor(p) });
      case 'role': return this.setRole(s, m.id, m.role);
      case 'geo': return this.setGeo(s, m.lat, m.lon, m.tz);
      case 'hotbar':
        p.hotbar = normalizeHotbar(m.slots);
        this.store.markPlayer(p.id);
        return;
      case 'board': return this.boardOp(s, m.op, m.text, m.id);
      case 'dev': {
        if (!config.devFast) return s.send({ t: 'toast', text: 'Dev commands need the server in dev mode (npm run dev:fast).', kind: 'warn' });
        return this.devCommand(s, m.cmd, m.args);
      }
    }
  }

  private hello(s: Session, token: string, v: number) {
    if (v !== PROTOCOL_VERSION) {
      log.info('outdated client', { ip: s.ip, version: v });
      s.send({ t: 'err', code: 'version', msg: 'Your game client is out of date – please refresh.' });
      return s.ws.close(4002, 'version');
    }
    if (s.player) return;
    const hash = hashToken(token);
    const p = this.store.playerByToken(hash);
    if (!p) {
      log.warn('login with unknown token', { ip: s.ip });
      s.send({ t: 'err', code: 'auth', msg: 'Please log in again.' });
      return s.ws.close(4003, 'auth');
    }
    const ban = this.banReason(p);
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
    this.store.touchToken(hash);
    const prev = this.online.get(p.id);
    if (prev) {
      log.info('session replaced by new login', { player: p.id });
      prev.send({ t: 'err', code: 'replaced', msg: 'You logged in somewhere else.' });
      prev.ws.close(4004, 'replaced');
      this.disconnect(prev);
    }
    s.player = p;
    this.online.set(p.id, s);
    log.info('player connected', { player: p.id, name: p.name, ip: s.ip, online: this.online.size });
    p.lastSeen = Date.now();
    s.send({ t: 'welcome', you: p.created ? this.selfView(p) : null, serverTime: Date.now(), dev: config.devFast });
    if (p.created) {
      this.sendFriends(s);
      s.send({ t: 'mail', list: p.mail });
      this.pushFriendsToFriendsOf(p);
      this.enterIsland(s, p.homeIslandId!);
    }
  }

  private createCharacter(s: Session, m: Extract<ClientMessage, { t: 'create' }>) {
    const p = s.player!;
    if (p.created) return s.send({ t: 'err', code: 'exists', msg: 'Character already created.' });
    if (!(m.gender === 'boy' ? ['short', 'spiky', 'curly', 'buzz'] : ['long', 'ponytail', 'bob', 'pigtails']).includes(m.look.hair))
      return s.send({ t: 'err', code: 'bad_look', msg: 'Pick a hairstyle for your character.' });
    const tz = isValidTimeZone(m.geo.tz) ? m.geo.tz : 'UTC';
    // Store location coarsely (≈ 50 km) – enough for sun & seasons, kinder to privacy.
    p.geo = { lat: Math.round(m.geo.lat * 2) / 2, lon: Math.round(m.geo.lon * 2) / 2, tz };
    p.name = this.sanitize(m.name);
    p.gender = m.gender as Gender;
    p.look = m.look;
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
      name: this.sanitize(m.islandName),
      biome: m.biome,
      seed,
      map: this.mapSpot(m.biome, seed),
      createdAt: now,
      foundedDayKey: day,
      lastDayKey: day,
      access: 'friends',
      inviteCode: this.uniqueCode(8),
      objects: [],
      buildings: [],
      villagers: [],
      nextId: 100000,
    };
    // Materialise the generated layout into the record.
    const tmp = new Room({ id: island.id, kind: 'island', name: island.name, biome: island.biome, ownerId: p.id, ownerName: p.name, geo: p.geo, seed, elevation: true, size: ISLAND_SIZE });
    island.objects = [...tmp.objects.values()];
    island.buildings = [...tmp.buildings.values()];
    this.store.addIsland(island);
    log.info('character created', { player: p.id, name: p.name, island: island.id, biome: island.biome });
    p.homeIslandId = island.id;
    this.store.markPlayer(p.id);
    s.send({ t: 'welcome', you: this.selfView(p), serverTime: now, dev: config.devFast });
    this.sendFriends(s);
    s.send({ t: 'mail', list: p.mail });
    this.enterIsland(s, island.id);
    s.send({ t: 'toast', text: `Welcome to ${island.name}! Check your goals (G).`, kind: 'good' });
  }

  private mapSpot(biome: string, seed: number) {
    const region = BIOMES[biome as keyof typeof BIOMES].map;
    const rng = new Rng(seed);
    const others = [...this.store.islands.values()].map((i) => i.map);
    let best = { x: region.x, y: region.y };
    let bestD = -1;
    for (let i = 0; i < 30; i++) {
      const ang = rng.range(0, Math.PI * 2);
      const rad = Math.sqrt(rng.float()) * region.r * 0.85;
      const c = { x: Math.round(region.x + Math.cos(ang) * rad), y: Math.round(region.y + Math.sin(ang) * rad) };
      const d = others.reduce((m, o) => Math.min(m, Math.hypot(o.x - c.x, o.y - c.y)), Infinity);
      if (d > bestD) {
        bestD = d;
        best = c;
      }
      if (d > 14) break;
    }
    return best;
  }

  // ── Rooms & travel ──────────────────────────────────────────────────────
  islandRoom(id: string): Room | null {
    const existing = this.rooms.get(id);
    if (existing) return existing;
    const rec = this.store.islands.get(id);
    if (!rec) return null;
    const owner = this.store.players.get(rec.ownerId);
    migrateIsland(rec);
    const room = new Room({
      id: rec.id, kind: 'island', name: rec.name, biome: rec.biome, ownerId: rec.ownerId, ownerName: owner?.name ?? null,
      geo: owner?.geo ?? { lat: 47, lon: 8, tz: 'UTC' }, seed: rec.seed, record: rec, elevation: (rec.gen ?? 1) >= 2, size: rec.size ?? LEGACY_ISLAND_SIZE,
    });
    room.onBuildingComplete = (r, b) => this.buildingCompleted(r, b);
    this.rooms.set(id, room);
    // Catch up on everything that happened while nobody was here.
    room.slowTick(Date.now());
    return room;
  }

  /** The inside of a building. Shares the island record (villagers, furniture in your home). */
  interiorRoom(parent: Room, b: Building): Room | null {
    const id = `${parent.id}~${b.id}`;
    const existing = this.rooms.get(id);
    const villager = b.villagerId ? villagerDef(b.villagerId) : undefined;
    if (existing) {
      this.syncVillagerAtHome(parent, existing, b);
      return existing;
    }
    const spec = interiorSpecFor(b.type, b.id, villager);
    if (!spec) return null;
    const houseOwnerId = b.ownerId ?? parent.ownerId ?? undefined;
    const owner = (b.ownerId ? this.store.players.get(b.ownerId)?.name : parent.ownerName) ?? 'Someone';
    const name =
      spec.style === 'tent' ? `${owner}\u2019s tent`
      : spec.style === 'cabin' ? `${owner}\u2019s house`
      : spec.style === 'villager' ? `${villager?.name ?? 'A villager'}\u2019s house`
      : spec.style === 'shack' ? 'Fisher\u2019s cottage'
      : BUILDINGS[b.type].name;
    const room = new Room({
      id, kind: 'interior', name, biome: parent.biome,
      ownerId: parent.ownerId, ownerName: parent.ownerName, geo: parent.geo, seed: parent.seed, record: parent.record,
      interior: { spec, buildingId: b.id, parentId: parent.id, houseOwnerId },
    });
    this.rooms.set(id, room);
    this.syncVillagerAtHome(parent, room, b);
    return room;
  }

  // ── Builders & residents ────────────────────────────────────────────────
  /** The island owner lets a friend build here, live here – or neither. */
  private setRole(s: Session, targetId: string, role: 'none' | 'builder' | 'resident') {
    const p = s.player!;
    const isl = this.homeIsland(p);
    if (!isl) return;
    const target = this.store.players.get(targetId);
    if (!target || target.id === p.id) return s.send({ t: 'toast', text: 'Pick one of your friends.', kind: 'warn' });
    if (role !== 'none' && !p.friends.includes(target.id)) return s.send({ t: 'toast', text: 'You can only grant this to friends.', kind: 'warn' });
    isl.builders = (isl.builders ?? []).filter((x) => x !== target.id);
    isl.residents = (isl.residents ?? []).filter((x) => x !== target.id);
    if (role === 'builder') isl.builders.push(target.id);
    if (role === 'resident') isl.residents.push(target.id);
    this.store.markIsland(isl.id);
    log.info('island role changed', { island: isl.id, owner: p.id, player: target.id, role });
    this.sendSelf(s);
    const text = role === 'none' ? `${target.name} no longer builds or lives on ${isl.name}.`
      : role === 'builder' ? `${target.name} can now build on ${isl.name}.` : `${target.name} is now a resident of ${isl.name}!`;
    s.send({ t: 'toast', text, kind: 'good' });
    const ts = this.online.get(target.id);
    if (ts) {
      this.sendSelf(ts);
      ts.send({ t: 'toast', text: role === 'none' ? `You no longer build or live on ${isl.name}.` : role === 'builder' ? `🔨 ${p.name} lets you build on ${isl.name}!` : `🏡 ${p.name} made you a resident of ${isl.name}! Build your own house there.`, kind: role === 'none' ? 'info' : 'good' });
    }
    // Everyone affected who stands on the island gets their new rights straight away.
    for (const r of this.islandRooms(isl.id)) for (const x of r.sessions) if (x.player?.id === target.id) r.resendView(x);
  }

  /** Change your location / time zone: your island's sun, seasons and clock follow it. */
  private setGeo(s: Session, lat: number, lon: number, tz: string) {
    const p = s.player!;
    if (!isValidTimeZone(tz)) return s.send({ t: 'toast', text: 'Unknown time zone.', kind: 'warn' });
    p.geo = { lat: Math.round(lat * 2) / 2, lon: Math.round(lon * 2) / 2, tz }; // ≈ 50 km – enough for the sun
    this.store.markPlayer(p.id);
    if (p.homeIslandId) for (const r of this.islandRooms(p.homeIslandId)) {
      r.geo = p.geo;
      r.invalidateEnv();
      r.broadcast({ t: 'env', env: r.env() });
    }
    this.sendSelf(s);
    s.send({ t: 'toast', text: `📍 Location saved – your island now follows ${tz.replace(/_/g, ' ')}.`, kind: 'good' });
  }

  // ── Messages in bottles ─────────────────────────────────────────────────
  /** Bottles whose time has come wash up on a random player's island (never the sender's). */
  deliverBottles(now = Date.now()) {
    const due = this.store.dueBottles(now);
    if (!due.length) return;
    const all = [...this.store.players.values()].filter((p) => p.created && p.homeIslandId && this.store.islands.has(p.homeIslandId) && !p.banned);
    const active = all.filter((p) => now - p.lastSeen < 30 * 86400_000 || this.online.has(p.id));
    for (const b of due) {
      const pool = (active.length > 1 ? active : all).filter((p) => p.id !== b.from_id);
      // Nobody else around: it drifts back to the sender's own beach.
      const to = pool.length ? pool[Math.floor(Math.random() * pool.length)] : all.find((p) => p.id === b.from_id);
      if (!to) {
        this.store.bottleSent(b.id, '');
        continue;
      }
      const isl = this.store.islands.get(to.homeIslandId!)!;
      (isl.bottles ??= []).push({ id: b.id, from: b.from_id, fromName: b.from_name, text: b.text, at: now });
      this.store.markIsland(isl.id);
      this.store.bottleSent(b.id, to.id);
      log.info('bottle washed up', { bottle: b.id, to: to.id, island: isl.id });
      const live = this.rooms.get(isl.id);
      if (live) live.slowTick(now); // land it on the beach right away
      const s = this.online.get(to.id);
      if (s) s.send({ t: 'toast', text: '🍾 Something washed up on your beach…', kind: 'info' });
    }
  }

  // ── Admin tool support ──────────────────────────────────────────────────
  /** Rooms belonging to an island: the island itself and its interiors. */
  private islandRooms(id: string) {
    return [...this.rooms.values()].filter((r) => r.id === id || r.id.startsWith(`${id}~`));
  }

  /** Copy the live state of a loaded island (and its interiors) into its record. */
  syncIsland(id: string) {
    for (const r of this.islandRooms(id)) r.syncRecord(true);
  }

  /**
   * Throw away the loaded rooms of an island and rebuild them from the record
   * (after an admin edit). Everyone inside lands back on the fresh island.
   */
  reloadIsland(id: string) {
    const rooms = this.islandRooms(id);
    if (!rooms.length) return;
    const moving: { s: Session; at?: { x: number; z: number; r: number } }[] = [];
    for (const r of rooms) {
      for (const s of r.sessions) moving.push({ s, at: r.id === id ? { x: s.x, z: s.z, r: s.r } : undefined });
      this.rooms.delete(r.id);
    }
    const fresh = this.islandRoom(id);
    for (const { s, at } of moving) {
      if (!fresh) {
        this.travel(s, { kind: 'home' });
        continue;
      }
      this.moveToRoom(s, fresh, at && fresh.grid.walkable(at.x, at.z) ? at : undefined);
      s.send({ t: 'toast', text: 'This island was updated by an admin.', kind: 'info' });
    }
  }

  /** What the admin map needs: the record plus the terrain as the game sees it. */
  adminIslandView(rec: IslandRecord) {
    const live = this.rooms.get(rec.id);
    const room = live ?? new Room({
      id: rec.id, kind: 'island', name: rec.name, biome: rec.biome, ownerId: rec.ownerId, ownerName: null,
      geo: { lat: 47, lon: 8, tz: 'UTC' }, seed: rec.seed, record: rec, elevation: (rec.gen ?? 1) >= 2, size: rec.size ?? LEGACY_ISLAND_SIZE,
    });
    const g = room.grid;
    const owner = this.store.players.get(rec.ownerId);
    return {
      record: { ...rec, objects: live ? [...live.objects.values()].filter((o) => o.kind !== 'bird') : rec.objects, buildings: live ? [...live.buildings.values()] : rec.buildings },
      owner: owner ? { id: owner.id, name: owner.name, username: owner.username ?? null } : null,
      size: g.size,
      tiles: encodeTiles(g.tiles), levels: encodeTiles(g.levels), ramps: encodeTiles(g.ramps), paths: encodeTiles(g.paths),
      spawn: room.layout.spawn,
      loaded: !!live,
      players: live ? [...live.sessions].map((s) => ({ id: s.player!.id, name: s.player!.name, x: s.x, z: s.z })) : [],
      villagers: [...room.villagers.values()].map((v) => ({ id: v.id, x: v.x, z: v.z, home: room.villagerView(v).home })),
      birds: live ? [...live.objects.values()].filter((o) => o.kind === 'bird') : [],
    };
  }

  /** Re-send a player's own state after an admin edit. */
  refreshPlayer(id: string) {
    const s = this.online.get(id);
    if (!s?.player) return;
    this.sendSelf(s);
    this.sendInv(s);
    this.sendQuest(s);
    s.send({ t: 'album', album: albumOf(s.player) });
  }

  /** Remove a player for good: their island goes too; friends forget them. */
  deletePlayer(id: string) {
    const p = this.store.players.get(id);
    if (!p) return;
    this.kick(id, 'Your account was deleted.');
    for (const isl of [...this.store.islands.values()].filter((i) => i.ownerId === id)) {
      for (const r of this.islandRooms(isl.id)) {
        for (const s of [...r.sessions]) if (s.player?.id !== id) this.travel(s, { kind: 'shared', id: 'harbor' } as TravelTarget);
        this.rooms.delete(r.id);
      }
      this.store.deleteIsland(isl.id);
    }
    for (const other of this.store.players.values()) {
      const before = other.friends.length + other.reqIn.length + other.reqOut.length;
      other.friends = other.friends.filter((f) => f !== id);
      other.reqIn = other.reqIn.filter((f) => f !== id);
      other.reqOut = other.reqOut.filter((f) => f !== id);
      if (other.friends.length + other.reqIn.length + other.reqOut.length !== before) this.store.markPlayer(other.id);
    }
    this.store.deletePlayer(id);
  }

  // ── Game data (edited in the game creation tool) ────────────────────────
  /** Tables that differ from the built-in data – sent to every client. */
  gameDataOverrides: Partial<GameData> = {};

  /** Apply stored overrides at startup (invalid ones are skipped and logged). */
  loadGameData() {
    const stored = this.store.gameData() as Partial<GameData>;
    const tables = GAME_TABLES.filter((t) => t in stored);
    if (!tables.length) return;
    const merged = { ...snapshotGameData(), ...stored } as GameData;
    const errors = validateGameData(merged);
    if (errors.length) {
      log.error('stored game data is invalid – using the built-in data', { errors: errors.slice(0, 10) });
      return;
    }
    applyGameData(stored);
    this.gameDataOverrides = Object.fromEntries(tables.map((t) => [t, stored[t]]));
    log.info('game data overrides loaded', { tables });
  }

  /** Apply already-validated tables, save them and tell everyone online. */
  setGameData(tables: Partial<GameData>, author: string) {
    applyGameData(tables);
    for (const [t, data] of Object.entries(tables)) {
      this.store.setGameData(t, data, author);
      (this.gameDataOverrides as Record<string, unknown>)[t] = data;
    }
    this.store.audit(author, 'gamedata.set', Object.keys(tables).join(','));
    log.info('game data changed', { by: author, tables: Object.keys(tables) });
    this.announceDataChange();
  }

  resetGameData(tables: GameTable[], author: string) {
    applyGameData(Object.fromEntries(tables.map((t) => [t, DEFAULT_GAME_DATA[t]])));
    for (const t of tables) {
      this.store.deleteGameData(t);
      delete this.gameDataOverrides[t];
    }
    this.store.audit(author, 'gamedata.reset', tables.join(','));
    log.info('game data reset', { by: author, tables });
    this.announceDataChange();
  }

  private announceDataChange() {
    for (const s of this.online.values()) s.send({ t: 'toast', text: '🛠️ Game data was updated – reload the page to see every change.', kind: 'info' });
  }

  /** Villagers are at home (inside) at night – you can visit them there. */
  private syncVillagerAtHome(parent: Room, inside: Room, b: Building) {
    if (!b.villagerId) return;
    const outside = parent.villagers.get(b.villagerId);
    const home = !!outside?.home;
    const present = inside.villagers.has(b.villagerId);
    if (home && !present) {
      const v = inside.spawnVillager(b.villagerId, b.id);
      const mid = inside.layout.size / 2;
      v.x = v.tx = mid + 1.2;
      v.z = v.tz = mid - 0.5;
      v.r = 0;
      inside.broadcast({ t: 'vAdd', v: [inside.villagerView(v)] });
      if (inside.sessions.size) inside.broadcast({ t: 'chat', from: '', name: '', text: `${villagerDef(b.villagerId)?.name ?? 'Someone'} came home.`, sys: true });
    } else if (!home && present) {
      const v = inside.villagers.get(b.villagerId)!;
      inside.broadcast({ t: 'vs', l: [[v.id, v.x, v.z, v.r, 1]] }); // hides them on clients
      inside.removeVillager(b.villagerId);
      inside.broadcast({ t: 'chat', from: '', name: '', text: `${villagerDef(b.villagerId)?.name ?? 'They'} headed out for the day.`, sys: true });
    }
  }

  sharedRoom(id: string): Room | null {
    const key = `shared_${id}`;
    const existing = this.rooms.get(key);
    if (existing) return existing;
    const loc = sharedLocation(id);
    if (!loc) return null;
    const design = id === 'harbor' ? 'harbor' : id === 'aurora' ? 'aurora' : undefined;
    const room = new Room({ id: key, kind: 'shared', name: loc.name, biome: loc.biome, ownerId: null, ownerName: null, geo: loc.geo, seed: hashString(key), design });
    if ([...room.buildings.values()].some((b) => b.type === 'billboard')) room.board = this.store.boards[key] ??= [];
    room.slowTick(Date.now());
    this.rooms.set(key, room);
    return room;
  }

  private enterIsland(s: Session, islandId: string) {
    const room = this.islandRoom(islandId);
    if (!room) return s.send({ t: 'err', code: 'no_island', msg: 'Island not found.' });
    this.moveToRoom(s, room);
  }

  private moveToRoom(s: Session, room: Room, at?: { x: number; z: number; r?: number }) {
    const from = s.room;
    s.room?.leave(s);
    room.join(s, at);
    log.debug('entered room', { player: s.player!.id, room: room.id, from: from?.id });
    if (room.kind === 'island' && room.ownerId !== s.player!.id && from?.interior?.parentId !== room.id) {
      room.broadcast({ t: 'chat', from: '', name: '', text: `${s.player!.name} is visiting!`, sys: true }, s);
    }
    this.sendQuest(s);
  }

  canVisit(p: PlayerRecord, isl: IslandRecord, viaCode: boolean, s?: Session): boolean {
    if (isl.ownerId === p.id) return true;
    if (isl.residents?.includes(p.id) || isl.builders?.includes(p.id)) return true;
    if (isl.access === 'private') return false;
    const owner = this.store.players.get(isl.ownerId);
    const friend = !!owner?.friends.includes(p.id);
    if (isl.access === 'public') return true;
    if (friend) return true; // friends may visit unless private
    if (isl.access === 'invite') return viaCode || !!s?.inviteGrants.has(isl.id);
    return false;
  }

  travel(s: Session, to: TravelTarget): void {
    const p = s.player!;
    switch (to.kind) {
      case 'enter': {
        const room = s.room;
        const b = room?.buildings.get(to.id);
        if (!room || (room.kind !== 'island' && room.kind !== 'shared') || !b || !ENTERABLE.includes(b.type)) return s.send({ t: 'toast', text: 'You can\u2019t go in there.', kind: 'warn' });
        if (b.completeAt > Date.now()) return s.send({ t: 'toast', text: 'It\u2019s still being built.', kind: 'warn' });
        if (!atDoor(b, s.x, s.z)) return s.send({ t: 'toast', text: 'Stand in front of the door to go in.', kind: 'warn' });
        const inside = this.interiorRoom(room, b);
        if (!inside) return s.send({ t: 'toast', text: 'It\u2019s locked.', kind: 'warn' });
        if (b.villagerId && !inside.villagers.has(b.villagerId)) s.send({ t: 'toast', text: `${villagerDef(b.villagerId)?.name ?? 'They'} is out and about – they’re home from 19:00 to 07:00.`, kind: 'info' });
        return this.moveToRoom(s, inside);
      }
      case 'exit': {
        const room = s.room;
        if (!room?.interior) return;
        const pid = room.interior.parentId;
        const parent = this.rooms.get(pid) ?? (pid.startsWith('shared_') ? this.sharedRoom(pid.slice(7)) : this.islandRoom(pid));
        if (!parent) return this.travel(s, { kind: 'home' });
        const b = parent.buildings.get(room.interior.buildingId);
        const at = b ? { x: b.x + b.w / 2, z: b.z + b.h + 0.45, r: 0 } : undefined;
        return this.moveToRoom(s, parent, at);
      }
      case 'home':
        return this.enterIsland(s, p.homeIslandId!);
      case 'shared': {
        const room = this.sharedRoom(to.id);
        if (!room) return s.send({ t: 'toast', text: 'Unknown destination.', kind: 'warn' });
        return this.moveToRoom(s, room);
      }
      case 'island':
      case 'code': {
        const isl = to.kind === 'island' ? this.store.islands.get(to.id) : this.store.islandByInvite(to.code);
        if (!isl) return s.send({ t: 'toast', text: to.kind === 'code' ? 'No island has that invite code.' : 'Island not found.', kind: 'warn' });
        if (!this.canVisit(p, isl, to.kind === 'code', s)) return s.send({ t: 'toast', text: `${isl.name} isn’t open to you right now.`, kind: 'warn' });
        if (to.kind === 'code') s.inviteGrants.add(isl.id);
        return this.enterIsland(s, isl.id);
      }
      case 'tour': {
        const home = this.islandRoom(p.homeIslandId!);
        if (!home || home.completedCount('travel_agent') < 1) return s.send({ t: 'toast', text: 'Build a Travel Agent to book mystery tours.', kind: 'warn' });
        const here = s.room;
        const atAgent = here?.interior?.parentId === home.id && [...here.buildings.values()].some((b) => b.role === 'travel_agent' && nearBuilding(b, s.x, s.z, config.buildingReach));
        if (!atAgent) return s.send({ t: 'toast', text: 'Book tours at the counter inside your Travel Agent.', kind: 'warn' });
        if (p.coins < MYSTERY_TOUR_COST) return s.send({ t: 'toast', text: `A tour costs ${MYSTERY_TOUR_COST} coins.`, kind: 'warn' });
        p.coins -= MYSTERY_TOUR_COST;
        this.sendInv(s);
        const biome = BIOME_IDS[crypto.randomInt(0, BIOME_IDS.length)];
        const id = `tour_${p.id}_${Date.now().toString(36)}`;
        const room = new Room({ id, kind: 'tour', name: `Mystery ${BIOMES[biome].name}`, biome, ownerId: p.id, ownerName: p.name, geo: p.geo, seed: hashString(id), elevation: true });
        room.slowTick(Date.now());
        this.rooms.set(id, room);
        s.send({ t: 'toast', text: `Welcome to a mystery ${BIOMES[biome].name}! Gather all you like.`, kind: 'good' });
        return this.moveToRoom(s, room);
      }
    }
  }

  homeIsland(p: PlayerRecord) {
    return p.homeIslandId ? this.store.islands.get(p.homeIslandId) : undefined;
  }

  // ── Movement (server-validated) ─────────────────────────────────────────
  private move(s: Session, x: number, z: number, r: number) {
    const room = s.room;
    if (!room) return;
    const now = Date.now();
    const dt = Math.min(1, Math.max(0.05, (now - s.lastMoveAt) / 1000));
    const dist = Math.hypot(x - s.x, z - s.z);
    const maxDist = config.playerSpeed * dt * config.moveTolerance + 0.2;
    let ok = dist <= maxDist && room.grid.walkable(x, z);
    // Walk the path in small steps so nobody tunnels through obstacles or climbs cliffs.
    if (ok) {
      const steps = Math.max(1, Math.ceil(dist / 0.25));
      let px = s.x, pz = s.z;
      for (let i = 1; i <= steps && ok; i++) {
        const t = i / steps;
        const nx = s.x + (x - s.x) * t, nz = s.z + (z - s.z) * t;
        ok = room.grid.canMove(px, pz, nx, nz, i === steps ? 0.2 : 0.12);
        px = nx;
        pz = nz;
      }
    }
    s.lastMoveAt = now;
    if (!ok) {
      s.send({ t: 'corr', x: s.x, z: s.z });
      return;
    }
    if (dist > 0.0001 || Math.abs(r - s.r) > 0.01) {
      s.x = x;
      s.z = z;
      s.r = wrapAngle(r);
      s.moved = true;
    }
  }

  // ── After-action bookkeeping ────────────────────────────────────────────
  private afterAction(s: Session, kind: string) {
    const p = s.player!;
    this.store.markPlayer(p.id);
    if (s.room?.record) this.store.markIsland(s.room.id);
    this.sendInv(s);
    if (kind === 'craft' || kind === 'build' || kind === 'demolish') this.sendQuest(s);
    if (kind === 'wear' || kind === 'restyle') this.sendSelf(s);
  }

  private buildingCompleted(room: Room, b: Building) {
    log.info('building completed', { island: room.id, building: b.type, id: b.id });
    const owner = room.ownerId ? this.online.get(room.ownerId) : undefined;
    if (b.type === 'villager_house' && !b.villagerId && room.record) {
      const taken = new Set(room.record.villagers.map((v) => v.defId));
      const candidates = VILLAGERS.filter((v) => !taken.has(v.id));
      if (!candidates.length) return;
      const def = new Rng(hashString(b.id + room.id)).pick(candidates);
      b.villagerId = def.id;
      room.record.villagers.push({ defId: def.id, houseId: b.id, movedInAt: Date.now(), friendship: {} });
      const v = room.spawnVillager(def.id, b.id);
      room.broadcast({ t: 'bAdd', b: [b] });
      room.broadcast({ t: 'vAdd', v: [room.villagerView(v)] });
      room.broadcast({ t: 'chat', from: '', name: '', text: `${def.name} the ${def.species} moved in! Say hi!`, sys: true });
      room.dirty = true;
      this.store.markIsland(room.id);
    } else if (b.completeAt > 0) {
      room.broadcast({ t: 'bAdd', b: [b] });
      if (owner?.room === room && BUILDINGS[b.type].buildMinutes > 0) owner.send({ t: 'toast', text: `${BUILDINGS[b.type].name} is finished!`, kind: 'good' });
    }
    if (owner) this.sendQuest(owner);
  }

  levelUpCheck(s: Session, room: Room, defId: string, f: Friendship) {
    const lvl = friendshipLevel(f.pts).level;
    const prev = f.level ?? 0;
    if (lvl <= prev) return;
    f.level = lvl;
    const def = villagerDef(defId)!;
    const rewards = ['flower_pot', 'bench', 'lamp', 'picnic_table', 'gnome'];
    const it = rewards[Math.min(lvl, rewards.length) - 1];
    if (it && inv.add(s.player!, it, 1)) {
      s.send({ t: 'toast', text: `${def.name} is now your ${friendshipLevel(f.pts).name}! They gave you a ${ITEMS[it].name}.`, kind: 'good' });
    }
  }

  // ── Progression ─────────────────────────────────────────────────────────
  progress(p: PlayerRecord): ProgressInput & { day: number } {
    const room = p.homeIslandId ? this.islandRoom(p.homeIslandId) : null;
    const built: ProgressInput['built'] = {};
    let villagers = 0;
    let day = 1;
    if (room) {
      const now = Date.now();
      for (const b of room.buildings.values()) if (b.completeAt <= now) built[b.type] = (built[b.type] ?? 0) + 1;
      villagers = room.villagers.size;
      day = room.islandDay(now);
    }
    return { crafted: p.crafted, built, villagers, day };
  }

  sendQuest(s: Session) {
    const p = s.player!;
    const prog = this.progress(p);
    // Pay out rewards for every completed chapter, in order.
    let chapter = 1;
    for (const c of CHAPTERS) {
      if (!chapterDone(c, prog)) break;
      if (p.chapterRewarded < c.id) {
        p.chapterRewarded = c.id;
        p.coins += c.reward.coins;
        for (const [id, n] of Object.entries(c.reward.items ?? {})) inv.add(p, id, n);
        s.send({ t: 'toast', text: `Chapter complete: ${c.title}! +${c.reward.coins} coins`, kind: 'good' });
        this.store.markPlayer(p.id);
        this.sendInv(s);
      }
      chapter = c.id + 1;
    }
    const cur = CHAPTERS[chapter - 1];
    const q: QuestView = { chapter, done: cur ? cur.goals.map((g) => goalDone(g, prog)) : [], islandDay: prog.day, villagers: prog.villagers };
    s.send({ t: 'quest', q });
  }

  // ── Views ───────────────────────────────────────────────────────────────
  selfView(p: PlayerRecord): SelfView {
    const isl = this.homeIsland(p);
    return {
      id: p.id, name: p.name, code: p.code, gender: p.gender, look: p.look, hat: p.hat,
      homeIslandId: p.homeIslandId, islandName: isl?.name ?? null, biome: isl?.biome ?? null,
      access: isl?.access ?? 'friends', inviteCode: isl?.inviteCode ?? null, coins: p.coins, inv: p.inv,
      permits: p.permits ?? [], hotbar: normalizeHotbar(p.hotbar ?? DEFAULT_HOTBAR), album: albumOf(p),
      username: p.username ?? null, admin: this.isAdmin(p), geo: p.geo,
      islandRoles: isl ? Object.fromEntries([...(isl.builders ?? []).map((id) => [id, 'builder'] as const), ...(isl.residents ?? []).map((id) => [id, 'resident'] as const)]) : {},
      helping: [...this.store.islands.values()]
        .filter((i) => i.residents?.includes(p.id) || i.builders?.includes(p.id))
        .map((i) => ({ id: i.id, name: i.name, owner: this.store.players.get(i.ownerId)?.name ?? '?', role: i.residents?.includes(p.id) ? 'resident' as const : 'builder' as const })),
    };
  }

  sendSelf(s: Session) {
    s.send({ t: 'self', you: this.selfView(s.player!) });
  }

  sendInv(s: Session) {
    s.send({ t: 'inv', inv: s.player!.inv, coins: s.player!.coins });
  }

  broadcastLook(s: Session) {
    const p = s.player!;
    s.room?.broadcast({ t: 'pLook', id: p.id, look: p.look, hat: p.hat });
  }

  notifyMail(playerId: string) {
    const s = this.online.get(playerId);
    if (!s) return;
    s.send({ t: 'mail', list: s.player!.mail });
    s.send({ t: 'toast', text: 'You’ve got mail! 📬', kind: 'good' });
  }

  private mapFor(p: PlayerRecord): MapIsland[] {
    const out: MapIsland[] = [];
    for (const isl of this.store.islands.values()) {
      const mine = isl.ownerId === p.id;
      const owner = this.store.players.get(isl.ownerId);
      if (!owner) continue;
      const helps = !!(isl.residents?.includes(p.id) || isl.builders?.includes(p.id));
      const friend = owner.friends.includes(p.id) || helps;
      const visible = mine || helps || isl.access === 'public' || (friend && isl.access !== 'private');
      if (!visible) continue;
      const room = this.rooms.get(isl.id);
      out.push({
        id: isl.id, name: isl.name, owner: owner.name, biome: isl.biome, x: isl.map.x, y: isl.map.y, access: isl.access,
        friend, mine, online: this.online.has(owner.id), visitors: room ? room.sessions.size : 0,
      });
      if (out.length > 300) break;
    }
    return out;
  }

  // ── Social ──────────────────────────────────────────────────────────────
  private friendView(id: string): FriendView | null {
    const f = this.store.players.get(id);
    if (!f) return null;
    return { id: f.id, name: f.name, code: f.code, online: this.online.has(f.id), islandId: f.homeIslandId };
  }

  sendFriends(s: Session) {
    const p = s.player!;
    const map = (ids: string[]) => ids.map((id) => this.friendView(id)).filter((x): x is FriendView => !!x);
    s.send({ t: 'friends', list: map(p.friends), incoming: map(p.reqIn), outgoing: map(p.reqOut) });
  }

  private pushFriendsToFriendsOf(p: PlayerRecord) {
    for (const id of p.friends) {
      const fs = this.online.get(id);
      if (fs) this.sendFriends(fs);
    }
  }

  private friendOp(s: Session, op: 'request' | 'accept' | 'decline' | 'remove' | 'cancel', code?: string, id?: string) {
    const p = s.player!;
    const other = code ? this.store.playerByCode(code) : id ? this.store.players.get(id) : undefined;
    if (!other || !other.created) return s.send({ t: 'toast', text: 'No player found with that code.', kind: 'warn' });
    if (other.id === p.id) return s.send({ t: 'toast', text: 'That’s you!', kind: 'warn' });
    const del = (arr: string[], v: string) => {
      const i = arr.indexOf(v);
      if (i >= 0) arr.splice(i, 1);
    };
    const befriend = () => {
      del(p.reqIn, other.id); del(p.reqOut, other.id); del(other.reqIn, p.id); del(other.reqOut, p.id);
      if (!p.friends.includes(other.id)) p.friends.push(other.id);
      if (!other.friends.includes(p.id)) other.friends.push(p.id);
      s.send({ t: 'toast', text: `You and ${other.name} are now friends!`, kind: 'good' });
      this.online.get(other.id)?.send({ t: 'toast', text: `You and ${p.name} are now friends!`, kind: 'good' });
    };
    switch (op) {
      case 'request':
        if (p.friends.includes(other.id)) return s.send({ t: 'toast', text: 'Already friends.', kind: 'info' });
        if (p.friends.length >= 100) return s.send({ t: 'toast', text: 'Friend list is full.', kind: 'warn' });
        if (p.reqIn.includes(other.id)) befriend();
        else if (!p.reqOut.includes(other.id)) {
          if (other.reqIn.length >= 50) return s.send({ t: 'toast', text: 'They have too many pending requests.', kind: 'warn' });
          p.reqOut.push(other.id);
          other.reqIn.push(p.id);
          s.send({ t: 'toast', text: `Friend request sent to ${other.name}.`, kind: 'info' });
          this.online.get(other.id)?.send({ t: 'toast', text: `${p.name} wants to be friends!`, kind: 'info' });
        }
        break;
      case 'accept':
        if (!p.reqIn.includes(other.id)) return;
        befriend();
        break;
      case 'decline':
        del(p.reqIn, other.id); del(other.reqOut, p.id);
        break;
      case 'cancel':
        del(p.reqOut, other.id); del(other.reqIn, p.id);
        break;
      case 'remove':
        del(p.friends, other.id); del(other.friends, p.id);
        break;
    }
    this.store.markPlayer(p.id);
    this.store.markPlayer(other.id);
    this.sendFriends(s);
    const os = this.online.get(other.id);
    if (os) this.sendFriends(os);
  }

  // ── Billboard ───────────────────────────────────────────────────────────
  private lastPost = new Map<string, number>();
  private boardOp(s: Session, op: 'post' | 'delete', text?: string, id?: string) {
    const room = s.room;
    const p = s.player!;
    const board = room?.board;
    if (!room || !board) return s.send({ t: 'toast', text: 'There’s no billboard here.', kind: 'warn' });
    if (op === 'post') {
      const bb = [...room.buildings.values()].find((b) => b.type === 'billboard')!;
      if (!nearBuilding(bb, s.x, s.z, config.buildingReach + 0.5)) return s.send({ t: 'toast', text: 'Walk up to the billboard to pin a note.', kind: 'warn' });
      const clean = this.sanitize(text ?? '');
      if (!clean) return;
      const now = Date.now();
      const wait = (this.lastPost.get(p.id) ?? 0) + BOARD_POST_COOLDOWN_MS - now;
      if (wait > 0) return s.send({ t: 'toast', text: `You can pin another note in ${Math.ceil(wait / 1000)}s.`, kind: 'warn' });
      this.lastPost.set(p.id, now);
      board.unshift({ id: `n${now.toString(36)}${crypto.randomBytes(3).toString('hex')}`, by: p.id, name: p.name, text: clean, at: now });
      if (board.length > BOARD_MAX_POSTS) board.length = BOARD_MAX_POSTS;
      s.send({ t: 'toast', text: '📌 Note pinned to the billboard!', kind: 'good' });
    } else {
      const i = board.findIndex((n) => n.id === id);
      if (i < 0) return;
      if (board[i].by !== p.id) return s.send({ t: 'toast', text: 'You can only take down your own notes.', kind: 'warn' });
      board.splice(i, 1);
    }
    this.store.markBoards();
    room.broadcast({ t: 'board', posts: board });
  }

  // ── Chat ────────────────────────────────────────────────────────────────
  sanitize(text: string) {
    // Strip control & bidi characters, collapse whitespace.
    return text.replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, '').replace(/\s+/g, ' ').trim();
  }

  private chat(s: Session, raw: string) {
    if (!s.room) return;
    if (!s.allowChat()) return s.send({ t: 'toast', text: 'You’re chatting too fast.', kind: 'warn' });
    const text = this.sanitize(raw);
    if (!text) return;
    if (text.startsWith('/') && config.devFast) {
      const [cmd, ...args] = text.slice(1).split(' ');
      if ((DEV_COMMANDS as readonly string[]).includes(cmd)) return this.devCommand(s, cmd as DevCommand, args.slice(0, 4));
      return s.send({ t: 'chat', from: '', name: '', text: `Dev commands: ${DEV_COMMANDS.map((c) => '/' + c).join(' ')}`, sys: true });
    }
    s.room.broadcast({ t: 'chat', from: s.player!.id, name: s.player!.name, text });
  }

  /** Developer helpers – only active with DEV_FAST=1 (validated by the protocol schema). */
  devCommand(s: Session, cmd: DevCommand, args: string[]) {
    const p = s.player!;
    log.info('dev command', { player: p.id, cmd, args });
    const room = s.room;
    const reply = (t: string) => s.send({ t: 'chat', from: '', name: '', text: `[dev] ${t}`, sys: true });
    const n = (i: number, d: number) => (Number.isFinite(Number(args[i])) && args[i] !== '' && args[i] !== undefined ? Number(args[i]) : d);
    switch (cmd) {
      case 'kit':
        for (const [id, q] of Object.entries({ wood: 300, stone: 200, clay: 80, iron_ore: 40, fiber: 50, sapling: 10 })) inv.add(p, id, q);
        reply('Building kit added.');
        break;
      case 'give':
        if (!args[0] || !ITEMS[args[0]]) return reply('Usage: give <item> [n]');
        inv.add(p, args[0], Math.max(1, Math.min(999, n(1, 1))));
        reply(`Gave ${args[0]}`);
        break;
      case 'coins':
        p.coins = Math.max(0, p.coins + n(0, 1000));
        break;
      case 'permits':
        p.permits = PERMITS.map((x) => x.id);
        this.sendSelf(s);
        reply('All Town Hall permits granted.');
        break;
      case 'birds': {
        // Land a few birds right around you.
        if (!room || room.interior) return reply('Go outside first.');
        const landed = room.landBirdsNear(s.x, s.z, Math.max(1, Math.min(6, n(0, 3))));
        reply(`${landed} bird(s) landed nearby.`);
        break;
      }
      case 'bottles':
        this.store.rushBottles();
        this.deliverBottles();
        reply('All bottles at sea have washed up.');
        break;
      case 'beach': {
        if (!room || room.kind !== 'island') return reply('Only on islands.');
        const k = room.washUp(Math.max(1, Math.min(10, n(0, 5))));
        reply(`${k} thing(s) washed up on the beach.`);
        break;
      }
      case 'clearinv':
        p.inv = {};
        p.hat = null;
        reply('Pockets emptied.');
        break;
      case 'day': {
        const isl = this.homeIsland(p);
        if (!isl) return;
        const d = Math.max(-365, Math.min(365, n(0, 1)));
        isl.foundedDayKey = new Date(Date.parse(isl.foundedDayKey + 'T00:00:00Z') - d * 86400000).toISOString().slice(0, 10);
        this.store.markIsland(isl.id);
        for (const r of this.rooms.values()) if (r.record === isl) r.invalidateEnv();
        reply(`Island is now on day ${this.progress(p).day}.`);
        this.sendQuest(s);
        if (room) s.send({ t: 'env', env: room.env() });
        break;
      }
      case 'finish':
        if (!room) return;
        for (const b of room.buildings.values()) if (b.completeAt > Date.now()) b.completeAt = Date.now() - 1;
        for (const o of room.objects.values()) if (o.growAt) o.growAt = Date.now() - 1;
        room.slowTick(Date.now());
        reply('Construction and growth finished.');
        break;
      case 'respawn':
        if (!room) return;
        for (const r of room.respawns) r.at = 0;
        for (const o of room.objects.values()) if (o.kind === 'stump') o.decayAt = 1;
        room.slowTick(Date.now());
        reply('Resources respawned.');
        break;
      case 'weather': {
        if (!room) return;
        const w = args[0] as Weather;
        const valid: Weather[] = ['clear', 'cloudy', 'rain', 'storm', 'snow', 'fog', 'sandstorm', 'heatwave'];
        room.weatherOverride = valid.includes(w) ? { weather: w, until: Date.now() + 30 * 60000 } : null;
        room.invalidateEnv();
        room.broadcast({ t: 'env', env: room.env() });
        reply(room.weatherOverride ? `Weather set to ${w} for 30 minutes.` : 'Weather back to normal.');
        break;
      }
      case 'season': {
        // Applies to the island and its interiors (and is reflected in fish, weather & visuals).
        const base = room?.interior ? this.rooms.get(room.interior.parentId) : room;
        if (!room || !base) return;
        const model = BIOMES[base.biome].seasonModel;
        const want = args[0] as Season;
        const valid = SEASONS_BY_MODEL[model].includes(want);
        for (const r of this.rooms.values()) {
          if (r !== base && r.interior?.parentId !== base.id) continue;
          r.seasonOverride = valid ? want : null;
          r.invalidateEnv();
          r.broadcast({ t: 'env', env: r.env() });
        }
        reply(valid ? `Season forced to ${want}.` : `Season back to the real calendar (valid here: ${SEASONS_BY_MODEL[model].join(', ')}).`);
        break;
      }
      case 'tp': {
        if (!room) return;
        const x = n(0, s.x), z = n(1, s.z);
        if (!room.grid.walkable(x, z)) return reply('Can\u2019t stand there.');
        s.x = x;
        s.z = z;
        s.moved = true;
        s.send({ t: 'corr', x, z });
        break;
      }
    }
    this.store.markPlayer(p.id);
    this.sendInv(s);
  }
}

/** The player's album (created on first use). */
export function albumOf(p: PlayerRecord): Album {
  return (p.album ??= { fish: {}, birds: {} });
}

/** One-off upgrades for islands saved by older versions. */
function migrateIsland(rec: IslandRecord) {
  for (const b of rec.buildings) {
    // The 3×3 Post Office became a 1×1 Mailbox (placed at its front-centre).
    if ((b.type as string) === 'post_office') {
      b.type = 'mailbox';
      b.x += 1;
      b.z += 2;
      b.w = 1;
      b.h = 1;
    }
  }
}

function accessLabel(a: string) {
  return ({ private: 'Nobody', friends: 'Friends only', invite: 'Friends + invite code', public: 'Everyone' } as Record<string, string>)[a] ?? a;
}

export { ACCESS_LEVELS };
