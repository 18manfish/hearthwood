// Island layout: tiles, elevation (cliff levels + ramps), world objects and
// level-aware collision. Shared by server (authoritative validation) and
// client (prediction + rendering).

import { BIOMES, TREES, type BiomeId, type TreeSpecies } from './data/biomes.ts';
import { BUILDINGS, NON_BLOCKING, type BuildingType } from './data/buildings.ts';
import { fbm2D, Rng } from './rng.ts';

/** Side length of new home islands (tiles). */
export const ISLAND_SIZE = 72;
/** Islands created before the 1.5× enlargement keep their original size. */
export const LEGACY_ISLAND_SIZE = 48;
/** Highest cliff level players can terraform to. */
export const MAX_LEVEL = 3;
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
  /** Flowing fresh water connected to the sea (a pond has no connection). */
  River = 8,
}

/** Ramp directions point uphill: 0 = north (−z), 1 = east (+x), 2 = south (+z), 3 = west (−x). */
export const DIRS: readonly [number, number][] = [[0, -1], [1, 0], [0, 1], [-1, 0]];

export type ObjKind = 'tree' | 'stump' | 'rock' | 'bush' | 'mushroom' | 'flower' | 'furniture' | 'decor' | 'bird' | 'washed';

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
  /** Washed ashore: a message in a bottle (id in the bottle store). */
  bottle?: string;
  /** Birds: species id (see data/birds.ts) and when it flies off on its own. */
  bird?: string;
  leaveAt?: number;
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
  /** For interior counters: which service it provides (a shop type, town_hall…). */
  role?: BuildingType;
  /** Houses built by a resident belong to them (default: the island owner). */
  ownerId?: string;
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
  /** Sea the generator turned into beach (1) or river mouth (2) to make beaches wider; saved terrain gets it once. */
  beachBand?: Uint8Array;
}

export function tileAt(tiles: Uint8Array, size: number, x: number, z: number): Tile {
  if (x < 0 || z < 0 || x >= size || z >= size) return Tile.Sea;
  return tiles[z * size + x] as Tile;
}

export function isWaterTile(t: Tile): boolean {
  return t === Tile.Sea || t === Tile.Pond || t === Tile.River;
}

/** Fresh inland water (ponds and rivers). */
export function isFreshWater(t: Tile): boolean {
  return t === Tile.Pond || t === Tile.River;
}

/** Which kind of water a tile is, for fishing. */
export function waterKind(t: Tile): 'sea' | 'river' | 'pond' | null {
  return t === Tile.Sea ? 'sea' : t === Tile.River ? 'river' : t === Tile.Pond ? 'pond' : null;
}

/** Height of the water surface for a water tile at a cliff level. */
export const WATER_SURFACE = -0.2;

/**
 * Fresh water connected to the sea is a river, everything else a pond.
 * Returns the indices whose tile type changed.
 */
export function classifyWater(size: number, tiles: Uint8Array): number[] {
  const seen = new Uint8Array(size * size);
  const q: number[] = [];
  for (let i = 0; i < size * size; i++) if (tiles[i] === Tile.Sea) { seen[i] = 1; q.push(i); }
  while (q.length) {
    const i = q.pop()!;
    const x = i % size, z = Math.floor(i / size);
    for (const [dx, dz] of DIRS) {
      const nx = x + dx, nz = z + dz;
      if (nx < 0 || nz < 0 || nx >= size || nz >= size) continue;
      const j = nz * size + nx;
      if (seen[j] || (tiles[j] !== Tile.Pond && tiles[j] !== Tile.River)) continue;
      seen[j] = 1;
      q.push(j);
    }
  }
  const changed: number[] = [];
  for (let i = 0; i < size * size; i++) {
    const t = tiles[i];
    if (t !== Tile.Pond && t !== Tile.River) continue;
    const want = seen[i] ? Tile.River : Tile.Pond;
    if (t !== want) {
      tiles[i] = want;
      changed.push(i);
    }
  }
  return changed;
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
  if (o.kind === 'decor') return !isFlatDecor(o.item ?? '');
  return o.kind === 'stump' || o.kind === 'rock' || o.kind === 'bush' || o.kind === 'furniture';
}

/** Rugs and wall-mounted decor don't block movement. */
export function isFlatDecor(item: string) {
  return item.startsWith('rug') || item.startsWith('w_');
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
  /** Bridge deck level + 1 per tile (0 = no bridge). */
  readonly bridges: Uint8Array;

  constructor(size: number, tiles: Uint8Array, levels?: Uint8Array, ramps?: Uint8Array, paths?: Uint8Array) {
    this.size = size;
    this.tiles = tiles;
    this.levels = levels ?? new Uint8Array(size * size);
    this.ramps = ramps ?? new Uint8Array(size * size);
    this.blocked = new Uint8Array(size * size);
    this.occupied = new Uint8Array(size * size);
    this.reserved = new Uint8Array(size * size);
    this.paths = paths ?? new Uint8Array(size * size);
    this.bridges = new Uint8Array(size * size);
    this.recomputeReserved();
  }

  /** Mark ramps plus their approach and landing tiles as reserved. */
  recomputeReserved() {
    const size = this.size;
    this.reserved.fill(0);
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

  /** Change one tile's terrain (terraforming). Call `recomputeReserved` afterwards. */
  setTerrain(x: number, z: number, tile: Tile, level: number, ramp: number) {
    if (!this.inBounds(x, z)) return;
    const i = this.idx(x, z);
    this.tiles[i] = tile;
    this.levels[i] = level;
    this.ramps[i] = ramp;
    this.coast = null;
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

  /** Ramp direction at a tile, or -1. (The stored byte is dir + 1 + 4 × style.) */
  ramp(x: number, z: number): number {
    const v = this.inBounds(x, z) ? this.ramps[this.idx(x, z)] : 0;
    return v ? (v - 1) & 3 : -1;
  }

  /** Look of a ramp: 0 = grassy slope, then the kinds of stairs (see RAMP_STYLES). */
  rampStyle(x: number, z: number): number {
    const v = this.inBounds(x, z) ? this.ramps[this.idx(x, z)] : 0;
    return v ? (v - 1) >> 2 : 0;
  }

  addObject(o: WorldObject, sign = 1) {
    // Birds hop about freely and never get in the way.
    if (!this.inBounds(o.x, o.z) || o.kind === 'bird') return;
    const i = this.idx(o.x, o.z);
    this.occupied[i] += sign;
    if (objectBlocks(o)) this.blocked[i] += sign;
  }

  removeObject(o: WorldObject) {
    this.addObject(o, -1);
  }

  addBuilding(b: Building, sign = 1) {
    if (isBridge(b.type)) {
      // Bridges don't block: they make the water under them walkable at the bank's level.
      const deck = this.level(b.x, b.z) + 1;
      for (let dz = 0; dz < b.h; dz++)
        for (let dx = 0; dx < b.w; dx++) {
          if (!this.inBounds(b.x + dx, b.z + dz)) continue;
          const i = this.idx(b.x + dx, b.z + dz);
          this.occupied[i] += sign;
          if (isWaterTile(this.tiles[i] as Tile)) this.bridges[i] = sign > 0 ? deck : 0;
        }
      return;
    }
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
    this.bridges.fill(0);
    for (const o of objects) this.addObject(o);
    for (const b of buildings) this.addBuilding(b);
  }

  /** Can a character stand on this tile at all (ignoring elevation)? */
  walkableTile(x: number, z: number): boolean {
    if (!this.inBounds(x, z)) return false;
    const i = this.idx(x, z);
    if (!WALKABLE.has(this.tile(x, z)) && !this.bridges[i]) return false;
    return this.blocked[i] === 0;
  }

  /** The level you walk at: a bridge deck's, otherwise the tile's. */
  walkLevel(x: number, z: number): number {
    if (!this.inBounds(x, z)) return 0;
    const b = this.bridges[this.idx(x, z)];
    return b ? b - 1 : this.levels[this.idx(x, z)];
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
    if (ra < 0 && rb < 0) return this.walkLevel(ax, az) === this.walkLevel(bx, bz);
    if (ra >= 0 && rb >= 0) return ra === rb && this.level(ax, az) === this.level(bx, bz);
    return ra >= 0 ? this.rampLink(ax, az, ra, bx, bz) : this.rampLink(bx, bz, rb, ax, az);
  }

  private rampLink(rx: number, rz: number, d: number, ox: number, oz: number) {
    const L = this.level(rx, rz);
    const lo = this.walkLevel(ox, oz);
    const along = (ox - rx) * DIRS[d][0] + (oz - rz) * DIRS[d][1];
    if (lo === L) return along <= 0;
    if (lo === L + 1) return along === 1;
    return false;
  }

  /** Shallow sea a player can wade into (water up to the chest at most). */
  wadeableTile(x: number, z: number): boolean {
    if (!this.inBounds(x, z) || this.tile(x, z) !== Tile.Sea) return false;
    const i = this.idx(x, z);
    return this.blocked[i] === 0 && this.coastY(x + 0.5, z + 0.5, Tile.Sea) >= WADE_FLOOR;
  }

  /** Continuous-position walkability with a small body radius (no elevation check). Players may wade. */
  walkable(px: number, pz: number, r = 0.22, wade = true): boolean {
    const ok = (x: number, z: number) => this.walkableTile(x, z) || (wade && this.wadeableTile(x, z));
    return (
      ok(Math.floor(px - r), Math.floor(pz - r)) &&
      ok(Math.floor(px + r), Math.floor(pz - r)) &&
      ok(Math.floor(px - r), Math.floor(pz + r)) &&
      ok(Math.floor(px + r), Math.floor(pz + r))
    );
  }

  /** Movement check from one position to a nearby one, including cliffs and ramps. */
  canMove(fx: number, fz: number, tx: number, tz: number, r = 0.22, wade = true): boolean {
    if (!this.walkable(tx, tz, r, wade)) return false;
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

  /** Is this tile part of the smoothly sloping coast (beach at sea level, or the sea)? */
  isCoastal(x: number, z: number): boolean {
    const t = this.tile(x, z);
    return t === Tile.Sea || t === Tile.Dock || (t === Tile.Shore && this.level(x, z) === 0 && this.ramp(x, z) < 0);
  }

  /**
   * Ground height of the coast: beaches slope gently from the grass (BEACH_TOP)
   * down to just under the waterline at the sea (BEACH_EDGE), and the sea floor
   * keeps sloping down to its depth over SEA_SHELF tiles. `t` is the tile type
   * being drawn (a point on a tile border belongs to both tiles).
   */
  coastY(px: number, pz: number, t: Tile): number {
    const [dl, ds, dn] = this.coastDist(px, pz);
    if (t === Tile.Sea || t === Tile.Dock) return BEACH_EDGE + (SEA_DEEP - BEACH_EDGE) * smoothstep(dn / SEA_SHELF);
    if (dl <= 0) return BEACH_TOP;
    return BEACH_TOP + (BEACH_EDGE - BEACH_TOP) * smoothstep(dl / (dl + ds));
  }

  /** Distances to [land, sea, anything not sea], bilinear from a cached quarter-tile field. */
  private coastDist(px: number, pz: number): [number, number, number] {
    const f = (this.coast ??= this.buildCoastField());
    const gx = (px + COAST_MARGIN) * COAST_RES, gz = (pz + COAST_MARGIN) * COAST_RES;
    const ix = Math.floor(gx), iz = Math.floor(gz);
    if (ix < 0 || iz < 0 || ix >= f.w - 1 || iz >= f.w - 1) return [COAST_FAR, 0, COAST_FAR]; // open ocean
    const fx = gx - ix, fz = gz - iz;
    const out: [number, number, number] = [0, 0, 0];
    for (let k = 0; k < 3; k++) {
      const a = f.d[k], i = iz * f.w + ix;
      out[k] = (a[i] * (1 - fx) + a[i + 1] * fx) * (1 - fz) + (a[i + f.w] * (1 - fx) + a[i + f.w + 1] * fx) * fz;
    }
    return out;
  }

  private coast: { w: number; d: [Float32Array, Float32Array, Float32Array] } | null = null;

  private buildCoastField() {
    const M = COAST_MARGIN, R = COAST_FAR;
    const w = (this.size + 2 * M) * COAST_RES + 1;
    const d: [Float32Array, Float32Array, Float32Array] = [new Float32Array(w * w), new Float32Array(w * w), new Float32Array(w * w)];
    // Tile classes once: 0 sea, 1 beach & fresh water, 2 land; plus prefix sums to skip uniform areas.
    const o = M + R + 1, tw = this.size + 2 * o;
    const cls = new Uint8Array(tw * tw);
    const s0 = new Int32Array((tw + 1) * (tw + 1)), s2 = new Int32Array((tw + 1) * (tw + 1));
    for (let z = 0; z < tw; z++)
      for (let x = 0; x < tw; x++) {
        const k = this.tile(x - o, z - o);
        const c = k === Tile.Sea || k === Tile.Dock ? 0 : (k === Tile.Shore && this.level(x - o, z - o) === 0) || k === Tile.Pond || k === Tile.River ? 1 : 2;
        cls[z * tw + x] = c;
        const j = (z + 1) * (tw + 1) + x + 1;
        s0[j] = s0[j - 1] + s0[j - tw - 1] - s0[j - tw - 2] + (c === 0 ? 1 : 0);
        s2[j] = s2[j - 1] + s2[j - tw - 1] - s2[j - tw - 2] + (c === 2 ? 1 : 0);
      }
    const box = (s: Int32Array, x0: number, z0: number, x1: number, z1: number) =>
      s[(z1 + 1) * (tw + 1) + x1 + 1] - s[z0 * (tw + 1) + x1 + 1] - s[(z1 + 1) * (tw + 1) + x0] + s[z0 * (tw + 1) + x0];
    const all = (2 * R + 1) * (2 * R + 1);
    for (let j = 0; j < w; j++)
      for (let i = 0; i < w; i++) {
        const px = i / COAST_RES - M, pz = j / COAST_RES - M;
        const idx = j * w + i;
        // Window of tiles that can be within R (in class-grid coordinates).
        const x0 = Math.floor(px) - R + o, z0 = Math.floor(pz) - R + o;
        const x1 = x0 + 2 * R, z1 = z0 + 2 * R;
        const n0 = box(s0, x0, z0, x1, z1), n2 = box(s2, x0, z0, x1, z1);
        if (n0 === all) { d[0][idx] = R; d[1][idx] = 0; d[2][idx] = R; continue; }
        if (n2 === all) { d[0][idx] = 0; d[1][idx] = R; d[2][idx] = 0; continue; }
        let dl = R, ds = R, dn = R;
        for (let z = z0; z <= z1; z++) {
          const dz = Math.max(z - o - pz, 0, pz - (z - o + 1));
          if (dz >= R) continue;
          for (let x = x0; x <= x1; x++) {
            const dx = Math.max(x - o - px, 0, px - (x - o + 1));
            if (dx >= R) continue;
            const c = cls[z * tw + x];
            const dd = Math.hypot(dx, dz);
            if (c === 0) { if (dd < ds) ds = dd; }
            else {
              if (dd < dn) dn = dd;
              if (c === 2 && dd < dl) dl = dd; // ponds & river mouths cut into the beach instead of raising it
            }
          }
        }
        d[0][idx] = dl;
        d[1][idx] = ds;
        d[2][idx] = dn;
      }
    return { w, d };
  }

  /** Height of the walkable surface at a continuous position. */
  surfaceY(px: number, pz: number): number {
    const x = Math.floor(px), z = Math.floor(pz);
    const t = this.tile(x, z);
    const bridge = this.inBounds(x, z) ? this.bridges[this.idx(x, z)] : 0;
    if (bridge) return (bridge - 1) * CLIFF + BRIDGE_DECK;
    if ((t === Tile.Shore || t === Tile.Sea) && this.isCoastal(x, z)) return this.coastY(px, pz, t);
    const base = baseHeight(t) + this.level(x, z) * CLIFF;
    const d = this.ramp(x, z);
    if (d < 0) return t === Tile.Dock ? 0.16 : isWaterTile(t) ? WATER_SURFACE + this.level(x, z) * CLIFF : base;
    const fx = px - x, fz = pz - z;
    const f = d === 0 ? 1 - fz : d === 1 ? fx : d === 2 ? fz : 1 - fx;
    return base + f * CLIFF;
  }

  /** Corner heights of a tile (for terrain meshes): [x0z0, x1z0, x1z1, x0z1]. */
  cornerHeights(x: number, z: number): [number, number, number, number] {
    const t = this.tile(x, z);
    if (this.isCoastal(x, z)) return [this.coastY(x, z, t), this.coastY(x + 1, z, t), this.coastY(x + 1, z + 1, t), this.coastY(x, z + 1, t)];
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

/** Beaches: height where the sand meets the grass, and at the water's edge (just under the sea surface). */
export const BEACH_TOP = 0.12;
export const BEACH_EDGE = -0.18;
/** Tiles from the coast until the sea floor reaches full depth, and that depth. */
export const SEA_SHELF = 4.5;
export const SEA_DEEP = -1.6;
/** Visual sea level, and the deepest sea floor you can wade on (water up to the chest). */
export const SEA_LEVEL = -0.12;
export const WADE_FLOOR = SEA_LEVEL - 0.6;
const COAST_MARGIN = 10;
/** Land-mask value where the sea starts now (beaches run from 0.74; the sea used to start at 0.83). */
const BEACH_OUTER = 0.92;
const COAST_FAR = 5;
/** Coast field samples per tile (bilinear in between). */
const COAST_RES = 2;

/** Ramp looks (stored in the ramp byte). */
export const RAMP_STYLES = ['slope', 'stone_stairs', 'wood_stairs', 'log_steps'] as const;
export type RampStyle = (typeof RAMP_STYLES)[number];

function smoothstep(t: number) {
  const u = Math.min(1, Math.max(0, t));
  return u * u * (3 - 2 * u);
}

export function baseHeight(t: Tile): number {
  switch (t) {
    case Tile.Sea: return -0.7;
    case Tile.Dock: return -0.7;
    case Tile.Pond: return -0.55;
    case Tile.River: return -0.55;
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
      if (x >= dockX - 2 && x <= dockX + 3 && z >= beachZ - 1) continue;
      tiles[i] = Tile.Shore;
      beachBand[i] = 1;
    }
  for (let changed = true; changed; ) {
    changed = false;
    for (let z = 2; z < size - 2; z++)
      for (let x = 2; x < size - 2; x++) {
        const i = z * size + x;
        if (beachBand[i] !== 1) continue;
        const v = vAt(x, z);
        for (const [dx, dz] of DIRS) {
          const j = (z + dz) * size + x + dx;
          if (tiles[j] === Tile.River && levels[j] === 0 && vAt(x + dx, z + dz) < v) {
            tiles[i] = Tile.River;
            beachBand[i] = 2;
            changed = true;
            break;
          }
        }
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

/** Is a building's footprint adjacent to (or under) point px,pz within `reach`? */
export function nearBuilding(b: Building, px: number, pz: number, reach = 1.6): boolean {
  const cx = Math.max(b.x, Math.min(px, b.x + b.w));
  const cz = Math.max(b.z, Math.min(pz, b.z + b.h));
  const dx = px - cx;
  const dz = pz - cz;
  return dx * dx + dz * dz <= reach * reach;
}

/** Height of a bridge deck above its bank's level. */
export const BRIDGE_DECK = 0.28;

export function isBridge(type: string) {
  return type.startsWith('bridge_');
}

/** Why a building can't go at (x, z) – null if it can. Bridges must span water between two banks. */
export function placeError(g: Grid, type: BuildingType, x: number, z: number): string | null {
  const { w, h } = BUILDINGS[type];
  if (!isBridge(type)) return g.canPlace(x, z, w, h) ? null : 'Not enough free space there.';
  const along = type.startsWith('bridge_ns'); // the bridge runs north–south (along z)
  const len = along ? h : w;
  const lanes = along ? w : h;
  const at = (i: number, k: number) => (along ? [x + k, z + i] : [x + i, z + k]) as [number, number];
  const [bx0, bz0] = at(0, 0);
  if (!g.inBounds(bx0, bz0)) return 'Out of bounds.';
  const L = g.level(bx0, bz0);
  for (let k = 0; k < lanes; k++)
    for (const i of [0, len - 1]) {
      const [tx, tz] = at(i, k);
      const et = g.tile(tx, tz);
      if (!g.inBounds(tx, tz) || (et !== Tile.Ground && et !== Tile.Shore) || g.level(tx, tz) !== L || g.ramp(tx, tz) >= 0) return 'Both ends of a bridge need flat ground at the same height.';
      if (g.occupied[tz * g.size + tx]) return 'Clear the ends of the bridge first.';
    }
  for (let i = 1; i < len - 1; i++)
    for (let k = 0; k < lanes; k++) {
      const [tx, tz] = at(i, k);
      const t = g.tile(tx, tz);
      if (t !== Tile.River && t !== Tile.Pond) return 'Bridges go across rivers and ponds.';
      if (g.level(tx, tz) > L || g.occupied[tz * g.size + tx]) return 'Something is in the way.';
    }
  return null;
}

/** Is a point standing in front of a building's door (south side, centred)? */
export function atDoor(b: Building, px: number, pz: number): boolean {
  const doorX = b.x + b.w / 2;
  const front = b.z + b.h;
  return Math.abs(px - doorX) <= 0.8 && pz >= front - 0.15 && pz <= front + 1.5;
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
