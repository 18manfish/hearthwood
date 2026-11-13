// The coast's shape: beaches slope from the grass into the sea, the sea floor shelves
// down, and sea-level rivers cut soft banks. Heights come from a cached distance field
// (distances to land, sea and river), built once per terrain change.

import { smoothstep } from '../math.ts';
import { BEACH_EDGE, BEACH_TOP, SEA_DEEP, SEA_SHELF } from './constants.ts';
import type { Grid } from './grid.ts';
import { Tile } from './tiles.ts';

/** Tiles of open sea around the island the field covers. */
const COAST_MARGIN = 10;

/** Distances are capped here (tiles); further away counts as "far". */
const COAST_FAR = 5;

/** How far from a sea-level river its sandy bank dips down (tiles). */
const RIVER_BANK = 0.55;

/** Coast field samples per tile (bilinear in between). */
const COAST_RES = 2;

/** Is this tile part of the smoothly sloping coast (beach at sea level, or the sea)? */
export function isCoastal(g: Grid, x: number, z: number): boolean {
  const t = g.tile(x, z);
  if (t === Tile.Sea || t === Tile.Dock) return true;
  // Beaches and rivers at sea level: rivers get soft sandy banks and run out into the sea floor.
  return (t === Tile.Shore || t === Tile.River) && g.level(x, z) === 0 && g.ramp(x, z) < 0;
}

/**
 * Ground height of the coast: beaches slope gently from the grass (BEACH_TOP)
 * down to just under the waterline at the sea (BEACH_EDGE), and the sea floor
 * keeps sloping down to its depth over SEA_SHELF tiles. `t` is the tile type
 * being drawn (a point on a tile border belongs to both tiles).
 */
export function coastY(g: Grid, px: number, pz: number, t: Tile): number {
  const [dl, ds, dn, dr] = g.coastField().dist(px, pz);
  if (t === Tile.Sea || t === Tile.Dock || t === Tile.River) return BEACH_EDGE + (SEA_DEEP - BEACH_EDGE) * smoothstep(dn / SEA_SHELF);
  // The beach slopes down to the sea; beside a river it only dips right at the bank.
  const h = dl <= 0 ? BEACH_TOP : BEACH_TOP + (BEACH_EDGE - BEACH_TOP) * smoothstep(dl / (dl + ds));
  // Near the sea the river's banks open out like a funnel, so the mouth blends into the beach.
  const bank = RIVER_BANK + 1.6 * (1 - smoothstep(ds / 3.5));
  return dr >= bank ? h : BEACH_EDGE + (h - BEACH_EDGE) * smoothstep(dr / bank);
}

/** Distances around the island, sampled COAST_RES times per tile. */
export class CoastField {
  readonly w: number;
  readonly d: Float32Array[];


  constructor(g: Grid) {
    const M = COAST_MARGIN, R = COAST_FAR;
    const w = (g.size + 2 * M) * COAST_RES + 1;
    const d = [0, 1, 2, 3].map(() => new Float32Array(w * w));
    // Tile classes once: 0 sea, 1 beach & fresh water, 2 land, 3 sea-level river; plus prefix sums to skip uniform areas.
    const o = M + R + 1, tw = g.size + 2 * o;
    const cls = new Uint8Array(tw * tw);
    const s0 = new Int32Array((tw + 1) * (tw + 1)), s2 = new Int32Array((tw + 1) * (tw + 1));
    for (let z = 0; z < tw; z++)
      for (let x = 0; x < tw; x++) {
        const k = g.tile(x - o, z - o);
        const lv0 = g.level(x - o, z - o) === 0;
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
    // Round off the sea floor's distance (it was measured to tile squares, so its contours
    // followed the tile staircase): a soft blur over about a tile, keeping the shore line at 0.
    {
      // Signed (negative on land, by the distance to the sea or a river) so a straight shore keeps its exact slope.
      const src = d[2], orig = src.slice(), tmp = new Float32Array(w * w), BR = COAST_RES + 1;
      for (let k = 0; k < w * w; k++) if (orig[k] === 0) src[k] = -Math.min(d[1][k], d[3][k]);
      for (let pass = 0; pass < 2; pass++) {
        for (let j = 0; j < w; j++)
          for (let i = 0; i < w; i++) {
            let s = 0, n = 0;
            for (let k = Math.max(0, i - BR); k <= Math.min(w - 1, i + BR); k++) { s += src[j * w + k]; n++; }
            tmp[j * w + i] = s / n;
          }
        for (let j = 0; j < w; j++)
          for (let i = 0; i < w; i++) {
            let s = 0, n = 0;
            for (let k = Math.max(0, j - BR); k <= Math.min(w - 1, j + BR); k++) { s += tmp[k * w + i]; n++; }
            src[j * w + i] = orig[j * w + i] === 0 ? -Math.min(d[1][j * w + i], d[3][j * w + i]) : s / n;
          }
      }
      for (let k = 0; k < w * w; k++) src[k] = orig[k] === 0 ? 0 : Math.max(0, src[k]);
    }
    this.w = w;
    this.d = d;
  }

  /** Distances to [land, sea, anything not sea or river, sea-level river], bilinear from a cached field. */
  dist(px: number, pz: number): [number, number, number, number] {
    const gx = (px + COAST_MARGIN) * COAST_RES, gz = (pz + COAST_MARGIN) * COAST_RES;
    const ix = Math.floor(gx), iz = Math.floor(gz);
    if (ix < 0 || iz < 0 || ix >= this.w - 1 || iz >= this.w - 1) return [COAST_FAR, 0, COAST_FAR, COAST_FAR]; // open ocean
    const fx = gx - ix, fz = gz - iz;
    const out: [number, number, number, number] = [0, 0, 0, 0];
    for (let k = 0; k < 4; k++) {
      const a = this.d[k], i = iz * this.w + ix;
      out[k] = (a[i] * (1 - fx) + a[i + 1] * fx) * (1 - fz) + (a[i + this.w] * (1 - fx) + a[i + this.w + 1] * fx) * fz;
    }
    return out;
  }
}
