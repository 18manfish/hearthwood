// Collision / occupancy grid: tiles + elevation + objects + buildings, level-aware movement
// rules, and the heights everything stands on (coast, docks). Shared by server and client.

import { NON_BLOCKING } from '../data/buildings.ts';
import { CoastField, coastY, isCoastal } from './coast.ts';
import { dockRamp, dockRampLen } from './dock.ts';
import { cornerHeights, surfaceY } from './heights.ts';
import { WADE_FLOOR } from './constants.ts';
import { type Building, isBridge, isTransient, objectBlocks, objectTiles, type WorldObject } from './objects.ts';
import { DIRS, isWaterTile, Tile, tileAt } from './tiles.ts';

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
  /** Bridge deck level + 1 per tile under a bridge, ends included (0 = no bridge). */
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

  /** Index of a tile in the flat arrays. */
  idx(x: number, z: number) {
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
    // Birds hop about and fish swim freely: they never get in the way.
    if (isTransient(o)) return;
    const blocks = objectBlocks(o);
    for (const [x, z] of objectTiles(o)) {
      if (!this.inBounds(x, z)) continue;
      const i = this.idx(x, z);
      this.occupied[i] += sign;
      if (blocks) this.blocked[i] += sign;
    }
  }

  removeObject(o: WorldObject) {
    this.addObject(o, -1);
  }

  addBuilding(b: Building, sign = 1) {
    if (isBridge(b.type)) {
      // Bridges don't block: they make the water under them walkable at the bank's level, and
      // you stand on the deck over the whole footprint – also on its ends, which may be sand
      // that dips down towards the water (the deck is drawn flat from end to end).
      const deck = this.level(b.x, b.z) + 1;
      for (let dz = 0; dz < b.h; dz++)
        for (let dx = 0; dx < b.w; dx++) {
          if (!this.inBounds(b.x + dx, b.z + dz)) continue;
          const i = this.idx(b.x + dx, b.z + dz);
          this.occupied[i] += sign;
          this.bridges[i] = sign > 0 ? deck : 0;
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
    // Piers have no way down into the sea (or up out of it): off the deck or the gangway only onto land.
    const sa = this.tile(ax, az) === Tile.Sea, sb = this.tile(bx, bz) === Tile.Sea;
    if (sa !== sb && (sa ? this.isPier(bx, bz) : this.isPier(ax, az))) return false;
    const ra = this.ramp(ax, az);
    const rb = this.ramp(bx, bz);
    if (ra < 0 && rb < 0) return this.walkLevel(ax, az) === this.walkLevel(bx, bz);
    if (ra >= 0 && rb >= 0) return ra === rb && this.level(ax, az) === this.level(bx, bz);
    return ra >= 0 ? this.rampLink(ax, az, ra, bx, bz) : this.rampLink(bx, bz, rb, ax, az);
  }

  /** A dock deck tile, or a beach tile its gangway runs over. */
  isPier(x: number, z: number): boolean {
    const t = this.tile(x, z);
    if (t === Tile.Dock) return true;
    return (t === Tile.Shore || t === Tile.Ground) && dockRamp(this, x + 0.5, z + 0.5) !== null;
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
    return isCoastal(this, x, z);
  }

  /** Ground height of the coast (see coast.ts). `t` is the tile type being drawn. */
  coastY(px: number, pz: number, t: Tile): number {
    return coastY(this, px, pz, t);
  }

  /** The cached coast distance field (rebuilt after terrain changes). */
  coastField(): CoastField {
    return (this.coast ??= new CoastField(this));
  }

  private coast: CoastField | null = null;

  /** Gangway height at a point next to a pier, or null (see dock.ts). */
  dockRamp(px: number, pz: number) {
    return dockRamp(this, px, pz);
  }

  dockRampLen(ex: number, ez: number, dx: number, dz: number): number {
    return dockRampLen(this, ex, ez, dx, dz);
  }

  /** Height of the walkable surface at a continuous position (see heights.ts). */
  surfaceY(px: number, pz: number): number {
    return surfaceY(this, px, pz);
  }

  /** Corner heights of a tile (for terrain meshes): [x0z0, x1z0, x1z1, x0z1]. */
  cornerHeights(x: number, z: number): [number, number, number, number] {
    return cornerHeights(this, x, z);
  }
}
