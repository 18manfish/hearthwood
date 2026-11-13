// Where buildings may go: placement rules, doors, free spots.

import { BUILDINGS, type BuildingType } from '../data/buildings.ts';
import { Grid } from './grid.ts';
import { type Building, frontDir, furnitureShape, isBridge, objectTiles } from './objects.ts';
import { Tile } from './tiles.ts';

/** Is a building's footprint adjacent to (or under) point px,pz within `reach`? */
export function nearBuilding(b: Building, px: number, pz: number, reach = 1.6): boolean {
  const cx = Math.max(b.x, Math.min(px, b.x + b.w));
  const cz = Math.max(b.z, Math.min(pz, b.z + b.h));
  const dx = px - cx;
  const dz = pz - cz;
  return dx * dx + dz * dz <= reach * reach;
}

/** Why a building can't go at (x, z) – null if it can. Bridges must span water between two banks. */
export function placeError(g: Grid, type: BuildingType, x: number, z: number): string | null {
  const { w, h } = BUILDINGS[type];
  if (!isBridge(type)) return g.canPlace(x, z, w, h) ? null : 'Not enough free space there.';
  const along = type.startsWith('bridge_ns'); // the bridge runs north–south (along z)
  const len = along ? h : w;
  const lanes = along ? w : h;
  const at = (i: number, k: number) => (along ? [x + k, z + i] : [x + i, z + k]) as [number, number];
  const [bx0, bz0] = at(0, 0);
  if (!g.inBounds(bx0, bz0)) return 'Out of bounds.';
  const L = g.level(bx0, bz0);
  for (let k = 0; k < lanes; k++)
    for (const i of [0, len - 1]) {
      const [tx, tz] = at(i, k);
      const et = g.tile(tx, tz);
      if (!g.inBounds(tx, tz) || (et !== Tile.Ground && et !== Tile.Shore) || g.level(tx, tz) !== L || g.ramp(tx, tz) >= 0) return 'Both ends of a bridge need flat ground at the same height.';
      if (g.occupied[tz * g.size + tx]) return 'Clear the ends of the bridge first.';
    }
  for (let i = 1; i < len - 1; i++)
    for (let k = 0; k < lanes; k++) {
      const [tx, tz] = at(i, k);
      const t = g.tile(tx, tz);
      if (t !== Tile.River && t !== Tile.Pond) return 'Bridges go across rivers and ponds.';
      if (g.level(tx, tz) > L || g.occupied[tz * g.size + tx]) return 'Something is in the way.';
    }
  return null;
}

/** Is a point standing in front of a building's door (south side, centred)? */
export function atDoor(b: Building, px: number, pz: number): boolean {
  const doorX = b.x + b.w / 2;
  const front = b.z + b.h;
  return Math.abs(px - doorX) <= 0.8 && pz >= front - 0.15 && pz <= front + 1.5;
}

/** Find a free tile for a respawning resource: the original spot, else nearby, else anywhere on the lot. */
export function findFreeSpot(
  grid: Grid, x: number, z: number, ok: (x: number, z: number) => boolean, rand: () => number,
): { x: number; z: number } | null {
  if (ok(x, z)) return { x, z };
  for (let r = 1; r <= 6; r++) {
    const ring: [number, number][] = [];
    for (let dz = -r; dz <= r; dz++)
      for (let dx = -r; dx <= r; dx++) if (Math.max(Math.abs(dx), Math.abs(dz)) === r) ring.push([x + dx, z + dz]);
    const start = Math.floor(rand() * ring.length);
    for (let i = 0; i < ring.length; i++) {
      const [tx, tz] = ring[(start + i) % ring.length];
      if (ok(tx, tz)) return { x: tx, z: tz };
    }
  }
  for (let i = 0; i < 400; i++) {
    const tx = 1 + Math.floor(rand() * (grid.size - 2));
    const tz = 1 + Math.floor(rand() * (grid.size - 2));
    if (ok(tx, tz)) return { x: tx, z: tz };
  }
  return null;
}

/** Why a furniture item can't go at (x, z) facing `rot` – null if it can. */
export function furniturePlaceError(g: Grid, item: string, x: number, z: number, rot: number): string | null {
  const tiles = objectTiles({ kind: 'furniture', item, x, z, rot });
  const lvl = g.level(x, z);
  for (const [tx, tz] of tiles) if (!g.canPlace(tx, tz) || g.level(tx, tz) !== lvl) return tiles.length > 1 ? 'It needs two free tiles.' : 'Can’t place it there.';
  if (furnitureShape(item) === 'wall') {
    const [dx, dz] = frontDir(rot);
    if (g.tile(x - dx, z - dz) !== Tile.Wall) return 'Hang it with its back against a wall.';
  }
  return null;
}
