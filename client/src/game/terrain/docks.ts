// Plank docks (the look without the Blender dock models): boardwalks and piers on
// Dock tiles, with mooring posts along the outer edges.

import * as THREE from 'three';
import { Tile, type Grid } from '@hearthwood/shared';
import { bend, bentDepth } from '../bend.ts';

/**
 * Wooden decking for boardwalks and piers (Dock tiles): planks with a little
 * colour variation and mooring posts along the outer edges.
 */
export function buildDocks(g0: Grid): THREE.Group {
  const group = new THREE.Group();
  const tiles: [number, number][] = [];
  for (let z = 0; z < g0.size; z++) for (let x = 0; x < g0.size; x++) if (g0.tile(x, z) === Tile.Dock) tiles.push([x, z]);
  if (!tiles.length) return group;
  const isDock = (x: number, z: number) => g0.tile(x, z) === Tile.Dock;
  const plankGeo = new THREE.BoxGeometry(1.0, 0.07, 0.235);
  const planks = new THREE.InstancedMesh(plankGeo, bend(new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1 })), tiles.length * 4);
  const postGeo = new THREE.CylinderGeometry(0.07, 0.08, 1.3, 7);
  const postSpots: [number, number][] = [];
  const m4 = new THREE.Matrix4();
  const col = new THREE.Color();
  const shades = ['#9c7a52', '#8b6b47', '#a8875c', '#94704a'];
  let i = 0;
  for (const [x, z] of tiles) {
    // Planks run across the walkway: along x for north-south walks, along z otherwise.
    const ns = isDock(x, z - 1) || isDock(x, z + 1);
    const ew = isDock(x - 1, z) || isDock(x + 1, z);
    const alongX = ns || !ew;
    for (let k = 0; k < 4; k++) {
      const off = -0.375 + k * 0.25;
      m4.makeRotationY(alongX ? 0 : Math.PI / 2);
      m4.setPosition(x + 0.5 + (alongX ? 0 : off), 0.11 + ((k * 13 + x) % 3) * 0.006, z + 0.5 + (alongX ? off : 0));
      planks.setMatrixAt(i, m4);
      planks.setColorAt(i, col.set(shades[(x * 7 + z * 3 + k) % shades.length]));
      i++;
    }
    // Posts on outer corners.
    for (const [dx, dz] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      const cx = x + dx, cz = z + dz;
      const touchesWater = [[cx - 1, cz - 1], [cx, cz - 1], [cx - 1, cz], [cx, cz]].some(([tx, tz]) => !isDock(tx, tz) && g0.tile(tx, tz) === Tile.Sea);
      if (touchesWater && (cx + cz) % 2 === 0) postSpots.push([cx, cz]);
    }
  }
  planks.instanceMatrix.needsUpdate = true;
  planks.receiveShadow = true;
  planks.castShadow = true;
  planks.customDepthMaterial = bentDepth;
  planks.frustumCulled = false;
  group.add(planks);
  const uniq = [...new Set(postSpots.map(([x, z]) => `${x},${z}`))].map((k) => k.split(',').map(Number));
  const posts = new THREE.InstancedMesh(postGeo, bend(new THREE.MeshStandardMaterial({ color: '#5d4037', roughness: 1 })), Math.max(1, uniq.length));
  uniq.forEach(([x, z], j) => {
    m4.makeTranslation(x, -0.4, z);
    posts.setMatrixAt(j, m4);
  });
  posts.count = uniq.length;
  posts.instanceMatrix.needsUpdate = true;
  posts.castShadow = true;
  posts.customDepthMaterial = bentDepth;
  posts.frustumCulled = false;
  group.add(posts);
  return group;
}
