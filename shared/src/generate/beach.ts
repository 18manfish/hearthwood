// Wide beaches: the shallows just outside the old sand line become beach too (twice as
// deep, without taking any land). Rivers are carried across the new sand to the sea,
// and a rounded bay around the pier stays open water.

import { fbm2D } from '../rng.ts';
import { DIRS, Tile } from '../world/tiles.ts';
import type { GenState } from './state.ts';

/** Land-mask value where the sea starts now (beaches run from 0.74; the sea used to start at 0.83). */
const BEACH_OUTER = 0.92;

/** Returns the beach band: 1 = sea turned into sand, 2 = sea turned into a river mouth. */
export function widenBeaches(st: GenState): Uint8Array {
  const { seed, size, S, c, tiles, levels, dockX, beachZ } = st;
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
  return beachBand;
}
