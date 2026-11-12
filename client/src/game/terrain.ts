// Terrain mesh builder shared by the game world and the island previews.

import * as THREE from 'three';
import { BIOMES, CLIFF, Tile, baseHeight, hashString, isWaterTile, type BiomeId, type Grid, type Season, type InteriorTheme } from '@hearthwood/shared';
import { bend, bentDepth } from './bend.ts';

export interface TerrainOptions {
  biome: BiomeId;
  season: Season;
  vs: 'spring' | 'summer' | 'autumn' | 'winter';
  snowy: boolean;
  interior?: string;
  theme?: InteriorTheme;
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
      [Tile.River]: new THREE.Color('#6a8a78'),
      [Tile.Floor]: new THREE.Color(o.theme?.floor ?? (tent ? '#c9b27a' : '#b98a5a')),
      [Tile.Wall]: new THREE.Color(o.theme?.wall ?? (tent ? '#e0a94a' : '#efe3cf')),
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
        if (t === Tile.Floor) {
          // Floor pattern: planks (rows), tiles (checker) or carpet (plain).
          const pat = o.theme?.pattern ?? (tent ? 'carpet' : 'planks');
          const alt = pat === 'planks' ? z % 2 === 1 : pat === 'tiles' ? (x + z) % 2 === 1 : false;
          if (alt) c.set(o.theme?.floorAlt ?? '#a87b4f');
        }
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

/** The water surface sits this far above a water tile's cliff level (matches the sea plane). */
export const WATER_LEVEL_Y = -0.12;

/** Scrolling stripes for waterfalls (one shared texture, animated by the world). */
export const fallTexture = (() => {
  const c = document.createElement('canvas');
  c.width = 32;
  c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#8fd3ef';
  g.fillRect(0, 0, 32, 64);
  for (let i = 0; i < 14; i++) {
    g.fillStyle = `rgba(255,255,255,${0.35 + (i % 3) * 0.2})`;
    g.fillRect((i * 7) % 32, (i * 23) % 64, 2 + (i % 3), 10 + (i % 4) * 6);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
})();

/**
 * Water above sea level (rivers and ponds up on cliffs) plus waterfalls where a
 * river drops to lower water. Sea-level water is drawn by the world's sea plane.
 */
export function buildWater(g0: Grid, color: string): THREE.Group {
  const group = new THREE.Group();
  const size = g0.size;
  const surf: number[] = [];
  const fall: number[] = [];
  const fallUv: number[] = [];
  const foam: number[] = [];
  const wet = (x: number, z: number) => isWaterTile(g0.tile(x, z));
  for (let z = 0; z < size; z++)
    for (let x = 0; x < size; x++) {
      const t = g0.tile(x, z);
      if (t !== Tile.River && t !== Tile.Pond) continue;
      const L = g0.level(x, z);
      const y = L * CLIFF + WATER_LEVEL_Y;
      if (L > 0) surf.push(x, y, z, x, y, z + 1, x + 1, y, z + 1, x, y, z, x + 1, y, z + 1, x + 1, y, z);
      // Waterfalls: down to neighbouring water that sits lower.
      for (const [dx, dz] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
        const nx = x + dx, nz = z + dz;
        if (!wet(nx, nz)) continue;
        const M = g0.tile(nx, nz) === Tile.Sea ? 0 : g0.level(nx, nz);
        if (M >= L) continue;
        const yb = M * CLIFF + WATER_LEVEL_Y;
        // Edge between the tiles, nudged a little outwards so it doesn't touch the cliff face.
        const ex = dx === 1 ? x + 1.02 : dx === -1 ? x - 0.02 : null;
        const ez = dz === 1 ? z + 1.02 : dz === -1 ? z - 0.02 : null;
        const [ax, az, bx, bz] = ex !== null ? [ex, z, ex, z + 1] : [x, ez!, x + 1, ez!];
        const hgt = y - yb;
        fall.push(ax, y, az, ax, yb, az, bx, yb, bz, ax, y, az, bx, yb, bz, bx, y, bz);
        fallUv.push(0, hgt, 0, 0, 1, 0, 0, hgt, 1, 0, 1, hgt);
        // Foam where it lands.
        const fx = (ax + bx) / 2 + dx * 0.35, fz = (az + bz) / 2 + dz * 0.35;
        const s = 0.6;
        const fy = yb + 0.03;
        foam.push(fx - s, fy, fz - s, fx - s, fy, fz + s, fx + s, fy, fz + s, fx - s, fy, fz - s, fx + s, fy, fz + s, fx + s, fy, fz - s);
      }
    }
  const mk = (pos: number[], material: THREE.Material, uv?: number[]) => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    if (uv) geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, material);
    m.receiveShadow = true;
    group.add(m);
    return m;
  };
  if (surf.length) mk(surf, bend(new THREE.MeshStandardMaterial({ color, transparent: true, opacity: 0.82, roughness: 0.25, metalness: 0.05, side: THREE.DoubleSide })));
  if (fall.length) {
    mk(fall, bend(new THREE.MeshStandardMaterial({ map: fallTexture, transparent: true, opacity: 0.9, roughness: 0.3, side: THREE.DoubleSide })), fallUv);
    mk(foam, bend(new THREE.MeshStandardMaterial({ color: '#ffffff', transparent: true, opacity: 0.55, roughness: 0.6, depthWrite: false })));
  }
  return group;
}

export function waterColor(biome: BiomeId) {
  return biome === 'tropical' ? '#3fd0d4' : biome === 'nordic' ? '#3f8fb0' : '#4fb7d8';
}

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
