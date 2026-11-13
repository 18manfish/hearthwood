// Things placed on an island: world objects, buildings and the island layout record.

import { type TreeSpecies } from '../data/biomes.ts';
import { type BuildingType } from '../data/buildings.ts';
import { FURNITURE_SHAPES, ITEMS, type FishShadow } from '../data/items.ts';

export type ObjKind = 'tree' | 'stump' | 'rock' | 'bush' | 'mushroom' | 'flower' | 'furniture' | 'decor' | 'bird' | 'washed' | 'fish';

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
  /** Fish shadows (fishing spots): how big the fish is. */
  size?: FishShadow;
}

/** Birds and fish shadows come and go: never saved, never in anyone's way. */
export function isTransient(o: WorldObject): boolean {
  return o.kind === 'bird' || o.kind === 'fish';
}

/** How a furniture item sits (see FURNITURE_SHAPES); undefined = a plain one-tile block. */
export function furnitureShape(item: string): 'flat' | 'wall' | 'long' | undefined {
  return FURNITURE_SHAPES[ITEMS[item]?.model ?? item];
}

/** The tile step an object's front faces after `rot` quarter turns (rot 0 faces +z). */
export function frontDir(rot = 0): [number, number] {
  return ([[0, 1], [1, 0], [0, -1], [-1, 0]] as [number, number][])[((rot % 4) + 4) % 4];
}

/** Tiles an object takes up (long furniture also takes the tile in front of it). */
export function objectTiles(o: Pick<WorldObject, 'kind' | 'x' | 'z' | 'item' | 'rot'>): [number, number][] {
  if (o.kind === 'furniture' && furnitureShape(o.item ?? '') === 'long') {
    const [dx, dz] = frontDir(o.rot);
    return [[o.x, o.z], [o.x + dx, o.z + dz]];
  }
  return [[o.x, o.z]];
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
  /** Starter House tier (1–3, missing = 1). */
  level?: number;
  /** A house upgrade in progress: the tier it becomes once `at` (ms epoch) has passed. */
  upgrade?: { level: number; at: number };
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
  if (o.kind === 'furniture') {
    const shape = furnitureShape(o.item ?? '');
    return shape !== 'flat' && shape !== 'wall';
  }
  return o.kind === 'stump' || o.kind === 'rock' || o.kind === 'bush';
}

/** Rugs and wall-mounted decor don't block movement. */
export function isFlatDecor(item: string) {
  return item.startsWith('rug') || item.startsWith('w_');
}

export function isBridge(type: string) {
  return type.startsWith('bridge_');
}

