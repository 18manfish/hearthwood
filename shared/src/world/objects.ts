// Things placed on an island: world objects, buildings and the island layout record.

import { type TreeSpecies } from '../data/biomes.ts';
import { BUILDINGS, type BuildingType } from '../data/buildings.ts';

export type ObjKind = 'tree' | 'stump' | 'rock' | 'bush' | 'mushroom' | 'flower' | 'furniture' | 'decor' | 'bird' | 'washed';

export interface WorldObject {
  id: string;
  kind: ObjKind;
  x: number; // tile coords (integer)
  z: number;
  species?: TreeSpecies;
  /** Tree growth: 0 sapling, 1 young, 2 mature. */
  stage?: number;
  /** When the next growth stage is reached (ms epoch). */
  growAt?: number;
  /** Chop hits on a tree / hits on a rock. */
  hits?: number;
  /** Fruit hanging on a mature tree. */
  fruit?: number;
  /** Bush currently has food. */
  ripe?: boolean;
  rare?: boolean;
  /** Furniture item id. */
  item?: string;
  rot?: number;
  /** Day key on which the tree was last shaken for a branch. */
  shook?: string;
  /** Stumps rot away (and a sapling sprouts) at this time. */
  decayAt?: number;
  /** Washed ashore: a message in a bottle (id in the bottle store). */
  bottle?: string;
  /** Birds: species id (see data/birds.ts) and when it flies off on its own. */
  bird?: string;
  leaveAt?: number;
}

export interface Building {
  id: string;
  type: BuildingType;
  x: number;
  z: number;
  w: number;
  h: number;
  /** ms epoch when construction completes (<= now means done). */
  completeAt: number;
  villagerId?: string;
  /** For interior counters: which service it provides (a shop type, town_hall…). */
  role?: BuildingType;
  /** Houses built by a resident belong to them (default: the island owner). */
  ownerId?: string;
}

export interface IslandLayout {
  size: number;
  tiles: Uint8Array;
  levels: Uint8Array;
  /** Ramp direction + 1 per tile (0 = no ramp). */
  ramps: Uint8Array;
  /** Pre-laid paths (designed locations). */
  paths?: Uint8Array;
  objects: WorldObject[];
  buildings: Building[];
  spawn: { x: number; z: number };
  /** Sea the generator turned into beach (1) or river mouth (2) to make beaches wider; saved terrain gets it once. */
  beachBand?: Uint8Array;
}

/** Objects that stop movement. Saplings, mushrooms and flowers can be walked over. */
export function objectBlocks(o: WorldObject): boolean {
  if (o.kind === 'tree') return (o.stage ?? 2) >= 1;
  if (o.kind === 'decor') return !isFlatDecor(o.item ?? '');
  return o.kind === 'stump' || o.kind === 'rock' || o.kind === 'bush' || o.kind === 'furniture';
}

/** Rugs and wall-mounted decor don't block movement. */
export function isFlatDecor(item: string) {
  return item.startsWith('rug') || item.startsWith('w_');
}

export function isBridge(type: string) {
  return type.startsWith('bridge_');
}

export function buildingFootprint(type: BuildingType) {
  const d = BUILDINGS[type];
  return { w: d.w, h: d.h };
}
