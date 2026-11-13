// Clothing. Every player always wears trousers and an undershirt (colours in
// their Look). On top of that come the clothes they own and switch between,
// one per slot:
//   hat · top (shirt, pullover or dress) · bottom (skirt) · outer (jacket, coat) · shoes · gloves
// A dress is a top that also covers the bottom slot: wearing one takes off any
// skirt, and putting on a skirt takes off a dress.
// Clothing items live in BASE_ITEMS (items.ts) with `wear` = slot and `garment` = cut.

import { ITEMS } from './items.ts';

export const WEAR_SLOTS = ['hat', 'top', 'bottom', 'outer', 'shoes', 'gloves'] as const;
export type WearSlot = (typeof WEAR_SLOTS)[number];

/** What's worn in each slot (item ids). Empty slots are left out. */
export type Outfit = Partial<Record<WearSlot, string>>;

/** The cuts the client knows how to draw, per slot. */
export const GARMENTS: Record<WearSlot, readonly string[]> = {
  hat: ['straw_hat', 'beanie', 'cap', 'flower_crown', 'sun_hat', 'bucket_hat'],
  top: ['tshirt', 'shirt', 'pullover', 'dress_short', 'dress_knee', 'dress_long'],
  bottom: ['skirt_short', 'skirt_knee', 'skirt_long'],
  outer: ['jacket', 'coat'],
  shoes: ['sneakers', 'boots', 'sandals'],
  gloves: ['gloves', 'mittens'],
};
export const ALL_GARMENTS: string[] = Object.values(GARMENTS).flat();

/** The cut an item is drawn as (defaults to its id, like hats always did). */
export function garmentOf(item: string): string {
  return ITEMS[item]?.garment ?? item;
}

export function isDress(item: string | undefined): boolean {
  return !!item && garmentOf(item).startsWith('dress');
}

/** Put an item on (or, with item null, empty `slot`). Returns the new outfit. */
export function equip(outfit: Outfit, item: string | null, slot?: WearSlot): Outfit {
  const next: Outfit = { ...outfit };
  if (item === null) {
    if (slot) delete next[slot];
    return next;
  }
  const s = ITEMS[item]?.wear;
  if (!s) return next;
  next[s] = item;
  if (s === 'top' && isDress(item)) delete next.bottom;
  if (s === 'bottom' && isDress(next.top)) delete next.top;
  return next;
}

/** Only real, wearable items in their own slot (for saves and admin edits). */
export function cleanOutfit(o: unknown): Outfit {
  const out: Outfit = {};
  if (!o || typeof o !== 'object') return out;
  for (const slot of WEAR_SLOTS) {
    const id = (o as Record<string, unknown>)[slot];
    if (typeof id === 'string' && ITEMS[id]?.wear === slot) out[slot] = id;
  }
  if (out.bottom && isDress(out.top)) delete out.bottom;
  return out;
}

/** A player's outfit (old saves only had a hat). */
export function outfitOf(p: { hat: string | null; outfit?: Outfit }): Outfit {
  return p.outfit ?? (p.hat ? { hat: p.hat } : {});
}

/** Starter outfits offered in character creation (you get these clothes and wear them). */
export interface OutfitSet {
  id: string;
  name: string;
  icon: string;
  items: string[];
}

export const OUTFIT_SETS: OutfitSet[] = [
  { id: 'casual', name: 'Casual', icon: '👕', items: ['tshirt_sky', 'sneakers_white'] },
  { id: 'cozy', name: 'Cozy', icon: '🧶', items: ['pullover_cream', 'beanie', 'boots_brown'] },
  { id: 'summer', name: 'Summer', icon: '🌻', items: ['dress_sunny', 'sandals_tan', 'straw_hat'] },
  { id: 'explorer', name: 'Explorer', icon: '🧭', items: ['shirt_linen', 'jacket_rain', 'cap', 'boots_brown', 'gloves_work'] },
  { id: 'picnic', name: 'Picnic', icon: '🧺', items: ['shirt_gingham', 'skirt_denim', 'sneakers_white', 'sun_hat'] },
  { id: 'winter', name: 'Winter', icon: '❄️', items: ['pullover_forest', 'coat_wool', 'mittens_red', 'bucket_hat', 'boots_brown'] },
];
export const OUTFIT_SET_IDS = OUTFIT_SETS.map((s) => s.id);

/** The outfit a starter set dresses you in. */
export function setOutfit(id: string): Outfit {
  let o: Outfit = {};
  for (const item of OUTFIT_SETS.find((s) => s.id === id)?.items ?? []) o = equip(o, item);
  return o;
}

// ── Faces ───────────────────────────────────────────────────────────────────
export const EYE_SHAPES = ['round', 'happy', 'sleepy', 'wide', 'wink'] as const;
export const BROWS = ['soft', 'bold', 'raised', 'none'] as const;
export const MOUTHS = ['smile', 'grin', 'open', 'small', 'cat'] as const;
export const NOSES = ['dot', 'button', 'none'] as const;
export const CHEEKS = ['blush', 'freckles', 'none'] as const;
export type EyeShape = (typeof EYE_SHAPES)[number];
export type BrowStyle = (typeof BROWS)[number];
export type MouthStyle = (typeof MOUTHS)[number];
export type NoseStyle = (typeof NOSES)[number];
export type CheekStyle = (typeof CHEEKS)[number];
