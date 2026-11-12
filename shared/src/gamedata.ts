// Editable game data. The tables below can be changed in the game creation
// tool (dev mode); changes are stored by the server and sent to every client,
// which applies them on top of the built-in defaults before the game starts.

import { BASE_ITEMS, FISH, FURNITURE_MODELS, ITEM_CATEGORIES, ITEM_TAGS, rebuildItems, type FishDef, type ItemDef } from './data/items.ts';
import { BIRDS, rebuildBirds, type BirdDef } from './data/birds.ts';
import { RECIPES, type RecipeDef } from './data/recipes.ts';
import { BUILDINGS, SHOP_STOCK, rebuildBuildable, type BuildingDef, type BuildingType } from './data/buildings.ts';
import { VILLAGERS, type VillagerDef } from './data/villagers.ts';
import { PERMITS, rebuildPermits, type PermitDef } from './data/permits.ts';
import { PATHS, type PathDef } from './data/paths.ts';
import { BIOME_IDS } from './data/biomes.ts';

export interface GameData {
  items: ItemDef[];
  fish: FishDef[];
  birds: BirdDef[];
  recipes: RecipeDef[];
  shopStock: Record<string, string[]>;
  buildings: Record<string, BuildingDef>;
  villagers: VillagerDef[];
  permits: PermitDef[];
  paths: PathDef[];
}

export type GameTable = keyof GameData;
export const GAME_TABLES: GameTable[] = ['items', 'fish', 'birds', 'recipes', 'shopStock', 'buildings', 'villagers', 'permits', 'paths'];

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** A deep copy of the game data currently in use. */
export function snapshotGameData(): GameData {
  return clone({
    items: BASE_ITEMS, fish: FISH, birds: BIRDS, recipes: RECIPES, shopStock: SHOP_STOCK as Record<string, string[]>,
    buildings: BUILDINGS as Record<string, BuildingDef>, villagers: VILLAGERS, permits: PERMITS, paths: PATHS,
  });
}

/** The built-in data (captured when this module loads, before any overrides). */
export const DEFAULT_GAME_DATA: GameData = snapshotGameData();

function replaceArray<T>(target: T[], src: T[]) {
  target.length = 0;
  target.push(...clone(src));
}
function replaceRecord<T>(target: Record<string, T>, src: Record<string, T>) {
  for (const k of Object.keys(target)) delete target[k];
  Object.assign(target, clone(src));
}

/** Swap tables in place (every module keeps its references) and rebuild lookups. */
export function applyGameData(d: Partial<GameData>) {
  if (d.items) replaceArray(BASE_ITEMS, d.items);
  if (d.fish) replaceArray(FISH, d.fish);
  if (d.birds) replaceArray(BIRDS, d.birds);
  if (d.recipes) replaceArray(RECIPES, d.recipes);
  if (d.shopStock) replaceRecord(SHOP_STOCK as Record<string, string[]>, d.shopStock);
  if (d.buildings) replaceRecord(BUILDINGS as Record<string, BuildingDef>, d.buildings);
  if (d.villagers) replaceArray(VILLAGERS, d.villagers);
  if (d.permits) replaceArray(PERMITS, d.permits);
  if (d.paths) replaceArray(PATHS, d.paths);
  rebuildBirds();
  rebuildItems();
  rebuildPermits();
  rebuildBuildable();
}

// ── Editor hints ────────────────────────────────────────────────────────────

export interface FieldHint {
  key: string;
  label?: string;
  type: 'string' | 'number' | 'boolean' | 'color' | 'enum' | 'tags' | 'json';
  options?: readonly string[];
  required?: boolean;
  help?: string;
}

export interface TableInfo {
  label: string;
  icon: string;
  /** 'list' tables are arrays keyed by `key`; 'map' tables are objects keyed by name. */
  shape: 'list' | 'map';
  key: string;
  /** Rows can be added (new ids). Built-in rows can be edited but never deleted. */
  canAdd: boolean;
  fields: FieldHint[];
  blank?: () => Record<string, unknown>;
}

const SPECIES = ['cat', 'dog', 'rabbit', 'bear', 'fox', 'owl', 'deer', 'frog', 'penguin', 'koala', 'duck', 'hamster', 'wolf', 'squirrel'] as const;
const PERSONALITIES = ['cheerful', 'lazy', 'grumpy', 'sporty', 'artsy', 'shy'] as const;
const SEASON_NAMES = ['spring', 'summer', 'autumn', 'winter', 'wet', 'dry', 'hot', 'cool'] as const;
const BUILDING_TYPES = () => Object.keys(DEFAULT_GAME_DATA.buildings);

export const TABLE_INFO: Record<GameTable, TableInfo> = {
  items: {
    label: 'Items', icon: '🎒', shape: 'list', key: 'id', canAdd: true,
    fields: [
      { key: 'id', type: 'string', required: true, help: 'lowercase_with_underscores' },
      { key: 'name', type: 'string', required: true },
      { key: 'icon', type: 'string', required: true, help: 'An emoji' },
      { key: 'category', type: 'enum', options: ITEM_CATEGORIES.filter((c) => c !== 'fish' && c !== 'bird'), required: true },
      { key: 'tags', type: 'tags', options: ITEM_TAGS },
      { key: 'sell', type: 'number', required: true, help: 'Coins paid when selling' },
      { key: 'buy', type: 'number', help: 'Shop price (only sold if listed in Shop stock)' },
      { key: 'stack', type: 'number', help: 'Max carried (default 999)' },
      { key: 'placeable', type: 'boolean', help: 'Furniture can be placed outside' },
      { key: 'model', type: 'enum', options: FURNITURE_MODELS, help: 'Furniture model (default: same as id)' },
      { key: 'wear', type: 'enum', options: ['hat'] },
      { key: 'color', type: 'color', help: 'Hat colour' },
      { key: 'tool', type: 'json', help: '{"kind":"axe|shovel|rod|net","power":1}' },
    ],
    blank: () => ({ id: 'new_item', name: 'New item', icon: '📦', category: 'furniture', tags: ['furniture'], sell: 50, buy: 250, placeable: true, model: 'crate' }),
  },
  fish: {
    label: 'Fish', icon: '🐟', shape: 'list', key: 'id', canAdd: true,
    fields: [
      { key: 'id', type: 'string', required: true, help: 'Must start with fish_' },
      { key: 'name', type: 'string', required: true },
      { key: 'icon', type: 'string', required: true },
      { key: 'sell', type: 'number', required: true },
      { key: 'rarity', type: 'number', required: true, help: 'Weight – higher is more common' },
      { key: 'water', type: 'enum', options: ['sea', 'river', 'pond'], required: true, help: 'Rivers connect to the sea, ponds don’t' },
      { key: 'hours', type: 'json', help: '[from, to] local hours, e.g. [16, 9]' },
      { key: 'seasons', type: 'tags', options: SEASON_NAMES },
      { key: 'biomes', type: 'tags', options: BIOME_IDS, help: 'Extra biomes (on top of each biome’s fish list)' },
    ],
    blank: () => ({ id: 'fish_new', name: 'New fish', icon: '🐟', sell: 100, rarity: 5, water: 'river', biomes: ['grassland'] }),
  },
  birds: {
    label: 'Birds', icon: '🐦', shape: 'list', key: 'id', canAdd: true,
    fields: [
      { key: 'id', type: 'string', required: true, help: 'Must start with bird_' },
      { key: 'name', type: 'string', required: true },
      { key: 'icon', type: 'string', required: true },
      { key: 'sell', type: 'number', required: true },
      { key: 'rarity', type: 'number', required: true },
      { key: 'biomes', type: 'tags', options: BIOME_IDS, required: true },
      { key: 'hours', type: 'json', help: '[from, to] local hours' },
      { key: 'seasons', type: 'tags', options: SEASON_NAMES },
      { key: 'perch', type: 'enum', options: ['ground', 'shore'] },
      { key: 'colors', type: 'json', required: true, help: '["body","wing","belly","beak"] colours' },
      { key: 'size', type: 'number', required: true, help: 'Model scale, 1 = sparrow' },
    ],
    blank: () => ({ id: 'bird_new', name: 'New bird', icon: '🐦', sell: 150, rarity: 5, biomes: ['grassland'], hours: [6, 19], colors: ['#8d6e4f', '#5d4330', '#d7c4a3', '#3e2f22'], size: 1 }),
  },
  recipes: {
    label: 'Recipes', icon: '🛠️', shape: 'list', key: 'id', canAdd: true,
    fields: [
      { key: 'id', type: 'string', required: true },
      { key: 'output', type: 'string', required: true, help: 'Item id' },
      { key: 'qty', type: 'number', required: true },
      { key: 'station', type: 'enum', options: ['hand', 'workbench', 'campfire', 'restaurant'], required: true },
      { key: 'ingredients', type: 'json', required: true, help: '[{"item":"wood","qty":3}, {"tag":"fish","qty":1}]' },
    ],
    blank: () => ({ id: 'new_recipe', output: 'crate', qty: 1, station: 'workbench', ingredients: [{ item: 'wood', qty: 5 }] }),
  },
  shopStock: {
    label: 'Shop stock', icon: '🏪', shape: 'map', key: 'shop', canAdd: false,
    fields: [{ key: 'items', type: 'json', help: 'Item ids sold here (price = the item’s buy price)' }],
  },
  buildings: {
    label: 'Buildings', icon: '🏠', shape: 'map', key: 'type', canAdd: false,
    fields: [
      { key: 'name', type: 'string', required: true },
      { key: 'icon', type: 'string', required: true },
      { key: 'description', type: 'string' },
      { key: 'cost', type: 'json', help: '{"wood":20,"stone":10}' },
      { key: 'requires', type: 'json', help: 'Building types that must be finished first' },
      { key: 'minDay', type: 'number', help: 'Island day it unlocks' },
      { key: 'buildMinutes', type: 'number' },
      { key: 'max', type: 'number' },
      { key: 'color', type: 'color' },
      { key: 'roof', type: 'color' },
    ],
  },
  villagers: {
    label: 'Villagers', icon: '🦊', shape: 'list', key: 'id', canAdd: true,
    fields: [
      { key: 'id', type: 'string', required: true, help: 'Must start with v_' },
      { key: 'name', type: 'string', required: true },
      { key: 'species', type: 'enum', options: SPECIES, required: true, help: 'Picks the 3D model' },
      { key: 'personality', type: 'enum', options: PERSONALITIES, required: true },
      { key: 'color', type: 'color', required: true },
      { key: 'accent', type: 'color', required: true },
      { key: 'catchphrase', type: 'string', required: true },
      { key: 'likes', type: 'tags', options: ITEM_TAGS },
      { key: 'loves', type: 'json', help: 'Item ids, e.g. ["apple","bench"]' },
      { key: 'dislikes', type: 'tags', options: ITEM_TAGS },
      { key: 'birthday', type: 'string', required: true, help: 'MM-DD' },
    ],
    blank: () => ({ id: 'v_new', name: 'Newbie', species: 'cat', personality: 'cheerful', color: '#d9a35b', accent: '#fff3dc', catchphrase: 'hiya', likes: ['fruit'], loves: ['apple'], dislikes: ['mineral'], birthday: '01-01' }),
  },
  permits: {
    label: 'Permits', icon: '📜', shape: 'list', key: 'id', canAdd: false,
    fields: [
      { key: 'name', type: 'string', required: true },
      { key: 'icon', type: 'string', required: true },
      { key: 'price', type: 'number', required: true },
      { key: 'desc', type: 'string' },
    ],
  },
  paths: {
    label: 'Paths', icon: '🛤️', shape: 'list', key: 'id', canAdd: false,
    fields: [
      { key: 'name', type: 'string', required: true },
      { key: 'icon', type: 'string', required: true },
      { key: 'cost', type: 'json', help: 'Per tile, e.g. {"stone":1}' },
      { key: 'color', type: 'color', required: true },
    ],
  },
};

// ── Validation ──────────────────────────────────────────────────────────────

const ID_RE = /^[a-z0-9_]{2,40}$/;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

/** Problems with a complete data set (empty = fine). Built-in rows may not be removed. */
export function validateGameData(d: GameData): string[] {
  const errs: string[] = [];
  const err = (m: string) => errs.length < 60 && errs.push(m);
  const isNum = (v: unknown, min = 0) => typeof v === 'number' && Number.isFinite(v) && v >= min;
  const isStr = (v: unknown, max = 200) => typeof v === 'string' && v.length > 0 && v.length <= max;
  const isArr = (v: unknown) => Array.isArray(v);
  const keepDefaults = <T>(table: string, rows: T[], key: (r: T) => string | number, defaults: T[]) => {
    const have = new Set(rows.map(key));
    for (const r of defaults) if (!have.has(key(r))) err(`${table}: built-in "${key(r)}" can’t be removed (edit it instead)`);
    const seen = new Set<string | number>();
    for (const r of rows) {
      const k = key(r);
      if (seen.has(k)) err(`${table}: duplicate id "${k}"`);
      seen.add(k);
    }
  };
  for (const t of ['items', 'fish', 'birds', 'recipes', 'villagers', 'permits', 'paths'] as const) if (!isArr(d[t])) err(`${t}: must be a list`);
  if (errs.length) return errs;

  keepDefaults('items', d.items, (r) => r.id, DEFAULT_GAME_DATA.items);
  keepDefaults('fish', d.fish, (r) => r.id, DEFAULT_GAME_DATA.fish);
  keepDefaults('birds', d.birds, (r) => r.id, DEFAULT_GAME_DATA.birds);
  keepDefaults('recipes', d.recipes, (r) => r.id, []);
  keepDefaults('villagers', d.villagers, (r) => r.id, DEFAULT_GAME_DATA.villagers);
  keepDefaults('permits', d.permits, (r) => r.id, DEFAULT_GAME_DATA.permits);
  keepDefaults('paths', d.paths, (r) => r.id, DEFAULT_GAME_DATA.paths);
  if (d.permits.length !== DEFAULT_GAME_DATA.permits.length) err('permits: can’t add permits (each one unlocks code)');
  if (d.paths.length !== DEFAULT_GAME_DATA.paths.length) err('paths: can’t add path types');

  const itemIds = new Set<string>([...d.items.map((i) => i.id), ...d.fish.map((f) => f.id), ...d.birds.map((b) => b.id)]);
  for (const i of d.items) {
    if (!ID_RE.test(i.id)) err(`items: bad id "${i.id}"`);
    if ((i.id.startsWith('fish_') || i.id.startsWith('bird_')) && !DEFAULT_GAME_DATA.items.some((x) => x.id === i.id)) err(`items: "${i.id}" – fish_ and bird_ ids belong in the Fish / Birds tables`);
    if (!isStr(i.name, 60) || !isStr(i.icon, 16)) err(`items: "${i.id}" needs a name and an icon`);
    if (!(ITEM_CATEGORIES as string[]).includes(i.category)) err(`items: "${i.id}" has an unknown category`);
    if (!isArr(i.tags) || i.tags.some((t) => !(ITEM_TAGS as string[]).includes(t))) err(`items: "${i.id}" has unknown tags`);
    if (!isNum(i.sell)) err(`items: "${i.id}" sell price must be ≥ 0`);
    if (i.buy !== undefined && !isNum(i.buy)) err(`items: "${i.id}" buy price must be ≥ 0`);
    if (i.stack !== undefined && !isNum(i.stack, 1)) err(`items: "${i.id}" stack must be ≥ 1`);
    if (i.model !== undefined && !(FURNITURE_MODELS as readonly string[]).includes(i.model)) err(`items: "${i.id}" uses an unknown model`);
    if (i.tool && (!['axe', 'shovel', 'rod', 'net'].includes(i.tool.kind) || !isNum(i.tool.power, 1))) err(`items: "${i.id}" has a bad tool definition`);
    if (i.color !== undefined && !COLOR_RE.test(i.color)) err(`items: "${i.id}" colour must be #rrggbb`);
  }
  const hoursOk = (h: unknown) => h === undefined || (isArr(h) && (h as unknown[]).length === 2 && (h as unknown[]).every((x) => isNum(x) && (x as number) <= 24));
  for (const f of d.fish) {
    if (!f.id.startsWith('fish_') || !ID_RE.test(f.id)) err(`fish: id "${f.id}" must start with fish_`);
    if (!isStr(f.name, 60) || !isStr(f.icon, 16) || !isNum(f.sell) || !isNum(f.rarity) || f.rarity <= 0) err(`fish: "${f.id}" needs name, icon, sell ≥ 0 and rarity > 0`);
    if (!['sea', 'river', 'pond'].includes(f.water)) err(`fish: "${f.id}" water must be sea, river or pond`);
    if (!hoursOk(f.hours)) err(`fish: "${f.id}" hours must be [from, to]`);
    if (f.biomes && f.biomes.some((b) => !(BIOME_IDS as string[]).includes(b))) err(`fish: "${f.id}" has unknown biomes`);
  }
  for (const b of d.birds) {
    if (!b.id.startsWith('bird_') || !ID_RE.test(b.id)) err(`birds: id "${b.id}" must start with bird_`);
    if (!isStr(b.name, 60) || !isStr(b.icon, 16) || !isNum(b.sell) || !isNum(b.rarity) || b.rarity <= 0 || !isNum(b.size) || b.size <= 0) err(`birds: "${b.id}" needs name, icon, sell, rarity > 0 and size > 0`);
    if (!isArr(b.biomes) || !b.biomes.length || b.biomes.some((x) => !(BIOME_IDS as string[]).includes(x))) err(`birds: "${b.id}" needs valid biomes`);
    if (!isArr(b.colors) || b.colors.length !== 4 || b.colors.some((c) => !COLOR_RE.test(c))) err(`birds: "${b.id}" needs 4 colours (#rrggbb)`);
    if (!hoursOk(b.hours)) err(`birds: "${b.id}" hours must be [from, to]`);
  }
  const btypes = new Set(BUILDING_TYPES());
  for (const r of d.recipes) {
    if (!ID_RE.test(r.id)) err(`recipes: bad id "${r.id}"`);
    if (!itemIds.has(r.output)) err(`recipes: "${r.id}" makes unknown item "${r.output}"`);
    if (!isNum(r.qty, 1)) err(`recipes: "${r.id}" qty must be ≥ 1`);
    if (r.station !== 'hand' && !btypes.has(r.station)) err(`recipes: "${r.id}" has an unknown station`);
    if (!isArr(r.ingredients) || !r.ingredients.length) err(`recipes: "${r.id}" needs ingredients`);
    else for (const ing of r.ingredients) {
      if ('item' in ing ? !itemIds.has(ing.item) : !(ITEM_TAGS as string[]).includes(ing.tag)) err(`recipes: "${r.id}" uses an unknown ingredient`);
      if (!isNum(ing.qty, 1)) err(`recipes: "${r.id}" ingredient qty must be ≥ 1`);
    }
  }
  if (typeof d.shopStock !== 'object' || !d.shopStock) err('shopStock: must be an object');
  else for (const [shop, list] of Object.entries(d.shopStock)) {
    if (!btypes.has(shop)) err(`shopStock: unknown shop "${shop}"`);
    if (!isArr(list)) err(`shopStock: "${shop}" must be a list`);
    else for (const id of list) {
      if (!itemIds.has(id)) err(`shopStock: "${shop}" sells unknown item "${id}"`);
      else if (!isNum(d.items.find((i) => i.id === id)?.buy)) err(`shopStock: "${id}" has no buy price`);
    }
  }
  if (typeof d.buildings !== 'object' || !d.buildings) err('buildings: must be an object');
  else {
    for (const t of btypes) if (!d.buildings[t]) err(`buildings: "${t}" is missing`);
    for (const [t, b] of Object.entries(d.buildings)) {
      if (!btypes.has(t)) { err(`buildings: unknown type "${t}" (new building types need code)`); continue; }
      const def = DEFAULT_GAME_DATA.buildings[t];
      if (b.type !== t || b.w !== def.w || b.h !== def.h) err(`buildings: "${t}" type and footprint can’t change`);
      if (!isStr(b.name, 60) || !isStr(b.icon, 16)) err(`buildings: "${t}" needs a name and an icon`);
      if (typeof b.cost !== 'object' || Object.entries(b.cost ?? {}).some(([id, n]) => !itemIds.has(id) || !isNum(n, 1))) err(`buildings: "${t}" cost uses unknown items or bad amounts`);
      if (!isArr(b.requires) || b.requires.some((r) => !btypes.has(r))) err(`buildings: "${t}" requires unknown buildings`);
      if (!isNum(b.minDay, 0) || !isNum(b.buildMinutes, 0) || !isNum(b.max, 0)) err(`buildings: "${t}" minDay / buildMinutes / max must be ≥ 0`);
      if (!COLOR_RE.test(b.color) || !COLOR_RE.test(b.roof)) err(`buildings: "${t}" colours must be #rrggbb`);
    }
  }
  for (const v of d.villagers) {
    if (!v.id.startsWith('v_') || !ID_RE.test(v.id)) err(`villagers: id "${v.id}" must start with v_`);
    if (!isStr(v.name, 30) || !isStr(v.catchphrase, 40)) err(`villagers: "${v.id}" needs a name and a catchphrase`);
    if (!(SPECIES as readonly string[]).includes(v.species)) err(`villagers: "${v.id}" has an unknown species`);
    if (!(PERSONALITIES as readonly string[]).includes(v.personality)) err(`villagers: "${v.id}" has an unknown personality`);
    if (!COLOR_RE.test(v.color) || !COLOR_RE.test(v.accent)) err(`villagers: "${v.id}" colours must be #rrggbb`);
    if (![...(v.likes ?? []), ...(v.dislikes ?? [])].every((t) => (ITEM_TAGS as string[]).includes(t))) err(`villagers: "${v.id}" likes/dislikes use unknown tags`);
    if (!isArr(v.loves) || v.loves.some((id) => !itemIds.has(id))) err(`villagers: "${v.id}" loves unknown items`);
    if (!/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(v.birthday)) err(`villagers: "${v.id}" birthday must be MM-DD`);
  }
  for (const p of d.permits) if (!isStr(p.name, 60) || !isNum(p.price)) err(`permits: "${p.id}" needs a name and a price ≥ 0`);
  for (const p of d.paths) {
    if (!isStr(p.name, 60) || !COLOR_RE.test(p.color)) err(`paths: "${p.id}" needs a name and a colour`);
    if (typeof p.cost !== 'object' || Object.entries(p.cost ?? {}).some(([id, n]) => !itemIds.has(id) || !isNum(n, 1))) err(`paths: "${p.id}" cost uses unknown items`);
  }
  return errs;
}
