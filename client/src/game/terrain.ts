// Terrain mesh builder shared by the game world and the island previews.

import * as THREE from 'three';
import { BIOMES, CLIFF, Tile, baseHeight, hashString, isWaterTile, type BiomeId, type Grid, type Season, type InteriorTheme, SEA_DEEP } from '@hearthwood/shared';
import { bend, bentDepth } from './bend.ts';
import { hasTileset, piece, type Family } from './tileAssets.ts';

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
    // Memoised coast heights / corner heights (the coast slope is costly to evaluate).
    const coastMemo = new Map<number, number>();
    const coastY = (px: number, pz: number, t: Tile) => {
      const sea = t === Tile.Sea || t === Tile.Dock ? 1 : 0;
      const key = ((Math.round(px * 4) + 1000) * 4096 + (Math.round(pz * 4) + 1000)) * 2 + sea;
      let v = coastMemo.get(key);
      if (v === undefined) coastMemo.set(key, (v = g0.coastY(px, pz, t)));
      return v;
    };
    const cornerMemo = new Map<number, [number, number, number, number]>();
    const corners = (x: number, z: number): [number, number, number, number] => {
      const key = (x + 1000) * 4096 + (z + 1000);
      let v = cornerMemo.get(key);
      if (!v) cornerMemo.set(key, (v = cornersRaw(x, z)));
      return v;
    };
    const cornersRaw = (x: number, z: number): [number, number, number, number] => {
      if (g0.tile(x, z) === Tile.Wall) {
        const h = wallH(x, z);
        return [h, h, h, h];
      }
      if (interior && !g0.inBounds(x, z)) return [0, 0, 0, 0];
      if (g0.isCoastal(x, z)) {
        const t = g0.tile(x, z);
        return [coastY(x, z, t), coastY(x + 1, z, t), coastY(x + 1, z + 1, t), coastY(x, z + 1, t)];
      }
      return g0.cornerHeights(x, z);
    };
    const pad = interior ? 0 : o.pad ?? 8;
    const useTiles = !interior && hasTileset();

    /** Straight vertical faces down to lower neighbours (the fallback, and next to ramps). */
    const edgeFaces = (x: number, z: number, t: Tile, h: number[], c: THREE.Color, only?: (nx: number, nz: number) => boolean) => {
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
        quad([p0[0], a0, p0[1]], [p0[0], b0, p0[1]], [p1[0], b1, p1[1]], [p1[0], a1, p1[1]], face);
      }
    };

    // ---- Blender tileset: quarter tiles with rocky cliffs and rounded corners.
    const QUARTERS: [number, number][] = [[1, 1], [-1, 1], [-1, -1], [1, -1]];
    const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3(), tmpN = new THREE.Vector3();
    const faceCol = new THREE.Color(), mixCol = new THREE.Color();
    const tileColor = (x: number, z: number) => colors[g0.tile(x, z)] ?? colors[Tile.Ground]!;
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
        tri(a, b, d, col);
      }
    };
    const dirt = new THREE.Color(snowy ? '#e6e9ec' : '#9a7a55');
    /** Any tile that isn't coast: flat ground or a ramp, with rocky edges where its neighbours are lower. */
    const tiledTile = (x: number, z: number, t: Tile, h: [number, number, number, number], c: THREE.Color) => {
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
        const lowerA = [0, 0.25, 0.5].some((o) => N(sx, 0, Xe, cz + sz * o) < T(Xe, cz + sz * o) - 0.01);
        const lowerB = [0, 0.25, 0.5].some((o) => N(0, sz, cx + sx * o, Ze) < T(cx + sx * o, Ze) - 0.01);
        // A coast tile touching only our corner is covered by the beaches beside it.
        const lowerD = N(sx, sz, Xe, Ze) < T(Xe, Ze) - 0.01 && (lowerA || lowerB || !g0.isCoastal(x + sx, z + sz));
        const footA = (X: number, Z: number) => N(sx, 0, Xe, Math.min(z + 1, Math.max(z, Z)));
        const footB = (X: number, Z: number) => N(0, sz, Math.min(x + 1, Math.max(x, X)), Ze);
        const footD = N(sx, sz, Xe, Ze);
        const variant = hashString(`${x},${z},${q}`) % 3;
        if (lowerA && lowerB) {
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
      if (flats.length === 4) {
        quad([x, h[0], z], [x, h[3], z + 1], [x + 1, h[2], z + 1], [x + 1, h[1], z], topC);
        return;
      }
      for (const q of flats) {
        const [sx, sz] = QUARTERS[q];
        const x0 = Math.min(cx, cx + sx * 0.5), x1 = Math.max(cx, cx + sx * 0.5);
        const z0 = Math.min(cz, cz + sz * 0.5), z1 = Math.max(cz, cz + sz * 0.5);
        quad([x0, T(x0, z0), z0], [x0, T(x0, z1), z1], [x1, T(x1, z1), z1], [x1, T(x1, z0), z0], topC);
      }
    };

    // ---- The coast: beaches and the sea floor as smooth slopes (no steps).
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
    /** Height a neighbouring tile has at a point on our shared border. */
    const borderY = (nx: number, nz: number, px: number, pz: number) => {
      if (g0.isCoastal(nx, nz)) return coastY(px, pz, g0.tile(nx, nz));
      const h = corners(nx, nz);
      const fx = Math.min(1, Math.max(0, px - nx)), fz = Math.min(1, Math.max(0, pz - nz));
      return (h[0] * (1 - fx) + h[1] * fx) * (1 - fz) + (h[3] * (1 - fx) + h[2] * fx) * fz;
    };
    const coastTile = (x: number, z: number, t: Tile, n: number) => {
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
        quad([x, SEA_Y, z], [x, SEA_Y, z + 1], [x + 1, SEA_Y, z + 1], [x + 1, SEA_Y, z], coastColor(SEA_Y, n, t));
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
            tri(a, b, cc, coastColor((a[1] + b[1] + cc[1]) / 3, n, t));
            tri(a, cc, d, coastColor((a[1] + cc[1] + d[1]) / 3, n, t));
          } else {
            tri(a, b, d, coastColor((a[1] + b[1] + d[1]) / 3, n, t));
            tri(b, cc, d, coastColor((b[1] + cc[1] + d[1]) / 3, n, t));
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
          quad([px0, a0, pz0], [px0, b0, pz0], [px1, b1, pz1], [px1, a1, pz1], coastColor(Math.min(b0, b1), n, t).multiplyScalar(0.8));
        }
      }
    };

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
        quad([x, h[0], z], [x, h[3], z + 1], [x + 1, h[2], z + 1], [x + 1, h[1], z], c);
        edgeFaces(x, z, t, h, c);
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
