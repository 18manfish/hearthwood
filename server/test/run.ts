// End-to-end test: boots a real server (DEV_FAST) and drives it with bot
// clients over WebSockets, exercising the authoritative rules.
//   npm test   (from the repo root or /server)

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  Grid, decodeTiles, isWaterTile, BUILDINGS, PROTOCOL_VERSION, ISLAND_SIZE, TERRA_REACH, Tile, applyTerrain, distToTile,
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
  constructor(readonly name: string) {}

  async connect() {
    const r = await fetch(`${BASE}/api/register`, { method: 'POST' });
    const { token } = (await r.json()) as { token: string };
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
      if (!this.room.buildings.find((x) => x.id === b.id)) {
        this.room.buildings.push(b);
        this.grid.addBuilding(b);
      }
    }
    if (m.t === 'inv') this.inv = m.inv;
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
    return { ok: false, err: 'no reachable spot' };
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

async function main() {
  const server = spawn(process.execPath, ['--import', 'tsx', path.join(here, '../src/index.ts')], {
    env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir, DEV_FAST: '1' },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  await new Promise<void>((res) => server.stdout!.on('data', (d) => String(d).includes('listening') && res()));

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
      for (let r = 2; r <= 5 && !spot; r++)
        for (let dz = -r; dz <= r && !spot; dz++)
          for (let dx = -r; dx <= r && !spot; dx++) {
            const x = Math.floor(A.x) + dx, z = Math.floor(A.z) + dz;
            let ok = true;
            for (let zz = z - 2; zz <= z + 3 && ok; zz++) for (let xx = x - 2; xx <= x + 2 && ok; xx++) ok = flat(xx, zz);
            const away = (tx: number, tz: number) => Math.hypot(tx + 0.5 - A.x, tz + 0.5 - A.z) > 1.3;
            if (ok && away(x, z) && away(x, z + 1) && distToTile(A.x, A.z, x, z) <= TERRA_REACH - 0.5 && distToTile(A.x, A.z, x, z + 1) <= TERRA_REACH - 0.5) spot = [x, z];
          }
      check(!!spot, 'found a flat spot to terraform');
      if (spot) {
        const [tx, tz] = spot;
        const noTool = await A.act({ k: 'terra', op: 'raise', x: tx, z: tz });
        check(!noTool.ok && /Pick/.test(noTool.err ?? ''), 'terraforming needs a Landscaping Pick');
        A.send({ t: 'dev', cmd: 'give', args: ['landscaping_pick', '1'] });
        A.send({ t: 'dev', cmd: 'give', args: ['water_spade', '1'] });
        await sleep(300);
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

    console.log('Tent interior');
    const islandId = A.room.id;
    const tent = A.room.buildings.find((b) => b.type === 'tent')!;
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
    }
    await exitTo(A);
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
    const saved = fs.readdirSync(path.join(dataDir, 'islands')).length;
    check(saved >= 3, `state persisted to disk (${saved} islands)`);
    if (terraSpot) {
      const rec = JSON.parse(fs.readFileSync(path.join(dataDir, 'islands', `${terraIsland}.json`), 'utf8'));
      const lv = rec.terrain ? decodeTiles(rec.terrain.levels)[terraSpot[1] * (rec.size ?? 48) + terraSpot[0]] : -1;
      check(rec.size === 72 && lv === 1, 'terraformed terrain is saved with the island');
    }
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
}

main();
