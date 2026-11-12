// Terraforming: raise / lower cliffs, place / remove ramps, dig / fill ponds.
// The same rules run on the client (ghost preview) and the server (authority).

import { CLIFF, DIRS, Grid, MAX_LEVEL, Tile } from './world.ts';

export const TERRA_OPS = ['raise', 'lower', 'ramp', 'unramp', 'water', 'land'] as const;
export type TerraOp = (typeof TERRA_OPS)[number];

/** How far from the player a tile can be reshaped. */
export const TERRA_REACH = 6;

/** Which permit (bought at the Town Hall) each operation needs. */
export const TERRA_PERMIT: Record<TerraOp, 'permit_cliff' | 'permit_water'> = {
  raise: 'permit_cliff', lower: 'permit_cliff', ramp: 'permit_cliff', unramp: 'permit_cliff', water: 'permit_water', land: 'permit_water',
};

export const TERRA_INFO: Record<TerraOp, { name: string; icon: string; color: string; hint: string }> = {
  raise: { name: 'Raise cliff', icon: '⛰️', color: '#c58b4a', hint: 'Lifts ground one level' },
  lower: { name: 'Lower cliff', icon: '🕳️', color: '#8d6e63', hint: 'Takes ground down one level' },
  ramp: { name: 'Build ramp', icon: '📐', color: '#ffd166', hint: 'Slope up to the level in front of it' },
  unramp: { name: 'Remove ramp', icon: '🚧', color: '#ef8354', hint: 'Turns a ramp back into flat ground' },
  water: { name: 'Dig water', icon: '💧', color: '#4fb7d8', hint: 'Digs a pond tile (ground level only)' },
  land: { name: 'Fill water', icon: '🟫', color: '#a1887f', hint: 'Fills a pond tile with earth' },
};

/** One changed tile: [x, z, tile, level, ramp (dir + 1, 0 = none)]. */
export type TerrainChange = [number, number, number, number, number];

const isLand = (t: Tile) => t === Tile.Ground || t === Tile.Ramp;

/** Ramp direction (uphill) that fits on (x, z), preferring `prefer`; −1 if none. */
export function autoRampDir(g: Grid, x: number, z: number, prefer = -1): number {
  const order = prefer >= 0 ? [prefer, (prefer + 1) % 4, (prefer + 3) % 4, (prefer + 2) % 4] : [0, 1, 2, 3];
  for (const d of order) if (rampFits(g, x, z, d)) return d;
  return -1;
}

function rampFits(g: Grid, x: number, z: number, d: number) {
  const [dx, dz] = DIRS[d];
  const L = g.level(x, z);
  const ux = x + dx, uz = z + dz; // landing on top
  const bx = x - dx, bz = z - dz; // approach at the bottom
  if (!g.inBounds(ux, uz) || !g.inBounds(bx, bz)) return false;
  if (g.tile(ux, uz) !== Tile.Ground || g.level(ux, uz) !== L + 1 || g.ramp(ux, uz) >= 0) return false;
  const bt = g.tile(bx, bz);
  if ((bt !== Tile.Ground && bt !== Tile.Shore) || g.level(bx, bz) !== L || g.ramp(bx, bz) >= 0) return false;
  return g.blocked[uz * g.size + ux] === 0 && g.blocked[bz * g.size + bx] === 0;
}

/**
 * Why `op` can't be done on (x, z), or null if it can. Only terrain rules –
 * ownership, tools, reach and people standing there are checked by the caller.
 */
export function terraformError(g: Grid, op: TerraOp, x: number, z: number, dir = -1): string | null {
  if (x < 1 || z < 1 || x >= g.size - 1 || z >= g.size - 1) return 'Too close to the edge of the island.';
  const i = z * g.size + x;
  const t = g.tile(x, z);
  const L = g.level(x, z);
  const free = g.occupied[i] === 0;
  const neighbours = (fn: (nx: number, nz: number) => boolean) => {
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++) if ((dx || dz) && !fn(x + dx, z + dz)) return false;
    return true;
  };
  switch (op) {
    case 'raise':
      if (t !== Tile.Ground) return 'You can only raise plain ground.';
      if (!free) return 'Clear this spot first.';
      if (g.reserved[i]) return 'Keep the ground around ramps clear.';
      if (L >= MAX_LEVEL) return 'That’s as high as cliffs go.';
      if (!neighbours((nx, nz) => isLand(g.tile(nx, nz)))) return 'Cliffs need solid ground all around.';
      if (!neighbours((nx, nz) => g.level(nx, nz) >= L)) return 'Raise the ground around it first – one level at a time.';
      return null;
    case 'lower':
      if (t !== Tile.Ground || L === 0) return 'There’s no cliff to lower here.';
      if (!free) return 'Clear this spot first.';
      if (g.reserved[i]) return 'Keep the ground around ramps clear.';
      if (!neighbours((nx, nz) => g.level(nx, nz) <= L)) return 'Lower the higher ground around it first.';
      return null;
    case 'ramp': {
      if (t !== Tile.Ground) return 'Ramps go on plain ground.';
      if (!free || g.path(x, z)) return 'Clear this spot first.';
      if (g.reserved[i]) return 'There’s already a ramp right here.';
      const d = dir >= 0 ? dir : autoRampDir(g, x, z);
      if (d < 0 || !rampFits(g, x, z, d)) return 'A ramp needs a cliff one level up in front and flat ground behind.';
      return null;
    }
    case 'unramp':
      if (t !== Tile.Ramp) return 'That isn’t a ramp.';
      return null;
    case 'water':
      if (t !== Tile.Ground) return 'You can only dig water into plain ground.';
      if (L !== 0) return 'Water only works at ground level.';
      if (!free || g.path(x, z)) return 'Clear this spot first.';
      if (g.reserved[i]) return 'Keep the ground around ramps clear.';
      if (!neighbours((nx, nz) => g.level(nx, nz) === 0)) return 'Water can’t sit right against a cliff.';
      return null;
    case 'land':
      if (t !== Tile.Pond) return 'There’s no pond water here.';
      return null;
  }
}

/** The tile changes `op` makes (assumes `terraformError` returned null). */
export function terraformChanges(g: Grid, op: TerraOp, x: number, z: number, dir = -1): TerrainChange[] {
  const L = g.level(x, z);
  switch (op) {
    case 'raise': return [[x, z, Tile.Ground, L + 1, 0]];
    case 'lower': return [[x, z, Tile.Ground, L - 1, 0]];
    case 'ramp': return [[x, z, Tile.Ramp, L, (dir >= 0 ? dir : autoRampDir(g, x, z)) + 1]];
    case 'unramp': return [[x, z, Tile.Ground, L, 0]];
    case 'water': return [[x, z, Tile.Pond, 0, 0]];
    case 'land': return [[x, z, Tile.Ground, 0, 0]];
  }
}

/** Apply changes to a grid (both sides call this). */
export function applyTerrain(g: Grid, changes: TerrainChange[]) {
  for (const [x, z, t, l, r] of changes) {
    g.setTerrain(x, z, t, l, r);
    if (t !== Tile.Ground && t !== Tile.Ramp) g.paths[z * g.size + x] = 0;
  }
  g.recomputeReserved();
}

/** Visual height of a raised tile, for previews. */
export function terraPreviewY(g: Grid, op: TerraOp, x: number, z: number) {
  const base = g.surfaceY(x + 0.5, z + 0.5);
  return op === 'raise' ? base + CLIFF : base;
}
