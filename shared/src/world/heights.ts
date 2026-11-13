// Heights things stand on: the walkable surface (beaches, ramps, bridges, gangways,
// water) and the corner heights terrain meshes are built from.

import { baseHeight, BRIDGE_DECK, CLIFF, DOCK_Y, WATER_SURFACE } from './constants.ts';
import { dockRamp } from './dock.ts';
import type { Grid } from './grid.ts';
import { isWaterTile, Tile } from './tiles.ts';

/** Ground height without bridges or gangways (sand, grass, ramps). */
export function groundAt(g: Grid, px: number, pz: number): number {
  const x = Math.floor(px), z = Math.floor(pz);
  const t = g.tile(x, z);
  if (g.isCoastal(x, z) && t !== Tile.River) return g.coastY(px, pz, t);
  return baseHeight(t) + g.level(x, z) * CLIFF;
}

/** Height of the walkable surface at a continuous position. */
export function surfaceY(g: Grid, px: number, pz: number): number {
  const x = Math.floor(px), z = Math.floor(pz);
  const t = g.tile(x, z);
  const bridge = g.inBounds(x, z) ? g.bridges[g.idx(x, z)] : 0;
  if (bridge) return (bridge - 1) * CLIFF + BRIDGE_DECK;
  if (t === Tile.Shore || (t === Tile.Ground && g.level(x, z) === 0)) {
    const r = dockRamp(g, px, pz);
    if (r) return Math.max(r.y, groundAt(g, px, pz));
  }
  if ((t === Tile.Shore || t === Tile.Sea) && g.isCoastal(x, z)) return g.coastY(px, pz, t);
  const base = baseHeight(t) + g.level(x, z) * CLIFF;
  const d = g.ramp(x, z);
  if (d < 0) return t === Tile.Dock ? DOCK_Y : isWaterTile(t) ? WATER_SURFACE + g.level(x, z) * CLIFF : base;
  const fx = px - x, fz = pz - z;
  const f = d === 0 ? 1 - fz : d === 1 ? fx : d === 2 ? fz : 1 - fx;
  return base + f * CLIFF;
}

/** Corner heights of a tile (for terrain meshes): [x0z0, x1z0, x1z1, x0z1]. */
export function cornerHeights(g: Grid, x: number, z: number): [number, number, number, number] {
  const t = g.tile(x, z);
  if (g.isCoastal(x, z)) return [g.coastY(x, z, t), g.coastY(x + 1, z, t), g.coastY(x + 1, z + 1, t), g.coastY(x, z + 1, t)];
  const b = baseHeight(t) + g.level(x, z) * CLIFF;
  const d = g.ramp(x, z);
  if (d < 0) return [b, b, b, b];
  const H = b + CLIFF;
  if (d === 0) return [H, H, b, b];
  if (d === 1) return [b, H, H, b];
  if (d === 2) return [b, b, H, H];
  return [H, b, b, H];
}