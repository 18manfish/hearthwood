// Ponds and rivers up on the cliffs (sea-level water is the world's sea plane).

import * as THREE from 'three';
import { isFreshWater, type Grid } from '@hearthwood/shared';
import { bend } from '../bend.ts';
import { surfaceOf, type WaterLayer } from './common.ts';

/** Raised ponds and rivers (above sea level). */
export function addRaisedWater(g: Grid, color: string, { group }: WaterLayer) {
  const size = g.size;
  const surf: number[] = [];
  for (let z = 0; z < size; z++)
    for (let x = 0; x < size; x++) {
      if (!isFreshWater(g.tile(x, z)) || g.level(x, z) === 0) continue;
      const y = surfaceOf(g, x, z);
      surf.push(x, y, z, x, y, z + 1, x + 1, y, z + 1, x, y, z, x + 1, y, z + 1, x + 1, y, z);
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
