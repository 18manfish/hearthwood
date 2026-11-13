// Terrain mesh builder shared by the game world and the island previews.
// The geometry is built in ./terrain (plain arrays); this file wraps it in a mesh.
//   terrain/context.ts   shared state: colours, memoised heights, the triangle buffer
//   terrain/tiles.ts     tiles from the Blender tileset (cliffs, corners, ramps)
//   terrain/coast.ts     beaches, sea-level rivers and the sea floor as smooth slopes
//   terrain/fallback.ts  straight walls (no tileset, and interiors)
//   terrain/docks.ts     plank docks (no dock models)

import * as THREE from 'three';
import { Tile, hashString, type BiomeId, type Grid } from '@hearthwood/shared';
import { bend, bentDepth } from './bend.ts';
import { hasTileset } from './tileAssets.ts';
import { createTerrainCtx, type TerrainOptions } from './terrain/context.ts';
import { makeCoastTile } from './terrain/coast.ts';
import { makeEdgeFaces } from './terrain/fallback.ts';
import { makeTiledTile } from './terrain/tiles.ts';

export type { TerrainOptions } from './terrain/context.ts';
export { buildDocks } from './terrain/docks.ts';

/** The terrain's triangles as plain arrays: positions (x, y, z) and colours (r, g, b) per vertex. */
export function buildTerrainGeometry(g0: Grid, o: TerrainOptions): { pos: number[]; col: number[] } {
  const ctx = createTerrainCtx(g0, o);
  const { colors, corners, out, interior, tent } = ctx;
  const edgeFaces = makeEdgeFaces(ctx);
  const tiledTile = makeTiledTile(ctx);
  const coastTile = makeCoastTile(ctx);
  const size = g0.size;
  const pad = interior ? 0 : o.pad ?? 8;
  const useTiles = !interior && hasTileset();
  const c = new THREE.Color();
  for (let z = -pad; z < size + pad; z++)
    for (let x = -pad; x < size + pad; x++) {
      const t = g0.tile(x, z);
      const h = corners(x, z);
      const n = ((hashString(`${x},${z}`) % 100) / 100 - 0.5) * 0.06;
      c.copy(colors[t] ?? colors[Tile.Ground]!).offsetHSL(0, 0, n);
      if (t === Tile.Floor) {
        // Floor pattern: planks (rows), tiles (checker) or carpet (plain).
        const pat = o.theme?.pattern ?? (tent ? 'carpet' : 'planks');
        const alt = pat === 'planks' ? z % 2 === 1 : pat === 'tiles' ? (x + z) % 2 === 1 : false;
        if (alt) c.set(o.theme?.floorAlt ?? '#a87b4f');
      }
      if (useTiles && g0.isCoastal(x, z)) {
        coastTile(x, z, t, n);
        continue;
      }
      if (useTiles && t !== Tile.Wall && t !== Tile.Floor) {
        tiledTile(x, z, t, h, c.clone());
        continue;
      }
      // Top surface: [x0z0, x1z0, x1z1, x0z1]
      out.quad([x, h[0], z], [x, h[3], z + 1], [x + 1, h[2], z + 1], [x + 1, h[1], z], c);
      edgeFaces(x, z, t, h, c);
    }
  return { pos: out.pos, col: out.col };
}

/** One merged, vertex-coloured mesh: tile tops, cliff faces and ramps. */
export function buildTerrainMesh(g0: Grid, o: TerrainOptions): THREE.Mesh {
  const { pos, col } = buildTerrainGeometry(g0, o);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  const tmat = bend(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true, side: THREE.DoubleSide }));
  // Only back faces go into the shadow map: cliff walls still cast shadows,
  // but flat ground can't shadow itself (which caused striped "acne").
  tmat.shadowSide = THREE.BackSide;
  const m = new THREE.Mesh(g, tmat);
  m.receiveShadow = true;
  m.castShadow = true;
  m.customDepthMaterial = bentDepth;
  return m;
}

export function waterColor(biome: BiomeId) {
  return biome === 'tropical' ? '#3fd0d4' : biome === 'nordic' ? '#3f8fb0' : '#4fb7d8';
}
