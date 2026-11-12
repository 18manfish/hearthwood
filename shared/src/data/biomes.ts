// Starting locations. Each biome defines its look, its resources and its climate.

export type BiomeId =
  | 'grassland'
  | 'tropical'
  | 'nordic'
  | 'forest_edge'
  | 'oasis'
  | 'jungle'
  | 'desert';

export type SeasonModel = 'temperate' | 'boreal' | 'tropical' | 'arid';
export type Season = 'spring' | 'summer' | 'autumn' | 'winter' | 'wet' | 'dry' | 'hot' | 'cool';
export type Weather = 'clear' | 'cloudy' | 'rain' | 'storm' | 'snow' | 'fog' | 'sandstorm' | 'heatwave';

export type TreeSpecies = 'oak' | 'apple' | 'cherry' | 'pine' | 'birch' | 'palm' | 'date_palm' | 'banana' | 'jungle_giant' | 'cactus' | 'acacia';

export interface TreeSpeciesDef {
  id: TreeSpecies;
  name: string;
  fruit?: string; // item id dropped when shaken
  /** Foliage colours by season (hex). Missing seasons fall back to `summer`/`default`. */
  foliage: Partial<Record<Season | 'default', string>>;
  trunk: string;
  shape: 'round' | 'cone' | 'palm' | 'tall' | 'cactus' | 'flat';
  /** Loses leaves in winter. */
  deciduous?: boolean;
}

export const TREES: Record<TreeSpecies, TreeSpeciesDef> = {
  oak: { id: 'oak', name: 'Oak', shape: 'round', trunk: '#7a5230', deciduous: true, foliage: { spring: '#7fc650', summer: '#4f9e3a', autumn: '#d9822b', winter: '#8d7f6b', default: '#4f9e3a' } },
  apple: { id: 'apple', name: 'Apple Tree', fruit: 'apple', shape: 'round', trunk: '#80583a', deciduous: true, foliage: { spring: '#f4c2d7', summer: '#5bab45', autumn: '#c9a33b', winter: '#8d7f6b', default: '#5bab45' } },
  cherry: { id: 'cherry', name: 'Cherry Tree', fruit: 'cherry', shape: 'round', trunk: '#6d4433', deciduous: true, foliage: { spring: '#ffb7d0', summer: '#4f9b4a', autumn: '#d0582f', winter: '#8d7f6b', default: '#4f9b4a' } },
  pine: { id: 'pine', name: 'Pine', fruit: 'pinecone', shape: 'cone', trunk: '#5b3b25', foliage: { winter: '#2f5d4a', default: '#2e6b43' } },
  birch: { id: 'birch', name: 'Birch', shape: 'tall', trunk: '#e8e4da', deciduous: true, foliage: { spring: '#9ad15f', summer: '#6db64a', autumn: '#f0c419', winter: '#b9b2a5', default: '#6db64a' } },
  palm: { id: 'palm', name: 'Coconut Palm', fruit: 'coconut', shape: 'palm', trunk: '#a77b4f', foliage: { default: '#3fae4a', dry: '#6fae3a' } },
  date_palm: { id: 'date_palm', name: 'Date Palm', fruit: 'dates', shape: 'palm', trunk: '#946c45', foliage: { default: '#5a9a3c', hot: '#6c9a3a' } },
  banana: { id: 'banana', name: 'Banana Plant', fruit: 'banana', shape: 'palm', trunk: '#7c9a3a', foliage: { default: '#58b947' } },
  jungle_giant: { id: 'jungle_giant', name: 'Kapok', shape: 'flat', trunk: '#6a5139', foliage: { default: '#1f7a3a', wet: '#1b8a3c' } },
  cactus: { id: 'cactus', name: 'Cactus', fruit: 'prickly_pear', shape: 'cactus', trunk: '#4f8a3c', foliage: { default: '#4f8a3c' } },
  acacia: { id: 'acacia', name: 'Acacia', shape: 'flat', trunk: '#7d5a3a', foliage: { default: '#7a9a3a', hot: '#8f9a3a', cool: '#6f9a40' } },
};

export interface BiomeDef {
  id: BiomeId;
  name: string;
  blurb: string;
  /** Marker / region on the 1000×560 world map. */
  map: { x: number; y: number; r: number; color: string };
  seasonModel: SeasonModel;
  ground: Partial<Record<Season | 'default', string>>;
  shore: string;
  trees: { species: TreeSpecies; weight: number }[];
  treeDensity: number; // 0..1
  bushItem: string;
  bushColor: string;
  mushroomChance: number; // per tree per day
  rareMushroomChance: number; // chance a spawned mushroom is rare
  rockCount: number;
  water: 'pond' | 'river' | 'oasis' | 'lagoon' | 'none';
  seaFish: string[];
  freshFish: string[];
  /** Mean temperature (°C) by season – adjusted by time of day. */
  temp: Partial<Record<Season, number>>;
  dayNightSwing: number;
  /** Weather weights per season. */
  weather: Partial<Record<Season, Partial<Record<Weather, number>>>>;
  villagerFlavor: string;
}

export const BIOMES: Record<BiomeId, BiomeDef> = {
  grassland: {
    id: 'grassland',
    name: 'Grassland',
    blurb: 'Rolling meadows, apple trees and a lazy pond. Four mild seasons.',
    map: { x: 330, y: 250, r: 70, color: '#8cc65b' },
    seasonModel: 'temperate',
    ground: { spring: '#86c75a', summer: '#79b84c', autumn: '#a7a650', winter: '#e9eef2', default: '#79b84c' },
    shore: '#e6d6a3',
    trees: [ { species: 'apple', weight: 3 }, { species: 'oak', weight: 4 }, { species: 'birch', weight: 1 } ],
    treeDensity: 0.035,
    bushItem: 'berries',
    bushColor: '#3f8f3f',
    mushroomChance: 0.05,
    rareMushroomChance: 0.03,
    rockCount: 6,
    water: 'pond',
    seaFish: ['fish_sardine', 'fish_mackerel', 'fish_seabass', 'fish_oarfish'],
    freshFish: ['fish_carp', 'fish_perch', 'fish_pike', 'fish_trout', 'fish_koi'],
    temp: { spring: 13, summer: 24, autumn: 12, winter: 1 },
    dayNightSwing: 8,
    weather: {
      spring: { clear: 4, cloudy: 3, rain: 3, fog: 1 },
      summer: { clear: 7, cloudy: 2, rain: 1, storm: 1 },
      autumn: { clear: 2, cloudy: 4, rain: 4, fog: 2 },
      winter: { clear: 2, cloudy: 4, snow: 4, fog: 1 },
    },
    villagerFlavor: 'loves picnics in the meadow',
  },
  tropical: {
    id: 'tropical',
    name: 'Tropical Island',
    blurb: 'White sand, coconut palms and a turquoise lagoon. Wet & dry seasons.',
    map: { x: 460, y: 470, r: 62, color: '#3fd0c9' },
    seasonModel: 'tropical',
    ground: { wet: '#5cc35a', dry: '#8cc65b', default: '#6cc35a' },
    shore: '#f6ecc8',
    trees: [ { species: 'palm', weight: 6 }, { species: 'banana', weight: 2 } ],
    treeDensity: 0.03,
    bushItem: 'berries',
    bushColor: '#2e9a50',
    mushroomChance: 0.02,
    rareMushroomChance: 0.05,
    rockCount: 4,
    water: 'lagoon',
    seaFish: ['fish_clownfish', 'fish_butterfly', 'fish_tuna', 'fish_mahi', 'fish_sardine', 'fish_oarfish'],
    freshFish: ['fish_tilapia', 'fish_koi'],
    temp: { wet: 29, dry: 27 },
    dayNightSwing: 5,
    weather: {
      wet: { clear: 2, cloudy: 3, rain: 5, storm: 2 },
      dry: { clear: 8, cloudy: 2, rain: 1 },
    },
    villagerFlavor: 'never leaves home without sunscreen',
  },
  nordic: {
    id: 'nordic',
    name: 'Nordic Forest',
    blurb: 'Deep pine forests, cloudberries and icy rivers. Long snowy winters and auroras.',
    map: { x: 480, y: 70, r: 70, color: '#3f7a63' },
    seasonModel: 'boreal',
    ground: { spring: '#6e9e5a', summer: '#5f9a4c', autumn: '#9c8a4e', winter: '#f2f6fa', default: '#5f9a4c' },
    shore: '#c9c3ae',
    trees: [ { species: 'pine', weight: 7 }, { species: 'birch', weight: 3 } ],
    treeDensity: 0.055,
    bushItem: 'cloudberry',
    bushColor: '#3b7445',
    mushroomChance: 0.08,
    rareMushroomChance: 0.04,
    rockCount: 8,
    water: 'river',
    seaFish: ['fish_cod', 'fish_herring', 'fish_mackerel', 'fish_oarfish'],
    freshFish: ['fish_salmon', 'fish_char', 'fish_trout', 'fish_pike'],
    temp: { spring: 5, summer: 16, autumn: 4, winter: -9 },
    dayNightSwing: 6,
    weather: {
      spring: { clear: 3, cloudy: 4, rain: 2, snow: 1, fog: 1 },
      summer: { clear: 5, cloudy: 3, rain: 2 },
      autumn: { clear: 2, cloudy: 4, rain: 3, fog: 2, snow: 1 },
      winter: { clear: 3, cloudy: 2, snow: 6, fog: 1 },
    },
    villagerFlavor: 'knits by the fire all winter',
  },
  forest_edge: {
    id: 'forest_edge',
    name: 'Edge of the Forest',
    blurb: 'Where meadow meets old woods. Mushrooms galore, misty mornings, cherry blossoms.',
    map: { x: 520, y: 210, r: 66, color: '#5d9c4a' },
    seasonModel: 'temperate',
    ground: { spring: '#7cbf55', summer: '#6aad48', autumn: '#b08b45', winter: '#e8edf1', default: '#6aad48' },
    shore: '#d9cfa6',
    trees: [ { species: 'oak', weight: 4 }, { species: 'cherry', weight: 2 }, { species: 'pine', weight: 2 }, { species: 'birch', weight: 1 } ],
    treeDensity: 0.05,
    bushItem: 'berries',
    bushColor: '#357a3a',
    mushroomChance: 0.12,
    rareMushroomChance: 0.06,
    rockCount: 6,
    water: 'river',
    seaFish: ['fish_sardine', 'fish_seabass', 'fish_seabream', 'fish_oarfish'],
    freshFish: ['fish_trout', 'fish_carp', 'fish_catfish', 'fish_pike'],
    temp: { spring: 12, summer: 22, autumn: 11, winter: 0 },
    dayNightSwing: 8,
    weather: {
      spring: { clear: 3, cloudy: 3, rain: 3, fog: 2 },
      summer: { clear: 6, cloudy: 2, rain: 2, storm: 1 },
      autumn: { clear: 2, cloudy: 3, rain: 3, fog: 4 },
      winter: { clear: 2, cloudy: 3, snow: 4, fog: 2 },
    },
    villagerFlavor: 'collects pretty mushrooms',
  },
  oasis: {
    id: 'oasis',
    name: 'Desert Oasis',
    blurb: 'A palm-ringed spring in golden dunes. Date palms, koi and starry nights.',
    map: { x: 720, y: 360, r: 55, color: '#55c2a0' },
    seasonModel: 'arid',
    ground: { hot: '#d9c27a', cool: '#cdbb7c', default: '#d4bf7a' },
    shore: '#ead7a1',
    trees: [ { species: 'date_palm', weight: 6 }, { species: 'palm', weight: 1 }, { species: 'acacia', weight: 1 } ],
    treeDensity: 0.025,
    bushItem: 'herbs',
    bushColor: '#6f8f3f',
    mushroomChance: 0.01,
    rareMushroomChance: 0.02,
    rockCount: 7,
    water: 'oasis',
    seaFish: ['fish_seabream', 'fish_sardine', 'fish_tuna'],
    freshFish: ['fish_tilapia', 'fish_koi', 'fish_catfish'],
    temp: { hot: 33, cool: 19 },
    dayNightSwing: 13,
    weather: {
      hot: { clear: 8, heatwave: 2, sandstorm: 1 },
      cool: { clear: 7, cloudy: 2, rain: 1, sandstorm: 1 },
    },
    villagerFlavor: 'tells stories about desert caravans',
  },
  jungle: {
    id: 'jungle',
    name: 'Jungle',
    blurb: 'Towering kapoks, a winding river and glowing mushrooms. Steamy and rainy.',
    map: { x: 760, y: 220, r: 72, color: '#1f8a4a' },
    seasonModel: 'tropical',
    ground: { wet: '#3c9a45', dry: '#4f9e45', default: '#45a045' },
    shore: '#cdbb8a',
    trees: [ { species: 'jungle_giant', weight: 4 }, { species: 'banana', weight: 3 }, { species: 'palm', weight: 1 } ],
    treeDensity: 0.06,
    bushItem: 'berries',
    bushColor: '#1f6e3a',
    mushroomChance: 0.1,
    rareMushroomChance: 0.12,
    rockCount: 5,
    water: 'river',
    seaFish: ['fish_butterfly', 'fish_mackerel', 'fish_tuna'],
    freshFish: ['fish_piranha', 'fish_catfish', 'fish_arowana', 'fish_tilapia'],
    temp: { wet: 27, dry: 29 },
    dayNightSwing: 6,
    weather: {
      wet: { cloudy: 2, rain: 6, storm: 3, fog: 2 },
      dry: { clear: 4, cloudy: 3, rain: 3, fog: 2 },
    },
    villagerFlavor: 'can name every bird call',
  },
  desert: {
    id: 'desert',
    name: 'Desert',
    blurb: 'Endless dunes, cacti and rugged rocks full of ore. Scorching days, chilly nights.',
    map: { x: 640, y: 450, r: 60, color: '#e3b55f' },
    seasonModel: 'arid',
    ground: { hot: '#e5c27a', cool: '#dcbc7e', default: '#e0c07c' },
    shore: '#efd9a3',
    trees: [ { species: 'cactus', weight: 5 }, { species: 'acacia', weight: 3 } ],
    treeDensity: 0.022,
    bushItem: 'herbs',
    bushColor: '#8a8f4a',
    mushroomChance: 0.005,
    rareMushroomChance: 0.02,
    rockCount: 12,
    water: 'none',
    seaFish: ['fish_seabream', 'fish_sardine', 'fish_seabass', 'fish_oarfish'],
    freshFish: [],
    temp: { hot: 36, cool: 18 },
    dayNightSwing: 16,
    weather: {
      hot: { clear: 7, heatwave: 3, sandstorm: 2 },
      cool: { clear: 7, cloudy: 2, sandstorm: 2, rain: 0.5 },
    },
    villagerFlavor: 'polishes rocks for fun',
  },
};

export const BIOME_IDS = Object.keys(BIOMES) as BiomeId[];

export function isBiome(v: unknown): v is BiomeId {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(BIOMES, v);
}

/** Shared locations every player can visit. */
export interface SharedLocationDef {
  id: string;
  name: string;
  blurb: string;
  biome: BiomeId;
  map: { x: number; y: number };
  /** Real-world coordinates that drive the sun & seasons there. */
  geo: { lat: number; lon: number; tz: string };
}

export const SHARED_LOCATIONS: SharedLocationDef[] = [
  { id: 'harbor', name: 'Harbor Town Square', blurb: 'The bustling heart of the world. Meet travellers and fish off the pier.', biome: 'grassland', map: { x: 430, y: 330 }, geo: { lat: 46.0, lon: 8.95, tz: 'Europe/Zurich' } },
  { id: 'aurora', name: 'Aurora Lookout', blurb: 'A snowy hilltop where everyone gathers to watch the northern lights.', biome: 'nordic', map: { x: 620, y: 95 }, geo: { lat: 69.6, lon: 18.9, tz: 'Europe/Oslo' } },
  { id: 'bazaar', name: 'Sunset Bazaar', blurb: 'A lantern-lit market where the desert meets the oasis.', biome: 'oasis', map: { x: 820, y: 430 }, geo: { lat: 25.3, lon: 55.4, tz: 'Asia/Dubai' } },
];

export function sharedLocation(id: string): SharedLocationDef | undefined {
  return SHARED_LOCATIONS.find((s) => s.id === id);
}
