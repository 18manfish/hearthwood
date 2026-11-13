// Tiles built from the Blender tileset: every tile is four quarters, each picking a
// flat top, a cliff edge (three variants), a rounded outer corner or an inner
// corner, stretched to the real drop. Ramps use the same pieces along their slope.

import * as THREE from 'three';
import { CLIFF, Tile, hashString, isFreshWater, isWaterTile } from '@hearthwood/shared';
import { piece, type Family } from '../tileAssets.ts';
import type { Corners, TerrainCtx } from './context.ts';

export function makeTiledTile(ctx: TerrainCtx) {
  const { g0, cliff, out, snowy, tileColor, borderY } = ctx;
  const QUARTERS: [number, number][] = [[1, 1], [-1, 1], [-1, -1], [1, -1]];
  const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3(), tmpN = new THREE.Vector3();
  const faceCol = new THREE.Color(), mixCol = new THREE.Color();
  /**
   * Place one quarter piece. Its top follows `topAt` (flat ground or a ramp's
   * slope) and its foot reaches `footAt` (whatever lies below), per vertex.
   */
  const emitPiece = (
    arr: Float32Array, swap: boolean, sx: number, sz: number, cx: number, cz: number,
    topAt: (X: number, Z: number) => number, footAt: (X: number, Z: number) => number,
    fam: Family, topC: THREE.Color, faceC: THREE.Color, floorC: THREE.Color,
  ) => {
    const flip = sx * sz * (swap ? -1 : 1) < 0;
    const v: number[][] = [[], [], []];
    const ly = [0, 0, 0], dr = [0, 0, 0];
    for (let i = 0; i < arr.length; i += 9) {
      for (let k = 0; k < 3; k++) {
        let lx = arr[i + k * 3], lz = arr[i + k * 3 + 2];
        const y = arr[i + k * 3 + 1];
        if (swap) [lx, lz] = [lz, lx];
        const X = cx + sx * lx, Z = cz + sz * lz;
        const top = topAt(X, Z);
        const drop = Math.max(0, top - footAt(X, Z));
        const kk = flip && k > 0 ? 3 - k : k;
        v[kk] = [X, top + y * drop, Z];
        ly[kk] = y;
        dr[kk] = drop;
      }
      const [a, b, d] = v;
      tmpA.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      tmpB.set(d[0] - a[0], d[1] - a[1], d[2] - a[2]);
      tmpN.crossVectors(tmpA, tmpB);
      const len = tmpN.length();
      if (len < 1e-9) continue;
      const ny = Math.abs(tmpN.y) / len;
      const lmin = Math.min(...ly), lmax = Math.max(...ly);
      let col: THREE.Color;
      if ((ny > 0.8 && lmin > -0.03) || dr[0] + dr[1] + dr[2] < 0.15) col = topC; // tops (and walls squashed flat)
      else if (ny > 0.8 && lmax < -0.97) col = floorC;
      else {
        faceCol.copy(faceC);
        const ym = (a[1] + b[1] + d[1]) / 3;
        if (fam === 'cliff') faceCol.offsetHSL(0, 0, ((Math.floor(ym * 3) & 1) - 0.5) * 0.05);
        if (ny > 0.8) faceCol.offsetHSL(0, 0, 0.05); // ledges catch the light
        col = ny > 0.5 && lmin > -0.08 ? mixCol.copy(topC).lerp(faceCol, 0.5) : faceCol;
      }
      out.tri(a, b, d, col);
    }
  };
  const dirt = new THREE.Color(snowy ? '#e6e9ec' : '#9a7a55');
  const waterTop = (wx: number, wz: number) => (g0.tile(wx, wz) === Tile.Sea ? 0 : g0.level(wx, wz)) * CLIFF;
  /** Any tile that isn't coast: flat ground or a ramp, with rocky edges where its neighbours are lower. */
  return (x: number, z: number, t: Tile, h: Corners, c: THREE.Color) => {
    const fam: Family = t === Tile.Ground || t === Tile.Ramp ? 'cliff' : 'bank';
    const faceC = fam === 'cliff' ? cliff : c.clone().multiplyScalar(0.72);
    const topC = t === Tile.Ramp && g0.rampStyle(x, z) > 0 ? dirt : c;
    // My surface (bilinear: flat, or a ramp's plane) and my neighbours' surfaces at a point.
    const T = (X: number, Z: number) => {
      const fx = Math.min(1, Math.max(0, X - x)), fz = Math.min(1, Math.max(0, Z - z));
      return (h[0] * (1 - fx) + h[1] * fx) * (1 - fz) + (h[3] * (1 - fx) + h[2] * fx) * fz;
    };
    const N = (dx: number, dz: number, X: number, Z: number) => borderY(x + dx, z + dz, X, Z);
    const cx = x + 0.5, cz = z + 0.5;
    const flats: number[] = [];
    for (let q = 0; q < 4; q++) {
      const [sx, sz] = QUARTERS[q];
      const Xe = cx + sx * 0.5, Ze = cz + sz * 0.5;
      const lowerA = [0, 0.25, 0.5].some((o) => N(sx, 0, Xe, cz + sz * o) < T(Xe, cz + sz * o) - 0.01);
      const lowerB = [0, 0.25, 0.5].some((o) => N(0, sz, cx + sx * o, Ze) < T(cx + sx * o, Ze) - 0.01);
      // A coast tile touching only our corner is covered by the beaches beside it.
      const lowerD = N(sx, sz, Xe, Ze) < T(Xe, Ze) - 0.01 && (lowerA || lowerB || !g0.isCoastal(x + sx, z + sz));
      const footA = (X: number, Z: number) => N(sx, 0, Xe, Math.min(z + 1, Math.max(z, Z)));
      const footB = (X: number, Z: number) => N(0, sz, Math.min(x + 1, Math.max(x, X)), Ze);
      const footD = N(sx, sz, Xe, Ze);
      const variant = hashString(`${x},${z},${q}`) % 3;
      // Beside a waterfall: a sharp rock corner (two straight faces), so the falling
      // water tucks into the rock instead of leaving a rounded gap.
      const fallBeside = (ux: number, uz: number, lx: number, lz: number) =>
        isFreshWater(g0.tile(ux, uz)) && isWaterTile(g0.tile(lx, lz)) && waterTop(lx, lz) < waterTop(ux, uz) - 0.01;
      if (lowerA && lowerB && (fallBeside(x + sx, z, x + sx, z + sz) || fallBeside(x, z + sz, x + sx, z + sz))) {
        emitPiece(piece(fam, 'edge', variant), false, sx, sz, cx, cz, T, footA, fam, topC, faceC, tileColor(x + sx, z));
        emitPiece(piece(fam, 'edge', (variant + 1) % 3), true, sx, sz, cx, cz, T, footB, fam, topC, faceC, tileColor(x, z + sz));
      } else if (lowerA && lowerB) {
        const fA = footA(Xe, Ze), fB = footB(Xe, Ze);
        const floorC = tileColor(fA <= fB ? x + sx : x, fA <= fB ? z : z + sz);
        emitPiece(piece(fam, 'outer'), false, sx, sz, cx, cz, T, (X, Z) => Math.min(footA(X, Z), footB(X, Z)), fam, topC, faceC, floorC);
        // Two-level corner: the layer below needs its own inner corner.
        const mid = Math.min(fA, fB);
        if (footD < mid - 0.01) emitPiece(piece(fam, 'inner'), false, sx, sz, cx, cz, () => mid - 0.003, () => footD, fam, tileColor(x + sx, z), faceC, tileColor(x + sx, z + sz));
      } else if (lowerA) emitPiece(piece(fam, 'edge', variant), false, sx, sz, cx, cz, T, footA, fam, topC, faceC, tileColor(x + sx, z));
      else if (lowerB) emitPiece(piece(fam, 'edge', variant), true, sx, sz, cx, cz, T, footB, fam, topC, faceC, tileColor(x, z + sz));
      else if (lowerD) emitPiece(piece(fam, 'inner'), false, sx, sz, cx, cz, T, () => footD, fam, topC, faceC, tileColor(x + sx, z + sz));
      else flats.push(q);
    }
    if (flats.length === 4) {
      out.quad([x, h[0], z], [x, h[3], z + 1], [x + 1, h[2], z + 1], [x + 1, h[1], z], topC);
      return;
    }
    for (const q of flats) {
      const [sx, sz] = QUARTERS[q];
      const x0 = Math.min(cx, cx + sx * 0.5), x1 = Math.max(cx, cx + sx * 0.5);
      const z0 = Math.min(cz, cz + sz * 0.5), z1 = Math.max(cz, cz + sz * 0.5);
      out.quad([x0, T(x0, z0), z0], [x0, T(x0, z1), z1], [x1, T(x1, z1), z1], [x1, T(x1, z0), z0], topC);
    }
  };
}
