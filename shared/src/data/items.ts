// Every item in the game. The server is the only authority on who owns what;
// the client uses this table for names, icons and tooltips.

export type ItemCategory =
  | 'material'
  | 'tool'
  | 'food'
  | 'fish'
  | 'meal'
  | 'furniture'
  | 'clothing'
  | 'plant';

export type ItemTag =
  | 'wood'
  | 'mineral'
  | 'fiber'
  | 'fruit'
  | 'berry'
  | 'herb'
  | 'mushroom'
  | 'rare'
  | 'fish'
  | 'meal'
  | 'sweet'
  | 'furniture'
  | 'cozy'
  | 'clothing'
  | 'plant'
  | 'tool';

export type ToolKind = 'axe' | 'shovel' | 'rod';

export interface ItemDef {
  id: string;
  name: string;
  icon: string; // emoji – keeps the project asset-free
  category: ItemCategory;
  tags: ItemTag[];
  sell: number; // coins paid by the town hall / shops
  buy?: number; // price in a shop (if sold)
  tool?: { kind: ToolKind; power: number }; // power: hits saved / better fishing window
  stack?: number; // max quantity held (default 999)
  /** Furniture can be placed on the island. */
  placeable?: boolean;
  /** Clothing slot. */
  wear?: 'hat';
  color?: string;
}

const list: ItemDef[] = [
  // ── Materials ────────────────────────────────────────────
  { id: 'wood', name: 'Wood', icon: '🪵', category: 'material', tags: ['wood'], sell: 5 },
  { id: 'stone', name: 'Stone', icon: '🪨', category: 'material', tags: ['mineral'], sell: 5 },
  { id: 'clay', name: 'Clay', icon: '🧱', category: 'material', tags: ['mineral'], sell: 8 },
  { id: 'iron_ore', name: 'Iron Ore', icon: '⛓️', category: 'material', tags: ['mineral', 'rare'], sell: 30 },
  { id: 'fiber', name: 'Plant Fiber', icon: '🌾', category: 'material', tags: ['fiber'], sell: 3 },
  { id: 'sapling', name: 'Sapling', icon: '🌱', category: 'plant', tags: ['plant'], sell: 20, buy: 80 },
  { id: 'flower', name: 'Wildflower', icon: '🌼', category: 'plant', tags: ['plant', 'sweet'], sell: 15 },

  // ── Tools ────────────────────────────────────────────────
  { id: 'stone_axe', name: 'Stone Axe', icon: '🪓', category: 'tool', tags: ['tool'], sell: 40, stack: 1, tool: { kind: 'axe', power: 1 } },
  { id: 'shovel', name: 'Shovel', icon: '⛏️', category: 'tool', tags: ['tool'], sell: 40, stack: 1, tool: { kind: 'shovel', power: 1 } },
  { id: 'fishing_rod', name: 'Fishing Rod', icon: '🎣', category: 'tool', tags: ['tool'], sell: 40, stack: 1, tool: { kind: 'rod', power: 1 } },
  { id: 'iron_axe', name: 'Iron Axe', icon: '🪓', category: 'tool', tags: ['tool'], sell: 200, buy: 600, stack: 1, tool: { kind: 'axe', power: 2 } },
  { id: 'iron_shovel', name: 'Iron Shovel', icon: '⛏️', category: 'tool', tags: ['tool'], sell: 200, buy: 600, stack: 1, tool: { kind: 'shovel', power: 2 } },
  { id: 'pro_rod', name: 'Pro Fishing Rod', icon: '🎣', category: 'tool', tags: ['tool'], sell: 180, buy: 550, stack: 1, tool: { kind: 'rod', power: 2 } },

  // ── Foraged food ─────────────────────────────────────────
  { id: 'apple', name: 'Apple', icon: '🍎', category: 'food', tags: ['fruit', 'sweet'], sell: 25 },
  { id: 'cherry', name: 'Cherries', icon: '🍒', category: 'food', tags: ['fruit', 'sweet'], sell: 25 },
  { id: 'coconut', name: 'Coconut', icon: '🥥', category: 'food', tags: ['fruit'], sell: 30 },
  { id: 'banana', name: 'Banana', icon: '🍌', category: 'food', tags: ['fruit', 'sweet'], sell: 30 },
  { id: 'dates', name: 'Dates', icon: '🌴', category: 'food', tags: ['fruit', 'sweet'], sell: 35 },
  { id: 'pinecone', name: 'Pinecone', icon: '🌰', category: 'material', tags: ['wood'], sell: 10 },
  { id: 'prickly_pear', name: 'Prickly Pear', icon: '🌵', category: 'food', tags: ['fruit'], sell: 35 },
  { id: 'berries', name: 'Wild Berries', icon: '🫐', category: 'food', tags: ['berry', 'sweet'], sell: 12 },
  { id: 'cloudberry', name: 'Cloudberries', icon: '🟠', category: 'food', tags: ['berry', 'sweet', 'rare'], sell: 30 },
  { id: 'herbs', name: 'Desert Herbs', icon: '🌿', category: 'food', tags: ['herb'], sell: 14 },
  { id: 'mushroom', name: 'Mushroom', icon: '🍄', category: 'food', tags: ['mushroom'], sell: 20 },
  { id: 'glowcap', name: 'Glowcap', icon: '✨', category: 'food', tags: ['mushroom', 'rare'], sell: 120 },

  // ── Meals (restaurant) ───────────────────────────────────
  { id: 'fish_stew', name: 'Fish Stew', icon: '🍲', category: 'meal', tags: ['meal', 'cozy'], sell: 180 },
  { id: 'fruit_salad', name: 'Fruit Salad', icon: '🥗', category: 'meal', tags: ['meal', 'sweet'], sell: 150 },
  { id: 'mushroom_soup', name: 'Mushroom Soup', icon: '🥣', category: 'meal', tags: ['meal', 'cozy'], sell: 140 },
  { id: 'berry_pie', name: 'Berry Pie', icon: '🥧', category: 'meal', tags: ['meal', 'sweet'], sell: 160 },
  { id: 'grilled_fish', name: 'Grilled Fish', icon: '🐟', category: 'meal', tags: ['meal'], sell: 90 },

  // ── Furniture ────────────────────────────────────────────
  { id: 'bench', name: 'Wooden Bench', icon: '🪑', category: 'furniture', tags: ['furniture', 'cozy'], sell: 60, buy: 300, placeable: true },
  { id: 'lamp', name: 'Street Lamp', icon: '🏮', category: 'furniture', tags: ['furniture'], sell: 90, buy: 450, placeable: true },
  { id: 'flower_pot', name: 'Flower Pot', icon: '🪴', category: 'furniture', tags: ['furniture', 'plant'], sell: 40, buy: 200, placeable: true },
  { id: 'fence', name: 'Wooden Fence', icon: '🚧', category: 'furniture', tags: ['furniture'], sell: 10, buy: 50, placeable: true },
  { id: 'picnic_table', name: 'Picnic Table', icon: '🧺', category: 'furniture', tags: ['furniture', 'cozy'], sell: 100, buy: 500, placeable: true },
  { id: 'gnome', name: 'Garden Gnome', icon: '🧙', category: 'furniture', tags: ['furniture', 'rare'], sell: 150, buy: 800, placeable: true },
  { id: 'signpost', name: 'Signpost', icon: '🪧', category: 'furniture', tags: ['furniture'], sell: 30, placeable: true },

  // ── Clothing ─────────────────────────────────────────────
  { id: 'straw_hat', name: 'Straw Hat', icon: '👒', category: 'clothing', tags: ['clothing'], sell: 50, buy: 250, wear: 'hat', stack: 1, color: '#e8c872' },
  { id: 'beanie', name: 'Knit Beanie', icon: '🧶', category: 'clothing', tags: ['clothing', 'cozy'], sell: 50, buy: 250, wear: 'hat', stack: 1, color: '#c0392b' },
  { id: 'cap', name: 'Explorer Cap', icon: '🧢', category: 'clothing', tags: ['clothing'], sell: 50, buy: 250, wear: 'hat', stack: 1, color: '#2e86de' },
  { id: 'flower_crown', name: 'Flower Crown', icon: '💐', category: 'clothing', tags: ['clothing', 'sweet'], sell: 80, buy: 400, wear: 'hat', stack: 1, color: '#ff8fb1' },
];

export interface FishDef {
  id: string;
  name: string;
  icon: string;
  sell: number;
  rarity: number; // weight – higher is more common
  water: 'sea' | 'fresh';
  /** Active hours (island local), inclusive start, exclusive end. Wraps past midnight. */
  hours?: [number, number];
  /** Seasons in which the fish appears (undefined = all). */
  seasons?: string[];
}

// Fish live in their own table so biomes can reference them; they are
// registered as regular items below.
export const FISH: FishDef[] = [
  // Freshwater
  { id: 'fish_carp', name: 'Carp', icon: '🐟', sell: 60, rarity: 10, water: 'fresh' },
  { id: 'fish_perch', name: 'Perch', icon: '🐟', sell: 90, rarity: 8, water: 'fresh' },
  { id: 'fish_pike', name: 'Pike', icon: '🐟', sell: 300, rarity: 2, water: 'fresh', hours: [16, 9] },
  { id: 'fish_trout', name: 'Rainbow Trout', icon: '🐟', sell: 200, rarity: 5, water: 'fresh', seasons: ['spring', 'autumn', 'winter'] },
  { id: 'fish_salmon', name: 'Salmon', icon: '🐟', sell: 350, rarity: 3, water: 'fresh', seasons: ['summer', 'autumn'] },
  { id: 'fish_char', name: 'Arctic Char', icon: '🐟', sell: 450, rarity: 2, water: 'fresh', seasons: ['winter', 'spring'] },
  { id: 'fish_tilapia', name: 'Tilapia', icon: '🐟', sell: 80, rarity: 10, water: 'fresh' },
  { id: 'fish_koi', name: 'Golden Koi', icon: '🐠', sell: 900, rarity: 1, water: 'fresh', hours: [16, 9] },
  { id: 'fish_catfish', name: 'Catfish', icon: '🐟', sell: 200, rarity: 6, water: 'fresh', hours: [16, 9] },
  { id: 'fish_piranha', name: 'Piranha', icon: '🐟', sell: 500, rarity: 3, water: 'fresh', hours: [9, 16] },
  { id: 'fish_arowana', name: 'Arowana', icon: '🐉', sell: 1200, rarity: 1, water: 'fresh', hours: [16, 9] },
  // Sea
  { id: 'fish_sardine', name: 'Sardine', icon: '🐟', sell: 40, rarity: 12, water: 'sea' },
  { id: 'fish_mackerel', name: 'Mackerel', icon: '🐟', sell: 120, rarity: 8, water: 'sea' },
  { id: 'fish_seabass', name: 'Sea Bass', icon: '🐟', sell: 160, rarity: 7, water: 'sea' },
  { id: 'fish_cod', name: 'Cod', icon: '🐟', sell: 180, rarity: 6, water: 'sea', seasons: ['autumn', 'winter', 'spring'] },
  { id: 'fish_herring', name: 'Herring', icon: '🐟', sell: 70, rarity: 9, water: 'sea' },
  { id: 'fish_clownfish', name: 'Clownfish', icon: '🐠', sell: 250, rarity: 5, water: 'sea' },
  { id: 'fish_butterfly', name: 'Butterflyfish', icon: '🐠', sell: 220, rarity: 6, water: 'sea' },
  { id: 'fish_tuna', name: 'Tuna', icon: '🐟', sell: 700, rarity: 2, water: 'sea' },
  { id: 'fish_mahi', name: 'Mahi-Mahi', icon: '🐟', sell: 600, rarity: 2, water: 'sea', seasons: ['summer', 'wet'] },
  { id: 'fish_seabream', name: 'Sea Bream', icon: '🐟', sell: 150, rarity: 7, water: 'sea' },
  { id: 'fish_oarfish', name: 'Oarfish', icon: '🐉', sell: 1500, rarity: 0.5, water: 'sea', hours: [21, 5] },
];

for (const f of FISH) {
  list.push({ id: f.id, name: f.name, icon: f.icon, category: 'fish', tags: ['fish'], sell: f.sell });
}

export const ITEMS: Record<string, ItemDef> = Object.fromEntries(list.map((i) => [i.id, i]));
export const ITEM_LIST = list;

export function item(id: string): ItemDef {
  const def = ITEMS[id];
  if (!def) throw new Error(`Unknown item ${id}`);
  return def;
}

export function isItem(id: unknown): id is string {
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(ITEMS, id);
}

export function maxStack(id: string): number {
  return ITEMS[id]?.stack ?? 999;
}
