// Interiors for every enterable building. Each interior is a small walled
// room with a doorway (exit fixture) on the south wall, decorated with
// 'decor' objects (rendered by the client, not pick-up-able) and, for
// shops and the town hall, a service counter.
//
// Villager houses are themed after their resident: colours from the
// villager, furniture from their personality and the things they like.

import type { BuildingType } from './data/buildings.ts';
import type { VillagerDef } from './data/villagers.ts';
import { hashString, Rng } from './rng.ts';
import { Tile, type Building, type IslandLayout, type WorldObject } from './world.ts';

export type InteriorStyle = 'tent' | 'cabin' | 'villager' | 'shop' | 'town_hall' | 'shack' | 'lighthouse';

export interface InteriorSpec {
  style: InteriorStyle;
  /** Shops: which shop (its counter provides that service). */
  role?: BuildingType;
  /** Seed for variations (shack colours etc.). */
  seed: number;
  villager?: VillagerDef;
  /** Starter House tier (cabin interiors grow and get fancier). */
  level?: number;
}

export interface InteriorTheme {
  wall: string;
  floor: string;
  floorAlt: string;
  /** 'planks' | 'tiles' | 'carpet' – how the floor colours alternate. */
  pattern: 'planks' | 'tiles' | 'carpet';
}

export interface InteriorLayout extends IslandLayout {
  theme: InteriorTheme;
}

/** Interiors whose furniture the owner can rearrange (and which are saved). */
export const HOME_STYLES: InteriorStyle[] = ['tent', 'cabin'];

/** Starter House interior per tier (keep in step with HOUSE_TIERS). */
const CABIN_SIZE = [9, 11, 13];
const SIZE: Record<InteriorStyle, number> = { tent: 7, cabin: 9, villager: 9, shop: 11, town_hall: 13, shack: 8, lighthouse: 7 };

function mix(a: string, b: string, t: number) {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const ch = (s: number) => Math.round(((pa >> s) & 255) * (1 - t) + ((pb >> s) & 255) * t);
  return `#${((1 << 24) | (ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).slice(1)}`;
}

export function generateInterior(spec: InteriorSpec): InteriorLayout {
  const size = spec.style === 'cabin' ? CABIN_SIZE[(spec.level ?? 1) - 1] ?? SIZE.cabin : SIZE[spec.style];
  const tiles = new Uint8Array(size * size);
  for (let z = 0; z < size; z++)
    for (let x = 0; x < size; x++) tiles[z * size + x] = x === 0 || z === 0 || x === size - 1 || z === size - 1 ? Tile.Wall : Tile.Floor;
  const mid = Math.floor(size / 2);
  tiles[(size - 1) * size + mid] = Tile.Floor;
  const buildings: Building[] = [{ id: 'b_exit', type: 'exit', x: mid, z: size - 1, w: 1, h: 1, completeAt: 0 }];
  const objects: WorldObject[] = [];
  const used = new Set<string>();
  const rng = new Rng(spec.seed);
  let oid = 1;
  const inside = (x: number, z: number) => x >= 1 && z >= 1 && x <= size - 2 && z <= size - 2;
  // Keep the walk from the door to the middle of the room clear.
  const aisle = (x: number, z: number) => x === mid && z >= Math.floor(size / 2);
  const deco = (item: string, x: number, z: number, rot = 0) => {
    const wall = item.startsWith('w_');
    if (wall ? !(z === 0 && x >= 1 && x <= size - 2) : !inside(x, z) || (aisle(x, z) && !item.startsWith('rug'))) return false;
    const key = `${x},${z},${wall ? 'w' : item.startsWith('rug') ? 'r' : 'o'}`;
    if (used.has(key)) return false;
    used.add(key);
    objects.push({ id: `d${oid++}`, kind: 'decor', x, z, item, rot });
    return true;
  };
  const furniture = (item: string, x: number, z: number, rot = 0) => {
    if (!inside(x, z) || aisle(x, z) || used.has(`${x},${z},o`)) return;
    used.add(`${x},${z},o`);
    objects.push({ id: `d${oid++}`, kind: 'furniture', x, z, item, rot });
  };
  const fixture = (type: BuildingType, x: number, z: number, w: number, h: number, role?: BuildingType) => {
    buildings.push({ id: `b_${type}${buildings.length}`, type, x, z, w, h, completeAt: 0, role });
    for (let dz = 0; dz < h; dz++) for (let dx = 0; dx < w; dx++) used.add(`${x + dx},${z + dz},o`);
  };
  let theme: InteriorTheme = { wall: '#efe3cf', floor: '#b98a5a', floorAlt: '#a87b4f', pattern: 'planks' };
  const R = size - 2; // last floor row / column index

  switch (spec.style) {
    case 'tent':
      theme = { wall: '#e0a94a', floor: '#c9b27a', floorAlt: '#c0a86f', pattern: 'carpet' };
      fixture('bed', 1, 1, 1, 2);
      fixture('chest', R, 1, 1, 1);
      deco('rug|#c0392b', 3, 3);
      deco('lantern', R, 3);
      furniture('crate', 1, 4);
      break;

    case 'cabin': {
      const lvl = spec.level ?? 1;
      fixture('bed', 1, 1, 1, 2);
      fixture('chest', R, 1, 1, 1);
      if (lvl === 1) {
        theme = { wall: '#efe3cf', floor: '#b98a5a', floorAlt: '#a87b4f', pattern: 'planks' };
        deco('w_fireplace', mid, 0);
        deco('w_window', 2, 0);
        deco('w_window', R - 1, 0);
        deco('rug|#3d6fb6', mid, 3);
        deco('table|#a0703f', R - 1, 4);
        deco('chair|#a0703f', R - 1, 5, 2);
        deco('bookshelf|#8b5e34', 2, 1);
        deco('plant', 1, R);
        deco('plant', R, R);
      } else if (lvl === 2) {
        // Timber House: warmer wood, a sitting corner and a dining table.
        theme = { wall: '#f3e2c4', floor: '#a8754a', floorAlt: '#9a6a41', pattern: 'planks' };
        deco('w_fireplace', mid, 0);
        deco('w_window', 2, 0);
        deco('w_window', R - 1, 0);
        deco('w_clock', mid + 2, 0);
        deco('w_painting|#6aa84f', mid - 2, 0);
        deco('rug|#8e3b46', mid, 3);
        deco('sofa|#6d8b74', mid, 4, 2);
        deco('armchair|#c49a62', mid - 2, 3, 1);
        deco('bookshelf|#8b5e34', 2, 1);
        deco('wardrobe|#a0703f', R - 1, 1);
        deco('dining', 2, R - 2);
        deco('lantern', R, R - 3);
        deco('plant', 1, R);
        deco('plant', R, R);
      } else {
        // Hearth Manor: patterned floor, grand fireplace wall, library and dining hall.
        theme = { wall: '#f6efe2', floor: '#e8dcc6', floorAlt: '#7a5a43', pattern: 'tiles' };
        deco('w_fireplace', mid, 0);
        deco('w_window', 2, 0);
        deco('w_window', R - 1, 0);
        deco('w_painting|#c9a24a', mid - 2, 0);
        deco('w_painting|#3d5a80', mid + 2, 0);
        deco('w_clock', 3, 0);
        deco('w_banner|#7a1f3d', R - 2, 0);
        deco('rug|#7a1f3d', mid, 3);
        deco('rug|#7a1f3d', mid, 5);
        deco('sofa|#7a1f3d', mid, 4, 2);
        deco('armchair|#c9a24a', mid - 2, 3, 1);
        deco('armchair|#c9a24a', mid + 2, 3, 3);
        deco('bookshelf|#5d4037', 2, 1);
        deco('bookshelf|#5d4037', 3, 1);
        deco('wardrobe|#5d4037', R - 1, 1);
        deco('mirror', R - 2, 1);
        deco('globe', 1, 4);
        deco('telescope', R, 4);
        deco('aquarium', R, R - 3);
        deco('dining', 2, R - 2);
        deco('desk', R - 2, R - 1);
        deco('plant', 1, R);
        deco('plant', R, R);
        deco('plant_small', 1, R - 4);
      }
      break;
    }

    case 'villager': {
      const v = spec.villager;
      const color = v?.color ?? '#c9a36b', accent = v?.accent ?? '#fff0d4';
      const floorBy: Record<string, [string, string, InteriorTheme['pattern']]> = {
        cheerful: ['#f2c49b', '#eab68a', 'planks'],
        lazy: ['#c8a27a', '#bf9870', 'carpet'],
        grumpy: ['#6d4c3d', '#5f4134', 'planks'],
        sporty: ['#9fd3c7', '#8cc4b7', 'tiles'],
        artsy: ['#ece6da', '#3b3b48', 'tiles'],
        shy: ['#f4d6e0', '#eecbd7', 'carpet'],
      };
      const [floor, floorAlt, pattern] = floorBy[v?.personality ?? 'cheerful'];
      theme = { wall: mix(accent, color, 0.25), floor, floorAlt, pattern };
      // A bed in their colour, a rug, windows and a portrait.
      deco(`bed_big|${color}`, 1, 1);
      deco('none', 1, 2);
      deco(`rug|${mix(color, '#ffffff', 0.35)}`, mid, 4);
      deco('w_window', 2, 0);
      deco('w_window', R - 1, 0);
      deco(`w_painting|${accent}`, mid, 0);
      deco('w_clock', mid + 1, 0);
      // Personality.
      switch (v?.personality) {
        case 'cheerful':
          deco('balloons', R, 1);
          deco('radio', 3, 1);
          break;
        case 'lazy':
          deco('tv', mid, 1);
          deco(`sofa|${color}`, mid, 3, 2);
          deco('pillow|#f6c445', 3, 3);
          break;
        case 'grumpy':
          deco(`armchair|${mix(color, '#3b2f25', 0.4)}`, R - 1, 2, 3);
          deco('bookshelf|#5d4037', R, 1);
          deco('w_fireplace', mid - 1, 0);
          break;
        case 'sporty':
          deco('dumbbells', R, 5);
          deco('punching_bag', R, 2);
          deco('w_poster|#e8604c', 3, 0);
          break;
        case 'artsy':
          deco('easel', R - 1, 3, 3);
          deco(`w_painting|#3fa7d6`, 3, 0);
          deco(`w_painting|#f2c14e`, R - 2, 0);
          break;
        case 'shy':
          deco(`teddy|${accent}`, 2, 1);
          deco('plant', R, 3);
          deco('plant_small', 3, 1);
          break;
      }
      // What they like.
      const likes = new Set(v?.likes ?? []);
      if (likes.has('fish')) deco('aquarium', R, R);
      if (likes.has('plant')) { deco('plant', 1, R); deco('plant_small', R, 4); }
      if (likes.has('furniture') || likes.has('cozy')) deco(`armchair|${color}`, 2, R - 1, 1);
      if (likes.has('sweet') || likes.has('meal')) { deco('table|#a0703f', R - 1, R - 1); deco('cake', R - 1, R - 2); }
      if (likes.has('fruit') || likes.has('berry')) { deco('table|#c49a62', 2, 4); deco('fruit_bowl', 3, 4); }
      if (likes.has('mineral')) deco('rocks', 1, R);
      if (likes.has('rare')) { deco('telescope', R, 1); deco('globe', 1, 4); }
      if (likes.has('clothing')) { deco(`wardrobe|${color}`, R, 2); deco('mirror', 1, 4); }
      if (likes.has('mushroom')) { deco('mushroom_lamp', 1, 4); deco('mushroom_lamp', R, 4); }
      if (likes.has('wood')) deco('w_fireplace', mid - 1, 0);
      if (likes.has('tool')) deco('tool_rack', R, 4);
      // Fill any bare corners with a plant.
      for (const [x, z] of [[1, R], [R, R]] as [number, number][]) deco('plant_small', x, z);
      break;
    }

    case 'shop': {
      const role = spec.role!;
      theme = { wall: '#f5ecd7', floor: '#c49a62', floorAlt: '#b78d57', pattern: 'planks' };
      fixture('counter', mid - 1, 2, 2, 1, role);
      deco('w_window', 2, 0);
      deco('w_window', R - 1, 0);
      switch (role) {
        case 'tool_store':
          theme = { wall: '#e3e7ea', floor: '#9aa3a8', floorAlt: '#8d969b', pattern: 'tiles' };
          deco('w_toolrack', 3, 0);
          deco('w_toolrack', R - 2, 0);
          deco('shelf|tools', 1, 3);
          deco('shelf|tools', R, 3);
          furniture('crate', 1, R);
          furniture('barrel', R, R);
          deco('w_poster|#f2c14e', mid + 2, 0);
          break;
        case 'furniture_store':
          theme = { wall: '#efe1cf', floor: '#a0703f', floorAlt: '#946639', pattern: 'planks' };
          deco('rug|#8e5a3c', 3, 5);
          deco('rug|#2a9d8f', R - 2, 5);
          for (const [item, x, z] of [['bench', 2, 5], ['lamp', 1, 3], ['flower_pot', 3, 7], ['picnic_table', R - 2, 5], ['gnome', R, 7], ['barrel', R, 3], ['crate', 1, 7]] as [string, number, number][]) furniture(item, x, z);
          deco('armchair|#c0392b', 3, 3, 1);
          deco('sofa|#2a9d8f', R - 2, 3, 2);
          break;
        case 'clothing_shop':
          theme = { wall: '#fbe3ec', floor: '#f4f0ea', floorAlt: '#e9e2d8', pattern: 'tiles' };
          deco('rug|#ff8fb1', mid, 5);
          deco('rack', 2, 4);
          deco('rack', R - 1, 4);
          deco('mannequin|#3fa7d6', 1, 6);
          deco('mannequin|#e8604c', R, 6);
          deco('mirror', R, 2);
          deco('wardrobe|#c2185b', 1, 2);
          deco('w_poster|#ff8fb1', 3, 0);
          break;
        case 'restaurant':
          theme = { wall: '#fff2d6', floor: '#b5553c', floorAlt: '#a64b34', pattern: 'tiles' };
          deco('stove', 2, 1);
          deco('stove', R - 1, 1);
          for (const [x, z] of [[2, 5], [R - 1, 5], [2, 8], [R - 1, 8]] as [number, number][]) {
            deco('dining', x, z);
            deco('chair|#8b5e34', x + 1, z, 3);
            deco('chair|#8b5e34', x - 1, z, 1);
          }
          deco('plant', 1, R);
          deco('plant', R, R);
          deco('w_painting|#e67e22', mid + 2, 0);
          break;
        case 'travel_agent':
          theme = { wall: '#e1f0f7', floor: '#d9cdb8', floorAlt: '#cfc2ab', pattern: 'tiles' };
          deco('globe', 2, 2);
          deco('w_map', 3, 0);
          deco('w_poster|#2a9d8f', R - 2, 0);
          deco('w_poster|#f2c14e', R - 1, 0);
          for (const x of [2, 3]) deco('chair|#2a9d8f', x, 6, 2);
          deco('plant', 1, R);
          deco('plant', R, R);
          deco('w_wheel', mid + 2, 0);
          break;
      }
      break;
    }

    case 'town_hall':
      theme = { wall: '#efe3cf', floor: '#d7ccc8', floorAlt: '#c9bdb8', pattern: 'tiles' };
      fixture('counter', mid - 1, 2, 2, 1, 'town_hall');
      // Red runner from the door to the counter, flags and the island map.
      for (let z = 3; z <= R; z++) deco('rug|#b3392f', mid, z);
      deco('w_banner|#3d6fb6', 2, 0);
      deco('w_banner|#e8604c', R - 1, 0);
      deco('w_map', mid + 2, 0);
      deco('w_clock', mid - 2, 0);
      deco('bookshelf|#8b5e34', 1, 2);
      deco('bookshelf|#8b5e34', R, 2);
      for (const z of [6, 9]) {
        furniture('bench', 3, z);
        furniture('bench', R - 2, z);
      }
      deco('plant', 1, R);
      deco('plant', R, R);
      deco('plant', 1, 5);
      deco('plant', R, 5);
      break;

    case 'shack': {
      const walls = ['#f3dfc1', '#e8f1f5', '#fdebd3', '#e6f2e3'];
      theme = { wall: walls[spec.seed % walls.length], floor: '#9c7a52', floorAlt: '#8b6b47', pattern: 'planks' };
      deco(`bed_big|${['#3fa7d6', '#e8604c', '#59cd90', '#f2c14e'][(spec.seed >> 3) % 4]}`, 1, 1);
      deco('none', 1, 2);
      deco('w_net', 3, 0);
      deco('w_wheel', R - 1, 0);
      deco('w_window', mid, 0);
      deco('table|#8b6338', R - 1, 4);
      deco('chair|#8b6338', R - 2, 4, 1);
      deco('stove', R, 1);
      deco('lantern', R, 3);
      deco(`rug|${['#2a9d8f', '#c0392b', '#3d6fb6'][spec.seed % 3]}`, mid - 1, 4);
      furniture('barrel', 1, R);
      if (rng.chance(0.5)) furniture('crate', R, R);
      break;
    }

    case 'lighthouse':
      theme = { wall: '#e8e1d5', floor: '#9c7a52', floorAlt: '#8b6b47', pattern: 'planks' };
      deco('stairs', mid, 2);
      deco('w_map', 2, 0);
      deco('w_window', R - 1, 0);
      deco('telescope', R, 3);
      deco('desk', 1, 3);
      deco('chair|#5d4037', 2, 3, 3);
      deco('lantern', R, 1);
      furniture('crate', 1, R);
      furniture('barrel', R, R);
      break;
  }

  return {
    size, tiles, levels: new Uint8Array(size * size), ramps: new Uint8Array(size * size),
    objects, buildings, spawn: { x: mid + 0.5, z: size - 2 + 0.3 }, theme,
  };
}

/** Which interior a building has. */
export function interiorSpecFor(type: BuildingType, buildingId: string, villager?: VillagerDef, level = 1): InteriorSpec | null {
  const seed = hashString(buildingId);
  switch (type) {
    case 'tent': return { style: 'tent', seed };
    case 'cabin': return { style: 'cabin', seed, level };
    case 'villager_house': return { style: 'villager', seed, villager };
    case 'town_hall': return { style: 'town_hall', seed };
    case 'shack': return { style: 'shack', seed };
    case 'lighthouse': return { style: 'lighthouse', seed };
    case 'travel_agent':
    case 'clothing_shop':
    case 'restaurant':
    case 'tool_store':
    case 'furniture_store':
      return { style: 'shop', role: type, seed };
    default:
      return null;
  }
}
