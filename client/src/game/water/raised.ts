// Ponds and rivers up on the cliffs (sea-level water is the world's sea plane).

import * as THREE from 'three';
import { isFreshWater, isWaterTile, type Grid } from '@hearthwood/shared';
import { bend } from '../bend.ts';
import { surfaceOf, type WaterLayer } from './common.ts';

/** How far the stone lip on an open edge reaches into a raised water tile. */
const LIP = 0.17;

/** Raised ponds and rivers (above sea level). */
export function addRaisedWater(g: Grid, color: string, { group }: WaterLayer) {
  const size = g.size;
  const surf: number[] = [];
  for (let z = 0; z < size; z++)
    for (let x = 0; x < size; x++) {
      if (!isFreshWater(g.tile(x, z)) || g.level(x, z) === 0) continue;
      const y = surfaceOf(g, x, z);
      // Where lower ground lies next to the water, the terrain builds a stone lip
      // inside this tile (terrain/tiles.ts): stop the surface behind it.
      const open = (dx: number, dz: number) => {
        if (isWaterTile(g.tile(x + dx, z + dz))) return false;
        const ex = x + 0.5 + dx * 0.51, ez = z + 0.5 + dz * 0.51;
        return [-0.45, 0, 0.45].some((o) => g.surfaceY(ex + dz * o, ez + dx * o) < y + 0.02);
      };
      const x0 = x + (open(-1, 0) ? LIP : 0), x1 = x + 1 - (open(1, 0) ? LIP : 0);
      const z0 = z + (open(0, -1) ? LIP : 0), z1 = z + 1 - (open(0, 1) ? LIP : 0);
      surf.push(x0, y, z0, x0, y, z1, x1, y, z1, x0, y, z0, x1, y, z1, x1, y, z0);
    }
  if (surf.length) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(surf, 3));
    geo.computeVertexNormals();
    const c = new THREE.Color(color).lerp(new THREE.Color('#0b2d4d'), 0.25);
    const m = new THREE.Mesh(geo, bend(new THREE.MeshStandardMaterial({ color: c, transparent: true, opacity: 0.85, roughness: 0.2, metalness: 0.05, side: THREE.DoubleSide })));
    m.receiveShadow = true;
    m.renderOrder = 1;
    group.add(m);
  }
}
