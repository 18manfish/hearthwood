// Terraforming: raise / lower cliffs, place / remove ramps, dig / fill ponds.
// The same rules run on the client (ghost preview) and the server (authority).

import { CLIFF, DIRS, Grid, MAX_LEVEL, RAMP_STYLES, Tile, classifyWater, isWaterTile, type RampStyle, isFreshWater } from './world.ts';

export const TERRA_OPS = ['raise', 'lower', 'ramp', 'stairs_stone', 'stairs_wood', 'stairs_log', 'unramp', 'water', 'land'] as const;
export type TerraOp = (typeof TERRA_OPS)[number];

/** How far from the player a tile can be reshaped. */
export const TERRA_REACH = 6;

/** Which permit (bought at the Town Hall) each operation needs. */
export const TERRA_PERMIT: Record<TerraOp, 'permit_cliff' | 'permit_water'> = {
  raise: 'permit_cliff', lower: 'permit_cliff', ramp: 'permit_cliff', stairs_stone: 'permit_cliff', stairs_wood: 'permit_cliff', stairs_log: 'permit_cliff',
  unramp: 'permit_cliff', water: 'permit_water', land: 'permit_water',
};

export const TERRA_INFO: Record<TerraOp, { name: string; icon: string; color: string; hint: string }> = {
  raise: { name: 'Raise cliff', icon: '⛰️', color: '#c58b4a', hint: 'Lifts ground one level' },
  lower: { name: 'Lower cliff', icon: '🕳️', color: '#8d6e63', hint: 'Takes ground down one level' },
  ramp: { name: 'Build ramp', icon: '📐', color: '#ffd166', hint: 'Grassy slope up to the level in front of it' },
  stairs_stone: { name: 'Stone stairs', icon: '🪨', color: '#b0aca3', hint: 'Stone steps up a cliff (or turn a ramp into them)' },
  stairs_wood: { name: 'Wooden stairs', icon: '🪜', color: '#c08a52', hint: 'Plank steps with posts (or turn a ramp into them)' },
  stairs_log: { name: 'Log steps', icon: '🪵', color: '#8b5a2b', hint: 'Rustic logs set into the slope (or turn a ramp into them)' },
  unramp: { name: 'Remove ramp', icon: '🚧', color: '#ef8354', hint: 'Turns a ramp back into flat ground' },
  water: { name: 'Dig water', icon: '💧', color: '#4fb7d8', hint: 'Digs water into ground or sand, on any level. Joined to the sea or a river it becomes river, otherwise a pond; above lower water it makes a waterfall' },
  land: { name: 'Fill water', icon: '🟫', color: '#a1887f', hint: 'Fills a pond or river tile (with sand on the beach)' },
};

/** One changed tile: [x, z, tile, level, ramp (dir + 1, 0 = none)]. */
export type TerrainChange = [number, number, number, number, number];

const isLand = (t: Tile) => t === Tile.Ground || t === Tile.Ramp;

/** Ramp-building operations and the look each one gives. */
export const RAMP_OPS: Partial<Record<TerraOp, RampStyle>> = { ramp: 'slope', stairs_stone: 'stone_stairs', stairs_wood: 'wood_stairs', stairs_log: 'log_steps' };
export const isRampOp = (op: TerraOp) => op in RAMP_OPS;
const styleIndex = (op: TerraOp) => Math.max(0, RAMP_STYLES.indexOf(RAMP_OPS[op] ?? 'slope'));

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

/** What every terraforming rule looks at: the tile, its level and its surroundings. */
interface Spot {
  g: Grid;
  x: number;
  z: number;
  i: number;
  t: Tile;
  L: number;
  /** Nothing stands on the tile. */
  free: boolean;
  /** Do all 8 neighbours pass `fn`? */
  neighbours(fn: (nx: number, nz: number) => boolean): boolean;
  /** Does any of the 4 side neighbours pass `fn`? */
  side(fn: (nx: number, nz: number) => boolean): boolean;
  /** Level of a neighbour (the sea is always at level 0). */
  levelOf(nx: number, nz: number): number;
}

/** Ramps and every kind of stairs (on an existing ramp: change its look). */
function rampError(s: Spot, op: TerraOp, dir: number): string | null {
  const { g, x, z, i, t } = s;
  if (t === Tile.Ramp) return g.rampStyle(x, z) === styleIndex(op) ? 'It already looks like that.' : null;
  if (t !== Tile.Ground) return 'Ramps and stairs go on plain ground.';
  if (!s.free || g.path(x, z)) return 'Clear this spot first.';
  if (g.reserved[i]) return 'There’s already a ramp right here.';
  const d = dir >= 0 ? dir : autoRampDir(g, x, z);
  if (d < 0 || !rampFits(g, x, z, d)) return 'A ramp needs a cliff one level up in front and flat ground behind.';
  return null;
}

/** The other operations, one rule set each (checked in this order; the first failure is reported). */
const RULES: Partial<Record<TerraOp, (s: Spot) => string | null>> = {
  raise({ g, i, t, L, free, neighbours }) {
    if (t !== Tile.Ground) return 'You can only raise plain ground.';
    if (!free) return 'Clear this spot first.';
    if (g.reserved[i]) return 'Keep the ground around ramps clear.';
    if (L >= MAX_LEVEL) return 'That’s as high as cliffs go.';
    if (!neighbours((nx, nz) => isLand(g.tile(nx, nz)) || isFreshWater(g.tile(nx, nz)))) return 'Cliffs need solid ground (or ponds and rivers) all around.';
    if (!neighbours((nx, nz) => g.level(nx, nz) >= L)) return 'Raise the ground around it first – one level at a time.';
    return null;
  },
  lower({ g, i, t, L, free, neighbours, side }) {
    if (t !== Tile.Ground || L === 0) return 'There’s no cliff to lower here.';
    if (!free) return 'Clear this spot first.';
    if (g.reserved[i]) return 'Keep the ground around ramps clear.';
    if (!neighbours((nx, nz) => g.level(nx, nz) <= L)) return 'Lower the higher ground around it first.';
    if (side((nx, nz) => isFreshWater(g.tile(nx, nz)) && g.level(nx, nz) >= L)) return 'The water next to it would spill over – fill it in first.';
    return null;
  },
  unramp({ t }) {
    if (t !== Tile.Ramp) return 'That isn’t a ramp.';
    return null;
  },
  water({ g, x, z, i, t, L, free, side, levelOf }) {
    if (t !== Tile.Ground && t !== Tile.Shore) return 'You can only dig water into plain ground or sand.';
    if (!free || g.path(x, z)) return 'Clear this spot first.';
    if (g.reserved[i]) return 'Keep the ground around ramps clear.';
    // Against higher cliffs is fine. Over a cliff edge it would spill – unless there's water below: a waterfall.
    if (side((nx, nz) => levelOf(nx, nz) < L && !isWaterTile(g.tile(nx, nz))))
      return 'The water would spill over the cliff edge. Dig water below it first – that makes a waterfall!';
    return null;
  },
  land({ g, i, t, L, side }) {
    if (t !== Tile.Pond && t !== Tile.River) return 'There’s no pond or river water here.';
    if (g.bridges[i]) return 'There’s a bridge over this water.';
    if (side((nx, nz) => isFreshWater(g.tile(nx, nz)) && g.level(nx, nz) > L)) return 'The waterfall above would pour onto it – fill in the upper water first.';
    return null;
  },
};

/**
 * Why `op` can't be done on (x, z), or null if it can. Only terrain rules –
 * ownership, tools, reach and people standing there are checked by the caller.
 */
export function terraformError(g: Grid, op: TerraOp, x: number, z: number, dir = -1): string | null {
  if (x < 1 || z < 1 || x >= g.size - 1 || z >= g.size - 1) return 'Too close to the edge of the island.';
  const i = z * g.size + x;
  const spot: Spot = {
    g, x, z, i,
    t: g.tile(x, z),
    L: g.level(x, z),
    free: g.occupied[i] === 0,
    neighbours(fn) {
      for (let dz = -1; dz <= 1; dz++)
        for (let dx = -1; dx <= 1; dx++) if ((dx || dz) && !fn(x + dx, z + dz)) return false;
      return true;
    },
    side: (fn) => DIRS.some(([dx, dz]) => fn(x + dx, z + dz)),
    levelOf: (nx, nz) => (g.tile(nx, nz) === Tile.Sea ? 0 : g.level(nx, nz)),
  };
  if (isRampOp(op)) return rampError(spot, op, dir);
  return RULES[op]?.(spot) ?? (op in RULES ? null : 'Unknown terraforming.');
}

/** Is a filled-in water tile on the beach (mostly sand or sea around it)? */
function sandy(g: Grid, x: number, z: number) {
  let beach = 0, land = 0;
  for (let dz = -1; dz <= 1; dz++)
    for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dz) continue;
      const t = g.tile(x + dx, z + dz);
      if (t === Tile.Shore || t === Tile.Sea || t === Tile.Dock) beach++;
      else if (t === Tile.Ground || t === Tile.Ramp) land++;
    }
  return beach > land;
}

/** The tile changes `op` makes (assumes `terraformError` returned null). */
export function terraformChanges(g: Grid, op: TerraOp, x: number, z: number, dir = -1): TerrainChange[] {
  const L = g.level(x, z);
  if (isRampOp(op)) {
    const d = g.tile(x, z) === Tile.Ramp ? g.ramp(x, z) : dir >= 0 ? dir : autoRampDir(g, x, z);
    return [[x, z, Tile.Ramp, L, d + 1 + 4 * styleIndex(op)]];
  }
  switch (op) {
    case 'raise': return [[x, z, Tile.Ground, L + 1, 0]];
    case 'lower': return [[x, z, Tile.Ground, L - 1, 0]];
    case 'unramp': return [[x, z, Tile.Ground, L, 0]];
    case 'water': return [[x, z, Tile.Pond, L, 0]];
    case 'land': return [[x, z, L === 0 && sandy(g, x, z) ? Tile.Shore : Tile.Ground, L, 0]];
    default: return [];
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

/** Server side: apply, then re-sort water into rivers / ponds. Returns every changed tile. */
export function applyTerrainAndWater(g: Grid, changes: TerrainChange[]): TerrainChange[] {
  applyTerrain(g, changes);
  const out = [...changes];
  for (const i of classifyWater(g.size, g.tiles)) {
    const x = i % g.size, z = Math.floor(i / g.size);
    out.push([x, z, g.tiles[i], g.levels[i], g.ramps[i]]);
  }
  return out;
}

/** Visual height of a raised tile, for previews. */
export function terraPreviewY(g: Grid, op: TerraOp, x: number, z: number) {
  const base = g.surfaceY(x + 0.5, z + 0.5);
  return op === 'raise' ? base + CLIFF : base;
}
