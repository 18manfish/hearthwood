// The coast: beaches, sea-level rivers and the sea floor as smooth slopes (no steps),
// coloured from grass through sand and wet sand to the deep sea floor.

import * as THREE from 'three';
import { SEA_DEEP, Tile } from '@hearthwood/shared';
import type { TerrainCtx } from './context.ts';

export function makeCoastTile(ctx: TerrainCtx) {
  const { g0, colors, out, corners, coastY, borderY } = ctx;
  const SUB = 4;
  const grassC = colors[Tile.Ground]!;
  const sandC = colors[Tile.Shore]!;
  const floorSea = colors[Tile.Sea]!;
  const wetC = sandC.clone().lerp(floorSea, 0.5).multiplyScalar(0.88);
  const seaDeep = floorSea.clone().multiplyScalar(0.8);
  const coastCol = new THREE.Color();
  const riverBed = colors[Tile.River]!;
  const riverCol = new THREE.Color();
  /** How much a river tile looks like the sea (0 between grass banks, 1 out on the beach). */
  let seaLook = 0;
  const coastColor = (y: number, n: number, t: Tile = Tile.Shore) => {
    if (t === Tile.River && seaLook < 1) {
      // River beds: wet sand at the edges, river-bed green in the deeper middle…
      if (y > -0.22) riverCol.copy(wetC);
      else riverCol.copy(wetC).lerp(riverBed, Math.min(1, (-0.22 - y) / 0.15));
      // …fading into sand and sea colours where the river runs across the beach.
      if (seaLook > 0) riverCol.lerp(seaColor(y), seaLook);
      return coastCol.copy(riverCol).offsetHSL(0, 0, n);
    }
    return coastCol.copy(seaColor(y)).offsetHSL(0, 0, n);
  };
  const seaCol = new THREE.Color();
  const seaColor = (y: number) => {
    const coastCol = seaCol;
    if (y > 0.07) coastCol.copy(sandC).lerp(grassC, Math.min(1, (y - 0.07) / 0.05) * 0.7);
    else if (y > -0.1) coastCol.copy(sandC);
    else if (y > -0.3) coastCol.copy(sandC).lerp(wetC, (-0.1 - y) / 0.2);
    else coastCol.copy(wetC).lerp(seaDeep, Math.min(1, (-0.3 - y) / 0.4));
    return coastCol;
  };
  const SEA_Y = SEA_DEEP;
  return (x: number, z: number, t: Tile, n: number) => {
    if (t === Tile.River) {
      let k = 0;
      for (let dz = -1; dz <= 1; dz++)
        for (let dx = -1; dx <= 1; dx++) {
          const nt = g0.tile(x + dx, z + dz);
          if ((dx || dz) && (nt === Tile.Shore || nt === Tile.Sea || nt === Tile.Dock)) k++;
        }
      seaLook = Math.min(1, k / 5);
    } else seaLook = 0;
    const ch = corners(x, z);
    const mid = coastY(x + 0.5, z + 0.5, t);
    if (t !== Tile.Shore && [...ch, mid].every((v) => v <= SEA_Y + 1e-4)) {
      out.quad([x, SEA_Y, z], [x, SEA_Y, z + 1], [x + 1, SEA_Y, z + 1], [x + 1, SEA_Y, z], coastColor(SEA_Y, n, t));
      return;
    }
    const ys: number[][] = [];
    for (let j = 0; j <= SUB; j++) {
      ys.push([]);
      for (let i = 0; i <= SUB; i++) ys[j].push(coastY(x + i / SUB, z + j / SUB, t));
    }
    for (let j = 0; j < SUB; j++)
      for (let i = 0; i < SUB; i++) {
        const x0 = x + i / SUB, x1 = x + (i + 1) / SUB, z0 = z + j / SUB, z1 = z + (j + 1) / SUB;
        const a = [x0, ys[j][i], z0], b = [x0, ys[j + 1][i], z1], cc = [x1, ys[j + 1][i + 1], z1], d = [x1, ys[j][i + 1], z0];
        // Split along the flatter diagonal so the slope stays smooth.
        if (Math.abs(a[1] - cc[1]) <= Math.abs(b[1] - d[1])) {
          out.tri(a, b, cc, coastColor((a[1] + b[1] + cc[1]) / 3, n, t));
          out.tri(a, cc, d, coastColor((a[1] + cc[1] + d[1]) / 3, n, t));
        } else {
          out.tri(a, b, d, coastColor((a[1] + b[1] + d[1]) / 3, n, t));
          out.tri(b, cc, d, coastColor((b[1] + cc[1] + d[1]) / 3, n, t));
        }
      }
    // Skirts down to any lower neighbour (ponds, river mouths, odd corners), so there are no gaps.
    const sides: [number, number, (k: number) => [number, number]][] = [
      [0, -1, (k) => [x + 1 - k / SUB, z]],
      [1, 0, (k) => [x + 1, z + 1 - k / SUB]],
      [0, 1, (k) => [x + k / SUB, z + 1]],
      [-1, 0, (k) => [x, z + k / SUB]],
    ];
    for (const [dx, dz, at] of sides) {
      const nx = x + dx, nz = z + dz;
      for (let k = 0; k < SUB; k++) {
        const [px0, pz0] = at(k), [px1, pz1] = at(k + 1);
        const a0 = coastY(px0, pz0, t), a1 = coastY(px1, pz1, t);
        const b0 = Math.min(a0, borderY(nx, nz, px0, pz0)), b1 = Math.min(a1, borderY(nx, nz, px1, pz1));
        if (a0 - b0 < 0.005 && a1 - b1 < 0.005) continue;
        out.quad([px0, a0, pz0], [px0, b0, pz0], [px1, b1, pz1], [px1, a1, pz1], coastColor(Math.min(b0, b1), n, t).multiplyScalar(0.8));
      }
    }
  };
}
