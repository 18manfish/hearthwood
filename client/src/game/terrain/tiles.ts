// Tiles built from the Blender tileset: every tile is four quarters, each picking a
// flat top, a cliff edge (three variants), a rounded outer corner or an inner
// corner, stretched to the real drop. Ramps use the same pieces along their slope.

import * as THREE from 'three';
import { CLIFF, SEA_LEVEL, Tile, baseHeight, hashString, isFreshWater, isWaterTile } from '@hearthwood/shared';
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
  const grassC = ctx.colors[Tile.Ground] ?? cliff;
  const lipC = new THREE.Color(), lipFace = new THREE.Color();
  /** A face whose front points along `n` (whatever order the corners come in). */
  const face = (a: number[], b: number[], c: number[], d: number[], n: [number, number, number], col: THREE.Color) => {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    if (nx * n[0] + ny * n[1] + nz * n[2] >= 0) out.quad(a, b, c, d, col);
    else out.quad(d, c, b, a, col);
  };
  const strips = new Map<string, Float32Array>();
  /** The cliff edge piece (quarter-local, edge at lx = 0.5) squeezed into a strip `w` wide along the edge. */
  const strip = (variant: number, w: number) => {
    const key = `${variant}|${w}`;
    let a = strips.get(key);
    if (!a) {
      a = piece('cliff', 'edge', variant).slice();
      for (let i = 0; i < a.length; i += 3) a[i] = 0.5 - (0.5 - a[i]) * (w / 0.5);
      strips.set(key, a);
    }
    return a;
  };
  /**
   * Water up on a cliff must be held in: its surface sits above lower ground next to
   * it. Such an edge is "open" unless the water drops into water there (a waterfall).
   */
  const openEdge = (x: number, z: number, dx: number, dz: number) => {
    if (!isFreshWater(g0.tile(x, z)) || g0.level(x, z) === 0) return false;
    const nt = g0.tile(x + dx, z + dz);
    if (isWaterTile(nt)) return false;
    const wy = g0.level(x, z) * CLIFF + SEA_LEVEL;
    const ex = x + 0.5 + dx * 0.5, ez = z + 0.5 + dz * 0.5;
    return [-0.5, 0, 0.5].some((o) => borderY(x + dx, z + dz, ex + dz * o, ez + dx * o) < wy + 0.02);
  };
  /** A stone lip along an open edge: rock outside, a strip of grass on top, rock down into the water. */
  const lip = (x: number, z: number, dx: number, dz: number) => {
    const L = g0.level(x, z);
    const top = L * CLIFF + baseHeight(Tile.Ground) - 0.03;
    const bed = L * CLIFF + baseHeight(g0.tile(x, z)) + 0.05;
    const W = 0.16, S = 4; // lip width (raised.ts stops the water surface just inside it)
    const ax = dz !== 0 ? 1 : 0, az = dx !== 0 ? 1 : 0; // along the edge
    const ox = x + 0.5 + dx * 0.5, oz = z + 0.5 + dz * 0.5; // edge centre
    const pt = (u: number, inset: number): [number, number] => [ox + ax * u - dx * inset, oz + az * u - dz * inset];
    const foot = (u: number) => Math.min(top - 0.05, borderY(x + dx, z + dz, ox + ax * u + dx * 0.01, oz + az * u + dz * 0.01));
    lipFace.copy(cliff);
    lipC.copy(grassC).lerp(cliff, 0.12);
    // Outside and top: the tileset's cliff edge, squeezed into a strip W wide along the edge.
    const topAt = () => top;
    const footAt = (X: number, Z: number) => Math.min(top - 0.05, borderY(x + dx, z + dz, ax ? X : ox + dx * 0.01, az ? Z : oz + dz * 0.01));
    const cx = x + 0.5, cz = z + 0.5;
    for (const sg of [-1, 1]) {
      const sx = dx !== 0 ? dx : sg, sz = dz !== 0 ? dz : sg;
      emitPiece(strip(hashString(`${x},${z},${dx},${dz},${sg}`) % 3, W), dz !== 0, sx, sz, cx, cz, topAt, footAt, 'cliff', lipC, lipFace, tileColor(x + dx, z + dz));
    }
    // Inside: rock down into the water.
    for (let k = 0; k < S; k++) {
      const u0 = -0.5 + k / S, u1 = -0.5 + (k + 1) / S;
      const [i0x, i0z] = pt(u0, W), [i1x, i1z] = pt(u1, W);
      face([i0x, top, i0z], [i1x, top, i1z], [i1x, bed, i1z], [i0x, bed, i0z], [-dx, 0, -dz], lipFace);
    }
    for (const sg of [-1, 1]) {
      const bx = x + ax * sg, bz = z + az * sg;
      if (openEdge(bx, bz, dx, dz)) continue; // the lip carries on next door
      const [px, pz] = pt(sg * 0.5, -0.004), [qx, qz] = pt(sg * 0.5, W);
      const f = Math.min(foot(sg * 0.5), bed);
      face([px, f, pz], [qx, f, qz], [qx, top, qz], [px, top, pz], [ax * sg, 0, az * sg], lipFace);
    }
  };
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
      // (an open edge of raised water gets a stone lip instead, below)
      const lowerA = !openEdge(x, z, sx, 0) && [0, 0.25, 0.5].some((o) => N(sx, 0, Xe, cz + sz * o) < T(Xe, cz + sz * o) - 0.01);
      const lowerB = !openEdge(x, z, 0, sz) && [0, 0.25, 0.5].some((o) => N(0, sz, cx + sx * o, Ze) < T(cx + sx * o, Ze) - 0.01);
      // A coast tile touching only our corner is covered by the beaches beside it.
      const lowerD = N(sx, sz, Xe, Ze) < T(Xe, Ze) - 0.01 && (lowerA || lowerB || !g0.isCoastal(x + sx, z + sz)) && !openEdge(x, z, sx, 0) && !openEdge(x, z, 0, sz);
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
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (openEdge(x, z, dx, dz)) lip(x, z, dx, dz);
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
