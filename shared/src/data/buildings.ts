// Buildable structures. Costs, footprints and unlock rules live here so the
// server can validate and the client can show the build menu.

export type BuildingType =
  | 'campfire'
  | 'tent'
  | 'workbench'
  | 'cabin'
  | 'town_hall'
  | 'villager_house'
  | 'mailbox'
  | 'travel_agent'
  | 'clothing_shop'
  | 'restaurant'
  | 'tool_store'
  | 'furniture_store'
  | 'dock'
  | 'bridge_ns'
  | 'bridge_ew'
  | 'bridge_ns_long'
  | 'bridge_ew_long'
  // Interior fixtures (not buildable)
  | 'exit'
  | 'bed'
  | 'chest'
  // Shared-location set pieces (not buildable)
  | 'shack'
  | 'stall'
  | 'lighthouse'
  | 'fountain'
  | 'billboard'
  | 'counter';

export interface BuildingDef {
  type: BuildingType;
  name: string;
  icon: string;
  w: number; // footprint in tiles (x)
  h: number; // footprint in tiles (z)
  cost: Record<string, number>;
  /** Buildings that must exist (completed) first. */
  requires: BuildingType[];
  /** Minimum island age (days since founding, day 1 = first day). */
  minDay: number;
  /** Real-time construction duration in minutes (0 = instant). */
  buildMinutes: number;
  max: number;
  color: string;
  roof: string;
  description: string;
  /** Not player buildable (e.g. the dock). */
  fixed?: boolean;
  /** Pure scenery: not interactive. */
  decor?: boolean;
}

const shop = (
  type: BuildingType,
  name: string,
  icon: string,
  color: string,
  roof: string,
  description: string,
): BuildingDef => ({
  type,
  name,
  icon,
  w: 3,
  h: 3,
  cost: { wood: 40, stone: 25, clay: 10, iron_ore: 4 },
  requires: ['town_hall'],
  minDay: 31,
  buildMinutes: 240,
  max: 1,
  color,
  roof,
  description,
});

export const BUILDINGS: Record<BuildingType, BuildingDef> = {
  campfire: {
    type: 'campfire', name: 'Campfire', icon: '🔥', w: 1, h: 1,
    cost: { wood: 5, stone: 5 }, requires: [], minDay: 1, buildMinutes: 0, max: 1,
    color: '#5a4030', roof: '#ff8c2a', description: 'Warmth and light for your first night. Cook simple meals here.',
  },
  tent: {
    type: 'tent', name: 'Tent', icon: '⛺', w: 2, h: 2,
    cost: { wood: 8, fiber: 8 }, requires: [], minDay: 1, buildMinutes: 0, max: 1,
    color: '#d9a441', roof: '#c8553d', description: 'A simple shelter to sleep in.',
  },
  workbench: {
    type: 'workbench', name: 'Workbench', icon: '🛠️', w: 1, h: 1,
    cost: { wood: 8, stone: 2 }, requires: [], minDay: 1, buildMinutes: 0, max: 1,
    color: '#9b6b3e', roof: '#7a5230', description: 'Craft furniture and better gear.',
  },
  cabin: {
    type: 'cabin', name: 'Starter House', icon: '🏠', w: 3, h: 3,
    cost: { wood: 40, stone: 20, clay: 8 }, requires: ['tent', 'campfire', 'workbench'], minDay: 2, buildMinutes: 60, max: 1,
    color: '#e8d2a6', roof: '#b5523b', description: 'Your very own house – with a mailbox.',
  },
  town_hall: {
    type: 'town_hall', name: 'Town Hall', icon: '🏛️', w: 4, h: 3,
    cost: { wood: 60, stone: 40, clay: 15, iron_ore: 5 }, requires: ['cabin'], minDay: 7, buildMinutes: 360, max: 1,
    color: '#f1e4c8', roof: '#3d6fb6', description: 'The heart of your village. Sell goods, invite villagers, manage visitors.',
  },
  villager_house: {
    type: 'villager_house', name: 'Villager House', icon: '🏡', w: 2, h: 2,
    cost: { wood: 25, stone: 10, clay: 5 }, requires: ['town_hall'], minDay: 7, buildMinutes: 180, max: 7,
    color: '#f3d9b1', roof: '#6aa84f', description: 'A home for a new neighbour. A villager moves in once it is finished.',
  },
  mailbox: {
    type: 'mailbox', name: 'Mailbox', icon: '📮', w: 1, h: 1,
    cost: { wood: 4, stone: 2, clay: 1 }, requires: ['cabin'], minDay: 2, buildMinutes: 0, max: 1,
    color: '#d64541', roof: '#5d4037', description: 'Send letters & gifts to friends. Visitors can leave you a letter, and the flag goes up when you have mail.',
  },
  travel_agent: shop('travel_agent', 'Travel Agent', '✈️', '#e1f0f7', '#2a9d8f', 'Book mystery tours to resource-rich islands.'),
  clothing_shop: shop('clothing_shop', 'Clothing Shop', '👕', '#fbe3ec', '#c2185b', 'Hats and a full wardrobe makeover.'),
  restaurant: shop('restaurant', 'Restaurant', '🍽️', '#fff2d6', '#e67e22', 'Cook hearty meals from what you gather.'),
  tool_store: shop('tool_store', 'Tool Store', '🧰', '#e8e8e8', '#7f8c8d', 'Sturdier tools and saplings.'),
  furniture_store: shop('furniture_store', 'Furniture Store', '🛋️', '#efe1cf', '#8e5a3c', 'Benches, lamps and other outdoor decor.'),
  bridge_ns: {
    type: 'bridge_ns', name: 'Bridge (north–south)', icon: '🌉', w: 2, h: 4,
    cost: { wood: 30, stone: 10 }, requires: ['workbench'], minDay: 1, buildMinutes: 0, max: 8,
    color: '#a0703f', roof: '#7a5230', description: 'Crosses a two-tile river or pond running east–west. Both ends need flat ground.',
  },
  bridge_ew: {
    type: 'bridge_ew', name: 'Bridge (east–west)', icon: '🌉', w: 4, h: 2,
    cost: { wood: 30, stone: 10 }, requires: ['workbench'], minDay: 1, buildMinutes: 0, max: 8,
    color: '#a0703f', roof: '#7a5230', description: 'Crosses a two-tile river or pond running north–south. Both ends need flat ground.',
  },
  bridge_ns_long: {
    type: 'bridge_ns_long', name: 'Long bridge (north–south)', icon: '🌉', w: 2, h: 5,
    cost: { wood: 40, stone: 15 }, requires: ['workbench'], minDay: 1, buildMinutes: 0, max: 8,
    color: '#a0703f', roof: '#7a5230', description: 'Crosses three tiles of water running east–west.',
  },
  bridge_ew_long: {
    type: 'bridge_ew_long', name: 'Long bridge (east–west)', icon: '🌉', w: 5, h: 2,
    cost: { wood: 40, stone: 15 }, requires: ['workbench'], minDay: 1, buildMinutes: 0, max: 8,
    color: '#a0703f', roof: '#7a5230', description: 'Crosses three tiles of water running north–south.',
  },
  dock: {
    type: 'dock', name: 'Dock', icon: '⚓', w: 2, h: 3, cost: {}, requires: [], minDay: 1, buildMinutes: 0, max: 1,
    color: '#8b6b47', roof: '#8b6b47', description: 'Travel to other islands from here.', fixed: true,
  },
  exit: fixture('exit', 'Door', '🚪', 1, 1, 'Head back outside.'),
  bed: fixture('bed', 'Bed', '🛏️', 1, 2, 'Have a little rest.'),
  chest: fixture('chest', 'Storage Chest', '🧰', 1, 1, 'Your sell box.'),
  shack: fixture('shack', 'Fisher’s Cottage', '🏠', 2, 2, 'A colourful fisher’s house.'),
  stall: { ...fixture('stall', 'Market Stall', '🏪', 2, 1, 'Fresh fish and fruit, every morning.'), decor: true },
  lighthouse: fixture('lighthouse', 'Lighthouse', '🗼', 2, 2, 'Guides boats home at night.'),
  fountain: { ...fixture('fountain', 'Fountain', '⛲', 2, 2, 'Toss in a coin for luck.'), decor: true },
  billboard: fixture('billboard', 'Billboard', '📌', 2, 1, 'Pin a note for everyone to read.'),
  counter: fixture('counter', 'Counter', '🛎️', 2, 1, 'Ring the bell for service.'),
};

function fixture(type: BuildingType, name: string, icon: string, w: number, h: number, description: string): BuildingDef {
  return { type, name, icon, w, h, cost: {}, requires: [], minDay: 1, buildMinutes: 0, max: 1, color: '#a0703f', roof: '#a0703f', description, fixed: true };
}

/** Buildings you can walk into. */
export const ENTERABLE: BuildingType[] = [
  'tent', 'cabin', 'town_hall', 'villager_house', 'travel_agent', 'clothing_shop', 'restaurant', 'tool_store', 'furniture_store', 'shack', 'lighthouse',
];
/** Fixtures that do not block movement. */
export const NON_BLOCKING: BuildingType[] = ['dock', 'exit'];

/** Billboard posts. */
export const BOARD_MAX_POSTS = 60;
export const BOARD_POST_COOLDOWN_MS = 20_000;

export const BUILDABLE: BuildingType[] = [];
export function rebuildBuildable() {
  BUILDABLE.length = 0;
  BUILDABLE.push(...(Object.keys(BUILDINGS) as BuildingType[]).filter((t) => !BUILDINGS[t].fixed));
}
rebuildBuildable();

export const SHOP_TYPES: BuildingType[] = ['travel_agent', 'clothing_shop', 'restaurant', 'tool_store', 'furniture_store'];

export const MAX_VILLAGERS = 7;
/** Villager houses 4–7 open up in month two. */
export const VILLAGER_HOUSE_MONTH_ONE_LIMIT = 3;
export const VILLAGER_HOUSE_MONTH_TWO_MIN_DAY = 31;

export function isBuildingType(v: unknown): v is BuildingType {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(BUILDINGS, v);
}

/** Shop inventories (coins). */
export const SHOP_STOCK: Partial<Record<BuildingType, string[]>> = {
  tool_store: ['iron_axe', 'iron_shovel', 'pro_rod', 'silk_net', 'sapling'],
  furniture_store: [
    'bench', 'lamp', 'flower_pot', 'fence', 'picnic_table', 'barrel', 'crate', 'gnome',
    // Bohemian pack
    'boho_peacock_chair', 'boho_egg_chair', 'boho_floor_cushions', 'boho_pouf', 'boho_sofa', 'boho_canopy_bed', 'boho_coffee_table',
    'boho_trunk', 'boho_ladder_shelf', 'boho_room_divider', 'boho_kilim_rug', 'boho_jute_rug', 'boho_macrame', 'boho_tapestry',
    'boho_dreamcatcher', 'boho_lantern', 'boho_floor_lamp', 'boho_monstera', 'boho_plant_stand', 'boho_pampas_vase',
  ],
  clothing_shop: ['straw_hat', 'beanie', 'cap', 'flower_crown'],
};

export const MYSTERY_TOUR_COST = 500;
