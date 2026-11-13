// Shared state for one run of the island generator. Each step reads and writes it
// in a fixed order (island.ts); the RNG is drawn from in that order, so steps must
// not be reordered or the output (and every saved island built on it) changes.

import { type BiomeDef, type BiomeId, BIOMES } from '../data/biomes.ts';
import { Rng } from '../rng.ts';
import { ISLAND_SIZE, LEGACY_ISLAND_SIZE } from '../world/constants.ts';
import type { Building } from '../world/objects.ts';
import { Tile, tileAt } from '../world/tiles.ts';

export interface GenOptions {
  /** Shared hubs get a plaza and fewer resources. */
  variant?: 'home' | 'shared' | 'tour';
  /** Cliffs & ramps (new islands). */
  elevation?: boolean;
  /** Side length in tiles (default ISLAND_SIZE). Features scale with it. */
  size?: number;
}

export interface GenState {
  seed: number;
  biome: BiomeId;
  opts: GenOptions;
  variant: 'home' | 'shared' | 'tour';
  def: BiomeDef;
  size: number;
  /** Feature scale relative to the original 48-tile islands. */
  S: number;
  /** Island centre (tiles). */
  c: number;
  tiles: Uint8Array;
  levels: Uint8Array;
  ramps: Uint8Array;
  rng: Rng;
  set(x: number, z: number, t: Tile): void;
  get(x: number, z: number): Tile;
  /** Paint a disc of tiles (by default only over land). */
  carveDisc(cx: number, cz: number, r: number, t: Tile, onlyLand?: boolean): void;
  // Filled in by the steps:
  water?: string;
  oasisX: number;
  oasisZ: number;
  riverSource: { x: number; z: number } | null;
  dockX: number;
  beachZ: number;
  dock?: Building;
  spawn: { x: number; z: number };
  /** The clearing in front of the dock, kept free of trees and rocks. */
  inClearing(x: number, z: number, r?: number): boolean;
}

export function newGenState(seed: number, biome: BiomeId, opts: GenOptions): GenState {
  const size = opts.size ?? ISLAND_SIZE;
  const tiles = new Uint8Array(size * size);
  const st: GenState = {
    seed, biome, opts,
    variant: opts.variant ?? 'home',
    def: BIOMES[biome],
    size,
    S: size / LEGACY_ISLAND_SIZE,
    c: size / 2,
    tiles,
    levels: new Uint8Array(size * size),
    ramps: new Uint8Array(size * size),
    rng: new Rng(seed),
    set(x, z, t) {
      if (x >= 0 && z >= 0 && x < size && z < size) tiles[z * size + x] = t;
    },
    get: (x, z) => tileAt(tiles, size, x, z),
    carveDisc(cx, cz, r, t, onlyLand = true) {
      for (let z = Math.floor(cz - r); z <= cz + r; z++)
        for (let x = Math.floor(cx - r); x <= cx + r; x++) {
          const ddx = x + 0.5 - cx;
          const ddz = z + 0.5 - cz;
          if (ddx * ddx + ddz * ddz <= r * r && (!onlyLand || st.get(x, z) !== Tile.Sea)) st.set(x, z, t);
        }
    },
    oasisX: 0, oasisZ: 0, riverSource: null, dockX: 0, beachZ: 0, spawn: { x: 0, z: 0 },
    inClearing: () => false,
  };
  return st;
}
