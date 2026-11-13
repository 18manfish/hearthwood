// Collision / occupancy grid: tiles + elevation + objects + buildings, level-aware movement
// rules, and the heights everything stands on (coast, docks). Shared by server and client.

import { NON_BLOCKING } from '../data/buildings.ts';
import { smoothstep } from '../math.ts';
import { baseHeight, BEACH_EDGE, BEACH_TOP, BRIDGE_DECK, CLIFF, DOCK_Y, RAMP_STYLES, SEA_DEEP, SEA_LEVEL, SEA_SHELF, WADE_FLOOR, WATER_SURFACE } from './constants.ts';
import { type Building, isBridge, objectBlocks, type WorldObject } from './objects.ts';
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
    if (t === Tile.Sea || t === Tile.Dock) return true;
    // Beaches and rivers at sea level: rivers get soft sandy banks and run out into the sea floor.
    return (t === Tile.Shore || t === Tile.River) && this.level(x, z) === 0 && this.ramp(x, z) < 0;
  }

  /**
   * Ground height of the coast: beaches slope gently from the grass (BEACH_TOP)
   * down to just under the waterline at the sea (BEACH_EDGE), and the sea floor
   * keeps sloping down to its depth over SEA_SHELF tiles. `t` is the tile type
   * being drawn (a point on a tile border belongs to both tiles).
   */
  coastY(px: number, pz: number, t: Tile): number {
    const [dl, ds, dn, dr] = this.coastDist(px, pz);
    if (t === Tile.Sea || t === Tile.Dock || t === Tile.River) return BEACH_EDGE + (SEA_DEEP - BEACH_EDGE) * smoothstep(dn / SEA_SHELF);
    // The beach slopes down to the sea; beside a river it only dips right at the bank.
    const h = dl <= 0 ? BEACH_TOP : BEACH_TOP + (BEACH_EDGE - BEACH_TOP) * smoothstep(dl / (dl + ds));
    // Near the sea the river's banks open out like a funnel, so the mouth blends into the beach.
    const bank = RIVER_BANK + 1.6 * (1 - smoothstep(ds / 3.5));
    return dr >= bank ? h : BEACH_EDGE + (h - BEACH_EDGE) * smoothstep(dr / bank);
  }

  /** Distances to [land, sea, anything not sea or river, sea-level river], bilinear from a cached field. */
  private coastDist(px: number, pz: number): [number, number, number, number] {
    const f = (this.coast ??= this.buildCoastField());
    const gx = (px + COAST_MARGIN) * COAST_RES, gz = (pz + COAST_MARGIN) * COAST_RES;
    const ix = Math.floor(gx), iz = Math.floor(gz);
    if (ix < 0 || iz < 0 || ix >= f.w - 1 || iz >= f.w - 1) return [COAST_FAR, 0, COAST_FAR, COAST_FAR]; // open ocean
    const fx = gx - ix, fz = gz - iz;
    const out: [number, number, number, number] = [0, 0, 0, 0];
    for (let k = 0; k < 4; k++) {
      const a = f.d[k], i = iz * f.w + ix;
      out[k] = (a[i] * (1 - fx) + a[i + 1] * fx) * (1 - fz) + (a[i + f.w] * (1 - fx) + a[i + f.w + 1] * fx) * fz;
    }
    return out;
  }

  private coast: { w: number; d: Float32Array[] } | null = null;

  private buildCoastField() {
    const M = COAST_MARGIN, R = COAST_FAR;
    const w = (this.size + 2 * M) * COAST_RES + 1;
    const d = [0, 1, 2, 3].map(() => new Float32Array(w * w));
    // Tile classes once: 0 sea, 1 beach & fresh water, 2 land, 3 sea-level river; plus prefix sums to skip uniform areas.
    const o = M + R + 1, tw = this.size + 2 * o;
    const cls = new Uint8Array(tw * tw);
    const s0 = new Int32Array((tw + 1) * (tw + 1)), s2 = new Int32Array((tw + 1) * (tw + 1));
    for (let z = 0; z < tw; z++)
      for (let x = 0; x < tw; x++) {
        const k = this.tile(x - o, z - o);
        const lv0 = this.level(x - o, z - o) === 0;
        const c = k === Tile.Sea || k === Tile.Dock ? 0 : k === Tile.River && lv0 ? 3 : (k === Tile.Shore && lv0) || k === Tile.Pond || k === Tile.River ? 1 : 2;
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
        if (n0 === all) { d[0][idx] = R; d[1][idx] = 0; d[2][idx] = R; d[3][idx] = R; continue; }
        if (n2 === all) { d[0][idx] = 0; d[1][idx] = R; d[2][idx] = 0; d[3][idx] = R; continue; }
        let dl = R, ds = R, dn = R, dr = R;
        for (let z = z0; z <= z1; z++) {
          const dz = Math.max(z - o - pz, 0, pz - (z - o + 1));
          if (dz >= R) continue;
          for (let x = x0; x <= x1; x++) {
            const dx = Math.max(x - o - px, 0, px - (x - o + 1));
            if (dx >= R) continue;
            const c = cls[z * tw + x];
            const dd = Math.hypot(dx, dz);
            if (c === 0) { if (dd < ds) ds = dd; }
            else if (c === 3) { if (dd < dr) dr = dd; }
            else {
              if (dd < dn) dn = dd;
              if (c === 2 && dd < dl) dl = dd; // ponds & river mouths cut into the beach instead of raising it
            }
          }
        }
        d[0][idx] = dl;
        d[1][idx] = ds;
        d[2][idx] = dn;
        d[3][idx] = dr;
      }
    return { w, d };
  }

  /**
   * Piers reach dry land: where a pier's land end meets the beach, a gangway runs
   * from the deck down onto the sand (one to three tiles, until the sand is dry).
   * Returns the gangway's height at a point and which way the pier lies, or null.
   */
  dockRamp(px: number, pz: number): { y: number; dx: number; dz: number; s: number; len: number; from: number; to: number } | null {
    const x = Math.floor(px), z = Math.floor(pz);
    const t = this.tile(x, z);
    if (t !== Tile.Shore && t !== Tile.Ground) return null;
    for (const [dx, dz] of DIRS)
      for (let k = 1; k <= 3; k++) {
        const ex = x + dx * k, ez = z + dz * k; // the pier's land-end tile
        if (this.tile(ex, ez) !== Tile.Dock || this.tile(ex + dx, ez + dz) !== Tile.Dock || this.tile(ex + 2 * dx, ez + 2 * dz) !== Tile.Dock) continue;
        let between = true;
        for (let j = 1; j < k; j++) if (this.tile(x + dx * j, z + dz * j) !== Tile.Shore) between = false;
        if (!between) continue;
        // The whole width of the pier shares one gangway: same length, same landing height.
        const cols: [number, number][] = [];
        for (const sgn of [1, -1])
          for (let w = sgn > 0 ? 0 : 1; w < 6; w++) {
            const cx = ex + dz * w * sgn, cz = ez + dx * w * sgn;
            if (this.tile(cx, cz) !== Tile.Dock || this.tile(cx + dx, cz + dz) !== Tile.Dock || this.tile(cx - dx, cz - dz) === Tile.Dock) break;
            cols.push([cx, cz]);
          }
        let len = 1;
        for (const [cx, cz] of cols) len = Math.max(len, this.dockRampLen(cx, cz, dx, dz));
        if (k > len) continue;
        // Distance from the pier's edge back towards land, along the pier's axis.
        const edge = dx ? (dx > 0 ? ex : ex + 1) : dz > 0 ? ez : ez + 1;
        const s = dx ? Math.abs(edge - px) : Math.abs(edge - pz);
        let to = -Infinity;
        for (const [cx, cz] of cols) {
          const endX = dx ? edge - dx * len - dx * 0.01 : cx + 0.5, endZ = dz ? edge - dz * len - dz * 0.01 : cz + 0.5;
          to = Math.max(to, this.groundAt(endX, endZ));
        }
        return { y: DOCK_Y + (to - DOCK_Y) * Math.min(1, s / len), dx, dz, s, len, from: DOCK_Y, to };
      }
    return null;
  }

  /** Gangway length (tiles, 1–3) from the pier end at (ex, ez), pier pointing (dx, dz) away from land: until the sand is dry. */
  dockRampLen(ex: number, ez: number, dx: number, dz: number): number {
    const edge = dx ? (dx > 0 ? ex : ex + 1) : dz > 0 ? ez : ez + 1;
    for (let len = 1; len <= 3; len++) {
      const tx = ex - dx * len, tz = ez - dz * len;
      const t = this.tile(tx, tz);
      if (t !== Tile.Shore && t !== Tile.Ground) return Math.max(1, len - 1);
      const cx = dx ? edge - dx * (len + 0.01) : ex + 0.5, cz = dz ? edge - dz * (len + 0.01) : ez + 0.5;
      if (this.groundAt(cx, cz) >= SEA_LEVEL + 0.08) return len;
    }
    return 3;
  }

  /** Ground height without bridges or gangways (sand, grass, ramps). */
  private groundAt(px: number, pz: number): number {
    const x = Math.floor(px), z = Math.floor(pz);
    const t = this.tile(x, z);
    if (this.isCoastal(x, z) && t !== Tile.River) return this.coastY(px, pz, t);
    return baseHeight(t) + this.level(x, z) * CLIFF;
  }

  /** Height of the walkable surface at a continuous position. */
  surfaceY(px: number, pz: number): number {
    const x = Math.floor(px), z = Math.floor(pz);
    const t = this.tile(x, z);
    const bridge = this.inBounds(x, z) ? this.bridges[this.idx(x, z)] : 0;
    if (bridge) return (bridge - 1) * CLIFF + BRIDGE_DECK;
    if (t === Tile.Shore || (t === Tile.Ground && this.level(x, z) === 0)) {
      const r = this.dockRamp(px, pz);
      if (r) return Math.max(r.y, this.groundAt(px, pz));
    }
    if ((t === Tile.Shore || t === Tile.Sea) && this.isCoastal(x, z)) return this.coastY(px, pz, t);
    const base = baseHeight(t) + this.level(x, z) * CLIFF;
    const d = this.ramp(x, z);
    if (d < 0) return t === Tile.Dock ? DOCK_Y : isWaterTile(t) ? WATER_SURFACE + this.level(x, z) * CLIFF : base;
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

const COAST_MARGIN = 10;

const COAST_FAR = 5;

/** How far from a sea-level river its sandy bank dips down (tiles). */
const RIVER_BANK = 0.55;

/** Coast field samples per tile (bilinear in between). */
const COAST_RES = 2;
