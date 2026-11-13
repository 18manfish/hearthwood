// Scatter nature over the island: trees (in clumps), rocks, bushes, flowers, and the
// plaza furniture of shared hubs.

import { TREES } from '../data/biomes.ts';
import { fbm2D } from '../rng.ts';
import { Grid } from '../world/grid.ts';
import type { WorldObject } from '../world/objects.ts';
import { Tile } from '../world/tiles.ts';
import type { GenState } from './state.ts';

export function scatter(st: GenState): WorldObject[] {
  const { seed, size, S, c, tiles, levels, ramps, rng, def, variant, get, inClearing } = st;
  const water = st.water;
  const objects: WorldObject[] = [];
  let nid = 1;
  const taken = new Uint8Array(size * size);
  const grid = new Grid(size, tiles, levels, ramps);
  const nearTaken = (x: number, z: number, r = 1) => {
    for (let dz = -r; dz <= r; dz++)
      for (let dx = -r; dx <= r; dx++) {
        const tx = x + dx, tz = z + dz;
        if (tx >= 0 && tz >= 0 && tx < size && tz < size && taken[tz * size + tx]) return true;
      }
    return false;
  };
  const free = (x: number, z: number) => get(x, z) === Tile.Ground && !grid.reserved[z * size + x];
  const place = (o: Omit<WorldObject, 'id'>) => {
    taken[o.z * size + o.x] = 1;
    objects.push({ id: `o${nid++}`, ...o });
  };

  // Trees.
  const density = def.treeDensity * (variant === 'tour' ? 1.8 : variant === 'shared' ? 0.6 : 1);
  for (let z = 1; z < size - 1; z++)
    for (let x = 1; x < size - 1; x++) {
      if (!free(x, z) || inClearing(x, z)) continue;
      if (variant === 'shared' && Math.abs(x - c) < 8 && Math.abs(z - c) < 8) continue;
      const clump = fbm2D(seed + 31, x / 7, z / 7, 2);
      let p = density * (0.4 + clump * 1.6) * 2.2;
      if (water === 'oasis') {
        const ddx = x + 0.5 - st.oasisX, ddz = z + 0.5 - st.oasisZ;
        const d = Math.sqrt(ddx * ddx + ddz * ddz);
        if (d > 5 * S && d < 7.5 * S) p = 0.35;
      }
      if (!rng.chance(p) || nearTaken(x, z)) continue;
      const species = rng.weighted(def.trees, (t) => t.weight)!.species;
      place({ kind: 'tree', x, z, species, stage: 2, hits: 0, fruit: TREES[species].fruit ? rng.int(0, 3) : 0 });
    }

  const randomFreeGround = (avoidClearing = true, spacing = 1): { x: number; z: number } | null => {
    for (let tries = 0; tries < 200; tries++) {
      const x = rng.int(1, size - 2);
      const z = rng.int(1, size - 2);
      if (!free(x, z)) continue;
      if (avoidClearing && inClearing(x, z)) continue;
      if (nearTaken(x, z, spacing)) continue;
      return { x, z };
    }
    return null;
  };

  const area = S * S;
  const rocks = Math.round((variant === 'tour' ? def.rockCount + 6 : variant === 'shared' ? 2 : def.rockCount) * area);
  for (let i = 0; i < rocks; i++) {
    const p = randomFreeGround(true, 2);
    if (p) place({ kind: 'rock', ...p, hits: 0 });
  }
  const bushes = Math.round((variant === 'tour' ? 18 : variant === 'shared' ? 4 : 12) * area);
  for (let i = 0; i < bushes; i++) {
    const p = randomFreeGround(true, 1);
    if (p) place({ kind: 'bush', ...p, ripe: true });
  }
  for (let i = 0; i < Math.round(6 * area); i++) {
    const p = randomFreeGround(false, 1);
    if (p) place({ kind: 'flower', ...p });
  }

  if (variant === 'shared') {
    const deco: [string, number, number][] = [
      ['lamp', -4, -4], ['lamp', 4, -4], ['lamp', -4, 4], ['lamp', 4, 4],
      ['bench', -2, -5], ['bench', 2, -5], ['picnic_table', 0, 0], ['flower_pot', -5, 0], ['flower_pot', 5, 0],
    ];
    for (const [itemId, ox, oz] of deco) {
      const x = Math.floor(c + ox), z = Math.floor(c + oz);
      if (get(x, z) === Tile.Ground) place({ kind: 'furniture', x, z, item: itemId, rot: 0 });
    }
  }
  return objects;
}
