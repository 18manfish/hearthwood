// Cliffs and ramps: raise plateaus, smooth them, then add ramps until every walkable
// tile is reachable from the spawn.

import { fbm2D, Rng } from '../rng.ts';
import { LEGACY_ISLAND_SIZE } from '../world/constants.ts';
import { Grid } from '../world/grid.ts';
import { DIRS, Tile } from '../world/tiles.ts';
import { carveRiver } from './river.ts';

/**
 * Raise plateaus (level 1, small level-2 hilltops), smooth them, then add ramps
 * until every walkable tile is reachable from the spawn.
 */
export function carveCliffs(
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
