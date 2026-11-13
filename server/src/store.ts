// Persistence: an SQLite database (Node's built-in `node:sqlite`) in DATA_DIR.
//
// The game keeps every player and island in memory and writes changed records
// back in one transaction every few seconds (dirty tracking). Login tokens,
// game-data overrides and the admin audit log are written straight away.
// Saves from older versions (JSON files) are imported automatically once.

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import type { DatabaseSync, StatementSync } from 'node:sqlite';
import type { IslandRecord, PlayerRecord } from './types.ts';
import type { BoardPost } from '@hearthwood/shared';
import { logger } from './log.ts';

const log = logger('store');

const SCHEMA_VERSION = 1;

export interface BottleRow {
  id: string;
  from_id: string;
  from_name: string;
  text: string;
  created: number;
  deliver_at: number;
  to_id: string | null;
}

export interface NewsRow {
  id: number;
  title: string;
  body: string;
  icon: string | null;
  created: number;
  updated: number;
  author: string | null;
  pinned: number;
  published: number;
}

export interface AuditEntry {
  id: number;
  at: number;
  actor: string;
  action: string;
  target: string;
  detail: string;
}

/** Load node:sqlite without its one-time "experimental" warning cluttering the log. */
function openDatabase(file: string): DatabaseSync {
  const emit = process.emitWarning;
  process.emitWarning = ((w: string | Error, ...rest: unknown[]) => {
    if (String(w).includes('SQLite')) return;
    return (emit as (...a: unknown[]) => void).call(process, w, ...rest);
  }) as typeof process.emitWarning;
  try {
    const { DatabaseSync: Db } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');
    return new Db(file);
  } finally {
    process.emitWarning = emit;
  }
}

export class Store {
  readonly players = new Map<string, PlayerRecord>();
  readonly islands = new Map<string, IslandRecord>();
  private byToken = new Map<string, string>();
  private byCode = new Map<string, string>();
  private byInvite = new Map<string, string>();
  private byUsername = new Map<string, string>();
  private dirtyPlayers = new Set<string>();
  private dirtyIslands = new Set<string>();
  /** Billboard notes per location id. */
  boards: Record<string, BoardPost[]> = {};
  private boardsDirty = false;
  private db!: DatabaseSync;
  private q!: Record<string, StatementSync>;
  readonly file: string;

  constructor(private dir: string) {
    this.file = path.join(dir, 'hearthwood.db');
  }

  load() {
    fs.mkdirSync(this.dir, { recursive: true });
    this.db = openDatabase(this.file);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
      CREATE TABLE IF NOT EXISTS players (
        id TEXT PRIMARY KEY, username TEXT UNIQUE COLLATE NOCASE, code TEXT NOT NULL, name TEXT,
        data TEXT NOT NULL, updated INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS tokens (
        hash TEXT PRIMARY KEY, player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
        created INTEGER NOT NULL, last_used INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS tokens_player ON tokens(player_id);
      CREATE TABLE IF NOT EXISTS islands (id TEXT PRIMARY KEY, owner_id TEXT, data TEXT NOT NULL, updated INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS boards (key TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS gamedata (tbl TEXT PRIMARY KEY, data TEXT NOT NULL, updated INTEGER NOT NULL, author TEXT);
      CREATE TABLE IF NOT EXISTS bottles (
        id TEXT PRIMARY KEY, from_id TEXT, from_name TEXT, text TEXT NOT NULL, created INTEGER NOT NULL,
        deliver_at INTEGER NOT NULL, to_id TEXT, delivered_at INTEGER, opened_at INTEGER);
      CREATE INDEX IF NOT EXISTS bottles_due ON bottles(deliver_at) WHERE to_id IS NULL;
      CREATE TABLE IF NOT EXISTS news (
        id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, body TEXT NOT NULL, icon TEXT,
        created INTEGER NOT NULL, updated INTEGER NOT NULL, author TEXT, pinned INTEGER NOT NULL DEFAULT 0, published INTEGER NOT NULL DEFAULT 1);
      CREATE TABLE IF NOT EXISTS news_images (
        id TEXT PRIMARY KEY, mime TEXT NOT NULL, data BLOB NOT NULL, created INTEGER NOT NULL, author TEXT);
      CREATE TABLE IF NOT EXISTS audit (
        id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, actor TEXT, action TEXT, target TEXT, detail TEXT);
    `);
    this.db.prepare('INSERT OR IGNORE INTO meta (key, value) VALUES (?, ?)').run('schema', String(SCHEMA_VERSION));
    const p = (sql: string) => this.db.prepare(sql);
    this.q = {
      upsertPlayer: p(`INSERT INTO players (id, username, code, name, data, updated) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET username = excluded.username, code = excluded.code, name = excluded.name, data = excluded.data, updated = excluded.updated`),
      deletePlayer: p('DELETE FROM players WHERE id = ?'),
      upsertIsland: p(`INSERT INTO islands (id, owner_id, data, updated) VALUES (?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET owner_id = excluded.owner_id, data = excluded.data, updated = excluded.updated`),
      deleteIsland: p('DELETE FROM islands WHERE id = ?'),
      upsertBoard: p('INSERT INTO boards (key, data) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET data = excluded.data'),
      addToken: p('INSERT OR REPLACE INTO tokens (hash, player_id, created, last_used) VALUES (?, ?, ?, ?)'),
      touchToken: p('UPDATE tokens SET last_used = ? WHERE hash = ?'),
      deleteToken: p('DELETE FROM tokens WHERE hash = ?'),
      deleteTokensOf: p('DELETE FROM tokens WHERE player_id = ?'),
      tokensOf: p('SELECT hash FROM tokens WHERE player_id = ? ORDER BY last_used DESC'),
      setGameData: p(`INSERT INTO gamedata (tbl, data, updated, author) VALUES (?, ?, ?, ?)
        ON CONFLICT(tbl) DO UPDATE SET data = excluded.data, updated = excluded.updated, author = excluded.author`),
      deleteGameData: p('DELETE FROM gamedata WHERE tbl = ?'),
      audit: p('INSERT INTO audit (at, actor, action, target, detail) VALUES (?, ?, ?, ?, ?)'),
      auditList: p('SELECT * FROM audit ORDER BY id DESC LIMIT ?'),
    };

    this.importLegacyJson();

    for (const row of this.db.prepare('SELECT id, data FROM players').all() as { id: string; data: string }[]) {
      try {
        this.indexPlayer(JSON.parse(row.data) as PlayerRecord);
      } catch (e) {
        log.error('failed to load player', { id: row.id, err: e });
      }
    }
    for (const row of this.db.prepare('SELECT hash, player_id FROM tokens').all() as { hash: string; player_id: string }[]) {
      this.byToken.set(row.hash, row.player_id);
    }
    for (const row of this.db.prepare('SELECT id, data FROM islands').all() as { id: string; data: string }[]) {
      try {
        const i = JSON.parse(row.data) as IslandRecord;
        this.islands.set(i.id, i);
        this.byInvite.set(i.inviteCode, i.id);
      } catch (e) {
        log.error('failed to load island', { id: row.id, err: e });
      }
    }
    for (const row of this.db.prepare('SELECT key, data FROM boards').all() as { key: string; data: string }[]) {
      try {
        this.boards[row.key] = JSON.parse(row.data);
      } catch (e) {
        log.error('failed to load board', { key: row.key, err: e });
      }
    }
    log.info('database opened', { file: this.file, players: this.players.size, islands: this.islands.size, tokens: this.byToken.size });
  }

  /** One-time import of the JSON files written by earlier versions. */
  private importLegacyJson() {
    const pdir = path.join(this.dir, 'players');
    const idir = path.join(this.dir, 'islands');
    const bfile = path.join(this.dir, 'boards.json');
    if (!fs.existsSync(pdir) && !fs.existsSync(idir) && !fs.existsSync(bfile)) return;
    let np = 0, ni = 0;
    const now = Date.now();
    this.db.exec('BEGIN');
    try {
      if (fs.existsSync(pdir)) for (const f of fs.readdirSync(pdir).filter((x) => x.endsWith('.json'))) {
        const rec = JSON.parse(fs.readFileSync(path.join(pdir, f), 'utf8')) as PlayerRecord & { tokenHash?: string };
        const hash = rec.tokenHash;
        delete rec.tokenHash;
        this.q.upsertPlayer.run(rec.id, rec.username ?? null, rec.code, rec.name, JSON.stringify(rec), now);
        if (hash) this.q.addToken.run(hash, rec.id, rec.createdAt ?? now, rec.lastSeen ?? now);
        np++;
      }
      if (fs.existsSync(idir)) for (const f of fs.readdirSync(idir).filter((x) => x.endsWith('.json'))) {
        const rec = JSON.parse(fs.readFileSync(path.join(idir, f), 'utf8')) as IslandRecord;
        this.q.upsertIsland.run(rec.id, rec.ownerId, JSON.stringify(rec), now);
        ni++;
      }
      if (fs.existsSync(bfile)) {
        const boards = JSON.parse(fs.readFileSync(bfile, 'utf8')) as Record<string, BoardPost[]>;
        for (const [k, v] of Object.entries(boards)) this.q.upsertBoard.run(k, JSON.stringify(v));
      }
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      log.error('importing old JSON saves failed – they were left untouched', { err: e });
      return;
    }
    // Keep the old files, out of the way.
    const backup = path.join(this.dir, `json-backup-${new Date().toISOString().slice(0, 10)}`);
    fs.mkdirSync(backup, { recursive: true });
    for (const src of [pdir, idir, bfile]) if (fs.existsSync(src)) fs.renameSync(src, path.join(backup, path.basename(src)));
    log.info('imported old JSON saves into the database', { players: np, islands: ni, backup });
  }

  close() {
    try {
      this.db?.close();
    } catch {
      /* already closed */
    }
  }

  private indexPlayer(p: PlayerRecord) {
    this.players.set(p.id, p);
    this.byCode.set(p.code, p.id);
    if (p.username) this.byUsername.set(p.username.toLowerCase(), p.id);
  }

  addPlayer(p: PlayerRecord) {
    this.indexPlayer(p);
    // Written immediately: tokens reference the row.
    this.q.upsertPlayer.run(p.id, p.username ?? null, p.code, p.name, JSON.stringify(p), Date.now());
  }

  /** Change (or set) a player's login name. Returns false if it's taken. */
  setUsername(p: PlayerRecord, username: string): boolean {
    const other = this.byUsername.get(username.toLowerCase());
    if (other && other !== p.id) return false;
    if (p.username) this.byUsername.delete(p.username.toLowerCase());
    p.username = username;
    this.byUsername.set(username.toLowerCase(), p.id);
    this.q.upsertPlayer.run(p.id, p.username, p.code, p.name, JSON.stringify(p), Date.now());
    return true;
  }

  deletePlayer(id: string) {
    const p = this.players.get(id);
    if (!p) return;
    this.removeTokensOf(id);
    this.players.delete(id);
    this.byCode.delete(p.code);
    if (p.username) this.byUsername.delete(p.username.toLowerCase());
    this.dirtyPlayers.delete(id);
    this.q.deletePlayer.run(id);
  }

  addIsland(i: IslandRecord) {
    this.islands.set(i.id, i);
    this.byInvite.set(i.inviteCode, i.id);
    this.markIsland(i.id);
  }

  deleteIsland(id: string) {
    const i = this.islands.get(id);
    if (!i) return;
    this.islands.delete(id);
    this.byInvite.delete(i.inviteCode);
    this.dirtyIslands.delete(id);
    this.q.deleteIsland.run(id);
  }

  setInviteCode(i: IslandRecord, code: string) {
    this.byInvite.delete(i.inviteCode);
    i.inviteCode = code;
    this.byInvite.set(code, i.id);
    this.markIsland(i.id);
  }

  // ── Login tokens (only SHA-256 hashes are stored) ─────────────────────────
  addToken(playerId: string, hash: string) {
    const now = Date.now();
    this.q.addToken.run(hash, playerId, now, now);
    this.byToken.set(hash, playerId);
    // Keep the 5 most recent sessions per account.
    const all = this.q.tokensOf.all(playerId) as { hash: string }[];
    for (const old of all.slice(5)) this.removeToken(old.hash);
  }
  removeToken(hash: string) {
    this.byToken.delete(hash);
    this.q.deleteToken.run(hash);
  }
  removeTokensOf(playerId: string) {
    for (const [h, id] of this.byToken) if (id === playerId) this.byToken.delete(h);
    this.q.deleteTokensOf.run(playerId);
  }
  touchToken(hash: string) {
    this.q.touchToken.run(Date.now(), hash);
  }

  playerByToken(hash: string) {
    const id = this.byToken.get(hash);
    return id ? this.players.get(id) : undefined;
  }
  playerByUsername(name: string) {
    const id = this.byUsername.get(name.toLowerCase());
    return id ? this.players.get(id) : undefined;
  }
  playerByCode(code: string) {
    const id = this.byCode.get(code.toUpperCase());
    return id ? this.players.get(id) : undefined;
  }
  islandByInvite(code: string) {
    const id = this.byInvite.get(code.toUpperCase());
    return id ? this.islands.get(id) : undefined;
  }
  codeTaken(code: string) {
    return this.byCode.has(code) || this.byInvite.has(code);
  }

  markPlayer(id: string) {
    this.dirtyPlayers.add(id);
  }
  markIsland(id: string) {
    this.dirtyIslands.add(id);
  }
  markBoards() {
    this.boardsDirty = true;
  }

  /** Write every changed record in one transaction. */
  flush() {
    const np = this.dirtyPlayers.size, ni = this.dirtyIslands.size;
    if (!np && !ni && !this.boardsDirty) return;
    const t0 = Date.now();
    try {
      this.db.exec('BEGIN');
      for (const id of this.dirtyPlayers) {
        const p = this.players.get(id);
        if (p) this.q.upsertPlayer.run(p.id, p.username ?? null, p.code, p.name, JSON.stringify(p), t0);
      }
      for (const id of this.dirtyIslands) {
        const i = this.islands.get(id);
        if (i) this.q.upsertIsland.run(i.id, i.ownerId, JSON.stringify(i), t0);
      }
      if (this.boardsDirty) for (const [k, v] of Object.entries(this.boards)) this.q.upsertBoard.run(k, JSON.stringify(v));
      this.db.exec('COMMIT');
      this.boardsDirty = false;
      this.dirtyPlayers.clear();
      this.dirtyIslands.clear();
      log.debug('saved', { players: np, islands: ni, ms: Date.now() - t0 });
    } catch (e) {
      try {
        this.db.exec('ROLLBACK');
      } catch {
        /* no open transaction */
      }
      log.error('save failed (will retry)', { err: e });
    }
  }

  // ── Game data overrides ───────────────────────────────────────────────────
  gameData(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const row of this.db.prepare('SELECT tbl, data FROM gamedata').all() as { tbl: string; data: string }[]) {
      try {
        out[row.tbl] = JSON.parse(row.data);
      } catch (e) {
        log.error('bad game data row ignored', { table: row.tbl, err: e });
      }
    }
    return out;
  }
  gameDataInfo(): { tbl: string; updated: number; author: string | null }[] {
    return this.db.prepare('SELECT tbl, updated, author FROM gamedata').all() as { tbl: string; updated: number; author: string | null }[];
  }
  setGameData(table: string, data: unknown, author: string) {
    this.q.setGameData.run(table, JSON.stringify(data), Date.now(), author);
  }
  deleteGameData(table: string) {
    this.q.deleteGameData.run(table);
  }

  // ── Messages in bottles ───────────────────────────────────────────────────
  addBottle(b: { id: string; fromId: string; fromName: string; text: string; deliverAt: number }) {
    this.db.prepare('INSERT INTO bottles (id, from_id, from_name, text, created, deliver_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(b.id, b.fromId, b.fromName, b.text, Date.now(), b.deliverAt);
  }
  dueBottles(now: number): BottleRow[] {
    return this.db.prepare('SELECT * FROM bottles WHERE to_id IS NULL AND deliver_at <= ? ORDER BY deliver_at LIMIT 50').all(now) as unknown as BottleRow[];
  }
  bottleSent(id: string, toId: string) {
    this.db.prepare('UPDATE bottles SET to_id = ?, delivered_at = ? WHERE id = ?').run(toId, Date.now(), id);
  }
  /** Dev: every bottle still at sea arrives now. */
  rushBottles() {
    this.db.prepare('UPDATE bottles SET deliver_at = ? WHERE to_id IS NULL').run(Date.now());
  }
  bottleOpened(id: string) {
    this.db.prepare('UPDATE bottles SET opened_at = ? WHERE id = ?').run(Date.now(), id);
  }
  bottleStats() {
    return this.db.prepare('SELECT COUNT(*) AS total, SUM(to_id IS NULL) AS waiting, SUM(opened_at IS NOT NULL) AS opened FROM bottles').get() as { total: number; waiting: number; opened: number };
  }

  // ── News (start screen) ───────────────────────────────────────────────────
  news(includeDrafts = false): NewsRow[] {
    return this.db.prepare(`SELECT * FROM news ${includeDrafts ? '' : 'WHERE published = 1'} ORDER BY pinned DESC, created DESC LIMIT 50`).all() as unknown as NewsRow[];
  }
  saveNews(n: { id?: number; title: string; body: string; icon: string; pinned: boolean; published: boolean }, author: string): number {
    const now = Date.now();
    if (n.id) {
      this.db.prepare('UPDATE news SET title = ?, body = ?, icon = ?, pinned = ?, published = ?, updated = ?, author = ? WHERE id = ?')
        .run(n.title, n.body, n.icon, n.pinned ? 1 : 0, n.published ? 1 : 0, now, author, n.id);
      return n.id;
    }
    const r = this.db.prepare('INSERT INTO news (title, body, icon, created, updated, author, pinned, published) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(n.title, n.body, n.icon, now, now, author, n.pinned ? 1 : 0, n.published ? 1 : 0);
    return Number(r.lastInsertRowid);
  }
  deleteNews(id: number) {
    this.db.prepare('DELETE FROM news WHERE id = ?').run(id);
  }
  /** First start: a welcome post so the start screen isn't empty. */
  /** Images used inside news boxes (uploaded in the admin tool). */
  saveNewsImage(id: string, mime: string, data: Buffer, author: string) {
    this.db.prepare('INSERT INTO news_images (id, mime, data, created, author) VALUES (?, ?, ?, ?, ?)').run(id, mime, data, Date.now(), author);
  }
  newsImage(id: string): { mime: string; data: Uint8Array } | undefined {
    return this.db.prepare('SELECT mime, data FROM news_images WHERE id = ?').get(id) as { mime: string; data: Uint8Array } | undefined;
  }

  seedNews() {
    const n = this.db.prepare('SELECT COUNT(*) AS n FROM news').get() as { n: number };
    if (n.n) return;
    this.saveNews({ title: 'Welcome to Hearthwood!', icon: '🌿', pinned: true, published: true,
      body: 'Settle an island, gather, craft and build – then invite friends over. Admins can edit these news boxes in the admin tool (📰 News).' }, 'system');
  }

  // ── Audit log (admin & editor actions) ────────────────────────────────────
  audit(actor: string, action: string, target: string, detail: unknown = '') {
    this.q.audit.run(Date.now(), actor, action, target, typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 4000));
  }
  auditLog(limit = 200): AuditEntry[] {
    return this.q.auditList.all(Math.min(1000, limit)) as unknown as AuditEntry[];
  }
}
