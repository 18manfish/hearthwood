// Simple JSON-file persistence with atomic writes and dirty tracking.
// Everything is held in memory and flushed periodically. The interface is
// deliberately small so it can be swapped for SQLite/Postgres later.

import fs from 'node:fs';
import path from 'node:path';
import type { IslandRecord, PlayerRecord } from './types.ts';

export class Store {
  readonly players = new Map<string, PlayerRecord>();
  readonly islands = new Map<string, IslandRecord>();
  private byToken = new Map<string, string>();
  private byCode = new Map<string, string>();
  private byInvite = new Map<string, string>();
  private dirtyPlayers = new Set<string>();
  private dirtyIslands = new Set<string>();

  constructor(private dir: string) {}

  load() {
    for (const sub of ['players', 'islands']) fs.mkdirSync(path.join(this.dir, sub), { recursive: true });
    for (const f of fs.readdirSync(path.join(this.dir, 'players'))) {
      if (!f.endsWith('.json')) continue;
      try {
        const p = JSON.parse(fs.readFileSync(path.join(this.dir, 'players', f), 'utf8')) as PlayerRecord;
        this.indexPlayer(p);
      } catch (e) {
        console.error('[store] failed to load player', f, e);
      }
    }
    for (const f of fs.readdirSync(path.join(this.dir, 'islands'))) {
      if (!f.endsWith('.json')) continue;
      try {
        const i = JSON.parse(fs.readFileSync(path.join(this.dir, 'islands', f), 'utf8')) as IslandRecord;
        this.islands.set(i.id, i);
        this.byInvite.set(i.inviteCode, i.id);
      } catch (e) {
        console.error('[store] failed to load island', f, e);
      }
    }
    console.log(`[store] loaded ${this.players.size} players, ${this.islands.size} islands from ${this.dir}`);
  }

  private indexPlayer(p: PlayerRecord) {
    this.players.set(p.id, p);
    this.byToken.set(p.tokenHash, p.id);
    this.byCode.set(p.code, p.id);
  }

  addPlayer(p: PlayerRecord) {
    this.indexPlayer(p);
    this.markPlayer(p.id);
  }

  addIsland(i: IslandRecord) {
    this.islands.set(i.id, i);
    this.byInvite.set(i.inviteCode, i.id);
    this.markIsland(i.id);
  }

  setInviteCode(i: IslandRecord, code: string) {
    this.byInvite.delete(i.inviteCode);
    i.inviteCode = code;
    this.byInvite.set(code, i.id);
    this.markIsland(i.id);
  }

  playerByToken(hash: string) {
    const id = this.byToken.get(hash);
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

  flush() {
    for (const id of this.dirtyPlayers) {
      const p = this.players.get(id);
      if (p) this.writeAtomic(path.join(this.dir, 'players', `${id}.json`), p);
    }
    for (const id of this.dirtyIslands) {
      const i = this.islands.get(id);
      if (i) this.writeAtomic(path.join(this.dir, 'islands', `${id}.json`), i);
    }
    this.dirtyPlayers.clear();
    this.dirtyIslands.clear();
  }

  private writeAtomic(file: string, data: unknown) {
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data));
    fs.renameSync(tmp, file);
  }
}
