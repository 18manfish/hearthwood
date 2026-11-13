// Helpers shared by the water layers.

import * as THREE from 'three';
import { CLIFF, SEA_LEVEL, Tile, type Grid } from '@hearthwood/shared';

/** Water surface height of a water tile (the sea is always at sea level). */
export const surfaceOf = (g: Grid, x: number, z: number) => (g.tile(x, z) === Tile.Sea ? 0 : g.level(x, z)) * CLIFF + SEA_LEVEL;

/** Floor height under the water at a point (sea floor, beach, river or pond bed). */
export function floorAt(g: Grid, px: number, pz: number) {
  const x = Math.floor(px), z = Math.floor(pz);
  if (g.isCoastal(x, z)) return g.coastY(px, pz, g.tile(x, z));
  const h = g.cornerHeights(x, z);
  const fx = px - x, fz = pz - z;
  return (h[0] * (1 - fx) + h[1] * fx) * (1 - fz) + (h[3] * (1 - fx) + h[2] * fx) * fz;
}

/** Where a layer adds its meshes; sea-level layers also go in `bobbed` to rise and fall with the sea. */
export interface WaterLayer {
  group: THREE.Group;
  bobbed: THREE.Object3D[];
}
