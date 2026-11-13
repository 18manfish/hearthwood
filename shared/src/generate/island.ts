// Deterministic island generation from a seed. This file only orders the steps;
// each lives in its own module. The output must stay bit-identical for every seed:
// untouched islands are stored as seed + biome and regenerated on every load.

import type { BiomeId } from '../data/biomes.ts';
import type { IslandLayout } from '../world/objects.ts';
import { classifyWater } from '../world/tiles.ts';
import { widenBeaches } from './beach.ts';
import { carveCliffs } from './cliffs.ts';
import { landMask, placeDock, waterFeatures } from './landmass.ts';
import { carveRiver } from './river.ts';
import { scatter } from './scatter.ts';
import { newGenState, type GenOptions } from './state.ts';

export type { GenOptions } from './state.ts';
export { connectPlateaus, smoothLevels } from './cliffs.ts';

/** Deterministic island generation from a seed. */
export function generateIsland(seed: number, biome: BiomeId, opts: GenOptions = {}): IslandLayout {
  const st = newGenState(seed, biome, opts);
  const { size, tiles, levels, ramps, variant } = st;
  landMask(st);
  waterFeatures(st);
  placeDock(st);
  if (opts.elevation && variant !== 'shared') carveCliffs(seed, size, tiles, levels, ramps, (x, z) => st.inClearing(x, z, 8.5), st.spawn, st.riverSource);
  else if (st.riverSource) carveRiver(seed, size, tiles, levels, st.riverSource.x, st.riverSource.z, st.S);
  const objects = scatter(st);
  const beachBand = widenBeaches(st);
  classifyWater(size, tiles);
  return { size, tiles, levels, ramps, objects, buildings: [st.dock!], spawn: st.spawn, beachBand };
}
