// Birds: they land on islands, hop about for a few minutes and can be caught
// with a bird net. Like fish they are registered as regular items.

import type { BiomeId } from './biomes.ts';

export interface BirdDef {
  id: string;
  name: string;
  icon: string;
  sell: number;
  /** Weight – higher is more common. */
  rarity: number;
  biomes: BiomeId[];
  /** Active hours (island local), inclusive start, exclusive end. Wraps past midnight. */
  hours?: [number, number];
  /** Seasons in which it appears (undefined = all year). */
  seasons?: string[];
  /** Where it lands: on grass (default) or on the beach. */
  perch?: 'ground' | 'shore';
  /** Model colours: body, wing, belly / accent, beak. */
  colors: [string, string, string, string];
  /** Model scale (1 = sparrow-sized). */
  size: number;
}

const TEMPERATE: BiomeId[] = ['grassland', 'forest_edge'];
const COLD: BiomeId[] = ['nordic'];
const WARM: BiomeId[] = ['tropical', 'jungle'];
const DRY: BiomeId[] = ['desert', 'oasis'];
const ALL: BiomeId[] = [...TEMPERATE, ...COLD, ...WARM, ...DRY];

export const BIRDS: BirdDef[] = [
  { id: 'bird_sparrow', name: 'House Sparrow', icon: '🐦', sell: 60, rarity: 12, biomes: [...TEMPERATE, ...COLD, ...DRY], hours: [5, 20], colors: ['#8d6e4f', '#5d4330', '#d7c4a3', '#3e2f22'], size: 0.9 },
  { id: 'bird_robin', name: 'Robin', icon: '🐦', sell: 120, rarity: 8, biomes: [...TEMPERATE, ...COLD], hours: [5, 20], seasons: ['spring', 'autumn', 'winter'], colors: ['#7b6a52', '#5f513e', '#e2672e', '#2e2a24'], size: 0.9 },
  { id: 'bird_blue_tit', name: 'Blue Tit', icon: '🐦', sell: 140, rarity: 7, biomes: TEMPERATE, hours: [6, 19], colors: ['#7aa84a', '#3d7cc9', '#f2d64b', '#2b2b2b'], size: 0.8 },
  { id: 'bird_magpie', name: 'Magpie', icon: '🐦‍⬛', sell: 180, rarity: 6, biomes: [...TEMPERATE, ...COLD], hours: [6, 19], colors: ['#1f2430', '#2f4f8f', '#f4f4f4', '#151515'], size: 1.3 },
  { id: 'bird_crow', name: 'Carrion Crow', icon: '🐦‍⬛', sell: 150, rarity: 7, biomes: ALL, hours: [5, 21], colors: ['#20232a', '#2c3039', '#3a3f4a', '#111111'], size: 1.35 },
  { id: 'bird_woodpecker', name: 'Great Spotted Woodpecker', icon: '🐦', sell: 320, rarity: 3, biomes: ['forest_edge', 'nordic'], hours: [7, 17], colors: ['#222222', '#f2f2f2', '#d12a2a', '#3b3b3b'], size: 1.1 },
  { id: 'bird_owl', name: 'Tawny Owl', icon: '🦉', sell: 600, rarity: 3, biomes: ['forest_edge', 'nordic', 'jungle', 'grassland'], hours: [20, 5], colors: ['#8b5e3c', '#6b4429', '#c9a27a', '#e0b23a'], size: 1.5 },
  { id: 'bird_bullfinch', name: 'Bullfinch', icon: '🐦', sell: 260, rarity: 4, biomes: COLD, hours: [7, 17], seasons: ['autumn', 'winter'], colors: ['#5d6470', '#1d1d1d', '#e05a47', '#222222'], size: 0.95 },
  { id: 'bird_snow_bunting', name: 'Snow Bunting', icon: '🐦', sell: 340, rarity: 3, biomes: COLD, hours: [8, 16], seasons: ['winter'], colors: ['#f1efe9', '#8a6f52', '#ffffff', '#c58b2b'], size: 0.9 },
  { id: 'bird_waxwing', name: 'Bohemian Waxwing', icon: '🐦', sell: 420, rarity: 2, biomes: COLD, hours: [8, 16], seasons: ['winter', 'spring'], colors: ['#c49a7a', '#5f5f6a', '#f3c94a', '#2b2b2b'], size: 1.0 },
  { id: 'bird_kingfisher', name: 'Kingfisher', icon: '🐦', sell: 500, rarity: 2, biomes: ['grassland', 'forest_edge', 'oasis'], hours: [6, 18], colors: ['#1f8fc9', '#21b3c9', '#e8823a', '#222222'], size: 0.9 },
  { id: 'bird_pheasant', name: 'Golden Pheasant', icon: '🐓', sell: 1100, rarity: 0.8, biomes: ['forest_edge', 'grassland'], hours: [6, 10], colors: ['#d8342a', '#2a5fa8', '#f5c542', '#d7b06a'], size: 1.7 },
  { id: 'bird_seagull', name: 'Herring Gull', icon: '🕊️', sell: 90, rarity: 10, biomes: ALL, hours: [5, 21], perch: 'shore', colors: ['#f4f4f4', '#9aa4ad', '#ffffff', '#f2c230'], size: 1.4 },
  { id: 'bird_sandpiper', name: 'Sandpiper', icon: '🐦', sell: 200, rarity: 5, biomes: ['grassland', 'tropical', 'nordic', 'oasis'], hours: [5, 20], perch: 'shore', colors: ['#b39c7c', '#7c6a52', '#f2ede2', '#2b2b2b'], size: 0.85 },
  { id: 'bird_parrot', name: 'Scarlet Macaw', icon: '🦜', sell: 700, rarity: 3, biomes: WARM, hours: [6, 18], colors: ['#d9282f', '#2a6fd0', '#f4c430', '#e8e1d0'], size: 1.5 },
  { id: 'bird_toucan', name: 'Toco Toucan', icon: '🐦', sell: 900, rarity: 1.5, biomes: ['jungle'], hours: [7, 17], colors: ['#161616', '#161616', '#f5f5f0', '#f28c1d'], size: 1.5 },
  { id: 'bird_hummingbird', name: 'Hummingbird', icon: '🐦', sell: 480, rarity: 3, biomes: WARM, hours: [6, 18], colors: ['#2fa36b', '#1f7a6a', '#e74c8b', '#222222'], size: 0.55 },
  { id: 'bird_lorikeet', name: 'Rainbow Lorikeet', icon: '🦜', sell: 400, rarity: 4, biomes: ['tropical'], hours: [6, 18], colors: ['#3aa84a', '#2e5fc9', '#f28c28', '#e43b3b'], size: 1.0 },
  { id: 'bird_flamingo', name: 'Flamingo', icon: '🦩', sell: 1000, rarity: 1, biomes: ['oasis', 'tropical'], hours: [6, 19], perch: 'shore', colors: ['#f48fb1', '#ec6f9a', '#f8bbd0', '#2b2b2b'], size: 2.0 },
  { id: 'bird_roadrunner', name: 'Roadrunner', icon: '🐦', sell: 450, rarity: 3, biomes: ['desert'], hours: [6, 19], colors: ['#8a7356', '#4f4334', '#e6d9bf', '#2b2b2b'], size: 1.3 },
  { id: 'bird_lark', name: 'Desert Lark', icon: '🐦', sell: 160, rarity: 8, biomes: DRY, hours: [5, 19], colors: ['#c8a978', '#a88a5d', '#eadcc0', '#5a4a36'], size: 0.85 },
  { id: 'bird_hoopoe', name: 'Hoopoe', icon: '🐦', sell: 550, rarity: 2, biomes: DRY, hours: [7, 17], colors: ['#d9945a', '#1f1f1f', '#f2e3cf', '#2b2b2b'], size: 1.1 },
  { id: 'bird_nightjar', name: 'Nightjar', icon: '🐦', sell: 650, rarity: 1.5, biomes: [...DRY, ...WARM], hours: [20, 4], colors: ['#7a6450', '#5a4838', '#b8a07e', '#2b2b2b'], size: 1.1 },
];

export const BIRD_BY_ID: Record<string, BirdDef> = Object.fromEntries(BIRDS.map((b) => [b.id, b]));

export function hourIn(hour: number, h?: [number, number]) {
  if (!h) return true;
  const [a, b] = h;
  return a <= b ? hour >= a && hour < b : hour >= a || hour < b;
}

/** Birds that can appear on a biome at this local hour and season. */
export function birdsFor(biome: BiomeId, hour: number, season: string): BirdDef[] {
  return BIRDS.filter((b) => b.biomes.includes(biome) && hourIn(hour, b.hours) && (!b.seasons || b.seasons.includes(season)));
}

/** Catch chance with the basic net (rarer birds are warier). */
export function birdCatchChance(b: BirdDef, netPower: number) {
  const base = b.rarity >= 6 ? 0.85 : b.rarity >= 3 ? 0.72 : b.rarity >= 1.5 ? 0.6 : 0.5;
  return Math.min(0.97, base + (netPower - 1) * 0.15);
}
