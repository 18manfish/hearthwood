// Everything the terrain builders share for one mesh: the grid, tile colours,
// memoised corner and coast heights, and the triangle buffer.

import * as THREE from 'three';
import { BIOMES, Tile, baseHeight, type BiomeId, type Grid, type InteriorTheme, type Season } from '@hearthwood/shared';
import { MeshBuffer } from './buffer.ts';

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

export type Corners = [number, number, number, number];

export interface TerrainCtx {
  g0: Grid;
  o: TerrainOptions;
  out: MeshBuffer;
  interior: boolean;
  tent: boolean;
  snowy: boolean;
  /** Base colour per tile type. */
  colors: Partial<Record<Tile, THREE.Color>>;
  /** Cliff faces: earthy, with a little banding. */
  cliff: THREE.Color;
  /** Corner heights of a tile [x0z0, x1z0, x1z1, x0z1] (memoised). */
  corners(x: number, z: number): Corners;
  /** Coast height at a point for a tile type (memoised; the coast slope is costly to evaluate). */
  coastY(px: number, pz: number, t: Tile): number;
  /** Height a neighbouring tile has at a point on our shared border. */
  borderY(nx: number, nz: number, px: number, pz: number): number;
  /** Base colour of the tile at (x, z). */
  tileColor(x: number, z: number): THREE.Color;
}

export function createTerrainCtx(g0: Grid, o: TerrainOptions): TerrainCtx {
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
  const cliff = new THREE.Color(groundHex).lerp(new THREE.Color(def.seasonModel === 'arid' ? '#b8874f' : '#8a7356'), 0.7);
  const size = g0.size;
  const wallH = (x: number, z: number) => (z === size - 1 ? 0.35 : baseHeight(Tile.Wall));
  const coastMemo = new Map<number, number>();
  const coastY = (px: number, pz: number, t: Tile) => {
    const sea = t === Tile.Sea || t === Tile.Dock ? 1 : 0;
    const key = ((Math.round(px * 4) + 1000) * 4096 + (Math.round(pz * 4) + 1000)) * 2 + sea;
    let v = coastMemo.get(key);
    if (v === undefined) coastMemo.set(key, (v = g0.coastY(px, pz, t)));
    return v;
  };
  const cornerMemo = new Map<number, Corners>();
  const corners = (x: number, z: number): Corners => {
    const key = (x + 1000) * 4096 + (z + 1000);
    let v = cornerMemo.get(key);
    if (!v) cornerMemo.set(key, (v = cornersRaw(x, z)));
    return v;
  };
  const cornersRaw = (x: number, z: number): Corners => {
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
  const borderY = (nx: number, nz: number, px: number, pz: number) => {
    if (g0.isCoastal(nx, nz)) return coastY(px, pz, g0.tile(nx, nz));
    const h = corners(nx, nz);
    const fx = Math.min(1, Math.max(0, px - nx)), fz = Math.min(1, Math.max(0, pz - nz));
    return (h[0] * (1 - fx) + h[1] * fx) * (1 - fz) + (h[3] * (1 - fx) + h[2] * fx) * fz;
  };
  return {
    g0, o, out: new MeshBuffer(), interior, tent, snowy, colors, cliff, corners, coastY, borderY,
    tileColor: (x, z) => colors[g0.tile(x, z)] ?? colors[Tile.Ground]!,
  };
}
