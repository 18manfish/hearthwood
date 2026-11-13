// End-to-end test: boots a real server (DEV_FAST) and drives it with bot
// clients over WebSockets, exercising the authoritative rules.
//   npm test   (from the repo root or /server)

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

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = 8800 + Math.floor(Math.random() * 100);
const BASE = `http://127.0.0.1:${PORT}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hearthwood-test-'));

let failures = 0;
/** Terraformed tile (and its island) – checked in the save file at the end. */
let terraSpot: [number, number] | null = null;
let terraIsland = '';
let hotbarPlayer = '';
let hotbarExpected: unknown[] = [];
function check(cond: unknown, label: string) {
  if (cond) console.log(`  ✔ ${label}`);
  else {
    failures++;
    console.log(`  ✘ ${label}`);
  }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class Bot {
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
async function http(method: string, p: string, body?: unknown, token?: string, base = BASE) {
  const r = await fetch(base + p, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, unknown> };
}

/** Read the server's SQLite database directly (after it shut down). */
function dbAll(sql: string, ...args: (string | number)[]) {
  const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');
  const db = new DatabaseSync(path.join(dataDir, 'hearthwood.db'));
  try {
    return db.prepare(sql).all(...args);
  } finally {
    db.close();
  }
}

/** A second server without dev mode: accounts are required, tools are locked. */
async function productionChecks() {
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

async function main() {
  const server = spawn(process.execPath, ['--import', 'tsx', path.join(here, '../src/index.ts')], {
    env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir, DEV_FAST: '1', LOG_LEVEL: process.env.LOG_LEVEL ?? 'error' },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  server.stdout!.resume(); // logs go to stdout; we don't need them
  // Wait until the server answers.
  for (let i = 0; i < 100; i++) {
    const ok = await fetch(`${BASE}/api/health`).then((r) => r.ok).catch(() => false);
    if (ok) break;
    await sleep(100);
  }

  try {
    console.log('Accounts & character creation');
    const A = new Bot('A');
    const w = await A.connect();
    check(w.t === 'welcome' && w.you === null, 'new account needs character creation');
    A.send({ t: 'move', seq: 1, x: 1, z: 1, r: 0 });
    check((await A.wait('err')).code === 'no_character', 'actions rejected before character exists');
    A.send({ t: 'create', name: 'X', islandName: 'Isle', gender: 'boy', biome: 'mars', look: {}, geo: {} });
    check((await A.wait('err')).code === 'bad_message', 'invalid create payload rejected by schema');
    await A.create('grassland', 'Alice');
    check(A.room.kind === 'island' && A.room.canHarvest, 'Alice lands on her own island');
    check(/[12]/.test(A.room.levels) && /[1-4]/.test(A.room.ramps), 'island has cliff levels and ramps');

    console.log('Elevation');
    // Find a cliff edge: level-0 tile next to a level-1 tile that is not a ramp.
    let edge: [number, number, number, number] | null = null;
    for (let z = 1; z < A.grid.size - 1 && !edge; z++)
      for (let x = 1; x < A.grid.size - 1 && !edge; x++) {
        if (!A.grid.walkableTile(x, z) || A.grid.level(x, z) !== 0 || A.grid.ramp(x, z) >= 0) continue;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]])
          if (A.grid.walkableTile(x + dx, z + dz) && A.grid.level(x + dx, z + dz) === 1 && A.grid.ramp(x + dx, z + dz) < 0) { edge = [x, z, dx, dz]; break; }
      }
    if (edge && (await A.walkTo(edge[0], edge[1], false))) {
      const [ex, ez, dx, dz] = edge;
      let blocked = false;
      for (let i = 1; i <= 6; i++) {
        A.send({ t: 'move', seq: ++A.seq, x: ex + 0.5 + dx * 0.25 * i, z: ez + 0.5 + dz * 0.25 * i, r: 0 });
        await sleep(110);
        if (A.inbox.some((m) => m.t === 'corr')) { blocked = true; break; }
      }
      check(blocked, 'walking up a cliff wall is rejected');
      A.inbox = A.inbox.filter((m) => m.t !== 'corr');
    }
    // A ramp leads up.
    let rampTile: [number, number] | null = null;
    for (let z = 0; z < A.grid.size && !rampTile; z++) for (let x = 0; x < A.grid.size; x++) if (A.grid.ramp(x, z) >= 0 && A.grid.level(x, z) === 0) { rampTile = [x, z]; break; }
    if (rampTile) {
      const d = [[0, -1], [1, 0], [0, 1], [-1, 0]][A.grid.ramp(rampTile[0], rampTile[1])];
      const ok = await A.walkTo(rampTile[0] + d[0], rampTile[1] + d[1], false);
      check(ok && !A.inbox.some((m) => m.t === 'corr') && A.grid.level(Math.floor(A.x), Math.floor(A.z)) === 1, 'climbing a ramp reaches the plateau');
      await A.walkTo(Math.floor(A.room.spawn.x), Math.floor(A.room.spawn.z) - 3, false);
    }

    console.log('Movement validation');
    A.send({ t: 'move', seq: 2, x: A.x + 15, z: A.z, r: 0 });
    const corr = await A.wait('corr');
    check(!!corr, 'teleport attempt is corrected by the server');
    A.send({ t: 'move', seq: 3, x: A.x, z: A.z + 0.3, r: 0 });
    await sleep(200);
    check(!A.inbox.some((m) => m.t === 'corr'), 'normal step accepted');
    A.z += 0.3;

    console.log('Gathering without tools');
    const tree = A.nearest('tree', (o) => o.stage === 2)!;
    await A.walkTo(tree.x, tree.z);
    const shake = await A.act({ k: 'shake', id: tree.id });
    check(shake.ok && (shake.gained?.wood ?? 0) >= 1, 'shaking a tree drops a branch');
    const chopNoAxe = await A.act({ k: 'chop', id: tree.id });
    check(!chopNoAxe.ok, `chopping without an axe is refused (“${chopNoAxe.err}”)`);
    const rock = A.nearest('rock')!;
    await A.walkTo(rock.x, rock.z);
    const r1 = await A.act({ k: 'hit', id: rock.id });
    const r2 = await A.act({ k: 'hit', id: rock.id });
    const r3 = await A.act({ k: 'hit', id: rock.id });
    check(r1.ok && r2.ok && !r3.ok, 'only two loose stones per rock by hand');
    const far = A.nearest('tree', (o) => Math.hypot(o.x - A.x, o.z - A.z) > 6)!;
    const farRes = await A.act({ k: 'shake', id: far.id });
    check(!farRes.ok && farRes.err === 'Too far away.', 'distance is validated');

    console.log('Crafting & day-one camp');
    await A.chat('/kit');
    await A.wait('inv');
    A.send({ t: 'dev', cmd: 'give', args: ['fence', '2'] });
    for (const r of ['stone_axe', 'shovel', 'fishing_rod']) check((await A.act({ k: 'craft', recipe: r })).ok, `crafted ${r}`);
    check(!(await A.act({ k: 'craft', recipe: 'shovel' })).ok, 'cannot craft a duplicate tool');
    const t2 = A.nearest('tree', (o) => o.stage === 2)!;
    await A.walkTo(t2.x, t2.z);
    let felled = false;
    for (let i = 0; i < 4; i++) felled = (await A.act({ k: 'chop', id: t2.id })).msg === 'Timber!' || felled;
    check(felled && A.objects.get(t2.id)?.kind === 'stump', 'tree felled into a stump after 4 hits');
    check((await A.act({ k: 'dig', id: t2.id })).ok && !A.objects.has(t2.id), 'stump dug up');
    const rocks = [...A.objects.values()].filter((o) => o.kind === 'rock' && !o.hits).sort((p, q) => Math.hypot(p.x - A.x, p.z - A.z) - Math.hypot(q.x - A.x, q.z - A.z));
    let r2rock = rocks[0];
    for (const r of rocks) if (await A.walkTo(r.x, r.z)) { r2rock = r; break; }
    let crumbled = false;
    for (let i = 0; i < 8 && !crumbled; i++) crumbled = (await A.act({ k: 'hit', id: r2rock.id })).msg === 'The rock crumbled away.';
    check(crumbled && !A.objects.has(r2rock.id), 'depleted rock disappears');
    // Nearest bush we can actually walk to (cliffs may be in the way).
    const bushes = [...A.objects.values()].filter((o) => o.kind === 'bush').sort((p, q) => Math.hypot(p.x - A.x, p.z - A.z) - Math.hypot(q.x - A.x, q.z - A.z));
    let bush = bushes[0];
    for (const b of bushes) if (await A.walkTo(b.x, b.z)) { bush = b; break; }
    const picked = await A.act({ k: 'forage', id: bush.id });
    check(picked.ok && !A.objects.has(bush.id), 'picked bush disappears');
    // Block the bush's old spot with furniture so the respawn must move.
    const fence = await A.act({ k: 'place', item: 'fence', x: bush.x, z: bush.z, rot: 0 });
    A.send({ t: 'dev', cmd: 'respawn', args: [] });
    const back = await A.wait('oAdd', (m) => m.o.some((o) => o.kind === 'rock' || o.kind === 'bush'), 3000).catch(() => null);
    await sleep(300);
    const newBush = [...A.objects.values()].find((o) => o.kind === 'bush' && Math.abs(o.x - bush.x) <= 6 && Math.abs(o.z - bush.z) <= 6 && o.id !== bush.id && o.id.startsWith('k'));
    check(!!back, 'resources respawn later (dev: respawn now)');
    check(!fence.ok || (newBush && (newBush.x !== bush.x || newBush.z !== bush.z)), 'blocked respawn spot → resource appears on another free tile');
    let spotP: [number, number] | null = null;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const x = Math.floor(A.x) + dx, z = Math.floor(A.z) + dz;
      if (A.grid.canPlace(x, z) && ![...A.objects.values()].some((o) => (o.kind === 'tree' || o.kind === 'stump') && Math.abs(o.x - x) <= 1 && Math.abs(o.z - z) <= 1)) { spotP = [x, z]; break; }
    }
    if (spotP) {
      const plant = await A.act({ k: 'plant', x: spotP[0], z: spotP[1] });
      check(plant.ok, `sapling planted${plant.ok ? '' : ` (${plant.err})`}`);
    }

    console.log('Paths');
    let pv: [number, number] | null = null;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [2, 0], [0, 2]]) {
      const x = Math.floor(A.x) + dx, z = Math.floor(A.z) + dz;
      if (A.grid.canPave(x, z) && !A.grid.path(x, z) && Math.floor(A.x) !== x) { pv = [x, z]; break; }
    }
    if (pv) {
      const clay0 = A.inv.clay ?? 0;
      check((await A.act({ k: 'pave', x: pv[0], z: pv[1], path: 1 })).ok, 'dirt path laid (shovel)');
      await A.wait('paths', (m) => m.l.some((e) => e[0] === pv![0] && e[1] === pv![1] && e[2] === 1)).catch(() => null);
      check((await A.act({ k: 'pave', x: pv[0], z: pv[1], path: 4 })).ok, 'swapped for a brick path');
      await sleep(100);
      check((A.inv.clay ?? 0) === clay0 - 2, 'brick path cost 2 clay');
      check(!(await A.act({ k: 'plant', x: pv[0], z: pv[1] })).ok, 'cannot plant a tree on a path');
      check((await A.act({ k: 'unpave', x: pv[0], z: pv[1] })).ok, 'path removed');
      await sleep(100);
      check((A.inv.clay ?? 0) === clay0, 'removing a path refunds its materials');
      const far = await A.act({ k: 'pave', x: Math.min(A.grid.size - 1, Math.floor(A.x) + 12), z: Math.floor(A.z), path: 1 });
      check(!far.ok, 'paving far away is refused');
    }

    for (const b of ['tent', 'campfire', 'workbench'] as const) {
      const res = await A.build(b);
      check(res.ok, `built ${b}${res.ok ? '' : ` (${res.err})`}`);
    }
    const q = await A.wait('quest', (m) => m.q.chapter === 2, 3000).catch(() => null);
    check(!!q, 'chapter 1 complete → chapter 2 (starter house)');

    console.log('Terraforming');
    check(A.grid.size === ISLAND_SIZE && ISLAND_SIZE === 72, 'new islands are 72×72 (1.5× the old 48)');
    {
      // Find a flat, empty 5×6 patch near the player: T gets raised, R below it becomes a ramp.
      const g = A.grid;
      const flat = (x: number, z: number) => g.tile(x, z) === Tile.Ground && g.level(x, z) === 0 && g.occupied[z * g.size + x] === 0 && !g.reserved[z * g.size + x] && !g.path(x, z);
      let spot: [number, number] | null = null;
      // Any flat patch on the island, nearest first; then walk up beside it.
      const patches: [number, number][] = [];
      for (let z = 3; z < g.size - 4; z++)
        for (let x = 3; x < g.size - 4; x++) {
          let ok = true;
          for (let zz = z - 2; zz <= z + 3 && ok; zz++) for (let xx = x - 2; xx <= x + 2 && ok; xx++) ok = flat(xx, zz);
          if (ok) patches.push([x, z]);
        }
      patches.sort((p, q) => Math.hypot(p[0] - A.x, p[1] - A.z) - Math.hypot(q[0] - A.x, q[1] - A.z));
      for (const [x, z] of patches.slice(0, 15)) {
        if (!(await A.walkTo(x + 3, z, false).catch(() => false))) continue;
        const away = (tx: number, tz: number) => Math.hypot(tx + 0.5 - A.x, tz + 0.5 - A.z) > 1.3;
        if (away(x, z) && away(x, z + 1) && distToTile(A.x, A.z, x, z) <= TERRA_REACH - 0.5 && distToTile(A.x, A.z, x, z + 1) <= TERRA_REACH - 0.5) {
          spot = [x, z];
          break;
        }
      }
      check(!!spot, 'found a flat spot to terraform');
      if (spot) {
        const [tx, tz] = spot;
        const noTool = await A.act({ k: 'terra', op: 'raise', x: tx, z: tz });
        check(!noTool.ok && /Permit/.test(noTool.err ?? ''), 'terraforming needs a Town Hall permit');
        A.send({ t: 'dev', cmd: 'permits', args: [] });
        await A.wait('self', (m) => m.you.permits.length === 2);
        const me = await A.act({ k: 'terra', op: 'raise', x: Math.floor(A.x), z: Math.floor(A.z) });
        check(!me.ok, 'cannot raise the ground you stand on');
        const up = await A.act({ k: 'terra', op: 'raise', x: tx, z: tz });
        check(up.ok, `cliff raised${up.ok ? '' : ` (${up.err})`}`);
        await A.wait('terrain', (m) => m.l.some((c) => c[0] === tx && c[1] === tz)).catch(() => null);
        check(A.grid.level(tx, tz) === 1, 'raised tile is one level up');
        const twice = await A.act({ k: 'terra', op: 'raise', x: tx, z: tz });
        check(!twice.ok, 'cliffs rise one level at a time (neighbours first)');
        const ramp = await A.act({ k: 'terra', op: 'ramp', x: tx, z: tz + 1, dir: 0 });
        check(ramp.ok, `ramp built up to the new cliff${ramp.ok ? '' : ` (${ramp.err})`}`);
        await sleep(150);
        check(A.grid.ramp(tx, tz + 1) === 0 && A.grid.stepOk(tx, tz + 1, tx, tz), 'the ramp connects both levels');
        check(!(await A.act({ k: 'terra', op: 'lower', x: tx, z: tz })).ok, 'cannot lower a ramp landing');
        for (const [op, style] of [['stairs_stone', 1], ['stairs_wood', 2], ['stairs_log', 3]] as const) {
          const st = await A.act({ k: 'terra', op, x: tx, z: tz + 1 });
          await sleep(120);
          check(st.ok && A.grid.rampStyle(tx, tz + 1) === style && A.grid.ramp(tx, tz + 1) === 0, `ramp turned into ${op.replace('_', ' ')}${st.ok ? '' : ` (${st.err})`}`);
        }
        check(!(await A.act({ k: 'terra', op: 'stairs_log', x: tx, z: tz + 1 })).ok, 'same stairs again is refused');
        check(A.grid.stepOk(tx, tz + 1, tx, tz), 'stairs still connect both levels');
        check((await A.act({ k: 'terra', op: 'unramp', x: tx, z: tz + 1 })).ok, 'ramp removed');
        check((await A.act({ k: 'terra', op: 'lower', x: tx, z: tz })).ok, 'cliff lowered again');
        check((await A.act({ k: 'terra', op: 'water', x: tx, z: tz })).ok, 'pond dug');
        await sleep(150);
        check(A.grid.tile(tx, tz) === Tile.Pond, 'tile is water now');
        check((await A.act({ k: 'terra', op: 'land', x: tx, z: tz })).ok, 'pond filled in');
        const far = await A.act({ k: 'terra', op: 'raise', x: Math.min(A.grid.size - 3, Math.floor(A.x) + 15), z: Math.floor(A.z) });
        check(!far.ok, 'terraforming far away is refused');
        // Leave one raised tile so persistence can be checked after a reload.
        check((await A.act({ k: 'terra', op: 'raise', x: tx, z: tz })).ok, 'raised again (kept for the save check)');
        terraSpot = spot;
        terraIsland = A.room.id;
      }
    }

    console.log('Birds & album');
    {
      const birdsSeen = () => [...A.objects.values()].filter((o) => o.kind === 'bird');
      A.send({ t: 'dev', cmd: 'birds', args: ['5'] });
      await A.wait('oAdd', (m) => m.o.some((o) => o.kind === 'bird')).catch(() => null);
      await sleep(200);
      check(birdsSeen().length > 0, `birds landed (${birdsSeen().length})`);
      const first = birdsSeen()[0];
      if (first) {
        await A.walkTo(first.x + 1, first.z, false).catch(() => false);
        const noNet = await A.act({ k: 'catch', id: first.id });
        check(!noNet.ok && /net/.test(noNet.err ?? ''), 'catching birds needs a net');
      }
      A.send({ t: 'dev', cmd: 'give', args: ['bird_net', '1'] });
      await sleep(300);
      let caught: string | null = null;
      for (let tries = 0; tries < 12 && !caught; tries++) {
        let b = birdsSeen()[0];
        if (!b) {
          A.send({ t: 'dev', cmd: 'birds', args: ['4'] });
          await A.wait('oAdd', (m) => m.o.some((o) => o.kind === 'bird')).catch(() => null);
          await sleep(150);
          b = birdsSeen()[0];
          if (!b) continue;
        }
        let reached = false;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (!reached) reached = await A.walkTo(b.x + dx, b.z + dz, false).catch(() => false);
        const r = await A.act({ k: 'catch', id: b.id });
        if (r.ok && r.gained && Object.keys(r.gained).some((k) => k.startsWith('bird_'))) caught = Object.keys(r.gained)[0];
        else await sleep(200);
      }
      check(!!caught, `caught a bird (${caught})`);
      const album = A.inbox.filter((m) => m.t === 'album').pop() as Extract<ServerMessage, { t: 'album' }> | undefined;
      check(!!caught && !!album?.album.birds[caught], 'the bird is in the album');
      check(!birdsSeen().some((o) => o.id === caught), 'caught bird is gone from the island');
    }

    console.log('Hotbar');
    {
      const slots = ['net', 'hand', 'axe', null, 'rod', 'shovel', 'sapling', 'pick', 'spade', null];
      A.send({ t: 'hotbar', slots });
      A.send({ t: 'hotbar', slots: ['axe', 'axe', 'bogus'] }); // duplicates / unknown tools are cleaned
      await sleep(200);
      A.send({ t: 'hotbar', slots });
      await sleep(200);
      hotbarPlayer = A.self.id;
      hotbarExpected = slots;
    }

    console.log('Moving buildings');
    {
      const fire = A.room.buildings.find((b) => b.type === 'campfire')!;
      A.send({ t: 'dev', cmd: 'coins', args: ['2000'] });
      await sleep(300);
      const coins0 = A.coins;
      let moved = false;
      for (const [x, z] of A.freeSpots('campfire').filter(([x, z]) => Math.hypot(x - fire.x, z - fire.z) > 3).slice(0, 30)) {
        if (!(await A.walkTo(x - 1, z, false))) continue;
        const r = await A.act({ k: 'relocate', id: fire.id, x, z });
        if (!r.ok) continue;
        await sleep(200);
        const now = A.room.buildings.find((b) => b.id === fire.id)!;
        check(now.x === x && now.z === z, 'campfire moved to its new spot');
        check(A.coins === coins0 - relocationCost(fire.w, fire.h), 'moving cost coins');
        moved = true;
        break;
      }
      check(moved, 'a building can be moved');
      const dock = A.room.buildings.find((b) => b.type === 'dock')!;
      check(!(await A.act({ k: 'relocate', id: dock.id, x: 5, z: 5 })).ok, 'the dock cannot be moved');
    }

    console.log('Tent interior');
    const islandId = A.room.id;
    const tent = A.room.buildings.find((b) => b.type === 'tent')!;
    // From behind the tent you can't get in – only through the door.
    if (await A.walkTo(tent.x, tent.z - 1, false)) {
      A.send({ t: 'travel', to: { kind: 'enter', id: tent.id } });
      check(!!(await A.wait('toast', (m) => /front of the door/.test(m.text)).catch(() => null)), 'buildings are entered through the door only');
    }
    await A.walkTo(tent.x, tent.z + tent.h, false);
    A.send({ t: 'travel', to: { kind: 'enter', id: tent.id } });
    await A.wait('room', (m) => m.room.kind === 'interior');
    check(A.room.kind === 'interior' && A.room.interior === 'tent', 'entered the tent');
    check(A.room.buildings.some((b) => b.type === 'bed') && A.room.canDecorate && !A.room.canBuild, 'tent has a bed; can decorate but not build inside');
    const chest = A.room.buildings.find((b) => b.type === 'chest')!;
    await A.walkTo(chest.x, chest.z + 1, false);
    check((await A.act({ k: 'sell', item: 'stone', n: 1 })).ok, 'sell box (chest) works inside');
    A.send({ t: 'travel', to: { kind: 'exit' } });
    await A.wait('room', (m) => m.room.kind === 'island');
    check(A.room.id === islandId && Math.abs(A.z - (tent.z + tent.h + 0.45)) < 0.6, 'exit puts you back in front of the tent');

    console.log('Village growth');
    const cab = await A.build('cabin');
    check(cab.ok, `starter house construction started ${cab.err ?? ''}`);
    check(!(await A.build('town_hall')).ok, 'town hall requires a finished house');
    await A.chat('/finish');
    await sleep(300);
    const th = await A.build('town_hall');
    check(th.ok, `town hall construction started ${th.err ?? ''}`);
    await A.chat('/finish');
    await sleep(300);
    await A.chat('/kit');
    const vh = await A.build('villager_house');
    check(vh.ok, `villager house construction started ${vh.err ?? ''}`);
    await A.chat('/finish');
    const vAdd = await A.wait('vAdd');
    const vid = vAdd.v[0].id;
    check(!!vid, `a villager moved in (${vid})`);

    console.log('Interiors');
    const enterAndBack = async (bot: Bot, b: { id: string; x: number; z: number; w: number; h: number }) => {
      await bot.walkTo(b.x + Math.floor(b.w / 2), b.z + b.h, false);
      bot.send({ t: 'travel', to: { kind: 'enter', id: b.id } });
      const r = await bot.wait('room', (m) => m.room.kind === 'interior').catch(() => null);
      return r?.room ?? null;
    };
    const exitTo = async (bot: Bot) => {
      bot.send({ t: 'travel', to: { kind: 'exit' } });
      await bot.wait('room', (m) => m.room.kind !== 'interior');
    };
    const hall = A.room.buildings.find((b) => b.type === 'town_hall')!;
    const thIn = await enterAndBack(A, hall);
    const counter = thIn?.buildings.find((b) => b.type === 'counter');
    check(thIn?.interior === 'town_hall' && counter?.role === 'town_hall', 'entered the Town Hall, which has a service counter');
    if (counter) {
      await A.walkTo(counter.x, counter.z + 1, false);
      check((await A.act({ k: 'sell', item: 'stone', n: 1 })).ok, 'selling works at the Town Hall counter');
      const again = await A.act({ k: 'permit', id: 'permit_cliff' });
      check(!again.ok && /already/.test(again.err ?? ''), 'permits are sold at the Town Hall counter (no double purchase)');
    }
    await exitTo(A);
    check(/Town Hall/.test((await A.act({ k: 'permit', id: 'permit_water' })).err ?? ''), 'permits can only be bought at the counter');
    const vHouse = A.room.buildings.find((b) => b.type === 'villager_house' && b.villagerId);
    if (vHouse) {
      const vIn = await enterAndBack(A, vHouse);
      check(vIn?.interior === 'villager' && !!vIn.theme && vIn.objects.filter((o) => o.kind === 'decor').length >= 6, `villager house is furnished & themed (${vIn?.name})`);
      check(!vIn?.canDecorate, 'you cannot rearrange a villager’s furniture');
      await exitTo(A);
    }

    // Shops: services live at the counter inside.
    await A.chat('/kit');
    const ts = await A.build('tool_store');
    check(ts.ok, `tool store construction started ${ts.err ?? ''}`);
    await A.chat('/finish');
    await sleep(300);
    const store = A.room.buildings.find((b) => b.type === 'tool_store');
    if (store) {
      const outside = await A.act({ k: 'buy', shop: 'tool_store', item: 'sapling', n: 1 });
      check(!outside.ok, 'shops no longer serve you from outside');
      const sIn2 = await enterAndBack(A, store);
      const ctr = sIn2?.buildings.find((b) => b.type === 'counter');
      check(sIn2?.interior === 'shop' && ctr?.role === 'tool_store', 'tool store interior has a shop counter');
      if (ctr) {
        await A.walkTo(ctr.x, ctr.z + 1, false);
        const bought = await A.act({ k: 'buy', shop: 'tool_store', item: 'sapling', n: 1 });
        check(bought.ok, `bought a sapling at the counter ${bought.err ?? ''}`);
      }
      await exitTo(A);
    }

    console.log('Villagers');
    const vs = vAdd.v[0];
    await A.walkTo(Math.floor(vs.x), Math.floor(vs.z));
    // Villagers wander; follow the latest broadcast position.
    let talk = null;
    for (let i = 0; i < 6 && !talk; i++) {
      const pos = [...A.inbox].reverse().find((m) => m.t === 'vs' && m.l.some((e) => e[0] === vid)) as Extract<ServerMessage, { t: 'vs' }> | undefined;
      const e = pos?.l.find((x) => x[0] === vid);
      if (e && e[4] === 1) break; // night – indoors
      if (e) await A.walkTo(Math.floor(e[1]), Math.floor(e[2]));
      const r = await A.act({ k: 'talk', vid });
      if (r.ok) talk = await A.wait('talk');
    }
    if (talk) {
      check(talk.v.points >= 2, `talking raises friendship (“${talk.v.line}”)`);
      const g = await A.act({ k: 'gift', vid, item: 'wood' });
      if (g.ok) {
        const t3 = await A.wait('talk');
        check(!!t3.v.reaction, `gift reaction: ${t3.v.reaction}`);
        check(!(await A.act({ k: 'gift', vid, item: 'wood' })).ok, 'only one gift per villager per day');
      }
    } else console.log('  (villagers are asleep at this local hour – skipped talk test)');

    console.log('Fishing');
    let castTile: [number, number] | null = null;
    let stand: [number, number] | null = null;
    outer: for (let z = 1; z < A.grid.size - 1; z++)
      for (let x = 1; x < A.grid.size - 1; x++) {
        if (!A.grid.walkableTile(x, z)) continue;
        for (const [dx, dz] of [[0, 1], [1, 0], [0, -1], [-1, 0]]) {
          if (isWaterTile(A.grid.tile(x + dx, z + dz)) && A.grid.tile(x + dx, z + dz) === 3) {
            stand = [x, z]; castTile = [x + dx, z + dz]; break outer;
          }
        }
      }
    if (stand && castTile) {
      await A.walkTo(stand[0], stand[1], false);
      let caught = false;
      for (let i = 0; i < 3 && !caught; i++) {
        const c = await A.act({ k: 'cast', x: castTile[0], z: castTile[1] });
        if (!c.ok || c.msg) { console.log('  cast:', c.err ?? c.msg); break; }
        const bite = await A.wait('bite', () => true, 8000);
        A.send({ t: 'act', seq: ++A.seq, a: { k: 'reel', castId: bite.castId } });
        const f = await A.wait('fish', () => true, 3000).catch(() => null);
        caught = !!f?.ok;
        if (f) check(f.ok, f.msg);
      }
      // Reeling early fails.
      const c2 = await A.act({ k: 'cast', x: castTile[0], z: castTile[1] });
      if (c2.ok && !c2.msg) {
        const early = await A.act({ k: 'reel', castId: 'c999999' });
        check(!early.ok, 'reeling a cast that is not yours is rejected');
      }
    }

    console.log('Multiplayer, access control & friends');
    const B = new Bot('B');
    await B.connect();
    await B.create('tropical', 'Bob');
    check(B.room.biome === 'tropical', 'Bob starts on a tropical island');
    B.send({ t: 'travel', to: { kind: 'island', id: A.room.id } });
    const denied = await B.wait('toast', (m) => /isn.t open/.test(m.text));
    check(/isn.t open/.test(denied.text), 'Bob cannot visit a friends-only island');
    B.send({ t: 'friend', op: 'request', code: A.self.code });
    await A.wait('friends', (m) => m.incoming.length === 1);
    A.send({ t: 'friend', op: 'accept', id: B.self.id });
    const fr = await B.wait('friends', (m) => m.list.length === 1);
    check(fr.list[0].name === 'Alice', 'friend request accepted');
    B.send({ t: 'travel', to: { kind: 'island', id: A.room.id } });
    await B.wait('room');
    check(B.room.id === A.room.id && !B.room.canHarvest, 'friend can visit but not harvest');
    const pAdd = await A.wait('pAdd');
    check(pAdd.p.name === 'Bob', 'Alice sees Bob arrive');

    console.log('Mailbox');
    const mb = await A.build('mailbox');
    check(mb.ok, `mailbox built ${mb.err ?? ''}`);
    const box = A.room.buildings.find((b) => b.type === 'mailbox');
    if (box) {
      await A.walkTo(box.x, box.z + 1, false);
      const sent = await A.act({ k: 'mail', to: B.self.id, text: 'Welcome to my island!', item: 'stone', n: 1 });
      check(sent.ok, `Alice mails Bob from her mailbox ${sent.err ?? ''}`);
      const got = await B.wait('mail', (m) => m.list.some((x) => x.text === 'Welcome to my island!')).catch(() => null);
      check(!!got, 'Bob receives the letter with a gift');
      await B.walkTo(box.x, box.z + 1, false);
      const toOther = await B.act({ k: 'mail', to: 'p_000000000000', text: 'x' });
      check(!toOther.ok, 'a visitor can only post letters to the mailbox owner');
      const back = await B.act({ k: 'mail', to: A.self.id, text: 'Thanks Alice!' });
      check(back.ok, `Bob leaves a letter in Alice’s mailbox ${back.err ?? ''}`);
      const gotA = await A.wait('mail', (m) => m.list.some((x) => x.text === 'Thanks Alice!')).catch(() => null);
      check(!!gotA, 'Alice gets the visitor’s letter');
    }
    const bt = B.nearest('tree', (o) => o.stage === 2)!;
    await B.walkTo(bt.x, bt.z);
    check(!(await B.act({ k: 'shake', id: bt.id })).ok, 'visitor cannot shake trees');
    B.send({ t: 'move', seq: ++B.seq, x: B.x, z: B.z + 0.2, r: 1 });
    const ps = await A.wait('ps', (m) => m.l.some((e) => e[0] === B.self.id));
    check(!!ps, 'Alice receives Bob’s movement');
    B.send({ t: 'chat', text: 'hi \u0007alice‮!' });
    const ch = await A.wait('chat', (m) => m.name === 'Bob');
    check(ch.text === 'hi alice!', 'chat is relayed and sanitised');

    const C = new Bot('C');
    await C.connect();
    await C.create('desert', 'Cleo');
    A.send({ t: 'access', access: 'invite' });
    await A.wait('self', (m) => m.you.access === 'invite');
    C.send({ t: 'travel', to: { kind: 'island', id: A.room.id } });
    check(!!(await C.wait('toast', (m) => /isn.t open/.test(m.text)).catch(() => null)), 'stranger blocked without invite code');
    C.send({ t: 'travel', to: { kind: 'code', code: A.self.inviteCode } });
    await C.wait('room');
    check(C.room.id === A.room.id, 'invite code grants entry');
    A.send({ t: 'kick', id: C.self.id });
    await C.wait('room');
    check(C.room.id !== A.room.id, 'owner can send visitors home');

    C.send({ t: 'travel', to: { kind: 'shared', id: 'harbor' } });
    await C.wait('room');
    check(C.room.kind === 'shared', 'shared location reachable by anyone');
    console.log('Harbor Town: billboard & public mailbox');
    check(C.room.buildings.some((b) => b.type === 'billboard') && C.room.buildings.filter((b) => b.type === 'shack').length >= 5, 'harbor has a billboard and a hillside of houses');
    check(/[12]/.test(C.room.levels) && C.room.paths.includes('4'), 'harbor has terraces and a brick plaza');
    const bb = C.room.buildings.find((b) => b.type === 'billboard')!;
    const far2 = await new Promise<boolean>((res) => { C.send({ t: 'board', op: 'post', text: 'too far' }); C.wait('toast', (m) => /Walk up/.test(m.text), 2000).then(() => res(true)).catch(() => res(false)); });
    check(far2, 'posting requires standing at the billboard');
    check(await C.walkTo(bb.x, bb.z + 1, false), 'walked to the billboard');
    C.send({ t: 'board', op: 'post', text: 'Selling turnips \u0007cheap!' });
    const board = await C.wait('board', (m) => m.posts.some((n) => n.name === 'Cleo')).catch(() => null);
    check(board?.posts[0].text === 'Selling turnips cheap!', 'note pinned (sanitised) and broadcast');
    C.send({ t: 'board', op: 'post', text: 'spam' });
    check(!!(await C.wait('toast', (m) => /another note/.test(m.text)).catch(() => null)), 'post cooldown enforced');
    B.send({ t: 'travel', to: { kind: 'shared', id: 'harbor' } });
    await B.wait('room', (m) => m.room.kind === 'shared');
    check(B.room.board?.[0]?.text === 'Selling turnips cheap!', 'new arrivals see the billboard notes');
    B.send({ t: 'board', op: 'delete', id: board!.posts[0].id });
    check(!!(await B.wait('toast', (m) => /own notes/.test(m.text)).catch(() => null)), 'cannot take down someone else’s note');
    C.send({ t: 'board', op: 'delete', id: board!.posts[0].id });
    check(!!(await C.wait('board', (m) => !m.posts.some((n) => n.id === board!.posts[0].id)).catch(() => null)), 'author can take down their note');
    const hm = B.room.buildings.find((b) => b.type === 'mailbox')!;
    await B.walkTo(hm.x, hm.z + 1, false);
    const pub = await B.act({ k: 'mail', to: A.self.id, text: 'Greetings from the harbour!' });
    check(pub.ok, `public mailbox sends to a friend ${pub.err ?? ''}`);

    const shackB = C.room.buildings.find((b) => b.type === 'shack')!;
    const sIn = await enterAndBack(C, shackB);
    check(sIn?.interior === 'shack' && (sIn?.objects.length ?? 0) > 5, 'harbor cottages can be entered');
    await exitTo(C);
    check(C.room.id === 'shared_harbor', 'leaving a cottage returns to the harbour');

    C.send({ t: 'map' });
    const map = await C.wait('map');
    check(map.islands.some((i) => i.mine) && !map.islands.some((i) => i.name === 'Alice Isle'), 'map hides non-public islands from strangers');

    console.log('Dev season override');
    A.send({ t: 'dev', cmd: 'season', args: ['winter'] });
    const envW = await A.wait('env', (m) => m.env.season === 'winter').catch(() => null);
    check(!!envW, 'dev command forces the island season');
    A.send({ t: 'dev', cmd: 'season', args: ['wet'] });
    const envN = await A.wait('env').catch(() => null);
    check(envN?.env.season !== 'wet', 'season not valid for the climate is refused (back to real calendar)');

    console.log('Water, bridges & the beach');
    {
      if (A.room.id !== A.self.homeIslandId) {
        A.send({ t: 'travel', to: { kind: 'home' } });
        await A.wait('room', (m) => m.room.id === A.self.homeIslandId);
      }
      const g = A.grid;
      let river = 0, pond = 0;
      for (let i = 0; i < g.size * g.size; i++) { if (g.tiles[i] === Tile.River) river++; if (g.tiles[i] === Tile.Pond) pond++; }
      check(river > 0 && pond > 0, `the island has a river (${river} tiles) and a pond (${pond})`);
      check(classifyWater(g.size, Uint8Array.from(g.tiles)).length === 0, 'rivers connect to the sea, ponds don’t');
      // Digging into beach sand: joined to the sea it's a river; filled in, it's sand again.
      {
        const n = 10, tiles = new Uint8Array(n * n).fill(Tile.Ground);
        for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) if (z >= 6) tiles[z * n + x] = z >= 8 ? Tile.Sea : Tile.Shore;
        const tg = new Grid(n, tiles);
        check(terraformError(tg, 'water', 4, 7) === null, 'water can be dug into sand');
        applyTerrainAndWater(tg, terraformChanges(tg, 'water', 4, 7));
        check(tg.tile(4, 7) === Tile.River, 'sand dug next to the sea becomes river');
        applyTerrainAndWater(tg, terraformChanges(tg, 'land', 4, 7));
        check(tg.tile(4, 7) === Tile.Shore, 'filled back in with sand on the beach');
      }
      // Water on cliffs: against a cliff is fine, over an edge only with water below (a waterfall).
      {
        const n = 10, tiles = new Uint8Array(n * n).fill(Tile.Ground), levels = new Uint8Array(n * n);
        for (let z = 0; z < 5; z++) for (let x = 0; x < n; x++) levels[z * n + x] = 1;
        const tg = new Grid(n, tiles, levels);
        const dig = (op: 'water' | 'land' | 'lower', x: number, z: number) => {
          const err = terraformError(tg, op, x, z);
          if (!err) applyTerrainAndWater(tg, terraformChanges(tg, op, x, z));
          return err;
        };
        check(dig('water', 4, 4) !== null, 'water at a cliff edge with dry ground below is refused');
        check(dig('water', 4, 5) === null && dig('water', 5, 5) === null, 'water dug right against a cliff');
        check(dig('water', 4, 4) === null && tg.level(4, 4) === 1 && tg.level(4, 5) === 0, 'water on the cliff above water below (a waterfall)');
        check(dig('land', 4, 5) !== null, 'the water under a waterfall can’t be filled while it falls');
        check(dig('lower', 3, 4) !== null, 'ground holding raised water can’t be lowered');
        check(dig('land', 4, 4) === null && tg.tile(4, 4) === Tile.Ground && tg.level(4, 4) === 1, 'raised water filled back in on its level');
      }
      // Wide beaches and wading into the shallow sea.
      {
        let shore = 0, wade = 0, deep = 0;
        for (let z = 0; z < g.size; z++)
          for (let x = 0; x < g.size; x++) {
            if (g.tile(x, z) === Tile.Shore) shore++;
            if (g.tile(x, z) === Tile.Sea) g.wadeableTile(x, z) ? wade++ : deep++;
          }
        check(shore > g.size * 8, `wide beaches (${shore} sand tiles)`);
        check(wade > 0 && deep > 0, `the sea is shallow near the beach (${wade} wadeable tiles), then deep`);
        let pair: [number, number, number, number] | null = null;
        let best = Infinity;
        for (let z = 1; z < g.size - 1; z++)
          for (let x = 1; x < g.size - 1; x++) {
            if (g.tile(x, z) !== Tile.Shore || !g.walkableTile(x, z)) continue;
            for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
              const wx = x + dx * 2, wz = z + dz * 2;
              if (g.tile(x + dx, z + dz) !== Tile.Sea || !g.wadeableTile(x + dx, z + dz) || !g.wadeableTile(wx, wz)) continue;
              const d = Math.hypot(x - A.x, z - A.z);
              if (d < best) { best = d; pair = [x, z, dx, dz]; }
            }
          }
        check(!!pair, 'found a beach with shallow water in front');
        if (pair && (await A.walkTo(pair[0], pair[1], false))) {
          A.inbox = A.inbox.filter((m) => m.t !== 'corr');
          for (let i = 1; i <= 4; i++) {
            A.x += pair[2] * 0.4;
            A.z += pair[3] * 0.4;
            A.send({ t: 'move', seq: ++A.seq, x: A.x, z: A.z, r: 0 });
            await sleep(110);
          }
          await sleep(200);
          const corrected = A.inbox.some((m) => m.t === 'corr');
          const tx = Math.floor(A.x), tz = Math.floor(A.z);
          check(!corrected && g.tile(tx, tz) === Tile.Sea, 'waded into the shallow sea');
          check(g.surfaceY(A.x, A.z) < SEA_LEVEL - 0.1 && g.surfaceY(A.x, A.z) >= WADE_FLOOR, `standing in the water (floor ${g.surfaceY(A.x, A.z).toFixed(2)})`);
          // Back to the beach.
          for (let i = 0; i < 4; i++) {
            A.x -= pair[2] * 0.4;
            A.z -= pair[3] * 0.4;
            A.send({ t: 'move', seq: ++A.seq, x: A.x, z: A.z, r: 0 });
            await sleep(110);
          }
        }
        check(!g.walkable(0.5, 0.5) && !g.wadeableTile(0, 0), 'the deep sea is still off limits');
        // The pier reaches dry sand: a gangway from the deck down onto the beach.
        let gang: ReturnType<typeof g.dockRamp> = null;
        for (let z = 0; z < g.size && !gang; z++) for (let x = 0; x < g.size && !gang; x++) gang = g.dockRamp(x + 0.5, z + 0.5);
        check(!!gang && gang.to >= SEA_LEVEL, `the dock's gangway lands on dry sand (${gang?.to.toFixed(2)})`);
      }
      // A bridge across the river.
      A.send({ t: 'dev', cmd: 'kit', args: [] });
      await sleep(300);
      // The rules on a hand-made river first: 2 tiles of water between two banks.
      {
        const n = 8, tiles = new Uint8Array(n * n).fill(Tile.Ground);
        for (let z = 0; z < n; z++) tiles[z * n + 3] = tiles[z * n + 4] = Tile.River;
        const tg = new Grid(n, tiles);
        check(placeError(tg, 'bridge_ew', 2, 2) === null && placeError(tg, 'bridge_ns', 2, 2) !== null && placeError(tg, 'bridge_ew_long', 2, 2) !== null, 'bridge placement rules (ends on banks, middle over water)');
        tg.addBuilding({ id: 'tb', type: 'bridge_ew', x: 2, z: 2, w: 4, h: 2, completeAt: 0 });
        check(tg.walkableTile(3, 2) && tg.stepOk(2, 2, 3, 2) && tg.stepOk(4, 2, 5, 2) && !tg.walkableTile(3, 4), 'a bridge makes its water walkable (only there)');
      }
      type BT = 'bridge_ns' | 'bridge_ew' | 'bridge_ns_long' | 'bridge_ew_long';
      let bridged: { type: BT; x: number; z: number } | null = null;
      const cands: { type: BT; x: number; z: number }[] = [];
      for (const type of ['bridge_ns', 'bridge_ew', 'bridge_ns_long', 'bridge_ew_long'] as const)
        for (let z = 1; z < g.size - 5; z++) for (let x = 1; x < g.size - 5; x++) if (!placeError(g, type, x, z)) cands.push({ type, x, z });
      cands.sort((p, q) => Math.hypot(p.x - A.x, p.z - A.z) - Math.hypot(q.x - A.x, q.z - A.z));
      for (const c of cands.slice(0, 25)) {
        const [sx, sz] = c.type.startsWith('bridge_ns') ? [c.x, c.z - 1] : [c.x - 1, c.z];
        if (!(await A.walkTo(sx, sz, false))) continue;
        const r = await A.act({ k: 'build', type: c.type, x: c.x, z: c.z });
        if (r.ok) { bridged = c; break; }
      }
      if (!cands.length) console.log('  (no free bridge spot on this island’s river – trees or uneven banks)');
      else check(!!bridged, `built a bridge over the river ${bridged ? `(${bridged.type})` : `(${cands.length} spots)`}`);
      if (bridged) {
        const len = bridged.type.endsWith('long') ? 5 : 4;
        const [ex, ez] = bridged.type.startsWith('bridge_ns') ? [bridged.x, bridged.z + len] : [bridged.x + len, bridged.z];
        const corr0 = A.inbox.filter((m) => m.t === 'corr').length;
        const walked = await A.walkTo(ex, ez, false);
        await sleep(300);
        check(walked && A.inbox.filter((m) => m.t === 'corr').length === corr0 && Math.floor(A.x) === ex && Math.floor(A.z) === ez, 'walked across the bridge to the other bank');
      }
      // River fishing gives river fish.
      let rs: [number, number] | null = null, rc: [number, number] | null = null;
      outerR: for (let z = 1; z < g.size - 1; z++) for (let x = 1; x < g.size - 1; x++) {
        if (!g.walkableTile(x, z) || g.bridges[z * g.size + x]) continue;
        for (const [dx, dz] of DIRS) if (g.tile(x + dx, z + dz) === Tile.River) { rs = [x, z]; rc = [x + dx, z + dz]; if (await A.walkTo(x, z, false)) break outerR; rs = null; }
      }
      if (rs && rc) {
        A.inbox = A.inbox.filter((m) => m.t !== 'bite' && m.t !== 'fish'); // forget earlier casts
        const c = await A.act({ k: 'cast', x: rc[0], z: rc[1] });
        if (c.ok && !c.msg) {
          const bite = await A.wait('bite', () => true, 8000);
          A.send({ t: 'act', seq: ++A.seq, a: { k: 'reel', castId: bite.castId } });
          const f = await A.wait('fish', () => true, 3000).catch(() => null);
          check(!!f?.item && FISH.find((x) => x.id === f.item)?.water === 'river', `river fishing catches river fish (${f?.item})`);
        } else console.log('  cast:', c.err ?? c.msg);
      }
      // Things wash ashore.
      A.send({ t: 'dev', cmd: 'beach', args: ['4'] });
      const wash = await A.wait('oAdd', (m) => m.o.some((o) => o.kind === 'washed')).catch(() => null);
      const item = wash?.o.find((o) => o.kind === 'washed');
      check(!!item, `something washed ashore (${item?.item})`);
      if (item && (await A.walkTo(item.x, item.z))) {
        const r = await A.act({ k: 'forage', id: item.id });
        check(r.ok && !!r.gained?.[item.item!], 'picked it up');
      }
      // Message in a bottle.
      A.send({ t: 'dev', cmd: 'give', args: ['message_bottle', '1'] });
      await sleep(200);
      let atSea = false;
      for (let z = 1; z < g.size - 1 && !atSea; z++) for (let x = 1; x < g.size - 1 && !atSea; x++)
        if (g.tile(x, z) === Tile.Shore && DIRS.some(([dx, dz]) => g.tile(x + dx, z + dz) === Tile.Sea) && Math.hypot(x - A.x, z - A.z) < 25) atSea = await A.walkTo(x, z, false);
      const thrown = await A.act({ k: 'bottle', text: 'Hello from Alice' });
      check(thrown.ok, `message in a bottle thrown ${thrown.err ?? ''}`);
      A.send({ t: 'dev', cmd: 'bottles', args: [] });
      await sleep(400);
      let finder: Bot | null = null;
      for (const bot of [B, C]) {
        const v = await http('GET', `/api/admin/islands/${bot.self.homeIslandId}`, undefined, A.token);
        if ((v.body.record as { bottles?: unknown[] }).bottles?.length) finder = bot;
      }
      check(!!finder, `the bottle washed up on another player’s island (${finder?.name})`);
      if (finder) {
        finder.send({ t: 'travel', to: { kind: 'home' } });
        await finder.wait('room', (m) => m.room.id === finder!.self.homeIslandId);
        await sleep(300);
        const bottle = [...finder.objects.values()].find((o) => o.kind === 'washed' && o.bottle);
        if (bottle && (await finder.walkTo(bottle.x, bottle.z))) {
          await finder.act({ k: 'forage', id: bottle.id });
          const mail = await finder.wait('mail', (m) => m.list.some((l) => l.text === 'Hello from Alice')).catch(() => null);
          check(!!mail, 'its finder reads the message in their letters');
        } else check(false, 'bottle lies on the finder’s beach');
      }
    }

    console.log('Builders & residents');
    {
      B.send({ t: 'travel', to: { kind: 'island', id: A.self.homeIslandId } });
      await B.wait('room', (m) => m.room.id === A.self.homeIslandId);
      const spot = [Math.floor(B.x) + 1, Math.floor(B.z)];
      check(!(await B.act({ k: 'pave', x: spot[0], z: spot[1], path: 2 })).ok, 'visitors can’t build');
      B.send({ t: 'dev', cmd: 'kit', args: [] }); // stone for gravel paths
      await sleep(300);
      A.send({ t: 'role', id: B.self.id, role: 'builder' });
      check(!!(await B.wait('room', (m) => m.room.role === 'builder').catch(() => null)), 'owner made Bob a builder');
      let paved = false;
      outerP: for (let r = 1; r <= 5; r++) for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
        const x = Math.floor(B.x) + dx, z = Math.floor(B.z) + dz;
        if (B.grid.canPave(x, z) && !B.grid.path(x, z)) { paved = (await B.act({ k: 'pave', x, z, path: 2 })).ok; if (paved) break outerP; }
      }
      check(paved, 'builders can build (paths) on the island');
      A.send({ t: 'role', id: B.self.id, role: 'resident' });
      check(!!(await B.wait('room', (m) => m.room.role === 'resident' && m.room.canHarvest).catch(() => null)), 'owner made Bob a resident (can gather too)');
      const tentB = await B.build('tent');
      check(tentB.ok, `a resident builds their own tent ${tentB.err ?? ''}`);
      const mine = B.room.buildings.find((b) => b.type === 'tent' && b.ownerId === B.self.id);
      check(!!mine, 'the tent belongs to the resident');
      A.send({ t: 'role', id: B.self.id, role: 'none' });
      check(!!(await B.wait('room', (m) => m.room.role === 'visitor').catch(() => null)), 'owner can take the rights back');
    }

    console.log('Location & time zone');
    {
      A.send({ t: 'geo', lat: 35.7, lon: 139.7, tz: 'Asia/Tokyo' });
      const self = await A.wait('self', (m) => m.you.geo.tz === 'Asia/Tokyo').catch(() => null);
      check(!!self && self.you.geo.lat === 35.5, 'location saved (rounded to ~50 km)');
      check(!!(await A.wait('env', (m) => m.env.geo.tz === 'Asia/Tokyo').catch(() => null)), 'the island now follows that time zone');
      A.send({ t: 'geo', lat: 0, lon: 0, tz: 'Not/AZone' });
      check(!!(await A.wait('toast', (m) => /Unknown time zone/.test(m.text)).catch(() => null)), 'unknown time zones are refused');
    }

    console.log('News');
    {
      const n0 = await http('GET', '/api/news');
      check((n0.body.news as { title: string }[]).some((n) => /Welcome/.test(n.title)), 'start screen has a welcome news box');
      const created = await http('POST', '/api/admin/news', { title: 'Patch 1.1', body: 'Rivers!', icon: '🏞️', pinned: true }, A.token);
      check(created.status === 200, 'admin writes a news box');
      const n1 = await http('GET', '/api/news');
      check((n1.body.news as { title: string; pinned: boolean }[])[0]?.title === 'Patch 1.1', 'pinned news comes first');
      await http('PUT', `/api/admin/news/${created.body.id}`, { title: 'Patch 1.1', body: 'x', published: false }, A.token);
      check(!((await http('GET', '/api/news')).body.news as { title: string }[]).some((n) => n.title === 'Patch 1.1'), 'drafts stay hidden');
      check((await http('POST', '/api/admin/news', { title: 'x', body: 'y' })).status === 401, 'only admins edit news');
    }

    console.log('Accounts');
    {
      const reg = await http('POST', '/api/register', { username: 'Tester_1', password: 'correct horse' });
      check(reg.status === 200 && !!reg.body.token, 'register with username & password');
      check((await http('POST', '/api/register', { username: 'tester_1', password: 'whatever123' })).status === 409, 'usernames are unique (case-insensitive)');
      check((await http('POST', '/api/register', { username: 'x', password: 'whatever123' })).status === 400, 'too-short username refused');
      check((await http('POST', '/api/login', { username: 'tester_1', password: 'wrong password' })).status === 401, 'wrong password refused');
      const login = await http('POST', '/api/login', { username: 'TESTER_1', password: 'correct horse' });
      check(login.status === 200 && login.body.token !== reg.body.token, 'login issues a new token');
      const me = await http('GET', '/api/me', undefined, login.body.token as string);
      check(me.body.username === 'Tester_1', '/api/me knows who you are');
      await http('POST', '/api/logout', {}, login.body.token as string);
      check((await http('GET', '/api/me', undefined, login.body.token as string)).status === 401, 'logout revokes the token');
    }

    console.log('Admin API');
    {
      const list = await http('GET', '/api/admin/players', undefined, A.token);
      check(list.status === 200 && (list.body.players as { id: string }[]).some((p) => p.id === A.self.id), 'admin lists players (everyone is admin in dev mode)');
      const r1 = await http('PATCH', `/api/admin/players/${A.self.id}`, { coins: 12345, inv: { wood: 7, bogus_item: 1 } }, A.token);
      check(r1.status === 400, 'admin edits are validated (unknown item)');
      await http('PATCH', `/api/admin/players/${A.self.id}`, { coins: 12345 }, A.token);
      const invMsg = await A.wait('inv', (m) => m.coins === 12345).catch(() => null);
      check(!!invMsg, 'online player sees admin coin change immediately');
      const isl = await http('GET', `/api/admin/islands/${A.self.homeIslandId}`, undefined, A.token);
      check(isl.status === 200 && (isl.body.size as number) === 72 && typeof isl.body.tiles === 'string', 'admin island view has the map data');
      const ren = await http('PATCH', `/api/admin/islands/${A.self.homeIslandId}`, { name: 'Admin Isle' }, A.token);
      check(ren.status === 200, 'admin renamed the island');
      const roomMsg = await A.wait('room', (m) => m.room.name === 'Admin Isle').catch(() => null);
      check(!!roomMsg, 'players on the island get the reloaded island');
      const bad = await http('PATCH', `/api/admin/islands/${A.self.homeIslandId}`, { terrain: { tiles: '123', levels: '0', ramps: '0' } }, A.token);
      check(bad.status === 400, 'bad terrain data refused');
      const D = new Bot('D');
      await D.connect();
      await D.create('desert', 'Dora');
      await http('PATCH', `/api/admin/players/${D.self.id}`, { banned: { reason: 'testing' } }, A.token);
      const banned = await D.wait('err', (m) => m.code === 'kicked' || m.code === 'banned').catch(() => null);
      check(!!banned, 'banned player is disconnected');
      const D2 = new Bot('D2');
      D2.ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
      await new Promise((res) => (D2.ws.onopen = res));
      D2.ws.onmessage = (ev) => D2.onMsg(JSON.parse(String(ev.data)));
      D2.send({ t: 'hello', token: D.token, v: PROTOCOL_VERSION });
      check(!!(await D2.wait('err', (m) => m.code === 'banned').catch(() => null)), 'banned player can’t log back in');
      const audit = await http('GET', '/api/admin/audit', undefined, A.token);
      check((audit.body.entries as { action: string }[]).some((e) => e.action === 'player.edit'), 'admin actions are in the audit log');
      check((await http('GET', '/api/admin/players', undefined, 'nonsense')).status === 401, 'admin API needs a login');
    }

    console.log('Game data');
    {
      const gd = await http('GET', '/api/dev/gamedata', undefined, A.token);
      const items = (gd.body.current as { items: { id: string; buy?: number }[] }).items;
      items.find((i) => i.id === 'bench')!.buy = 999;
      const put = await http('PUT', '/api/dev/gamedata/items', { data: items }, A.token);
      check(put.status === 200, 'game data table saved');
      const pub = await http('GET', '/api/gamedata');
      check((pub.body.items as { id: string; buy?: number }[] | undefined)?.find((i) => i.id === 'bench')?.buy === 999, 'clients receive the changed price');
      const vill = (gd.body.current as { villagers: unknown[] }).villagers.slice(1);
      check((await http('PUT', '/api/dev/gamedata/villagers', { data: vill }, A.token)).status === 400, 'removing a built-in villager is refused');
      check((await http('DELETE', '/api/dev/gamedata/items', undefined, A.token)).status === 200 && !('items' in (await http('GET', '/api/gamedata')).body), 'table reset to built-in data');
    }

    console.log('Abuse protection');
    for (let i = 0; i < 200; i++) C.send({ t: 'ping', ct: i });
    await sleep(500);
    const pongs = C.inbox.filter((m) => m.t === 'pong').length;
    check(pongs < 200 && pongs > 0, `rate limiter dropped excess messages (${pongs}/200 answered)`);
  } catch (e) {
    failures++;
    console.error(e);
  } finally {
    server.kill('SIGINT');
    await sleep(400);
    const saved = (dbAll('SELECT id FROM islands') as unknown[]).length;
    check(saved >= 3, `state persisted to the database (${saved} islands)`);
    if (terraSpot) {
      const rec = JSON.parse((dbAll('SELECT data FROM islands WHERE id = ?', terraIsland)[0] as { data: string }).data);
      const lv = rec.terrain ? decodeTiles(rec.terrain.levels)[terraSpot[1] * (rec.size ?? 48) + terraSpot[0]] : -1;
      check(rec.size === 72 && lv === 1, 'terraformed terrain is saved with the island');
      check(!rec.objects.some((o: { kind: string }) => o.kind === 'bird'), 'birds are not saved with the island');
    }
    if (hotbarPlayer) {
      const pl = JSON.parse((dbAll('SELECT data FROM players WHERE id = ?', hotbarPlayer)[0] as { data: string }).data);
      check(!('passHash' in pl) || typeof pl.passHash === 'string', 'player rows stored as JSON');
      check((dbAll('SELECT hash FROM tokens WHERE player_id = ?', hotbarPlayer) as { hash: string }[]).every((t) => /^[0-9a-f]{64}$/.test(t.hash)), 'only token hashes are stored');
      check(JSON.stringify(pl.hotbar) === JSON.stringify(hotbarExpected), 'hotbar layout is saved');
      check(Object.keys(pl.album?.birds ?? {}).length > 0, 'album is saved');
    }
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
  await productionChecks().catch((e) => {
    failures++;
    console.error(e);
  });
  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
}

main();
