// Beachcombing: shells and driftwood wash up now and then, messages in bottles land
// on their island, and saved terrain gets the wide beaches once (migration).

import { classifyWater, DIRS, Tile, washupsFor } from '@hearthwood/shared';
import type { IslandRecord } from '../../types.ts';
import type { Room } from '../Room.ts';

/** Version of the wide-beach migration for saved (terraformed) terrain. */
const BEACH_VERSION = 4;

/**
 * Beaches got twice as wide (out into the old shallows). Generated terrain
 * already has them; reshaped, saved terrain gets them once.
 */
export function widenBeaches(room: Room, rec: IslandRecord, band: Uint8Array) {
  const L = room.layout;
  const v = rec.beach ?? 0;
  if (rec.terrain && v < BEACH_VERSION) {
    for (let i = 0; i < band.length; i++) {
      const t = L.tiles[i];
      if (band[i] && t === Tile.Sea) L.tiles[i] = band[i] === 2 ? Tile.River : Tile.Shore;
      // Version 2 fanned river mouths out along the beach; now they run straight to the sea.
      else if (v === 2 && band[i] === 1 && t === Tile.River) L.tiles[i] = Tile.Shore;
      else if (v === 2 && band[i] === 2 && t === Tile.Shore) L.tiles[i] = Tile.River;
    }
    classifyWater(L.size, L.tiles);
  }
  if (v !== BEACH_VERSION) {
    rec.beach = BEACH_VERSION;
    room.dirty = true;
  }
}

/** Shells, driftwood… wash up on the beach now and then; bottles addressed to this island land first. */
export function beachTick(room: Room, now: number) {
  const washed = [...room.objects.values()].filter((o) => o.kind === 'washed');
  // Messages in bottles waiting for this island.
  for (const b of room.record?.bottles ?? []) {
    if (washed.some((o) => o.bottle === b.id)) continue;
    const spot = beachSpot(room);
    if (!spot) break;
    room.addObject({ id: room.newId('w'), kind: 'washed', item: 'message_bottle', bottle: b.id, ...spot });
    washed.push({ id: '', kind: 'washed', x: spot.x, z: spot.z, bottle: b.id });
  }
  const max = Math.max(4, Math.round(room.layout.size / 8));
  if (washed.length >= max || !room.birdRng.chance(room.sessions.size ? 0.03 : 0.002)) return;
  const pick = room.birdRng.weighted(washupsFor(room.biome), (w) => w.weight);
  const spot = beachSpot(room);
  if (pick && spot) room.addObject({ id: room.newId('w'), kind: 'washed', item: pick.item, ...spot, rot: room.birdRng.int(0, 3) });
}

/** Dev helper: wash things up right now. */
export function washUp(room: Room, count: number) {
  let n = 0;
  for (let i = 0; i < count; i++) {
    const pick = room.birdRng.weighted(washupsFor(room.biome), (w) => w.weight);
    const spot = beachSpot(room);
    if (!pick || !spot) break;
    room.addObject({ id: room.newId('w'), kind: 'washed', item: pick.item, ...spot, rot: 0 });
    n++;
  }
  return n;
}

/** A free beach tile right next to the sea. */
export function beachSpot(room: Room): { x: number; z: number } | null {
  const g = room.grid;
  const spots: number[] = [];
  for (let z = 1; z < g.size - 1; z++)
    for (let x = 1; x < g.size - 1; x++) {
      if (g.tile(x, z) !== Tile.Shore || g.occupied[z * g.size + x]) continue;
      if (DIRS.some(([dx, dz]) => g.tile(x + dx, z + dz) === Tile.Sea)) spots.push(z * g.size + x);
    }
  if (!spots.length) return null;
  const i = spots[room.birdRng.int(0, spots.length - 1)];
  return { x: i % g.size, z: Math.floor(i / g.size) };
}
