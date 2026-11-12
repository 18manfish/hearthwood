// Terrain mesh builder shared by the game world and the island previews.

import * as THREE from 'three';
import { BIOMES, Tile, baseHeight, hashString, type BiomeId, type Grid, type Season } from '@hearthwood/shared';
import { bend, bentDepth } from './bend.ts';

export interface TerrainOptions {
  biome: BiomeId;
  season: Season;
  vs: 'spring' | 'summer' | 'autumn' | 'winter';
  snowy: boolean;
  interior?: 'tent' | 'cabin';
  /** Extra sea-floor tiles around the island. */
  pad?: number;
}

/** One merged, vertex-coloured mesh: tile tops, cliff faces and ramps. */
export function buildTerrainMesh(g0: Grid, o: TerrainOptions): THREE.Mesh {
    const def = BIOMES[o.biome];
    const { season, vs, snowy } = o;
    const interior = !!o.interior;
    const tent = o.interior === 'tent';
    const groundHex = snowy ? '#eef3f7' : def.ground[season] ?? def.ground[vs] ?? def.ground.default ?? '#79b84c';
    const colors: Partial<Record<Tile, THREE.Color>> = {
      [Tile.Ground]: new THREE.Color(groundHex),
      [Tile.Ramp]: new THREE.Color(groundHex).offsetHSL(0, -0.05, -0.04),
      [Tile.Shore]: new THREE.Color(snowy && def.seasonModel !== 'arid' ? '#e4e6e2' : def.shore),
      [Tile.Sea]: new THREE.Color('#d9c9a0'),
      [Tile.Dock]: new THREE.Color('#d9c9a0'),
      [Tile.Pond]: new THREE.Color('#6d8f6a'),
      [Tile.Floor]: new THREE.Color(tent ? '#c9b27a' : '#b98a5a'),
      [Tile.Wall]: new THREE.Color(tent ? '#e0a94a' : '#efe3cf'),
    };
    // Cliff faces: earthy, with a little banding.
    const cliff = new THREE.Color(groundHex).lerp(new THREE.Color(def.seasonModel === 'arid' ? '#b8874f' : '#8a7356'), 0.7);
    const pos: number[] = [];
    const col: number[] = [];
    const size = g0.size;
    const c = new THREE.Color();
    const tri = (a: number[], b: number[], d: number[], color: THREE.Color) => {
      pos.push(...a, ...b, ...d);
      for (let i = 0; i < 3; i++) col.push(color.r, color.g, color.b);
    };
    const quad = (a: number[], b: number[], cc: number[], d: number[], color: THREE.Color) => {
      tri(a, b, cc, color);
      tri(a, cc, d, color);
    };
    const wallH = (x: number, z: number) => (z === size - 1 ? 0.35 : baseHeight(Tile.Wall));
    const corners = (x: number, z: number): [number, number, number, number] => {
      if (g0.tile(x, z) === Tile.Wall) {
        const h = wallH(x, z);
        return [h, h, h, h];
      }
      if (interior && !g0.inBounds(x, z)) return [0, 0, 0, 0];
      return g0.cornerHeights(x, z);
    };
    const pad = interior ? 0 : o.pad ?? 8;
    for (let z = -pad; z < size + pad; z++)
      for (let x = -pad; x < size + pad; x++) {
        const t = g0.tile(x, z);
        const h = corners(x, z);
        const n = ((hashString(`${x},${z}`) % 100) / 100 - 0.5) * 0.06;
        c.copy(colors[t] ?? colors[Tile.Ground]!).offsetHSL(0, 0, n);
        if (t === Tile.Floor && !tent && (x + z) % 2) c.offsetHSL(0, 0, -0.03); // planks
        // Top surface: [x0z0, x1z0, x1z1, x0z1]
        quad([x, h[0], z], [x, h[3], z + 1], [x + 1, h[2], z + 1], [x + 1, h[1], z], c);
        // Vertical faces down to lower neighbours, per edge.
        const edges: [number, number, [number, number], [number, number], number[], number[]][] = [
          // dx, dz, my corner indices, neighbour corner indices (matching positions), positions
          [0, 1, [3, 2], [0, 1], [x, z + 1], [x + 1, z + 1]],
          [1, 0, [2, 1], [3, 0], [x + 1, z + 1], [x + 1, z]],
          [0, -1, [1, 0], [2, 3], [x + 1, z], [x, z]],
          [-1, 0, [0, 3], [1, 2], [x, z], [x, z + 1]],
        ];
        for (const [dx, dz, mine, theirs, p0, p1] of edges) {
          const nh = corners(x + dx, z + dz);
          const a0 = h[mine[0]], a1 = h[mine[1]];
          const b0 = Math.min(a0, nh[theirs[0]]), b1 = Math.min(a1, nh[theirs[1]]);
          if (a0 - b0 < 0.01 && a1 - b1 < 0.01) continue;
          const face = t === Tile.Wall ? c.clone().multiplyScalar(0.85) : t === Tile.Ground || t === Tile.Ramp ? cliff.clone().offsetHSL(0, 0, ((Math.floor(a0 * 3) % 2) - 0.5) * 0.04) : c.clone().multiplyScalar(0.72);
          quad([p0[0], a0, p0[1]], [p0[0], b0, p0[1]], [p1[0], b1, p1[1]], [p1[0], a1, p1[1]], face);
        }
      }
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
