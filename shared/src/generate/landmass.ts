// The island's shape: land mask (grass, sand, sea), ponds / oasis / lagoon, the
// legacy river of 48-tile islands, and the dock with its clearing.

import { fbm2D } from '../rng.ts';
import { LEGACY_ISLAND_SIZE } from '../world/constants.ts';
import { Tile } from '../world/tiles.ts';
import { RIVER_BIOMES } from './river.ts';
import type { GenState } from './state.ts';

/** Land mask: radial falloff perturbed by noise. */
export function landMask(st: GenState) {
  const { seed, size, S, c, tiles } = st;
  for (let z = 0; z < size; z++)
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5 - c) / c;
      const dz = (z + 0.5 - c) / c;
      const d = Math.sqrt(dx * dx + dz * dz);
      const n = fbm2D(seed, x / (9 * S), z / (9 * S), 3) - 0.5;
      const v = d + n * 0.32;
      tiles[z * size + x] = v < 0.74 ? Tile.Ground : v < 0.83 ? Tile.Shore : Tile.Sea;
    }
}

/** Ponds, oasis, lagoon; picks where a new island's river starts (carved later). */
export function waterFeatures(st: GenState) {
  const { seed, size, S, c, def, variant, biome, rng, carveDisc, get, set } = st;
  const water = variant === 'shared' ? 'pond' : def.water;
  st.water = water;
  const oasisX = c - 6 * S, oasisZ = c - 4 * S;
  st.oasisX = oasisX;
  st.oasisZ = oasisZ;
  if (water === 'pond') carveDisc(c - 9 * S, c - 7 * S, 3.2 * S, Tile.Pond);
  if (water === 'oasis') {
    carveDisc(oasisX, oasisZ, 6.5 * S, Tile.Ground);
    carveDisc(oasisX, oasisZ, 5 * S, Tile.Pond);
  }
  if (water === 'lagoon') {
    carveDisc(c + 13 * S, c - 2 * S, 7 * S, Tile.Shore, true);
    carveDisc(c + 14 * S, c - 2 * S, 5.5 * S, Tile.Sea, false);
  }
  // New (72-tile) islands get a proper river that flows down the cliffs into the sea
  // (carved after the cliffs); 48-tile islands keep their original layout.
  const legacy = size <= LEGACY_ISLAND_SIZE;
  st.riverSource = !legacy && variant !== 'shared' && RIVER_BIOMES.includes(biome)
    ? biome === 'grassland' ? { x: c + 7 * S, z: c - 6 * S } : biome === 'tropical' ? { x: c - 6 * S, z: c - 5 * S } : { x: c - 4 * S, z: c - 7 * S }
    : null;
  if (!legacy && variant !== 'shared' && (water === 'river')) carveDisc(c + 8 * S, c + 3 * S, 2.4 * S, Tile.Pond);
  if (water === 'river' && legacy) {
    let rx = c - 4 * S + rng.range(-3, 3);
    const end = c - 8 * S;
    for (let z = 0; z <= end; z++) {
      rx += (fbm2D(seed + 77, z / 6, 0, 2) - 0.5) * 1.6;
      for (let w = -1; w <= 0; w++) if (get(Math.floor(rx) + w, z) !== Tile.Sea) set(Math.floor(rx) + w, z, Tile.Pond);
    }
    carveDisc(rx, end, 2.6 * S, Tile.Pond);
  }
}

/** Dock on the south coast, straight below the centre, and the clearing in front of it. */
export function placeDock(st: GenState) {
  const { size, c, get, set } = st;
  const dockX = Math.floor(c) - 1;
  let beachZ = size - 1;
  while (beachZ > 0 && get(dockX, beachZ) === Tile.Sea && get(dockX + 1, beachZ) === Tile.Sea) beachZ--;
  for (let dz = -1; dz <= 0; dz++) {
    set(dockX, beachZ + dz, Tile.Shore);
    set(dockX + 1, beachZ + dz, Tile.Shore);
  }
  st.dock = { id: 'b_dock', type: 'dock', x: dockX, z: beachZ + 1, w: 2, h: 3, completeAt: 0 };
  for (let dz = 0; dz < 3; dz++) {
    set(dockX, beachZ + 1 + dz, Tile.Dock);
    set(dockX + 1, beachZ + 1 + dz, Tile.Dock);
  }
  st.dockX = dockX;
  st.beachZ = beachZ;
  st.spawn = { x: dockX + 1, z: beachZ - 0.5 };

  const clearX = c;
  const clearZ = beachZ - 7;
  st.inClearing = (x: number, z: number, r = 6.5) => {
    const ddx = x + 0.5 - clearX;
    const ddz = z + 0.5 - clearZ;
    return ddx * ddx + ddz * ddz < r * r || (Math.abs(x + 0.5 - (dockX + 1)) < 2 && z > clearZ);
  };
}
