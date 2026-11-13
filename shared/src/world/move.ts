// Movement helpers: sliding along walls, angles, distances.

import { Grid } from './grid.ts';

/**
 * Move from (x,z) by (dx,dz), sliding along obstacles and cliffs. Used by the
 * client for prediction; the server validates the result with `canMove`.
 */
export function slideMove(grid: Grid, x: number, z: number, dx: number, dz: number): { x: number; z: number } {
  const nx = x + dx;
  const nz = z + dz;
  if (grid.canMove(x, z, nx, nz)) return { x: nx, z: nz };
  if (grid.canMove(x, z, nx, z)) return { x: nx, z };
  if (grid.canMove(x, z, x, nz)) return { x, z: nz };
  return { x, z };
}

// ── Generation ─────────────────────────────────────────────────────────────

/** Wrap an angle into [-π, π). */
export function wrapAngle(a: number): number {
  const t = Math.PI * 2;
  return ((((a + Math.PI) % t) + t) % t) - Math.PI;
}

export function distToTile(px: number, pz: number, tx: number, tz: number): number {
  const dx = px - (tx + 0.5);
  const dz = pz - (tz + 0.5);
  return Math.sqrt(dx * dx + dz * dz);
}
