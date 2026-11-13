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
  clothing_shop: shop('clothing_shop', 'Clothing Shop', '👕', '#fbe3ec', '#c2185b', 'Clothes, hats, shoes and a full makeover.'),
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

// ── Starter House tiers ─────────────────────────────────────────────────────
// The Starter House ('cabin') is upgraded in place: same 3×3 footprint, a
// grander model (client/public/models/house.glb, built by art/house_build.py)
// and a bigger interior at every tier. Upgrades are ordered at the Town Hall
// and the house stays usable while the builders work.

export type HouseTier = BuildingTier;

export const HOUSE_TIERS: HouseTier[] = [
  {
    level: 1, name: 'Starter House', icon: '🏠', description: 'A snug plaster cottage with a shingle roof and a stone chimney.',
    cost: {}, coins: 0, requires: [], minDay: 2, buildMinutes: 60, interior: 9,
  },
  {
    level: 2, name: 'Timber House', icon: '🏡', description: 'Two storeys of timber framing on a stone base, with a porch, dormer window and flower boxes.',
    cost: { wood: 80, stone: 60, clay: 25, iron_ore: 8 }, coins: 8000, requires: ['town_hall'], minDay: 10, buildMinutes: 240, interior: 11,
  },
  {
    level: 3, name: 'Hearth Manor', icon: '🏰', description: 'A dressed-stone manor with a columned portico, balcony, corner tower and gilded trim.',
    cost: { wood: 120, stone: 150, clay: 40, iron_ore: 25, sea_glass: 10, pearl: 3 }, coins: 40000, requires: ['town_hall'], minDay: 21, buildMinutes: 480, interior: 13,
  },
];
export const MAX_HOUSE_LEVEL = HOUSE_TIERS.length;

/** The tier a house shows right now (finished upgrades count). */
export function houseLevel(b: { level?: number; upgrade?: { level: number; at: number } }, now: number): number {
  const lvl = b.upgrade && b.upgrade.at <= now ? b.upgrade.level : b.level ?? 1;
  return Math.max(1, Math.min(MAX_HOUSE_LEVEL, lvl));
}

export function houseTier(b: { level?: number; upgrade?: { level: number; at: number } }, now: number): HouseTier {
  return HOUSE_TIERS[houseLevel(b, now) - 1];
}

// ── Tiers for the other buildings ──────────────────────────────────────────
// The Town Hall and the shops grow with the island in three tiers, villager
// houses in two (models: art/kit/buildings.py → buildings.glb, `bld_<type>_<tier>`).
// Like the Starter House they are upgraded in place from the Town Hall counter,
// and stay open while the builders work. Bigger tiers need an older island and
// more villagers.

export interface BuildingTier {
  level: number;
  name: string;
  icon: string;
  description: string;
  /** Upgrade price to reach this tier (tier 1 is the normal build cost). */
  cost: Record<string, number>;
  coins: number;
  requires: BuildingType[];
  minDay: number;
  /** Villagers living on the island. */
  minVillagers?: number;
  buildMinutes: number;
  /** Interior side length (Starter House only). */
  interior?: number;
}

const shopTiers = (name: string, icon: string, t1: string, t2: string, t3: string): BuildingTier[] => [
  { level: 1, name: `${name} Booth`, icon, description: t1, cost: {}, coins: 0, requires: [], minDay: 31, buildMinutes: 240 },
  {
    level: 2, name: name, icon, description: t2,
    cost: { wood: 60, stone: 50, clay: 20, iron_ore: 6 }, coins: 12000, requires: ['town_hall'], minDay: 40, minVillagers: 4, buildMinutes: 300,
  },
  {
    level: 3, name: `Grand ${name}`, icon, description: t3,
    cost: { wood: 80, stone: 140, clay: 40, iron_ore: 20, sea_glass: 6 }, coins: 45000, requires: ['town_hall'], minDay: 60, minVillagers: 6, buildMinutes: 480,
  },
];

export const BUILDING_TIERS: Partial<Record<BuildingType, BuildingTier[]>> = {
  cabin: HOUSE_TIERS,
  town_hall: [
    { level: 1, name: 'Village Hall', icon: '🏛️', description: 'A long timber hall with a bell turret, a notice board and a flag.', cost: {}, coins: 0, requires: [], minDay: 7, buildMinutes: 360 },
    {
      level: 2, name: 'Town Hall', icon: '🏛️', description: 'Brick with stone dressings, a clock over the doors, a bell tower and two flags.',
      cost: { wood: 80, stone: 90, clay: 40, iron_ore: 10 }, coins: 15000, requires: [], minDay: 21, minVillagers: 3, buildMinutes: 360,
    },
    {
      level: 3, name: 'Grand Town Hall', icon: '🏛️', description: 'A columned portico, a copper dome with a gilded clock lantern, banners and a fountain.',
      cost: { wood: 100, stone: 220, clay: 60, iron_ore: 30, sea_glass: 10, pearl: 3 }, coins: 60000, requires: ['restaurant'], minDay: 60, minVillagers: 7, buildMinutes: 600,
    },
  ],
  villager_house: [
    { level: 1, name: 'Cottage', icon: '🏡', description: 'A cosy cottage in its villager’s colours.', cost: {}, coins: 0, requires: [], minDay: 7, buildMinutes: 180 },
    {
      level: 2, name: 'Two-storey Cottage', icon: '🏡', description: 'A stone ground floor, a timber-framed upper floor, a porch, a dormer and a little garden.',
      cost: { wood: 50, stone: 40, clay: 15 }, coins: 9000, requires: [], minDay: 21, minVillagers: 3, buildMinutes: 240,
    },
  ],
  travel_agent: shopTiers('Travel Agent', '✈️',
    'A timber booth with a striped awning, suitcases and a map board out front.',
    'A proper shop: display windows, a globe-and-plane sign and the next trips on the board.',
    'A two-storey travel bureau with a golden globe on the roof and a hot-air balloon tethered behind.'),
  clothing_shop: shopTiers('Clothing Shop', '👕',
    'A timber booth with a clothes rack and a dressed mannequin.',
    'A boutique with mannequins in the windows and a T-shirt sign over the door.',
    'A two-storey fashion house with a big glass front full of mannequins.'),
  restaurant: shopTiers('Restaurant', '🍽️',
    'A little kitchen booth with a café table and a menu board.',
    'A bistro with parasols on the terrace and a chef’s-hat sign.',
    'A two-storey restaurant with a terrace, a big oven chimney and a golden sign.'),
  tool_store: shopTiers('Tool Store', '🧰',
    'A timber shed with a barrel of tools and a pile of logs.',
    'A workshop with an anvil out front and crossed axe and shovel over the door.',
    'A two-storey hardware store with the tools in gold on the roof.'),
  furniture_store: shopTiers('Furniture Store', '🛋️',
    'A timber booth with an armchair and a side table on show.',
    'A showroom with furniture in the windows and an armchair sign.',
    'A two-storey furniture house, its windows furnished like little rooms.'),
};

/** Tiers a building type has (none: it never changes). */
export function tiersOf(type: BuildingType): BuildingTier[] {
  return BUILDING_TIERS[type] ?? [];
}

/** The tier a building shows right now (finished upgrades count); 1 for buildings without tiers. */
export function buildingLevel(b: { type: BuildingType; level?: number; upgrade?: { level: number; at: number } }, now: number): number {
  const max = Math.max(1, tiersOf(b.type).length);
  const lvl = b.upgrade && b.upgrade.at <= now ? b.upgrade.level : b.level ?? 1;
  return Math.max(1, Math.min(max, lvl));
}

/** The tier info a building has right now (undefined: no tiers). */
export function buildingTier(b: { type: BuildingType; level?: number; upgrade?: { level: number; at: number } }, now: number): BuildingTier | undefined {
  return tiersOf(b.type)[buildingLevel(b, now) - 1];
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
    // Cottage pack
    'cottage_armchair', 'cottage_rocking_chair', 'cottage_loveseat', 'cottage_footstool', 'cottage_ladderback_chair', 'cottage_farmhouse_table', 'cottage_welsh_dresser',
    'cottage_blanket_chest', 'cottage_side_table', 'cottage_range_stove', 'cottage_fireplace', 'cottage_iron_bed', 'cottage_standard_lamp', 'cottage_rag_rug',
    'cottage_cuckoo_clock', 'cottage_sampler', 'cottage_wall_shelf', 'cottage_geranium_pot',
  ],
  clothing_shop: [
    'straw_hat', 'beanie', 'cap', 'flower_crown', 'sun_hat', 'bucket_hat',
    'tshirt_sky', 'tshirt_coral', 'shirt_linen', 'shirt_gingham', 'pullover_cream', 'pullover_forest', 'dress_sunny', 'dress_meadow', 'dress_evening', 'skirt_denim', 'skirt_pleated', 'skirt_boho', 'jacket_rain', 'jacket_denim', 'coat_wool', 'coat_navy', 'sneakers_white', 'sneakers_red', 'boots_brown', 'sandals_tan', 'gloves_work', 'mittens_red',
  ],
};

export const MYSTERY_TOUR_COST = 500;
