// Test harness: the server under test, bot clients and small helpers shared by
// every suite in ./suites (see run.ts).

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import {
  Grid, decodeTiles, isWaterTile, BUILDINGS, PROTOCOL_VERSION, ISLAND_SIZE, TERRA_REACH, Tile, applyTerrain, distToTile, relocationCost, placeError, classifyWater, FISH, DIRS, SEA_LEVEL, WADE_FLOOR, terraformError, terraformChanges, applyTerrainAndWater,
  type RoomView, type ServerMessage, type WorldObject, type BuildingType,
} from '@hearthwood/shared';

export const here = path.dirname(fileURLToPath(import.meta.url));
export const PORT = 8800 + Math.floor(Math.random() * 100);
export const BASE = `http://127.0.0.1:${PORT}`;
export const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hearthwood-test-'));

/** Results and things later checks (the save-file checks at the end) need. */
export const state = {
  failures: 0,
  /** Terraformed tile (and its island) – checked in the save file at the end. */
  terraSpot: null as [number, number] | null,
  terraIsland: '',
  hotbarPlayer: '',
  hotbarExpected: [] as unknown[],
};
export function check(cond: unknown, label: string) {
  if (cond) console.log(`  ✔ ${label}`);
  else {
    state.failures++;
    console.log(`  ✘ ${label}`);
  }
}
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class Bot {
  ws!: WebSocket;
  inbox: ServerMessage[] = [];
  room!: RoomView;
  grid!: Grid;
  objects = new Map<string, WorldObject>();
  x = 0;
  z = 0;
  seq = 0;
  inv: Record<string, number> = {};
  self: any;
  token = '';
  coins = 0;
  constructor(readonly name: string) {}

  async connect() {
    const r = await fetch(`${BASE}/api/register`, { method: 'POST' });
    const { token } = (await r.json()) as { token: string };
    this.token = token;
    this.ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
    await new Promise((res, rej) => {
      this.ws.onopen = res;
      this.ws.onerror = rej;
    });
    this.ws.onmessage = (ev) => this.onMsg(JSON.parse(String(ev.data)));
    this.send({ t: 'hello', token, v: PROTOCOL_VERSION });
    return this.wait('welcome');
  }

  onMsg(m: ServerMessage) {
    this.inbox.push(m);
    if (m.t === 'room') {
      this.room = m.room;
      this.grid = new Grid(m.room.size, decodeTiles(m.room.tiles), decodeTiles(m.room.levels), decodeTiles(m.room.ramps), decodeTiles(m.room.paths));
      this.objects = new Map(m.room.objects.map((o) => [o.id, o]));
      this.grid.rebuild(this.objects.values(), m.room.buildings);
      const me = m.room.players.find((p) => p.id === this.self?.id);
      this.x = me?.x ?? m.room.spawn.x;
      this.z = me?.z ?? m.room.spawn.z;
    }
    if (m.t === 'oAdd') for (const o of m.o) {
      const prev = this.objects.get(o.id);
      if (prev) this.grid.removeObject(prev);
      this.objects.set(o.id, o);
      this.grid.addObject(o);
    }
    if (m.t === 'oDel') for (const id of m.ids) {
      const prev = this.objects.get(id);
      if (prev) this.grid.removeObject(prev);
      this.objects.delete(id);
    }
    if (m.t === 'bAdd') for (const b of m.b) {
      const i = this.room.buildings.findIndex((x) => x.id === b.id);
      if (i >= 0) {
        this.grid.removeBuilding(this.room.buildings[i]);
        this.room.buildings[i] = b;
      } else this.room.buildings.push(b);
      this.grid.addBuilding(b);
    }
    if (m.t === 'inv') {
      this.inv = m.inv;
      this.coins = m.coins;
    }
    if (m.t === 'paths') for (const [x, z, t] of m.l) this.grid.paths[z * this.grid.size + x] = t;
    if (m.t === 'terrain') applyTerrain(this.grid, m.l);
    if (m.t === 'welcome' || m.t === 'self') this.self = m.you;
    if (m.t === 'corr') {
      this.x = m.x;
      this.z = m.z;
    }
  }

  send(m: unknown) {
    this.ws.send(JSON.stringify(m));
  }

  async wait<T extends ServerMessage['t']>(t: T, pred: (m: Extract<ServerMessage, { t: T }>) => boolean = () => true, ms = 4000) {
    const start = Date.now();
    for (;;) {
      const i = this.inbox.findIndex((m) => m.t === t && pred(m as Extract<ServerMessage, { t: T }>));
      if (i >= 0) return this.inbox.splice(i, 1)[0] as Extract<ServerMessage, { t: T }>;
      if (Date.now() - start > ms) throw new Error(`${this.name}: timeout waiting for ${t}`);
      await sleep(20);
    }
  }

  async act(a: Record<string, unknown>) {
    const seq = ++this.seq;
    this.send({ t: 'act', seq, a });
    const r = await this.wait('res', (m) => m.seq === seq);
    await sleep(300); // respect harvest cooldown
    return r;
  }

  /** BFS over walkable tiles, then step along the path like a real client. */
  async walkTo(tx: number, tz: number, adjacent = true) {
    const size = this.grid.size;
    const start = [Math.floor(this.x), Math.floor(this.z)];
    const goal = (x: number, z: number) => (adjacent ? Math.abs(x - tx) + Math.abs(z - tz) === 1 : x === tx && z === tz);
    const prev = new Map<number, number>();
    const q = [start[1] * size + start[0]];
    prev.set(q[0], -1);
    let found = -1;
    while (q.length) {
      const cur = q.shift()!;
      const cx = cur % size, cz = Math.floor(cur / size);
      if (goal(cx, cz)) { found = cur; break; }
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx, nz = cz + dz;
        const k = nz * size + nx;
        if (!prev.has(k) && this.grid.walkableTile(nx, nz) && this.grid.stepOk(cx, cz, nx, nz)) { prev.set(k, cur); q.push(k); }
      }
    }
    if (found < 0) return false;
    const path: number[] = [];
    for (let k = found; k !== -1; k = prev.get(k)!) path.unshift(k);
    for (const k of path) {
      const px = (k % size) + 0.5, pz = Math.floor(k / size) + 0.5;
      // Step in increments the server will accept.
      while (Math.hypot(px - this.x, pz - this.z) > 0.01) {
        const d = Math.hypot(px - this.x, pz - this.z);
        const step = Math.min(d, 0.4);
        this.x += ((px - this.x) / d) * step;
        this.z += ((pz - this.z) / d) * step;
        this.send({ t: 'move', seq: ++this.seq, x: this.x, z: this.z, r: 0 });
        await sleep(100);
      }
    }
    return true;
  }

  nearest(kind: WorldObject['kind'], pred: (o: WorldObject) => boolean = () => true) {
    let best: WorldObject | null = null;
    let bd = Infinity;
    for (const o of this.objects.values()) {
      if (o.kind !== kind || !pred(o)) continue;
      const d = Math.hypot(o.x + 0.5 - this.x, o.z + 0.5 - this.z);
      if (d < bd) { bd = d; best = o; }
    }
    return best;
  }

  freeSpots(type: BuildingType) {
    const { w, h } = BUILDINGS[type];
    const out: [number, number, number][] = [];
    for (let z = 1; z < this.grid.size - h - 1; z++)
      for (let x = 2; x < this.grid.size - w; x++) {
        if (!this.grid.canPlace(x - 1, z - 1, w + 2, h + 2)) continue;
        const d = Math.hypot(x + w / 2 - this.x, z + h / 2 - this.z);
        if (d > 2.5) out.push([x, z, d]);
      }
    return out.sort((a, b) => a[2] - b[2]);
  }

  /** Walk next to a free spot we can actually reach, then build there. */
  async build(type: BuildingType) {
    for (const [x, z] of this.freeSpots(type).slice(0, 80)) {
      if (!(await this.walkTo(x - 1, z + Math.floor(BUILDINGS[type].h / 2), false))) continue;
      return this.act({ k: 'build', type, x, z });
    }
    const g = this.grid, size = g.size, seen = new Uint8Array(size * size), st = [Math.floor(this.z) * size + Math.floor(this.x)];
    seen[st[0]] = 1; let n = 0;
    while (st.length) { const c = st.pop()!; n++; const cx = c % size, cz = Math.floor(c / size); for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const k = (cz + dz) * size + cx + dx; if (!seen[k] && g.walkableTile(cx + dx, cz + dz) && g.stepOk(cx, cz, cx + dx, cz + dz)) { seen[k] = 1; st.push(k); } } }
    const spots = this.freeSpots(type);
    return { ok: false, err: `no reachable spot (at ${this.x.toFixed(1)},${this.z.toFixed(1)} tile ${g.tile(Math.floor(this.x), Math.floor(this.z))}, reachable ${n}, spots ${spots.length}, first ${JSON.stringify(spots.slice(0, 3))})` };
  }

  async chat(text: string) {
    this.send({ t: 'chat', text });
    await sleep(150);
  }

  async create(biome: string, name: string) {
    this.send({
      t: 'create', name, islandName: `${name} Isle`, gender: 'girl', biome,
      look: { skin: '#f1c27d', hair: 'ponytail', hairColor: '#5a3a1e', eyes: '#2b1d14', shirt: '#e74c3c', pants: '#34495e', shoes: '#8d6e63' },
      geo: { lat: 47.37, lon: 8.54, tz: 'Europe/Zurich' },
    });
    await this.wait('welcome', (m) => !!m.you);
    await this.wait('room');
  }
}

/** JSON over HTTP against the test server. */
export async function http(method: string, p: string, body?: unknown, token?: string, base = BASE) {
  const r = await fetch(base + p, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, unknown> };
}

/** Read the server's SQLite database directly (after it shut down). */
export function dbAll(sql: string, ...args: (string | number)[]) {
  const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');
  const db = new DatabaseSync(path.join(dataDir, 'hearthwood.db'));
  try {
    return db.prepare(sql).all(...args);
  } finally {
    db.close();
  }
}

/** A second server without dev mode: accounts are required, tools are locked. */
export async function productionChecks() {
  console.log('Production mode (no DEV_FAST)');
  const port = PORT + 100;
  const base = `http://127.0.0.1:${port}`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hearthwood-prod-'));
  const srv = spawn(process.execPath, ['--import', 'tsx', path.join(here, '../src/index.ts')], {
    env: { ...process.env, PORT: String(port), DATA_DIR: dir, DEV_FAST: '', ADMIN_USERS: 'Root', LOG_LEVEL: 'error' },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  srv.stdout!.resume();
  try {
    for (let i = 0; i < 100 && !(await fetch(`${base}/api/health`).then((r) => r.ok).catch(() => false)); i++) await sleep(100);
    const h = await http('GET', '/api/health', undefined, undefined, base);
    check(h.body.guests === false && h.body.dev === false, 'production server reports no guests, no dev mode');
    check((await http('POST', '/api/register', {}, undefined, base)).status === 400, 'registration needs a username and password');
    const root = await http('POST', '/api/register', { username: 'root', password: 'admin-password' }, undefined, base);
    const pleb = await http('POST', '/api/register', { username: 'pleb', password: 'player-password' }, undefined, base);
    check((await http('GET', '/api/admin/players', undefined, pleb.body.token as string, base)).status === 403, 'normal players can’t use the admin API');
    check((await http('GET', '/api/admin/players', undefined, root.body.token as string, base)).status === 200, 'ADMIN_USERS accounts can');
    check((await http('GET', '/api/dev/gamedata', undefined, root.body.token as string, base)).status === 404, 'game creation API is off outside dev mode');
    check((await fetch(`${base}/editor`)).status === 404, 'game creation page is off outside dev mode');
  } finally {
    srv.kill('SIGINT');
    await sleep(300);
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Walk to a building's door, go in, and return the interior (or null). */
export async function enterAndBack(bot: Bot, b: { id: string; x: number; z: number; w: number; h: number }) {
  await bot.walkTo(b.x + Math.floor(b.w / 2), b.z + b.h, false);
  bot.send({ t: 'travel', to: { kind: 'enter', id: b.id } });
  const r = await bot.wait('room', (m) => m.room.kind === 'interior').catch(() => null);
  return r?.room ?? null;
}
/** Leave an interior. */
export async function exitTo(bot: Bot) {
  bot.send({ t: 'travel', to: { kind: 'exit' } });
  await bot.wait('room', (m) => m.room.kind !== 'interior');
}

/** Bots and values one suite sets up and later suites use (suites run in order). */
export interface Ctx {
  A: Bot;
  B: Bot;
  C: Bot;
  /** Alice's first villager moving in, and its id. */
  vAdd: Extract<ServerMessage, { t: 'vAdd' }>;
  vid: string;
}
