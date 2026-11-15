// How rare a fish or a bird is, and how often each rarity turns up. Fish and birds
// each name their rarity; this table (editable in the game creation tool) says how
// likely each rarity is to bite / land, as a weight against the others that could
// be there at that moment (place, time of day, season).

export type Rarity = 'common' | 'uncommon' | 'rare' | 'very_rare';
export const RARITY_IDS: Rarity[] = ['common', 'uncommon', 'rare', 'very_rare'];

export interface RarityDef {
  id: Rarity;
  name: string;
  /** Spawn rate of fish of this rarity (weight; 0 = never). */
  fish: number;
  /** Spawn rate of birds of this rarity (weight; 0 = never). */
  birds: number;
}

export const RARITIES: RarityDef[] = [
  { id: 'common', name: 'Common', fish: 10, birds: 10 },
  { id: 'uncommon', name: 'Uncommon', fish: 6, birds: 5.5 },
  { id: 'rare', name: 'Rare', fish: 2.5, birds: 3 },
  { id: 'very_rare', name: 'Very rare', fish: 1, birds: 1.2 },
];

export function isRarity(v: unknown): v is Rarity {
  return typeof v === 'string' && (RARITY_IDS as string[]).includes(v);
}

export function rarityDef(r: Rarity): RarityDef {
  return RARITIES.find((x) => x.id === r) ?? RARITIES[0];
}

export function rarityName(r: Rarity): string {
  return rarityDef(r).name;
}

/** How likely one fish or bird of this rarity is, against the others that could turn up. */
export function spawnWeight(kind: 'fish' | 'birds', r: Rarity): number {
  return Math.max(0, rarityDef(r)[kind]);
}

/** Rarer birds are warier: catch chance with the basic net. */
export const BIRD_CATCH: Record<Rarity, number> = { common: 0.85, uncommon: 0.72, rare: 0.6, very_rare: 0.5 };

/** Older data gave rarity as a weight (higher = more common): its rarity. */
export function rarityFromWeight(w: number): Rarity {
  return w >= 8 ? 'common' : w >= 4 ? 'uncommon' : w >= 2 ? 'rare' : 'very_rare';
}
