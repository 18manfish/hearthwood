// Island layout: tiles, elevation (cliff levels + ramps), world objects and
// level-aware collision. Shared by server (authoritative validation) and
// client (prediction + rendering).

import { BIOMES, TREES, type BiomeId, type TreeSpecies } from './data/biomes.ts';
import { BUILDINGS, NON_BLOCKING, type BuildingType } from './data/buildings.ts';
import { fbm2D, Rng } from './rng.ts';

export const ISLAND_SIZE = 48;
/** Height of one cliff level in world units. */
export const CLIFF = 1.0;

export enum Tile {
  Sea = 0,
  Shore = 1,
  Ground = 2,
  Pond = 3,
  Dock = 4,
  Ramp = 5,
  Floor = 6,
  Wall = 7,
}

/** Ramp directions point uphill: 0 = north (−z), 1 = east (+x), 2 = south (+z), 3 = west (−x). */
export const DIRS: readonly [number, number][] = [[0, -1], [1, 0], [0, 1], [-1, 0]];

export type ObjKind = 'tree' | 'stump' | 'rock' | 'bush' | 'mushroom' | 'flower' | 'furniture';

export interface WorldObject {
  id: string;
  kind: ObjKind;
  x: number; // tile coords (integer)
  z: number;
  species?: TreeSpecies;
  /** Tree growth: 0 sapling, 1 young, 2 mature. */
  stage?: number;
  /** When the next growth stage is reached (ms epoch). */
  growAt?: number;
  /** Chop hits on a tree / hits on a rock. */
  hits?: number;
  /** Fruit hanging on a mature tree. */
  fruit?: number;
  /** Bush currently has food. */
  ripe?: boolean;
  rare?: boolean;
  /** Furniture item id. */
  item?: string;
  rot?: number;
  /** Day key on which the tree was last shaken for a branch. */
  shook?: string;
  /** Stumps rot away (and a sapling sprouts) at this time. */
  decayAt?: number;
}

export interface Building {
  id: string;
  type: BuildingType;
  x: number;
  z: number;
  w: number;
  h: number;
  /** ms epoch when construction completes (<= now means done). */
  completeAt: number;
  villagerId?: string;
}

export interface IslandLayout {
  size: number;
  tiles: Uint8Array;
  levels: Uint8Array;
  /** Ramp direction + 1 per tile (0 = no ramp). */
  ramps: Uint8Array;
  /** Pre-laid paths (designed locations). */
  paths?: Uint8Array;
  objects: WorldObject[];
  buildings: Building[];
  spawn: { x: number; z: number };
}

export function tileAt(tiles: Uint8Array, size: number, x: number, z: number): Tile {
  if (x < 0 || z < 0 || x >= size || z >= size) return Tile.Sea;
  return tiles[z * size + x] as Tile;
}

export function isWaterTile(t: Tile): boolean {
  return t === Tile.Sea || t === Tile.Pond;
}

export function encodeTiles(tiles: Uint8Array): string {
  let s = '';
  for (let i = 0; i < tiles.length; i++) s += tiles[i];
  return s;
}

export function decodeTiles(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) - 48;
  return out;
}

/** Objects that stop movement. Saplings, mushrooms and flowers can be walked over. */
export function objectBlocks(o: WorldObject): boolean {
  if (o.kind === 'tree') return (o.stage ?? 2) >= 1;
  return o.kind === 'stump' || o.kind === 'rock' || o.kind === 'bush' || o.kind === 'furniture';
}

const WALKABLE = new Set<Tile>([Tile.Ground, Tile.Shore, Tile.Dock, Tile.Ramp, Tile.Floor]);

/** Collision / occupancy grid derived from tiles + elevation + objects + buildings. */
export class Grid {
  readonly size: number;
  readonly tiles: Uint8Array;
  readonly levels: Uint8Array;
  readonly ramps: Uint8Array;
  /** Count of blocking things per tile (counts make removal cheap). */
  readonly blocked: Uint8Array;
  /** Count of any object per tile (used for placement checks). */
  readonly occupied: Uint8Array;
  /** Ramp tiles plus their landing tiles – kept clear so cliffs stay reachable. */
  readonly reserved: Uint8Array;
  /** Path type per tile (0 = none). */
  readonly paths: Uint8Array;

  constructor(size: number, tiles: Uint8Array, levels?: Uint8Array, ramps?: Uint8Array, paths?: Uint8Array) {
    this.size = size;
    this.tiles = tiles;
    this.levels = levels ?? new Uint8Array(size * size);
    this.ramps = ramps ?? new Uint8Array(size * size);
    this.blocked = new Uint8Array(size * size);
    this.occupied = new Uint8Array(size * size);
    this.reserved = new Uint8Array(size * size);
    this.paths = paths ?? new Uint8Array(size * size);
    for (let z = 0; z < size; z++)
      for (let x = 0; x < size; x++) {
        const d = this.ramp(x, z);
        if (d < 0) continue;
        const [dx, dz] = DIRS[d];
        for (const k of [-1, 0, 1, 2]) {
          const tx = x + dx * k, tz = z + dz * k;
          if (this.inBounds(tx, tz)) this.reserved[tz * size + tx] = 1;
        }
      }
  }

  private idx(x: number, z: number) {
    return z * this.size + x;
  }

  inBounds(x: number, z: number) {
    return x >= 0 && z >= 0 && x < this.size && z < this.size;
  }

  tile(x: number, z: number): Tile {
    return tileAt(this.tiles, this.size, x, z);
  }

  level(x: number, z: number): number {
    return this.inBounds(x, z) ? this.levels[this.idx(x, z)] : 0;
  }

  /** Ramp direction at a tile, or -1. */
  ramp(x: number, z: number): number {
    return this.inBounds(x, z) ? this.ramps[this.idx(x, z)] - 1 : -1;
  }

  addObject(o: WorldObject, sign = 1) {
    if (!this.inBounds(o.x, o.z)) return;
    const i = this.idx(o.x, o.z);
    this.occupied[i] += sign;
    if (objectBlocks(o)) this.blocked[i] += sign;
  }

  removeObject(o: WorldObject) {
    this.addObject(o, -1);
  }

  addBuilding(b: Building, sign = 1) {
    for (let dz = 0; dz < b.h; dz++)
      for (let dx = 0; dx < b.w; dx++) {
        if (!this.inBounds(b.x + dx, b.z + dz)) continue;
        const i = this.idx(b.x + dx, b.z + dz);
        this.occupied[i] += sign;
        if (!NON_BLOCKING.includes(b.type)) this.blocked[i] += sign;
      }
  }

  removeBuilding(b: Building) {
    this.addBuilding(b, -1);
  }

  rebuild(objects: Iterable<WorldObject>, buildings: Iterable<Building>) {
    this.blocked.fill(0);
    this.occupied.fill(0);
    for (const o of objects) this.addObject(o);
    for (const b of buildings) this.addBuilding(b);
  }

  /** Can a character stand on this tile at all (ignoring elevation)? */
  walkableTile(x: number, z: number): boolean {
    if (!this.inBounds(x, z)) return false;
    if (!WALKABLE.has(this.tile(x, z))) return false;
    return this.blocked[this.idx(x, z)] === 0;
  }

  /**
   * Elevation rule between two neighbouring tiles: same level, or via a ramp
   * (entered from its bottom/sides, or from the plateau tile directly uphill).
   */
  stepOk(ax: number, az: number, bx: number, bz: number): boolean {
    if (ax === bx && az === bz) return true;
    if (Math.abs(ax - bx) > 1 || Math.abs(az - bz) > 1) return false;
    const ra = this.ramp(ax, az);
    const rb = this.ramp(bx, bz);
    if (ra < 0 && rb < 0) return this.level(ax, az) === this.level(bx, bz);
    if (ra >= 0 && rb >= 0) return ra === rb && this.level(ax, az) === this.level(bx, bz);
    return ra >= 0 ? this.rampLink(ax, az, ra, bx, bz) : this.rampLink(bx, bz, rb, ax, az);
  }

  private rampLink(rx: number, rz: number, d: number, ox: number, oz: number) {
    const L = this.level(rx, rz);
    const lo = this.level(ox, oz);
    const along = (ox - rx) * DIRS[d][0] + (oz - rz) * DIRS[d][1];
    if (lo === L) return along <= 0;
    if (lo === L + 1) return along === 1;
    return false;
  }

  /** Continuous-position walkability with a small body radius (no elevation check). */
  walkable(px: number, pz: number, r = 0.22): boolean {
    return (
      this.walkableTile(Math.floor(px - r), Math.floor(pz - r)) &&
      this.walkableTile(Math.floor(px + r), Math.floor(pz - r)) &&
      this.walkableTile(Math.floor(px - r), Math.floor(pz + r)) &&
      this.walkableTile(Math.floor(px + r), Math.floor(pz + r))
    );
  }

  /** Movement check from one position to a nearby one, including cliffs and ramps. */
  canMove(fx: number, fz: number, tx: number, tz: number, r = 0.22): boolean {
    if (!this.walkable(tx, tz, r)) return false;
    const ax = Math.floor(fx), az = Math.floor(fz);
    const pts = [[tx, tz], [tx - r, tz - r], [tx + r, tz - r], [tx - r, tz + r], [tx + r, tz + r]];
    for (const [px, pz] of pts) if (!this.stepOk(ax, az, Math.floor(px), Math.floor(pz))) return false;
    return true;
  }

  /** Free, buildable ground on a single level (no objects, buildings or ramp landings). */
  canPlace(x: number, z: number, w = 1, h = 1): boolean {
    const lvl = this.level(x, z);
    for (let dz = 0; dz < h; dz++)
      for (let dx = 0; dx < w; dx++) {
        const tx = x + dx;
        const tz = z + dz;
        if (!this.inBounds(tx, tz)) return false;
        const t = this.tile(tx, tz);
        if (t !== Tile.Ground && t !== Tile.Floor) return false;
        const i = this.idx(tx, tz);
        if (this.occupied[i] !== 0 || this.reserved[i] !== 0 || this.levels[i] !== lvl) return false;
      }
    return true;
  }

  path(x: number, z: number): number {
    return this.inBounds(x, z) ? this.paths[this.idx(x, z)] : 0;
  }

  /** Can a path be laid here? Plain ground (any level), nothing solid on it. */
  canPave(x: number, z: number): boolean {
    if (!this.inBounds(x, z) || this.tile(x, z) !== Tile.Ground) return false;
    return this.blocked[this.idx(x, z)] === 0;
  }

  /** Free ground for something to grow / respawn on (no paths). */
  canSpawn(x: number, z: number): boolean {
    return this.canPlace(x, z) && this.path(x, z) === 0;
  }

  /** Height of the walkable surface at a continuous position. */
  surfaceY(px: number, pz: number): number {
    const x = Math.floor(px), z = Math.floor(pz);
    const t = this.tile(x, z);
    const base = baseHeight(t) + this.level(x, z) * CLIFF;
    const d = this.ramp(x, z);
    if (d < 0) return t === Tile.Dock ? 0.16 : Math.max(base, t === Tile.Sea || t === Tile.Pond ? -0.2 : base);
    const fx = px - x, fz = pz - z;
    const f = d === 0 ? 1 - fz : d === 1 ? fx : d === 2 ? fz : 1 - fx;
    return base + f * CLIFF;
  }

  /** Corner heights of a tile (for terrain meshes): [x0z0, x1z0, x1z1, x0z1]. */
  cornerHeights(x: number, z: number): [number, number, number, number] {
    const t = this.tile(x, z);
    const b = baseHeight(t) + this.level(x, z) * CLIFF;
    const d = this.ramp(x, z);
    if (d < 0) return [b, b, b, b];
    const H = b + CLIFF;
    if (d === 0) return [H, H, b, b];
    if (d === 1) return [b, H, H, b];
    if (d === 2) return [b, b, H, H];
    return [H, b, b, H];
  }
}

export function baseHeight(t: Tile): number {
  switch (t) {
    case Tile.Sea: return -0.7;
    case Tile.Dock: return -0.7;
    case Tile.Pond: return -0.55;
    case Tile.Shore: return 0;
    case Tile.Ground: return 0.12;
    case Tile.Ramp: return 0.12;
    case Tile.Floor: return 0.05;
    case Tile.Wall: return 2.4;
  }
}

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

export interface GenOptions {
  /** Shared hubs get a plaza and fewer resources. */
  variant?: 'home' | 'shared' | 'tour';
  /** Cliffs & ramps (new islands). */
  elevation?: boolean;
}

/** Deterministic island generation from a seed. */
export function generateIsland(seed: number, biome: BiomeId, opts: GenOptions = {}): IslandLayout {
  const variant = opts.variant ?? 'home';
  const def = BIOMES[biome];
  const size = ISLAND_SIZE;
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
      const n = fbm2D(seed, x / 9, z / 9, 3) - 0.5;
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
  if (water === 'pond') carveDisc(c - 9, c - 7, 3.2, Tile.Pond);
  if (water === 'oasis') {
    carveDisc(c - 6, c - 4, 6.5, Tile.Ground);
    carveDisc(c - 6, c - 4, 5, Tile.Pond);
  }
  if (water === 'lagoon') {
    carveDisc(c + 13, c - 2, 7, Tile.Shore, true);
    carveDisc(c + 14, c - 2, 5.5, Tile.Sea, false);
  }
  if (water === 'river') {
    let rx = c - 4 + rng.range(-3, 3);
    for (let z = 0; z <= c - 8; z++) {
      rx += (fbm2D(seed + 77, z / 6, 0, 2) - 0.5) * 1.6;
      for (let w = -1; w <= 0; w++) if (get(Math.floor(rx) + w, z) !== Tile.Sea) set(Math.floor(rx) + w, z, Tile.Pond);
    }
    carveDisc(rx, c - 8, 2.6, Tile.Pond);
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

  if (opts.elevation && variant !== 'shared') carveCliffs(seed, size, tiles, levels, ramps, (x, z) => inClearing(x, z, 8.5), spawn);

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
        const ddx = x + 0.5 - (c - 6), ddz = z + 0.5 - (c - 4);
        const d = Math.sqrt(ddx * ddx + ddz * ddz);
        if (d > 5 && d < 7.5) p = 0.35;
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

  const rocks = variant === 'tour' ? def.rockCount + 6 : variant === 'shared' ? 2 : def.rockCount;
  for (let i = 0; i < rocks; i++) {
    const p = randomFreeGround(true, 2);
    if (p) place({ kind: 'rock', ...p, hits: 0 });
  }
  const bushes = variant === 'tour' ? 18 : variant === 'shared' ? 4 : 12;
  for (let i = 0; i < bushes; i++) {
    const p = randomFreeGround(true, 1);
    if (p) place({ kind: 'bush', ...p, ripe: true });
  }
  for (let i = 0; i < 6; i++) {
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

  return { size, tiles, levels, ramps, objects, buildings: [dock], spawn };
}

/**
 * Raise plateaus (level 1, small level-2 hilltops), smooth them, then add ramps
 * until every walkable tile is reachable from the spawn.
 */
function carveCliffs(
  seed: number, size: number, tiles: Uint8Array, levels: Uint8Array, ramps: Uint8Array,
  keepLow: (x: number, z: number) => boolean, spawn: { x: number; z: number },
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
      const v = fbm2D(seed + 500, x / 10, z / 10, 3) + (0.6 - Math.sqrt(dx * dx + dz * dz)) * 0.55;
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

  for (let iter = 0; iter < 24; iter++) {
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

// ── Interiors ──────────────────────────────────────────────────────────────

export type InteriorStyle = 'tent' | 'cabin';

/** A small walled room. The bottom row has a doorway with an exit fixture. */
export function generateInterior(style: InteriorStyle): IslandLayout {
  const size = style === 'tent' ? 7 : 9;
  const tiles = new Uint8Array(size * size);
  for (let z = 0; z < size; z++)
    for (let x = 0; x < size; x++) tiles[z * size + x] = x === 0 || z === 0 || x === size - 1 || z === size - 1 ? Tile.Wall : Tile.Floor;
  const mid = Math.floor(size / 2);
  tiles[(size - 1) * size + mid] = Tile.Floor;
  const buildings: Building[] = [
    { id: 'b_exit', type: 'exit', x: mid, z: size - 1, w: 1, h: 1, completeAt: 0 },
    { id: 'b_bed', type: 'bed', x: 1, z: 1, w: 1, h: 2, completeAt: 0 },
    { id: 'b_chest', type: 'chest', x: size - 2, z: 1, w: 1, h: 1, completeAt: 0 },
  ];
  return {
    size, tiles, levels: new Uint8Array(size * size), ramps: new Uint8Array(size * size),
    objects: [], buildings, spawn: { x: mid + 0.5, z: size - 2 + 0.3 },
  };
}

/** Is a building's footprint adjacent to (or under) point px,pz within `reach`? */
export function nearBuilding(b: Building, px: number, pz: number, reach = 1.6): boolean {
  const cx = Math.max(b.x, Math.min(px, b.x + b.w));
  const cz = Math.max(b.z, Math.min(pz, b.z + b.h));
  const dx = px - cx;
  const dz = pz - cz;
  return dx * dx + dz * dz <= reach * reach;
}

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

export function buildingFootprint(type: BuildingType) {
  const d = BUILDINGS[type];
  return { w: d.w, h: d.h };
}

/** Find a free tile for a respawning resource: the original spot, else nearby, else anywhere on the lot. */
export function findFreeSpot(
  grid: Grid, x: number, z: number, ok: (x: number, z: number) => boolean, rand: () => number,
): { x: number; z: number } | null {
  if (ok(x, z)) return { x, z };
  for (let r = 1; r <= 6; r++) {
    const ring: [number, number][] = [];
    for (let dz = -r; dz <= r; dz++)
      for (let dx = -r; dx <= r; dx++) if (Math.max(Math.abs(dx), Math.abs(dz)) === r) ring.push([x + dx, z + dz]);
    const start = Math.floor(rand() * ring.length);
    for (let i = 0; i < ring.length; i++) {
      const [tx, tz] = ring[(start + i) % ring.length];
      if (ok(tx, tz)) return { x: tx, z: tz };
    }
  }
  for (let i = 0; i < 400; i++) {
    const tx = 1 + Math.floor(rand() * (grid.size - 2));
    const tz = 1 + Math.floor(rand() * (grid.size - 2));
    if (ok(tx, tz)) return { x: tx, z: tz };
  }
  return null;
}
