// Straight vertical faces down to lower neighbours: the look without the Blender
// tileset, and the walls of interiors.

import * as THREE from 'three';
import { Tile } from '@hearthwood/shared';
import type { TerrainCtx } from './context.ts';

export function makeEdgeFaces(ctx: TerrainCtx) {
  const { corners, cliff, out } = ctx;
  return (x: number, z: number, t: Tile, h: number[], c: THREE.Color, only?: (nx: number, nz: number) => boolean) => {
    const edges: [number, number, [number, number], [number, number], number[], number[]][] = [
      // dx, dz, my corner indices, neighbour corner indices (matching positions), positions
      [0, 1, [3, 2], [0, 1], [x, z + 1], [x + 1, z + 1]],
      [1, 0, [2, 1], [3, 0], [x + 1, z + 1], [x + 1, z]],
      [0, -1, [1, 0], [2, 3], [x + 1, z], [x, z]],
      [-1, 0, [0, 3], [1, 2], [x, z], [x, z + 1]],
    ];
    for (const [dx, dz, mine, theirs, p0, p1] of edges) {
      if (only && !only(x + dx, z + dz)) continue;
      const nh = corners(x + dx, z + dz);
      const a0 = h[mine[0]], a1 = h[mine[1]];
      const b0 = Math.min(a0, nh[theirs[0]]), b1 = Math.min(a1, nh[theirs[1]]);
      if (a0 - b0 < 0.01 && a1 - b1 < 0.01) continue;
      const face = t === Tile.Wall ? c.clone().multiplyScalar(0.85) : t === Tile.Ground || t === Tile.Ramp ? cliff.clone().offsetHSL(0, 0, ((Math.floor(a0 * 3) % 2) - 0.5) * 0.04) : c.clone().multiplyScalar(0.72);
      out.quad([p0[0], a0, p0[1]], [p0[0], b0, p0[1]], [p1[0], b1, p1[1]], [p1[0], a1, p1[1]], face);
    }
  };
}
