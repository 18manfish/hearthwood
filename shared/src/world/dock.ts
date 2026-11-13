// Gangways: where a pier's land end meets the beach, a ramp runs from the deck down
// onto dry sand. Used for walking height and for drawing the dock.

import { DOCK_Y, SEA_LEVEL } from './constants.ts';
import type { Grid } from './grid.ts';
import { groundAt } from './heights.ts';
import { DIRS, Tile } from './tiles.ts';

/**
 * Piers reach dry land: where a pier's land end meets the beach, a gangway runs
 * from the deck down onto the sand (one to three tiles, until the sand is dry).
 * Returns the gangway's height at a point and which way the pier lies, or null.
 */
export function dockRamp(g: Grid, px: number, pz: number): { y: number; dx: number; dz: number; s: number; len: number; from: number; to: number } | null {
  const x = Math.floor(px), z = Math.floor(pz);
  const t = g.tile(x, z);
  if (t !== Tile.Shore && t !== Tile.Ground) return null;
  for (const [dx, dz] of DIRS)
    for (let k = 1; k <= 3; k++) {
      const ex = x + dx * k, ez = z + dz * k; // the pier's land-end tile
      if (g.tile(ex, ez) !== Tile.Dock || g.tile(ex + dx, ez + dz) !== Tile.Dock || g.tile(ex + 2 * dx, ez + 2 * dz) !== Tile.Dock) continue;
      let between = true;
      for (let j = 1; j < k; j++) if (g.tile(x + dx * j, z + dz * j) !== Tile.Shore) between = false;
      if (!between) continue;
      // The whole width of the pier shares one gangway: same length, same landing height.
      const cols: [number, number][] = [];
      for (const sgn of [1, -1])
        for (let w = sgn > 0 ? 0 : 1; w < 6; w++) {
          const cx = ex + dz * w * sgn, cz = ez + dx * w * sgn;
          if (g.tile(cx, cz) !== Tile.Dock || g.tile(cx + dx, cz + dz) !== Tile.Dock || g.tile(cx - dx, cz - dz) === Tile.Dock) break;
          cols.push([cx, cz]);
        }
      let len = 1;
      for (const [cx, cz] of cols) len = Math.max(len, dockRampLen(g, cx, cz, dx, dz));
      if (k > len) continue;
      // Distance from the pier's edge back towards land, along the pier's axis.
      const edge = dx ? (dx > 0 ? ex : ex + 1) : dz > 0 ? ez : ez + 1;
      const s = dx ? Math.abs(edge - px) : Math.abs(edge - pz);
      let to = -Infinity;
      for (const [cx, cz] of cols) {
        const endX = dx ? edge - dx * len - dx * 0.01 : cx + 0.5, endZ = dz ? edge - dz * len - dz * 0.01 : cz + 0.5;
        to = Math.max(to, groundAt(g, endX, endZ));
      }
      return { y: DOCK_Y + (to - DOCK_Y) * Math.min(1, s / len), dx, dz, s, len, from: DOCK_Y, to };
    }
  return null;
}

/** Gangway length (tiles, 1–3) from the pier end at (ex, ez), pier pointing (dx, dz) away from land: until the sand is dry. */
export function dockRampLen(g: Grid, ex: number, ez: number, dx: number, dz: number): number {
  const edge = dx ? (dx > 0 ? ex : ex + 1) : dz > 0 ? ez : ez + 1;
  for (let len = 1; len <= 3; len++) {
    const tx = ex - dx * len, tz = ez - dz * len;
    const t = g.tile(tx, tz);
    if (t !== Tile.Shore && t !== Tile.Ground) return Math.max(1, len - 1);
    const cx = dx ? edge - dx * (len + 0.01) : ex + 0.5, cz = dz ? edge - dz * (len + 0.01) : ez + 0.5;
    if (groundAt(g, cx, cz) >= SEA_LEVEL + 0.08) return len;
  }
  return 3;
}
