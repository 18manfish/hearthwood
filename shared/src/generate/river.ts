// Rivers on new islands: from a lake up on the highest plateau, flowing to the north
// coast, never uphill. Where the river drops a cliff level there's a waterfall.

import type { BiomeId } from '../data/biomes.ts';
import { fbm2D } from '../rng.ts';
import { Tile } from '../world/tiles.ts';

/** Biomes whose new (72-tile) islands get a river. */
export const RIVER_BIOMES: BiomeId[] = ['grassland', 'tropical', 'nordic', 'forest_edge', 'jungle'];

/**
 * A river from an inland lake to the north coast. It takes the level of the
 * lowest bank it passes, never flowing uphill – where it drops a cliff level
 * there's a waterfall.
 */
export function carveRiver(seed: number, size: number, tiles: Uint8Array, levels: Uint8Array, sx: number, sz: number, S: number) {
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
