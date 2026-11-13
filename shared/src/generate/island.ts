// Deterministic island generation from a seed: land, beaches, cliffs & ramps, rivers,
// ponds, the dock, and scattered trees, rocks and flowers. Output must stay bit-identical.

import { type BiomeId, BIOMES, TREES } from '../data/biomes.ts';
import { fbm2D, Rng } from '../rng.ts';
import { ISLAND_SIZE, LEGACY_ISLAND_SIZE } from '../world/constants.ts';
import { Grid } from '../world/grid.ts';
import { type Building, type IslandLayout, type WorldObject } from '../world/objects.ts';
import { classifyWater, DIRS, Tile, tileAt } from '../world/tiles.ts';

/** Land-mask value where the sea starts now (beaches run from 0.74; the sea used to start at 0.83). */
const BEACH_OUTER = 0.92;

export interface GenOptions {
  /** Shared hubs get a plaza and fewer resources. */
  variant?: 'home' | 'shared' | 'tour';
  /** Cliffs & ramps (new islands). */
  elevation?: boolean;
  /** Side length in tiles (default ISLAND_SIZE). Features scale with it. */
  size?: number;
}

/** Deterministic island generation from a seed. */
export function generateIsland(seed: number, biome: BiomeId, opts: GenOptions = {}): IslandLayout {
  const variant = opts.variant ?? 'home';
  const def = BIOMES[biome];
  const size = opts.size ?? ISLAND_SIZE;
  /** Feature scale relative to the original 48-tile islands. */
  const S = size / LEGACY_ISLAND_SIZE;
  const tiles = new Uint8Array(size * size);
  const levels = new Uint8Array(size * size);
  const ramps = new Uint8Array(size * size);
  const rng = new Rng(seed);
  const c = size / 2;

  // Land mask: radial falloff perturbed by noise.
  for (let z = 0; z < size; z++)
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5 - c) / c;
      const dz = (z + 0.5 - c) / c;
      const d = Math.sqrt(dx * dx + dz * dz);
      const n = fbm2D(seed, x / (9 * S), z / (9 * S), 3) - 0.5;
      const v = d + n * 0.32;
      tiles[z * size + x] = v < 0.74 ? Tile.Ground : v < 0.83 ? Tile.Shore : Tile.Sea;
    }

  const set = (x: number, z: number, t: Tile) => {
    if (x >= 0 && z >= 0 && x < size && z < size) tiles[z * size + x] = t;
  };
  const get = (x: number, z: number) => tileAt(tiles, size, x, z);

  const carveDisc = (cx: number, cz: number, r: number, t: Tile, onlyLand = true) => {
    for (let z = Math.floor(cz - r); z <= cz + r; z++)
      for (let x = Math.floor(cx - r); x <= cx + r; x++) {
        const ddx = x + 0.5 - cx;
        const ddz = z + 0.5 - cz;
        if (ddx * ddx + ddz * ddz <= r * r && (!onlyLand || get(x, z) !== Tile.Sea)) set(x, z, t);
      }
  };

  // Water features.
  const water = variant === 'shared' ? 'pond' : def.water;
  const oasisX = c - 6 * S, oasisZ = c - 4 * S;
  if (water === 'pond') carveDisc(c - 9 * S, c - 7 * S, 3.2 * S, Tile.Pond);
  if (water === 'oasis') {
    carveDisc(oasisX, oasisZ, 6.5 * S, Tile.Ground);
    carveDisc(oasisX, oasisZ, 5 * S, Tile.Pond);
  }
  if (water === 'lagoon') {
    carveDisc(c + 13 * S, c - 2 * S, 7 * S, Tile.Shore, true);
    carveDisc(c + 14 * S, c - 2 * S, 5.5 * S, Tile.Sea, false);
  }
  // New (72-tile) islands get a proper river that flows down the cliffs into the sea
  // (carved after the cliffs, below); 48-tile islands keep their original layout.
  const legacy = size <= LEGACY_ISLAND_SIZE;
  const riverSource = !legacy && variant !== 'shared' && RIVER_BIOMES.includes(biome)
    ? biome === 'grassland' ? { x: c + 7 * S, z: c - 6 * S } : biome === 'tropical' ? { x: c - 6 * S, z: c - 5 * S } : { x: c - 4 * S, z: c - 7 * S }
    : null;
  if (!legacy && variant !== 'shared' && (water === 'river')) carveDisc(c + 8 * S, c + 3 * S, 2.4 * S, Tile.Pond);
  if (water === 'river' && legacy) {
    let rx = c - 4 * S + rng.range(-3, 3);
    const end = c - 8 * S;
    for (let z = 0; z <= end; z++) {
      rx += (fbm2D(seed + 77, z / 6, 0, 2) - 0.5) * 1.6;
      for (let w = -1; w <= 0; w++) if (get(Math.floor(rx) + w, z) !== Tile.Sea) set(Math.floor(rx) + w, z, Tile.Pond);
    }
    carveDisc(rx, end, 2.6 * S, Tile.Pond);
  }

  // Dock on the south coast, straight below the centre.
  const dockX = Math.floor(c) - 1;
  let beachZ = size - 1;
  while (beachZ > 0 && get(dockX, beachZ) === Tile.Sea && get(dockX + 1, beachZ) === Tile.Sea) beachZ--;
  for (let dz = -1; dz <= 0; dz++) {
    set(dockX, beachZ + dz, Tile.Shore);
    set(dockX + 1, beachZ + dz, Tile.Shore);
  }
  const dock: Building = { id: 'b_dock', type: 'dock', x: dockX, z: beachZ + 1, w: 2, h: 3, completeAt: 0 };
  for (let dz = 0; dz < 3; dz++) {
    set(dockX, beachZ + 1 + dz, Tile.Dock);
    set(dockX + 1, beachZ + 1 + dz, Tile.Dock);
  }
  const spawn = { x: dockX + 1, z: beachZ - 0.5 };

  const clearX = c;
  const clearZ = beachZ - 7;
  const inClearing = (x: number, z: number, r = 6.5) => {
    const ddx = x + 0.5 - clearX;
    const ddz = z + 0.5 - clearZ;
    return ddx * ddx + ddz * ddz < r * r || (Math.abs(x + 0.5 - (dockX + 1)) < 2 && z > clearZ);
  };

  if (opts.elevation && variant !== 'shared') carveCliffs(seed, size, tiles, levels, ramps, (x, z) => inClearing(x, z, 8.5), spawn, riverSource);
  else if (riverSource) carveRiver(seed, size, tiles, levels, riverSource.x, riverSource.z, S);

  const objects: WorldObject[] = [];
  let nid = 1;
  const taken = new Uint8Array(size * size);
  const grid = new Grid(size, tiles, levels, ramps);
  const nearTaken = (x: number, z: number, r = 1) => {
    for (let dz = -r; dz <= r; dz++)
      for (let dx = -r; dx <= r; dx++) {
        const tx = x + dx, tz = z + dz;
        if (tx >= 0 && tz >= 0 && tx < size && tz < size && taken[tz * size + tx]) return true;
      }
    return false;
  };
  const free = (x: number, z: number) => get(x, z) === Tile.Ground && !grid.reserved[z * size + x];
  const place = (o: Omit<WorldObject, 'id'>) => {
    taken[o.z * size + o.x] = 1;
    objects.push({ id: `o${nid++}`, ...o });
  };

  // Trees.
  const density = def.treeDensity * (variant === 'tour' ? 1.8 : variant === 'shared' ? 0.6 : 1);
  for (let z = 1; z < size - 1; z++)
    for (let x = 1; x < size - 1; x++) {
      if (!free(x, z) || inClearing(x, z)) continue;
      if (variant === 'shared' && Math.abs(x - c) < 8 && Math.abs(z - c) < 8) continue;
      const clump = fbm2D(seed + 31, x / 7, z / 7, 2);
      let p = density * (0.4 + clump * 1.6) * 2.2;
      if (water === 'oasis') {
        const ddx = x + 0.5 - oasisX, ddz = z + 0.5 - oasisZ;
        const d = Math.sqrt(ddx * ddx + ddz * ddz);
        if (d > 5 * S && d < 7.5 * S) p = 0.35;
      }
      if (!rng.chance(p) || nearTaken(x, z)) continue;
      const species = rng.weighted(def.trees, (t) => t.weight)!.species;
      place({ kind: 'tree', x, z, species, stage: 2, hits: 0, fruit: TREES[species].fruit ? rng.int(0, 3) : 0 });
    }

  const randomFreeGround = (avoidClearing = true, spacing = 1): { x: number; z: number } | null => {
    for (let tries = 0; tries < 200; tries++) {
      const x = rng.int(1, size - 2);
      const z = rng.int(1, size - 2);
      if (!free(x, z)) continue;
      if (avoidClearing && inClearing(x, z)) continue;
      if (nearTaken(x, z, spacing)) continue;
      return { x, z };
    }
    return null;
  };

  const area = S * S;
  const rocks = Math.round((variant === 'tour' ? def.rockCount + 6 : variant === 'shared' ? 2 : def.rockCount) * area);
  for (let i = 0; i < rocks; i++) {
    const p = randomFreeGround(true, 2);
    if (p) place({ kind: 'rock', ...p, hits: 0 });
  }
  const bushes = Math.round((variant === 'tour' ? 18 : variant === 'shared' ? 4 : 12) * area);
  for (let i = 0; i < bushes; i++) {
    const p = randomFreeGround(true, 1);
    if (p) place({ kind: 'bush', ...p, ripe: true });
  }
  for (let i = 0; i < Math.round(6 * area); i++) {
    const p = randomFreeGround(false, 1);
    if (p) place({ kind: 'flower', ...p });
  }

  if (variant === 'shared') {
    const deco: [string, number, number][] = [
      ['lamp', -4, -4], ['lamp', 4, -4], ['lamp', -4, 4], ['lamp', 4, 4],
      ['bench', -2, -5], ['bench', 2, -5], ['picnic_table', 0, 0], ['flower_pot', -5, 0], ['flower_pot', 5, 0],
    ];
    for (const [itemId, ox, oz] of deco) {
      const x = Math.floor(c + ox), z = Math.floor(c + oz);
      if (get(x, z) === Tile.Ground) place({ kind: 'furniture', x, z, item: itemId, rot: 0 });
    }
  }

  // Wide beaches: the shallows just outside the old sand line become beach too
  // (twice as deep, without taking any land). Rivers are carried across the new
  // sand to the sea, and the water in front of the dock stays open.
  const beachBand = new Uint8Array(size * size);
  const vAt = (x: number, z: number) => {
    const dx = (x + 0.5 - c) / c, dz = (z + 0.5 - c) / c;
    return Math.sqrt(dx * dx + dz * dz) + (fbm2D(seed, x / (9 * S), z / (9 * S), 3) - 0.5) * 0.32;
  };
  for (let z = 2; z < size - 2; z++)
    for (let x = 2; x < size - 2; x++) {
      const i = z * size + x;
      if (tiles[i] !== Tile.Sea || vAt(x, z) >= BEACH_OUTER) continue;
      // A rounded little bay around the pier (not a straight channel), so the beach curves into it.
      const bx = x + 0.5 - (dockX + 1), bz = Math.min(Math.max(z + 0.5, beachZ + 1.5), beachZ + 4.5) - (z + 0.5);
      if (Math.hypot(bx, bz) < 2.4 + (fbm2D(seed + 3, x / 3, z / 3, 2) - 0.5) * 0.8) continue;
      tiles[i] = Tile.Shore;
      beachBand[i] = 1;
    }
  // Each river mouth runs straight on across the new sand: shortest path to the sea.
  const mouths: number[] = [];
  for (let i = 0; i < size * size; i++) {
    if (tiles[i] !== Tile.River || levels[i] !== 0) continue;
    const x = i % size, z = Math.floor(i / size);
    if (DIRS.some(([dx, dz]) => beachBand[(z + dz) * size + x + dx] === 1)) mouths.push(i);
  }
  for (const start of mouths) {
    const prev = new Map<number, number>([[start, -1]]);
    const q = [start];
    let end = -1;
    for (let k = 0; k < q.length && end < 0; k++) {
      const i = q[k], x = i % size, z = Math.floor(i / size);
      for (const [dx, dz] of DIRS) {
        const nx = x + dx, nz = z + dz;
        if (nx < 1 || nz < 1 || nx >= size - 1 || nz >= size - 1) continue;
        const j = nz * size + nx;
        if (prev.has(j)) continue;
        if (tiles[j] === Tile.Sea) { end = i; break; }
        if (!beachBand[j]) continue;
        prev.set(j, i);
        q.push(j);
      }
    }
    for (let i = end; i >= 0 && i !== start; i = prev.get(i) ?? -1) {
      tiles[i] = Tile.River;
      beachBand[i] = 2;
    }
  }

  classifyWater(size, tiles);
  return { size, tiles, levels, ramps, objects, buildings: [dock], spawn, beachBand };
}

const RIVER_BIOMES: BiomeId[] = ['grassland', 'tropical', 'nordic', 'forest_edge', 'jungle'];

/**
 * A river from an inland lake to the north coast. It takes the level of the
 * lowest bank it passes, never flowing uphill – where it drops a cliff level
 * there's a waterfall.
 */
function carveRiver(seed: number, size: number, tiles: Uint8Array, levels: Uint8Array, sx: number, sz: number, S: number) {
  const idx = (x: number, z: number) => z * size + x;
  const inB = (x: number, z: number) => x >= 1 && z >= 0 && x < size - 1 && z < size;
  const land = (x: number, z: number) => inB(x, z) && (tiles[idx(x, z)] === Tile.Ground || tiles[idx(x, z)] === Tile.Shore);
  // Source lake: up on the highest plateau near the preferred spot, so the river
  // has cliffs to tumble down.
  const r = 2.2 * S;
  const disc = (cx: number, cz: number) => {
    const out: number[] = [];
    for (let z = Math.floor(cz - r); z <= cz + r; z++)
      for (let x = Math.floor(cx - r); x <= cx + r; x++) {
        const dx = x + 0.5 - cx, dz = z + 0.5 - cz;
        if (dx * dx + dz * dz <= r * r && inB(x, z)) out.push(idx(x, z));
      }
    return out;
  };
  let best = -1;
  const search = Math.round(9 * S);
  for (let z = Math.floor(sz - search); z <= sz + search; z += 2)
    for (let x = Math.floor(sx - search); x <= sx + search; x += 2) {
      if (!land(x, z) || tiles[idx(x, z)] !== Tile.Ground) continue;
      const L = levels[idx(x, z)];
      const same = disc(x + 0.5, z + 0.5).filter((i) => tiles[i] === Tile.Ground && levels[i] === L).length;
      const score = L * 1000 + same * 10 - Math.hypot(x - sx, z - sz);
      if (score > best) {
        best = score;
        sx = x + 0.5;
        sz = z + 0.5;
      }
    }
  const lakeL = levels[idx(Math.floor(sx), Math.floor(sz))];
  const lake = disc(sx, sz).filter((i) => tiles[i] === Tile.Ground && levels[i] === lakeL);
  if (!lake.length) return;
  for (const i of lake) {
    tiles[i] = Tile.River;
    levels[i] = lakeL;
  }
  // Flow north to the sea, two tiles wide.
  let rx = sx;
  let prev = lakeL;
  for (let z = Math.floor(sz - r); z >= 0; z--) {
    rx += (fbm2D(seed + 77, z / 6, 0, 2) - 0.5) * 1.4;
    const x0 = Math.floor(rx) - 1;
    let L = prev;
    let reachedSea = false;
    for (const x of [x0 - 1, x0, x0 + 1, x0 + 2]) {
      if (!inB(x, z)) continue;
      const t = tiles[idx(x, z)];
      if (t === Tile.Sea) reachedSea ||= x === x0 || x === x0 + 1;
      if (t === Tile.Ground || t === Tile.River) L = Math.min(L, levels[idx(x, z)]);
      if (t === Tile.Shore) L = 0;
    }
    for (const x of [x0, x0 + 1]) {
      if (!land(x, z) && !(inB(x, z) && tiles[idx(x, z)] === Tile.River)) continue;
      tiles[idx(x, z)] = Tile.River;
      levels[idx(x, z)] = L;
    }
    prev = L;
    if (reachedSea) break;
  }
}

/**
 * Raise plateaus (level 1, small level-2 hilltops), smooth them, then add ramps
 * until every walkable tile is reachable from the spawn.
 */
function carveCliffs(
  seed: number, size: number, tiles: Uint8Array, levels: Uint8Array, ramps: Uint8Array,
  keepLow: (x: number, z: number) => boolean, spawn: { x: number; z: number },
  river: { x: number; z: number } | null = null,
) {
  const idx = (x: number, z: number) => z * size + x;
  const inB = (x: number, z: number) => x >= 0 && z >= 0 && x < size && z < size;
  const T = (x: number, z: number) => (inB(x, z) ? tiles[idx(x, z)] : Tile.Sea);
  const Lv = (x: number, z: number) => (inB(x, z) ? levels[idx(x, z)] : 0);
  const c = size / 2;

  // 1. Score ground tiles and pick thresholds by quantile.
  const scores: number[] = [];
  const score = new Float32Array(size * size).fill(-1);
  for (let z = 0; z < size; z++)
    for (let x = 0; x < size; x++) {
      if (T(x, z) !== Tile.Ground) continue;
      const dx = (x + 0.5 - c) / c, dz = (z + 0.5 - c) / c;
      const S = size / LEGACY_ISLAND_SIZE;
      const v = fbm2D(seed + 500, x / (10 * S), z / (10 * S), 3) + (0.6 - Math.sqrt(dx * dx + dz * dz)) * 0.55;
      score[idx(x, z)] = v;
      scores.push(v);
    }
  if (scores.length < 50) return;
  const sorted = [...scores].sort((a, b) => a - b);
  const t1 = sorted[Math.floor(sorted.length * 0.62)];
  const t2 = sorted[Math.floor(sorted.length * 0.9)];
  for (let z = 0; z < size; z++)
    for (let x = 0; x < size; x++) {
      const v = score[idx(x, z)];
      if (v < 0 || keepLow(x, z)) continue;
      levels[idx(x, z)] = v > t2 ? 2 : v > t1 ? 1 : 0;
    }

  smoothLevels(size, tiles, levels);
  if (river) carveRiver(seed, size, tiles, levels, river.x, river.z, size / LEGACY_ISLAND_SIZE);
  connectPlateaus(seed, size, tiles, levels, ramps, spawn);
}

/** Smooth cliff levels: no plateau touches water/sand, no thin spurs or pits, no tiny plateaus. */
export function smoothLevels(size: number, tiles: Uint8Array, levels: Uint8Array) {
  const idx = (x: number, z: number) => z * size + x;
  const inB = (x: number, z: number) => x >= 0 && z >= 0 && x < size && z < size;
  const T = (x: number, z: number) => (inB(x, z) ? tiles[idx(x, z)] : Tile.Sea);
  const Lv = (x: number, z: number) => (inB(x, z) ? levels[idx(x, z)] : 0);
  // 2. Constraints & smoothing.
  for (let pass = 0; pass < 4; pass++) {
    for (let z = 0; z < size; z++)
      for (let x = 0; x < size; x++) {
        const L = Lv(x, z);
        if (!L) continue;
        // Plateaus never touch water/sand directly and level 2 sits on level 1.
        let lower = false;
        let support = 0;
        for (let dz = -1; dz <= 1; dz++)
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dz) continue;
            if (T(x + dx, z + dz) !== Tile.Ground) lower = true;
            if (Lv(x + dx, z + dz) < L - 1) lower = true;
          }
        for (const [dx, dz] of DIRS) if (Lv(x + dx, z + dz) >= L) support++;
        if (lower || support < 2) levels[idx(x, z)] = L - 1;
      }
    // Fill pits.
    for (let z = 1; z < size - 1; z++)
      for (let x = 1; x < size - 1; x++) {
        if (T(x, z) !== Tile.Ground) continue;
        const L = Lv(x, z);
        let higher = 0;
        for (const [dx, dz] of DIRS) if (Lv(x + dx, z + dz) > L) higher++;
        if (higher >= 3) levels[idx(x, z)] = L + 1;
      }
  }

  // 3. Remove tiny plateaus.
  const component = (sx: number, sz: number, L: number, seen: Uint8Array) => {
    const out: number[] = [];
    const q = [idx(sx, sz)];
    seen[q[0]] = 1;
    while (q.length) {
      const i = q.pop()!;
      out.push(i);
      const x = i % size, z = Math.floor(i / size);
      for (const [dx, dz] of DIRS) {
        const nx = x + dx, nz = z + dz;
        if (!inB(nx, nz)) continue;
        const j = idx(nx, nz);
        if (!seen[j] && levels[j] >= L) {
          seen[j] = 1;
          q.push(j);
        }
      }
    }
    return out;
  };
  for (const L of [2, 1]) {
    const seen = new Uint8Array(size * size);
    for (let i = 0; i < size * size; i++) {
      if (seen[i] || levels[i] < L) continue;
      const comp = component(i % size, Math.floor(i / size), L, seen);
      if (comp.length < (L === 1 ? 14 : 6)) for (const j of comp) levels[j] = Math.min(levels[j], L - 1);
    }
  }

}

/** Add ramps until every walkable tile is reachable from the spawn (flatten what can't be reached). */
export function connectPlateaus(seed: number, size: number, tiles: Uint8Array, levels: Uint8Array, ramps: Uint8Array, spawn: { x: number; z: number }) {
  const idx = (x: number, z: number) => z * size + x;
  const inB = (x: number, z: number) => x >= 0 && z >= 0 && x < size && z < size;
  const T = (x: number, z: number) => (inB(x, z) ? tiles[idx(x, z)] : Tile.Sea);
  const Lv = (x: number, z: number) => (inB(x, z) ? levels[idx(x, z)] : 0);
  const c = size / 2;
  // 4. Ramps until everything is reachable (max a handful of iterations).
  const grid = () => new Grid(size, tiles, levels, ramps);
  const tryRamp = (comp: Set<number>): boolean => {
    // Candidate: lower tile R next to plateau tile U = R + d, with approach B = R - d on R's level.
    const cands: { r: number; d: number; wide: number; score: number }[] = [];
    for (const u of comp) {
      const ux = u % size, uz = Math.floor(u / size);
      const L = levels[u];
      for (let d = 0; d < 4; d++) {
        const [dx, dz] = DIRS[d];
        const rx = ux - dx, rz = uz - dz;
        const bx = rx - dx, bz = rz - dz;
        if (!inB(bx, bz) || T(rx, rz) !== Tile.Ground || T(bx, bz) !== Tile.Ground) continue;
        if (Lv(rx, rz) !== L - 1 || Lv(bx, bz) !== L - 1 || ramps[idx(rx, rz)] || ramps[idx(bx, bz)]) continue;
        // Second lane for a 2-wide ramp.
        const [px, pz] = DIRS[(d + 1) % 4];
        const r2x = rx + px, r2z = rz + pz;
        const wideOk =
          T(r2x, r2z) === Tile.Ground && Lv(r2x, r2z) === L - 1 && !ramps[idx(r2x, r2z)] &&
          Lv(r2x + dx, r2z + dz) === L && T(r2x - dx, r2z - dz) === Tile.Ground && Lv(r2x - dx, r2z - dz) === L - 1;
        const s = Math.abs(rx - c) + Math.abs(rz - c) + (wideOk ? -6 : 0) + ((rx * 31 + rz * 17 + seed) % 7);
        cands.push({ r: idx(rx, rz), d, wide: wideOk ? 1 : 0, score: s });
      }
    }
    if (!cands.length) return false;
    cands.sort((a, b) => a.score - b.score);
    const best = cands[0];
    const rx = best.r % size, rz = Math.floor(best.r / size);
    const place = (x: number, z: number) => {
      tiles[idx(x, z)] = Tile.Ramp;
      ramps[idx(x, z)] = best.d + 1;
    };
    place(rx, rz);
    if (best.wide) {
      const [px, pz] = DIRS[(best.d + 1) % 4];
      place(rx + px, rz + pz);
    }
    return true;
  };

  // (48-tile islands keep their original iteration budget so saved islands regenerate identically.)
  for (let iter = 0, n = size > 48 ? 40 : 24; iter < n; iter++) {
    const g = grid();
    // Flood fill from spawn using the same step rules as movement.
    const reach = new Uint8Array(size * size);
    const s0 = idx(Math.floor(spawn.x), Math.floor(spawn.z));
    const q = [s0];
    reach[s0] = 1;
    while (q.length) {
      const i = q.pop()!;
      const x = i % size, z = Math.floor(i / size);
      for (const [dx, dz] of DIRS) {
        const nx = x + dx, nz = z + dz;
        if (!inB(nx, nz)) continue;
        const j = idx(nx, nz);
        if (reach[j] || !g.walkableTile(nx, nz) || !g.stepOk(x, z, nx, nz)) continue;
        reach[j] = 1;
        q.push(j);
      }
    }
    // Find an unreachable elevated region.
    let region: Set<number> | null = null;
    for (let i = 0; i < size * size && !region; i++) {
      if (reach[i] || levels[i] === 0 || tiles[i] !== Tile.Ground) continue;
      const L = levels[i];
      const comp = new Set<number>();
      const st = [i];
      comp.add(i);
      while (st.length) {
        const k = st.pop()!;
        const x = k % size, z = Math.floor(k / size);
        for (const [dx, dz] of DIRS) {
          const nx = x + dx, nz = z + dz;
          if (!inB(nx, nz)) continue;
          const j = idx(nx, nz);
          if (!comp.has(j) && levels[j] === L && tiles[j] === Tile.Ground && !reach[j]) {
            comp.add(j);
            st.push(j);
          }
        }
      }
      region = comp;
    }
    if (!region) break;
    if (!tryRamp(region)) for (const j of region) levels[j] -= 1; // flatten if no ramp fits
  }
}
