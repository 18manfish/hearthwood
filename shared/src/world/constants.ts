// World-wide sizes and heights: island size, cliff height, sea level, beach and sea-floor shape.

import { Tile } from './tiles.ts';

/** Side length of new home islands (tiles). */
export const ISLAND_SIZE = 72;

/** Islands created before the 1.5× enlargement keep their original size. */
export const LEGACY_ISLAND_SIZE = 48;

/** Highest cliff level players can terraform to. */
export const MAX_LEVEL = 3;

/** Height of one cliff level in world units. */
export const CLIFF = 1.0;

/** Height of the water surface for a water tile at a cliff level. */
export const WATER_SURFACE = -0.2;

/** Beaches: height where the sand meets the grass, and at the water's edge (just under the sea surface). */
export const BEACH_TOP = 0.12;

export const BEACH_EDGE = -0.18;

/** Tiles from the coast until the sea floor reaches full depth, and that depth. */
export const SEA_SHELF = 4.5;

export const SEA_DEEP = -1.6;

/** Deck height of docks and piers. */
export const DOCK_Y = 0.16;

/** Visual sea level, and the deepest sea floor you can wade on (water up to the chest). */
export const SEA_LEVEL = -0.12;

export const WADE_FLOOR = SEA_LEVEL - 0.6;

/** Ramp looks (stored in the ramp byte). */
export const RAMP_STYLES = ['slope', 'stone_stairs', 'wood_stairs', 'log_steps'] as const;

export type RampStyle = (typeof RAMP_STYLES)[number];

export function baseHeight(t: Tile): number {
  switch (t) {
    case Tile.Sea: return -0.7;
    case Tile.Dock: return -0.7;
    case Tile.Pond: return -0.55;
    case Tile.River: return -0.55;
    case Tile.Shore: return 0;
    case Tile.Ground: return 0.12;
    case Tile.Ramp: return 0.12;
    case Tile.Floor: return 0.05;
    case Tile.Wall: return 2.4;
  }
}

/** Height of a bridge deck above its bank's level. */
export const BRIDGE_DECK = 0.28;
