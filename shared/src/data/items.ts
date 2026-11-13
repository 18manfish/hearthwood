// Every item in the game. The server is the only authority on who owns what;
// the client uses this table for names, icons and tooltips.

import { BIRDS } from './birds.ts';
import type { WearSlot } from './clothing.ts';

export type ItemCategory =
  | 'material'
  | 'tool'
  | 'food'
  | 'fish'
  | 'meal'
  | 'furniture'
  | 'clothing'
  | 'plant'
  | 'bird';

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
  | 'bird'
  | 'tool';

export type ToolKind = 'axe' | 'shovel' | 'rod' | 'net';

/** Furniture models the client knows how to draw. */
export const FURNITURE_MODELS = [
  'bench', 'lamp', 'flower_pot', 'fence', 'picnic_table', 'gnome', 'signpost', 'barrel', 'crate', 'rowboat',
  // Bohemian pack (art/kit/boho.py)
  'boho_peacock_chair', 'boho_egg_chair', 'boho_floor_cushions', 'boho_pouf', 'boho_sofa', 'boho_canopy_bed', 'boho_coffee_table',
  'boho_trunk', 'boho_ladder_shelf', 'boho_room_divider', 'boho_kilim_rug', 'boho_jute_rug', 'boho_macrame', 'boho_tapestry',
  'boho_dreamcatcher', 'boho_lantern', 'boho_floor_lamp', 'boho_monstera', 'boho_plant_stand', 'boho_pampas_vase',
  // Cottage pack (art/kit/cottage.py)
  'cottage_armchair', 'cottage_rocking_chair', 'cottage_loveseat', 'cottage_footstool', 'cottage_ladderback_chair', 'cottage_farmhouse_table', 'cottage_welsh_dresser',
  'cottage_blanket_chest', 'cottage_side_table', 'cottage_range_stove', 'cottage_fireplace', 'cottage_iron_bed', 'cottage_standard_lamp', 'cottage_rag_rug',
  'cottage_cuckoo_clock', 'cottage_sampler', 'cottage_wall_shelf', 'cottage_geranium_pot',
] as const;

/**
 * Furniture models that aren't a plain one-tile block:
 *   flat – lies on the floor (rugs): can be walked over
 *   wall – hangs on the wall behind its tile (needs a wall there): can be walked under
 *   long – two tiles deep (the tile in front of it, along its facing, is taken too)
 */
export const FURNITURE_SHAPES: Partial<Record<string, 'flat' | 'wall' | 'long'>> = {
  boho_kilim_rug: 'flat', boho_jute_rug: 'flat',
  boho_macrame: 'wall', boho_tapestry: 'wall', boho_dreamcatcher: 'wall',
  boho_canopy_bed: 'long',
  cottage_rag_rug: 'flat',
  cottage_cuckoo_clock: 'wall', cottage_sampler: 'wall', cottage_wall_shelf: 'wall',
  cottage_iron_bed: 'long',
};

export const ITEM_CATEGORIES: ItemCategory[] = ['material', 'tool', 'food', 'fish', 'meal', 'furniture', 'clothing', 'plant', 'bird'];
export const ITEM_TAGS: ItemTag[] = ['wood', 'mineral', 'fiber', 'fruit', 'berry', 'herb', 'mushroom', 'rare', 'fish', 'meal', 'sweet', 'furniture', 'cozy', 'clothing', 'plant', 'bird', 'tool'];

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
  /** Clothing slot (see data/clothing.ts). */
  wear?: WearSlot;
  /** Clothing cut the client draws (see GARMENTS); defaults to the item id. */
  garment?: string;
  /** 3D model used for furniture (see FURNITURE_MODELS); defaults to the item id. */
  model?: string;
  color?: string;
}

/** Regular items (fish and birds are added from their own tables). Editable in the game creation tool. */
export const BASE_ITEMS: ItemDef[] = [
  // ── Materials ────────────────────────────────────────────
  { id: 'wood', name: 'Wood', icon: '🪵', category: 'material', tags: ['wood'], sell: 5 },
  { id: 'stone', name: 'Stone', icon: '🪨', category: 'material', tags: ['mineral'], sell: 5 },
  { id: 'clay', name: 'Clay', icon: '🧱', category: 'material', tags: ['mineral'], sell: 8 },
  { id: 'iron_ore', name: 'Iron Ore', icon: '⛓️', category: 'material', tags: ['mineral', 'rare'], sell: 30 },
  { id: 'fiber', name: 'Plant Fiber', icon: '🌾', category: 'material', tags: ['fiber'], sell: 3 },
  { id: 'sapling', name: 'Sapling', icon: '🌱', category: 'plant', tags: ['plant'], sell: 20, buy: 80 },
  { id: 'flower', name: 'Wildflower', icon: '🌼', category: 'plant', tags: ['plant', 'sweet'], sell: 15 },

  // ── Beachcombing (washes ashore) ─────────────────────────
  { id: 'seashell', name: 'Seashell', icon: '🐚', category: 'material', tags: ['sweet'], sell: 20 },
  { id: 'conch', name: 'Conch Shell', icon: '🐚', category: 'material', tags: ['rare'], sell: 90 },
  { id: 'driftwood', name: 'Driftwood', icon: '🪵', category: 'material', tags: ['wood'], sell: 12 },
  { id: 'seaweed', name: 'Seaweed', icon: '🌿', category: 'food', tags: ['herb'], sell: 8 },
  { id: 'sea_glass', name: 'Sea Glass', icon: '💎', category: 'material', tags: ['mineral'], sell: 45 },
  { id: 'coral', name: 'Coral', icon: '🪸', category: 'material', tags: ['rare'], sell: 70 },
  { id: 'pearl', name: 'Pearl', icon: '🫧', category: 'material', tags: ['rare'], sell: 600 },
  { id: 'message_bottle', name: 'Message Bottle', icon: '🍾', category: 'material', tags: [], sell: 30 },

  // ── Tools ────────────────────────────────────────────────
  { id: 'stone_axe', name: 'Stone Axe', icon: '🪓', category: 'tool', tags: ['tool'], sell: 40, stack: 1, tool: { kind: 'axe', power: 1 } },
  { id: 'shovel', name: 'Shovel', icon: '⛏️', category: 'tool', tags: ['tool'], sell: 40, stack: 1, tool: { kind: 'shovel', power: 1 } },
  { id: 'fishing_rod', name: 'Fishing Rod', icon: '🎣', category: 'tool', tags: ['tool'], sell: 40, stack: 1, tool: { kind: 'rod', power: 1 } },
  { id: 'iron_axe', name: 'Iron Axe', icon: '🪓', category: 'tool', tags: ['tool'], sell: 200, buy: 600, stack: 1, tool: { kind: 'axe', power: 2 } },
  { id: 'iron_shovel', name: 'Iron Shovel', icon: '⛏️', category: 'tool', tags: ['tool'], sell: 200, buy: 600, stack: 1, tool: { kind: 'shovel', power: 2 } },
  { id: 'bird_net', name: 'Bird Net', icon: '🥅', category: 'tool', tags: ['tool'], sell: 40, stack: 1, tool: { kind: 'net', power: 1 } },
  { id: 'silk_net', name: 'Silk Bird Net', icon: '🥅', category: 'tool', tags: ['tool'], sell: 180, buy: 550, stack: 1, tool: { kind: 'net', power: 2 } },
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
  { id: 'barrel', name: 'Barrel', icon: '🛢️', category: 'furniture', tags: ['furniture', 'wood'], sell: 40, buy: 220, placeable: true },
  { id: 'crate', name: 'Wooden Crate', icon: '📦', category: 'furniture', tags: ['furniture', 'wood'], sell: 30, buy: 160, placeable: true },
  { id: 'rowboat', name: 'Rowboat', icon: '🛶', category: 'furniture', tags: ['furniture', 'rare'], sell: 500, placeable: false },
  // Bohemian furniture pack (home decoration).
  { id: 'boho_peacock_chair', name: 'Peacock Chair', icon: '🪑', category: 'furniture', tags: ['furniture', 'cozy'], sell: 240, buy: 1200, placeable: true },
  { id: 'boho_egg_chair', name: 'Hanging Egg Chair', icon: '🪺', category: 'furniture', tags: ['furniture', 'cozy'], sell: 320, buy: 1600, placeable: true },
  { id: 'boho_floor_cushions', name: 'Floor Cushions', icon: '🛋️', category: 'furniture', tags: ['furniture', 'cozy'], sell: 80, buy: 400, placeable: true },
  { id: 'boho_pouf', name: 'Knitted Pouf', icon: '🧶', category: 'furniture', tags: ['furniture', 'cozy'], sell: 60, buy: 300, placeable: true },
  { id: 'boho_sofa', name: 'Boho Sofa', icon: '🛋️', category: 'furniture', tags: ['furniture', 'cozy'], sell: 300, buy: 1500, placeable: true },
  { id: 'boho_canopy_bed', name: 'Canopy Bed', icon: '🛏️', category: 'furniture', tags: ['furniture', 'cozy'], sell: 480, buy: 2400, placeable: true },
  { id: 'boho_coffee_table', name: 'Carved Coffee Table', icon: '🪵', category: 'furniture', tags: ['furniture', 'cozy', 'wood'], sell: 140, buy: 700, placeable: true },
  { id: 'boho_trunk', name: 'Vintage Trunk', icon: '🧳', category: 'furniture', tags: ['furniture', 'cozy'], sell: 120, buy: 600, placeable: true },
  { id: 'boho_ladder_shelf', name: 'Ladder Shelf', icon: '🪜', category: 'furniture', tags: ['furniture', 'cozy', 'wood'], sell: 130, buy: 650, placeable: true },
  { id: 'boho_room_divider', name: 'Rattan Room Divider', icon: '🎋', category: 'furniture', tags: ['furniture', 'cozy'], sell: 160, buy: 800, placeable: true },
  { id: 'boho_kilim_rug', name: 'Kilim Rug', icon: '🟥', category: 'furniture', tags: ['furniture', 'cozy'], sell: 180, buy: 900, placeable: true },
  { id: 'boho_jute_rug', name: 'Round Jute Rug', icon: '🟤', category: 'furniture', tags: ['furniture', 'cozy', 'fiber'], sell: 100, buy: 500, placeable: true },
  { id: 'boho_macrame', name: 'Macramé Wall Hanging', icon: '🪢', category: 'furniture', tags: ['furniture', 'cozy', 'fiber'], sell: 70, buy: 350, placeable: true },
  { id: 'boho_tapestry', name: 'Wall Tapestry', icon: '🖼️', category: 'furniture', tags: ['furniture', 'cozy'], sell: 110, buy: 550, placeable: true },
  { id: 'boho_dreamcatcher', name: 'Dreamcatcher', icon: '🕸️', category: 'furniture', tags: ['furniture', 'cozy'], sell: 50, buy: 250, placeable: true },
  { id: 'boho_lantern', name: 'Moroccan Lantern', icon: '🏮', category: 'furniture', tags: ['furniture', 'cozy'], sell: 80, buy: 400, placeable: true },
  { id: 'boho_floor_lamp', name: 'Rattan Floor Lamp', icon: '💡', category: 'furniture', tags: ['furniture', 'cozy'], sell: 140, buy: 700, placeable: true },
  { id: 'boho_monstera', name: 'Monstera Basket', icon: '🪴', category: 'furniture', tags: ['furniture', 'cozy', 'plant'], sell: 90, buy: 450, placeable: true },
  { id: 'boho_plant_stand', name: 'Plant Stand', icon: '🌵', category: 'furniture', tags: ['furniture', 'cozy', 'plant'], sell: 100, buy: 500, placeable: true },
  { id: 'boho_pampas_vase', name: 'Pampas Vase', icon: '🌾', category: 'furniture', tags: ['furniture', 'cozy', 'plant'], sell: 60, buy: 300, placeable: true },
  // Cottage furniture pack (home decoration).
  { id: 'cottage_armchair', name: 'Wingback Armchair', icon: '🪑', category: 'furniture', tags: ['furniture', 'cozy', 'wood'], sell: 260, buy: 1300, placeable: true },
  { id: 'cottage_rocking_chair', name: 'Rocking Chair', icon: '🪑', category: 'furniture', tags: ['furniture', 'cozy', 'wood'], sell: 220, buy: 1100, placeable: true },
  { id: 'cottage_loveseat', name: 'Floral Loveseat', icon: '🛋️', category: 'furniture', tags: ['furniture', 'cozy'], sell: 320, buy: 1600, placeable: true },
  { id: 'cottage_footstool', name: 'Button Footstool', icon: '🟩', category: 'furniture', tags: ['furniture', 'cozy'], sell: 90, buy: 450, placeable: true },
  { id: 'cottage_ladderback_chair', name: 'Ladder-back Chair', icon: '🪑', category: 'furniture', tags: ['furniture', 'cozy', 'wood'], sell: 120, buy: 600, placeable: true },
  { id: 'cottage_farmhouse_table', name: 'Farmhouse Table', icon: '🍞', category: 'furniture', tags: ['furniture', 'cozy', 'wood'], sell: 280, buy: 1400, placeable: true },
  { id: 'cottage_welsh_dresser', name: 'Welsh Dresser', icon: '🫖', category: 'furniture', tags: ['furniture', 'cozy', 'wood'], sell: 360, buy: 1800, placeable: true },
  { id: 'cottage_blanket_chest', name: 'Painted Blanket Chest', icon: '🧺', category: 'furniture', tags: ['furniture', 'cozy', 'wood'], sell: 160, buy: 800, placeable: true },
  { id: 'cottage_side_table', name: 'Lace Side Table', icon: '☕', category: 'furniture', tags: ['furniture', 'cozy', 'wood'], sell: 120, buy: 600, placeable: true },
  { id: 'cottage_range_stove', name: 'Range Stove', icon: '🍳', category: 'furniture', tags: ['furniture', 'cozy'], sell: 400, buy: 2000, placeable: true },
  { id: 'cottage_fireplace', name: 'Stone Fireplace', icon: '🔥', category: 'furniture', tags: ['furniture', 'cozy', 'mineral'], sell: 480, buy: 2400, placeable: true },
  { id: 'cottage_iron_bed', name: 'Iron Bedstead', icon: '🛏️', category: 'furniture', tags: ['furniture', 'cozy'], sell: 440, buy: 2200, placeable: true },
  { id: 'cottage_standard_lamp', name: 'Standard Lamp', icon: '💡', category: 'furniture', tags: ['furniture', 'cozy'], sell: 140, buy: 700, placeable: true },
  { id: 'cottage_rag_rug', name: 'Braided Rag Rug', icon: '🧶', category: 'furniture', tags: ['furniture', 'cozy', 'fiber'], sell: 120, buy: 600, placeable: true },
  { id: 'cottage_cuckoo_clock', name: 'Cuckoo Clock', icon: '🕰️', category: 'furniture', tags: ['furniture', 'cozy', 'wood'], sell: 200, buy: 1000, placeable: true },
  { id: 'cottage_sampler', name: 'Cross-stitch Sampler', icon: '🧵', category: 'furniture', tags: ['furniture', 'cozy', 'fiber'], sell: 70, buy: 350, placeable: true },
  { id: 'cottage_wall_shelf', name: 'Preserves Shelf', icon: '🫙', category: 'furniture', tags: ['furniture', 'cozy'], sell: 110, buy: 550, placeable: true },
  { id: 'cottage_geranium_pot', name: 'Potted Geraniums', icon: '🌺', category: 'furniture', tags: ['furniture', 'cozy', 'plant'], sell: 70, buy: 350, placeable: true },

  // ── Clothing ─────────────────────────────────────────────
  { id: 'straw_hat', name: 'Straw Hat', icon: '👒', category: 'clothing', tags: ['clothing'], sell: 50, buy: 250, wear: 'hat', stack: 1, color: '#e8c872' },
  { id: 'beanie', name: 'Knit Beanie', icon: '🧶', category: 'clothing', tags: ['clothing', 'cozy'], sell: 50, buy: 250, wear: 'hat', stack: 1, color: '#c0392b' },
  { id: 'cap', name: 'Explorer Cap', icon: '🧢', category: 'clothing', tags: ['clothing'], sell: 50, buy: 250, wear: 'hat', stack: 1, color: '#2e86de' },
  { id: 'flower_crown', name: 'Flower Crown', icon: '💐', category: 'clothing', tags: ['clothing', 'sweet'], sell: 80, buy: 400, wear: 'hat', stack: 1, color: '#ff8fb1' },
  { id: 'tshirt_sky', name: 'Sky T-Shirt', icon: '👕', category: 'clothing', tags: ['clothing'], sell: 40, buy: 200, wear: 'top', garment: 'tshirt', stack: 1, color: '#6ec1e4' },
  { id: 'tshirt_coral', name: 'Coral T-Shirt', icon: '👕', category: 'clothing', tags: ['clothing'], sell: 40, buy: 200, wear: 'top', garment: 'tshirt', stack: 1, color: '#f08a6c' },
  { id: 'shirt_linen', name: 'Linen Shirt', icon: '👔', category: 'clothing', tags: ['clothing'], sell: 64, buy: 320, wear: 'top', garment: 'shirt', stack: 1, color: '#efe3c8' },
  { id: 'shirt_gingham', name: 'Gingham Shirt', icon: '👔', category: 'clothing', tags: ['clothing'], sell: 64, buy: 320, wear: 'top', garment: 'shirt', stack: 1, color: '#d9534f' },
  { id: 'pullover_cream', name: 'Cream Pullover', icon: '🧶', category: 'clothing', tags: ['clothing'], sell: 84, buy: 420, wear: 'top', garment: 'pullover', stack: 1, color: '#f1e6d0' },
  { id: 'pullover_forest', name: 'Forest Pullover', icon: '🧶', category: 'clothing', tags: ['clothing'], sell: 84, buy: 420, wear: 'top', garment: 'pullover', stack: 1, color: '#3f7a52' },
  { id: 'dress_sunny', name: 'Sunny Sundress', icon: '👗', category: 'clothing', tags: ['clothing'], sell: 96, buy: 480, wear: 'top', garment: 'dress_short', stack: 1, color: '#f6c945' },
  { id: 'dress_meadow', name: 'Meadow Dress', icon: '👗', category: 'clothing', tags: ['clothing'], sell: 112, buy: 560, wear: 'top', garment: 'dress_knee', stack: 1, color: '#7fb3e0' },
  { id: 'dress_evening', name: 'Evening Gown', icon: '👗', category: 'clothing', tags: ['clothing'], sell: 180, buy: 900, wear: 'top', garment: 'dress_long', stack: 1, color: '#7a3b69' },
  { id: 'skirt_denim', name: 'Denim Miniskirt', icon: '🩳', category: 'clothing', tags: ['clothing'], sell: 52, buy: 260, wear: 'bottom', garment: 'skirt_short', stack: 1, color: '#4a6fa5' },
  { id: 'skirt_pleated', name: 'Pleated Skirt', icon: '🩳', category: 'clothing', tags: ['clothing'], sell: 60, buy: 300, wear: 'bottom', garment: 'skirt_knee', stack: 1, color: '#2f3e63' },
  { id: 'skirt_boho', name: 'Long Boho Skirt', icon: '🩳', category: 'clothing', tags: ['clothing'], sell: 76, buy: 380, wear: 'bottom', garment: 'skirt_long', stack: 1, color: '#c9693c' },
  { id: 'jacket_rain', name: 'Rain Jacket', icon: '🧥', category: 'clothing', tags: ['clothing'], sell: 104, buy: 520, wear: 'outer', garment: 'jacket', stack: 1, color: '#f2c230' },
  { id: 'jacket_denim', name: 'Denim Jacket', icon: '🧥', category: 'clothing', tags: ['clothing'], sell: 112, buy: 560, wear: 'outer', garment: 'jacket', stack: 1, color: '#5b7fb5' },
  { id: 'coat_wool', name: 'Wool Coat', icon: '🧥', category: 'clothing', tags: ['clothing'], sell: 172, buy: 860, wear: 'outer', garment: 'coat', stack: 1, color: '#b38a5e' },
  { id: 'coat_navy', name: 'Navy Peacoat', icon: '🧥', category: 'clothing', tags: ['clothing'], sell: 180, buy: 900, wear: 'outer', garment: 'coat', stack: 1, color: '#2b3a5c' },
  { id: 'sneakers_white', name: 'White Sneakers', icon: '👟', category: 'clothing', tags: ['clothing'], sell: 48, buy: 240, wear: 'shoes', garment: 'sneakers', stack: 1, color: '#f4f4f2' },
  { id: 'sneakers_red', name: 'Red Sneakers', icon: '👟', category: 'clothing', tags: ['clothing'], sell: 48, buy: 240, wear: 'shoes', garment: 'sneakers', stack: 1, color: '#d9433c' },
  { id: 'boots_brown', name: 'Leather Boots', icon: '🥾', category: 'clothing', tags: ['clothing'], sell: 76, buy: 380, wear: 'shoes', garment: 'boots', stack: 1, color: '#7a4e2d' },
  { id: 'sandals_tan', name: 'Sandals', icon: '🩴', category: 'clothing', tags: ['clothing'], sell: 32, buy: 160, wear: 'shoes', garment: 'sandals', stack: 1, color: '#c79a62' },
  { id: 'gloves_work', name: 'Work Gloves', icon: '🧤', category: 'clothing', tags: ['clothing'], sell: 36, buy: 180, wear: 'gloves', garment: 'gloves', stack: 1, color: '#a0703f' },
  { id: 'mittens_red', name: 'Red Mittens', icon: '🧤', category: 'clothing', tags: ['clothing'], sell: 32, buy: 160, wear: 'gloves', garment: 'mittens', stack: 1, color: '#c0392b' },
  { id: 'sun_hat', name: 'Sun Hat', icon: '👒', category: 'clothing', tags: ['clothing'], sell: 60, buy: 300, wear: 'hat', garment: 'sun_hat', stack: 1, color: '#f3e2b5' },
  { id: 'bucket_hat', name: 'Bucket Hat', icon: '🎩', category: 'clothing', tags: ['clothing'], sell: 52, buy: 260, wear: 'hat', garment: 'bucket_hat', stack: 1, color: '#6d8f5a' },
];

export interface FishDef {
  id: string;
  name: string;
  icon: string;
  sell: number;
  rarity: number; // weight – higher is more common
  /** Where it bites: the sea, rivers (connected to the sea) or ponds. */
  water: 'sea' | 'river' | 'pond';
  /** Active hours (island local), inclusive start, exclusive end. Wraps past midnight. */
  hours?: [number, number];
  /** Seasons in which the fish appears (undefined = all). */
  seasons?: string[];
  /** Extra biomes this fish lives in (on top of each biome's own fish list). */
  biomes?: string[];
  /**
   * Size of the shadow it swims as (sea fish only – rivers and ponds only ever show
   * medium shadows, and any of their fish can bite there). Default: medium.
   */
  shadow?: FishShadow;
}

export type FishShadow = 'small' | 'medium' | 'large';
export const FISH_SHADOWS: FishShadow[] = ['small', 'medium', 'large'];

/** The shadow size a fish bites from (rivers and ponds: always medium). */
export function fishShadow(f: FishDef): FishShadow {
  return f.water === 'sea' ? f.shadow ?? 'medium' : 'medium';
}

// Fish live in their own table so biomes can reference them; they are
// registered as regular items below.
const ALL_BIOMES = ['grassland', 'tropical', 'nordic', 'forest_edge', 'oasis', 'jungle', 'desert'];

export const FISH: FishDef[] = [
  // Freshwater
  { id: 'fish_carp', name: 'Carp', icon: '🐟', sell: 60, rarity: 10, water: 'pond' },
  { id: 'fish_perch', name: 'Perch', icon: '🐟', sell: 90, rarity: 8, water: 'river' },
  { id: 'fish_pike', name: 'Pike', icon: '🐟', sell: 300, rarity: 2, water: 'river', hours: [16, 9] },
  { id: 'fish_trout', name: 'Rainbow Trout', icon: '🐟', sell: 200, rarity: 5, water: 'river', seasons: ['spring', 'autumn', 'winter'] },
  { id: 'fish_salmon', name: 'Salmon', icon: '🐟', sell: 350, rarity: 3, water: 'river', seasons: ['summer', 'autumn'] },
  { id: 'fish_char', name: 'Arctic Char', icon: '🐟', sell: 450, rarity: 2, water: 'river', seasons: ['winter', 'spring'] },
  { id: 'fish_tilapia', name: 'Tilapia', icon: '🐟', sell: 80, rarity: 10, water: 'pond' },
  { id: 'fish_koi', name: 'Golden Koi', icon: '🐠', sell: 900, rarity: 1, water: 'pond', hours: [16, 9] },
  { id: 'fish_catfish', name: 'Catfish', icon: '🐟', sell: 200, rarity: 6, water: 'pond', hours: [16, 9] },
  { id: 'fish_piranha', name: 'Piranha', icon: '🐟', sell: 500, rarity: 3, water: 'river', hours: [9, 16] },
  { id: 'fish_bitterling', name: 'Bitterling', icon: '🐟', sell: 50, rarity: 12, water: 'pond', biomes: ALL_BIOMES },
  { id: 'fish_goldfish', name: 'Goldfish', icon: '🐠', sell: 400, rarity: 1, water: 'pond', biomes: ALL_BIOMES },
  { id: 'fish_frog', name: 'Pond Frog', icon: '🐸', sell: 120, rarity: 5, water: 'pond', biomes: ALL_BIOMES, seasons: ['spring', 'summer', 'wet'] },
  { id: 'fish_dace', name: 'Dace', icon: '🐟', sell: 60, rarity: 12, water: 'river', biomes: ALL_BIOMES },
  { id: 'fish_eel', name: 'River Eel', icon: '🐍', sell: 320, rarity: 3, water: 'river', biomes: ALL_BIOMES, hours: [18, 6] },
  { id: 'fish_sweetfish', name: 'Sweetfish', icon: '🐟', sell: 240, rarity: 4, water: 'river', biomes: ['nordic', 'forest_edge', 'grassland'], seasons: ['summer'] },
  { id: 'fish_sturgeon', name: 'Sturgeon', icon: '🐟', sell: 1000, rarity: 0.8, water: 'river', biomes: ['nordic', 'forest_edge', 'grassland', 'jungle'] },
  { id: 'fish_arowana', name: 'Arowana', icon: '🐉', sell: 1200, rarity: 1, water: 'river', hours: [16, 9] },
  // Sea
  { id: 'fish_sardine', name: 'Sardine', icon: '🐟', sell: 40, rarity: 12, water: 'sea', shadow: 'small' },
  { id: 'fish_mackerel', name: 'Mackerel', icon: '🐟', sell: 120, rarity: 8, water: 'sea', shadow: 'medium' },
  { id: 'fish_seabass', name: 'Sea Bass', icon: '🐟', sell: 160, rarity: 7, water: 'sea', shadow: 'medium' },
  { id: 'fish_cod', name: 'Cod', icon: '🐟', sell: 180, rarity: 6, water: 'sea', shadow: 'large', seasons: ['autumn', 'winter', 'spring'] },
  { id: 'fish_herring', name: 'Herring', icon: '🐟', sell: 70, rarity: 9, water: 'sea', shadow: 'small' },
  { id: 'fish_clownfish', name: 'Clownfish', icon: '🐠', sell: 250, rarity: 5, water: 'sea', shadow: 'small' },
  { id: 'fish_butterfly', name: 'Butterflyfish', icon: '🐠', sell: 220, rarity: 6, water: 'sea', shadow: 'small' },
  { id: 'fish_tuna', name: 'Tuna', icon: '🐟', sell: 700, rarity: 2, water: 'sea', shadow: 'large' },
  { id: 'fish_mahi', name: 'Mahi-Mahi', icon: '🐟', sell: 600, rarity: 2, water: 'sea', shadow: 'large', seasons: ['summer', 'wet'] },
  { id: 'fish_seabream', name: 'Sea Bream', icon: '🐟', sell: 150, rarity: 7, water: 'sea', shadow: 'medium' },
  { id: 'fish_oarfish', name: 'Oarfish', icon: '🐉', sell: 1500, rarity: 0.5, water: 'sea', shadow: 'large', hours: [21, 5] },
];

export const ITEMS: Record<string, ItemDef> = {};
export const ITEM_LIST: ItemDef[] = [];

/** Rebuild ITEMS / ITEM_LIST from BASE_ITEMS, FISH and BIRDS (after game data changes). */
export function rebuildItems() {
  ITEM_LIST.length = 0;
  ITEM_LIST.push(...BASE_ITEMS);
  for (const f of FISH) ITEM_LIST.push({ id: f.id, name: f.name, icon: f.icon, category: 'fish', tags: ['fish'], sell: f.sell });
  for (const b of BIRDS) ITEM_LIST.push({ id: b.id, name: b.name, icon: b.icon, category: 'bird', tags: ['bird'], sell: b.sell });
  for (const k of Object.keys(ITEMS)) delete ITEMS[k];
  for (const i of ITEM_LIST) ITEMS[i.id] = i;
}
rebuildItems();

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
