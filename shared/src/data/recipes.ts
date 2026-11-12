import type { ItemTag } from './items.ts';
import type { BuildingType } from './buildings.ts';

/** An ingredient is either a specific item or "any item with tag X". */
export type Ingredient = { item: string; qty: number } | { tag: ItemTag; qty: number };

export interface RecipeDef {
  id: string;
  output: string;
  qty: number;
  ingredients: Ingredient[];
  /** Where the recipe can be made. 'hand' = anywhere. */
  station: 'hand' | BuildingType;
}

export const RECIPES: RecipeDef[] = [
  // Day-one tools – craftable by hand.
  { id: 'stone_axe', output: 'stone_axe', qty: 1, station: 'hand', ingredients: [{ item: 'wood', qty: 3 }, { item: 'stone', qty: 2 }, { item: 'fiber', qty: 1 }] },
  { id: 'shovel', output: 'shovel', qty: 1, station: 'hand', ingredients: [{ item: 'wood', qty: 3 }, { item: 'stone', qty: 3 }] },
  { id: 'fishing_rod', output: 'fishing_rod', qty: 1, station: 'hand', ingredients: [{ item: 'wood', qty: 3 }, { item: 'fiber', qty: 3 }] },

  // Workbench crafts.
  { id: 'fence', output: 'fence', qty: 2, station: 'workbench', ingredients: [{ item: 'wood', qty: 3 }] },
  { id: 'bench', output: 'bench', qty: 1, station: 'workbench', ingredients: [{ item: 'wood', qty: 8 }] },
  { id: 'flower_pot', output: 'flower_pot', qty: 1, station: 'workbench', ingredients: [{ item: 'clay', qty: 3 }, { item: 'flower', qty: 1 }] },
  { id: 'signpost', output: 'signpost', qty: 1, station: 'workbench', ingredients: [{ item: 'wood', qty: 4 }] },
  { id: 'barrel', output: 'barrel', qty: 1, station: 'workbench', ingredients: [{ item: 'wood', qty: 6 }, { item: 'iron_ore', qty: 1 }] },
  { id: 'crate', output: 'crate', qty: 1, station: 'workbench', ingredients: [{ item: 'wood', qty: 5 }] },
  { id: 'lamp', output: 'lamp', qty: 1, station: 'workbench', ingredients: [{ item: 'wood', qty: 3 }, { item: 'iron_ore', qty: 2 }] },
  { id: 'picnic_table', output: 'picnic_table', qty: 1, station: 'workbench', ingredients: [{ item: 'wood', qty: 14 }, { item: 'fiber', qty: 4 }] },
  { id: 'iron_axe', output: 'iron_axe', qty: 1, station: 'workbench', ingredients: [{ item: 'stone_axe', qty: 1 }, { item: 'iron_ore', qty: 4 }, { item: 'wood', qty: 3 }] },
  { id: 'landscaping_pick', output: 'landscaping_pick', qty: 1, station: 'workbench', ingredients: [{ item: 'iron_ore', qty: 3 }, { item: 'stone', qty: 8 }, { item: 'wood', qty: 4 }] },
  { id: 'water_spade', output: 'water_spade', qty: 1, station: 'workbench', ingredients: [{ item: 'shovel', qty: 1 }, { item: 'iron_ore', qty: 2 }, { item: 'clay', qty: 4 }] },
  { id: 'iron_shovel', output: 'iron_shovel', qty: 1, station: 'workbench', ingredients: [{ item: 'shovel', qty: 1 }, { item: 'iron_ore', qty: 4 }, { item: 'wood', qty: 3 }] },

  // Campfire cooking.
  { id: 'grilled_fish', output: 'grilled_fish', qty: 1, station: 'campfire', ingredients: [{ tag: 'fish', qty: 1 }, { item: 'wood', qty: 1 }] },

  // Restaurant cooking.
  { id: 'fish_stew', output: 'fish_stew', qty: 1, station: 'restaurant', ingredients: [{ tag: 'fish', qty: 2 }, { tag: 'herb', qty: 1 }] },
  { id: 'fish_stew_mush', output: 'fish_stew', qty: 1, station: 'restaurant', ingredients: [{ tag: 'fish', qty: 2 }, { tag: 'mushroom', qty: 1 }] },
  { id: 'fruit_salad', output: 'fruit_salad', qty: 1, station: 'restaurant', ingredients: [{ tag: 'fruit', qty: 3 }] },
  { id: 'mushroom_soup', output: 'mushroom_soup', qty: 1, station: 'restaurant', ingredients: [{ tag: 'mushroom', qty: 3 }] },
  { id: 'berry_pie', output: 'berry_pie', qty: 1, station: 'restaurant', ingredients: [{ tag: 'berry', qty: 4 }, { item: 'wood', qty: 1 }] },
];

export function recipe(id: string): RecipeDef | undefined {
  return RECIPES.find((r) => r.id === id);
}
