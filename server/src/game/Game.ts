// The authoritative game server's composition root: owns the store, the rooms and the
// online sessions, runs the ticks, and exposes the API the HTTP layer and the action
// handlers use. The work itself lives in ./services (one file per area) and ./actions.

import type { WebSocket } from 'ws';
import {
  SHARED_LOCATIONS, ACCESS_LEVELS, type GameData, type GameTable,
} from '@hearthwood/shared';
import { hashToken } from '../auth.ts';
import { config } from '../config.ts';
import { logger } from '../log.ts';
import type { Store } from '../store.ts';
import type { Friendship, IslandRecord, PlayerRecord } from '../types.ts';
import { Room } from './Room.ts';
import { Session } from './Session.ts';

import { banReason, claimAccount, deletePlayer, isAdmin, kick, login, register } from './services/accounts.ts';
import { deliverBottles } from './services/bottles.ts';
import { loadGameData, resetGameData, setGameData } from './services/gamedata.ts';
import { levelUpCheck, sendQuest } from './services/progress.ts';
import { reloadIsland, sharedRoom, syncIsland, syncVillagerAtHome } from './services/rooms.ts';
import { handleConnection } from './services/router.ts';
import { sanitize } from './services/social.ts';
import { adminIslandView, broadcastLook, notifyMail, refreshPlayer, sendSelf } from './services/views.ts';

const log = logger('game');

export { hashToken };

export class Game {
  readonly rooms = new Map<string, Room>();
  readonly online = new Map<string, Session>();
  private timers: NodeJS.Timeout[] = [];

  constructor(readonly store: Store) {}

  // ── Lifecycle ───────────────────────────────────────────────────────────
  start() {
    for (const loc of SHARED_LOCATIONS) sharedRoom(this, loc.id);
    this.timers.push(setInterval(() => this.fastTick(), 1000 / config.tickHz));
    this.timers.push(setInterval(() => this.villagerTick(), 1000 / config.villagerHz));
    this.timers.push(setInterval(() => this.slowTick(), 2000));
    this.timers.push(setInterval(() => this.flush(), config.saveIntervalMs));
    this.timers.push(setInterval(() => deliverBottles(this), 15_000));
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
        if (parent && b) syncVillagerAtHome(this, parent, r, b);
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

  // ── Game data (edited in the game creation tool) ────────────────────────
  /** Tables that differ from the built-in data – sent to every client. */
  gameDataOverrides: Partial<GameData> = {};

  // ── Billboard ───────────────────────────────────────────────────────────
  /** When each player last posted on a billboard (cooldown). */
  readonly lastPost = new Map<string, number>();

  // ── API used by the HTTP layer and the action handlers (services/*) ────
  /** Create an account (username + password, or a guest in dev mode) and log it in. */
  register(username?: string, password?: string): { token: string; playerId: string } | { error: string } {
    return register(this, username, password);
  }

  /** Username + password → a fresh login token. */
  login(username: string, password: string): { token: string; playerId: string } | { error: string } {
    return login(this, username, password);
  }

  /** A guest account picks a username and password (required outside dev mode). */
  claimAccount(p: PlayerRecord, username: string, password: string): string | null {
    return claimAccount(this, p, username, password);
  }

  banReason(p: PlayerRecord): string | null {
    return banReason(this, p);
  }

  isAdmin(p: PlayerRecord) {
    return isAdmin(this, p);
  }

  /** Disconnect a player (if online). */
  kick(playerId: string, msg: string) {
    return kick(this, playerId, msg);
  }

  handleConnection(ws: WebSocket, ip: string) {
    return handleConnection(this, ws, ip);
  }

  /** Copy the live state of a loaded island (and its interiors) into its record. */
  syncIsland(id: string) {
    return syncIsland(this, id);
  }

  /**
   * Throw away the loaded rooms of an island and rebuild them from the record
   * (after an admin edit). Everyone inside lands back on the fresh island.
   */
  reloadIsland(id: string) {
    return reloadIsland(this, id);
  }

  /** What the admin map needs: the record plus the terrain as the game sees it. */
  adminIslandView(rec: IslandRecord) {
    return adminIslandView(this, rec);
  }

  /** Re-send a player's own state after an admin edit. */
  refreshPlayer(id: string) {
    return refreshPlayer(this, id);
  }

  /** Remove a player for good: their island goes too; friends forget them. */
  deletePlayer(id: string) {
    return deletePlayer(this, id);
  }

  /** Apply stored overrides at startup (invalid ones are skipped and logged). */
  loadGameData() {
    return loadGameData(this);
  }

  /** Apply already-validated tables, save them and tell everyone online. */
  setGameData(tables: Partial<GameData>, author: string) {
    return setGameData(this, tables, author);
  }

  resetGameData(tables: GameTable[], author: string) {
    return resetGameData(this, tables, author);
  }

  levelUpCheck(s: Session, room: Room, defId: string, f: Friendship) {
    return levelUpCheck(this, s, room, defId, f);
  }

  sendSelf(s: Session) {
    return sendSelf(this, s);
  }

  sendQuest(s: Session) {
    return sendQuest(this, s);
  }

  broadcastLook(s: Session) {
    return broadcastLook(this, s);
  }

  notifyMail(playerId: string) {
    return notifyMail(this, playerId);
  }

  sanitize(text: string) {
    return sanitize(this, text);
  }
}

export { ACCESS_LEVELS };
export { albumOf } from './services/views.ts';
