// End-to-end test: boots a real server (DEV_FAST) and drives it with bot
// clients over WebSockets, exercising the authoritative rules.
//   npm test   (from the repo root or /server)

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  Grid, decodeTiles, isWaterTile, BUILDINGS, PROTOCOL_VERSION,
  type RoomView, type ServerMessage, type WorldObject, type BuildingType,
} from '@hearthwood/shared';

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = 8800 + Math.floor(Math.random() * 100);
const BASE = `http://127.0.0.1:${PORT}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hearthwood-test-'));

let failures = 0;
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
      this.grid = new Grid(m.room.size, decodeTiles(m.room.tiles), decodeTiles(m.room.levels), decodeTiles(m.room.ramps));
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

  freeSpot(type: BuildingType) {
    const { w, h } = BUILDINGS[type];
    let best: [number, number] | null = null;
    let bd = Infinity;
    for (let z = 1; z < this.grid.size - h; z++)
      for (let x = 1; x < this.grid.size - w; x++) {
        if (!this.grid.canPlace(x - 1, z - 1, w + 2, h + 2)) continue;
        if (this.grid.level(x, z) !== this.grid.level(Math.floor(this.x), Math.floor(this.z))) continue;
        const d = Math.hypot(x + w / 2 - this.x, z + h / 2 - this.z);
        if (d < bd && d > 2.5) { bd = d; best = [x, z]; }
      }
    return best;
  }

  async build(type: BuildingType) {
    const spot = this.freeSpot(type);
    if (!spot) return { ok: false, err: 'no spot' };
    await this.walkTo(spot[0] - 1, spot[1] + Math.floor(BUILDINGS[type].h / 2), false);
    return this.act({ k: 'build', type, x: spot[0], z: spot[1] });
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

    for (const b of ['tent', 'campfire', 'workbench'] as const) {
      const res = await A.build(b);
      check(res.ok, `built ${b}${res.ok ? '' : ` (${res.err})`}`);
    }
    const q = await A.wait('quest', (m) => m.q.chapter === 2, 3000).catch(() => null);
    check(!!q, 'chapter 1 complete → chapter 2 (starter house)');

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
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
}

main();
