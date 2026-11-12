// Things that wash ashore on island beaches.

import type { BiomeId } from './biomes.ts';

export interface WashupDef {
  item: string;
  weight: number;
  /** Only on these biomes (default: all). */
  biomes?: BiomeId[];
}

export const WASHUPS: WashupDef[] = [
  { item: 'seashell', weight: 12 },
  { item: 'driftwood', weight: 8 },
  { item: 'seaweed', weight: 7 },
  { item: 'sea_glass', weight: 4 },
  { item: 'conch', weight: 1.5 },
  { item: 'coral', weight: 3, biomes: ['tropical', 'jungle', 'oasis'] },
  { item: 'message_bottle', weight: 1 },
  { item: 'pearl', weight: 0.25 },
];

export function washupsFor(biome: BiomeId) {
  return WASHUPS.filter((w) => !w.biomes || w.biomes.includes(biome));
}

/** Messages in bottles: longest text and how long until one washes up. */
export const BOTTLE_MAX_CHARS = 280;
export const BOTTLE_MIN_DELAY_MS = 5 * 60_000;
export const BOTTLE_MAX_DELAY_MS = 24 * 3600_000;
/** One bottle per player every so often. */
export const BOTTLE_COOLDOWN_MS = 10 * 60_000;
