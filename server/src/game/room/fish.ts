// Fish shadows: dark shapes swimming in the water. They mark where a fish will
// bite – you can only fish at one. The sea has small, medium and large shadows
// (each size has its own fish); rivers and ponds only have medium ones, and any
// of their fish can bite there. Like birds they come and go and are never saved.

import {
  BIOMES, FISH, fishShadow, isWaterTile, Tile, waterKind,
  type EnvView, type FishDef, type FishShadow, type WorldObject,
} from '@hearthwood/shared';
import type { Room } from '../Room.ts';

/** Minutes a shadow stays before it swims off. */
const STAY_MIN = [3, 8] as const;
/** How likely each size is to turn up in the sea. */
const SEA_SIZES: [FishShadow, number][] = [['small', 0.45], ['medium', 0.35], ['large', 0.2]];

/** Fish that bite in this kind of water on this island right now. */
export function fishPool(biome: Room['biome'], water: 'sea' | 'river' | 'pond', env: EnvView): FishDef[] {
  const def = BIOMES[biome];
  const ids = new Set(water === 'sea' ? def.seaFish : def.freshFish);
  for (const f of FISH) if (f.water === water && f.biomes?.includes(biome)) ids.add(f.id);
  return [...ids]
    .map((id) => FISH.find((f) => f.id === id))
    .filter((f): f is FishDef => !!f && f.water === water)
    .filter((f) => {
      if (f.seasons && !f.seasons.includes(env.season)) return false;
      if (f.hours) {
        const [a0, b0] = f.hours;
        const inside = a0 < b0 ? env.hour >= a0 && env.hour < b0 : env.hour >= a0 || env.hour < b0;
        if (!inside) return false;
      }
      return true;
    });
}

/** Fish that can bite at this shadow: same water, and in the sea the same size. */
export function spotPool(room: Room, spot: WorldObject, env: EnvView): FishDef[] {
  const water = waterKind(room.grid.tile(spot.x, spot.z));
  if (!water) return [];
  const pool = fishPool(room.biome, water, env);
  return water === 'sea' ? pool.filter((f) => fishShadow(f) === (spot.size ?? 'medium')) : pool;
}

/** The shadow a line cast at tile (x, z) lands next to (within one tile), nearest first. */
export function spotAt(room: Room, x: number, z: number): WorldObject | null {
  let best: WorldObject | null = null;
  let bd = Infinity;
  for (const o of room.objects.values()) {
    if (o.kind !== 'fish' || Math.max(Math.abs(o.x - x), Math.abs(o.z - z)) > 1) continue;
    const d = Math.hypot(o.x - x, o.z - z);
    if (d < bd) {
      bd = d;
      best = o;
    }
  }
  return best;
}

/** Is there dry land (or a dock) within `r` tiles? Shadows stay where a line can reach them. */
function landWithin(room: Room, x: number, z: number, r: number) {
  const g = room.grid;
  for (let dz = -r; dz <= r; dz++)
    for (let dx = -r; dx <= r; dx++) {
      const tx = x + dx, tz = z + dz;
      if (g.inBounds(tx, tz) && !isWaterTile(g.tile(tx, tz))) return true;
    }
  return false;
}

/** Open water (not under a bridge) with no other shadow within `spacing` tiles. */
function freeWater(room: Room, x: number, z: number, spacing = 2) {
  const g = room.grid;
  if (!g.inBounds(x, z) || !isWaterTile(g.tile(x, z)) || g.bridges[g.idx(x, z)]) return false;
  for (const o of room.objects.values()) if (o.kind === 'fish' && Math.max(Math.abs(o.x - x), Math.abs(o.z - z)) <= spacing) return false;
  return true;
}

/** Which size of shadow could appear on this tile (null: none – nothing bites there now). */
function pickSize(room: Room, x: number, z: number, env: EnvView): FishShadow | null {
  const water = waterKind(room.grid.tile(x, z));
  if (!water) return null;
  const pool = fishPool(room.biome, water, env);
  if (water !== 'sea') return pool.length ? 'medium' : null;
  const sizes = SEA_SIZES.filter(([s]) => pool.some((f) => fishShadow(f) === s))
    // Big fish keep away from the shore.
    .filter(([s]) => s !== 'large' || !landWithin(room, x, z, 1));
  return room.birdRng.weighted(sizes, ([, w]) => w)?.[0] ?? null;
}

function beingFished(room: Room, id: string) {
  for (const s of room.sessions) if (s.cast?.spot === id) return true;
  return false;
}

/** Shadows swim off after a while; new ones turn up while someone is around. */
export function fishTick(room: Room, now: number, env: EnvView) {
  const spots = [...room.objects.values()].filter((o) => o.kind === 'fish');
  for (const o of spots) if ((o.leaveAt ?? 0) <= now && !beingFished(room, o.id)) room.removeObject(o.id);
  if (!room.sessions.size) return;
  const max = Math.max(3, Math.round((room.layout.size * room.layout.size) / 500));
  if (spots.length >= max || !room.birdRng.chance(0.25)) return;
  for (let tries = 0; tries < 40; tries++) {
    const x = room.birdRng.int(0, room.layout.size - 1);
    const z = room.birdRng.int(0, room.layout.size - 1);
    if (!freeWater(room, x, z) || !landWithin(room, x, z, 3)) continue;
    const size = pickSize(room, x, z, env);
    if (!size) continue;
    room.addObject({ id: room.newId('f'), kind: 'fish', x, z, size, rot: room.birdRng.int(0, 3), leaveAt: now + room.birdRng.range(STAY_MIN[0], STAY_MIN[1]) * 60000 });
    return;
  }
}

/** Dev helper: put shadows in the water within a few tiles of a point (or exactly on tile `at`). */
export function fishNear(room: Room, px: number, pz: number, count: number, size?: FishShadow, at?: [number, number]) {
  const env = room.env();
  let n = 0;
  for (let tries = 0; tries < 400 && n < count; tries++) {
    const x = at ? at[0] : Math.floor(px) + room.birdRng.int(-4, 4), z = at ? at[1] : Math.floor(pz) + room.birdRng.int(-4, 4);
    if (!freeWater(room, x, z, at ? 0 : 2)) {
      if (at) break;
      continue;
    }
    const fresh = room.grid.tile(x, z) !== Tile.Sea;
    const s = fresh ? 'medium' : size ?? pickSize(room, x, z, env) ?? 'medium';
    room.addObject({ id: room.newId('f'), kind: 'fish', x, z, size: s, rot: 0, leaveAt: Date.now() + 10 * 60000 });
    n++;
    if (at) break;
  }
  return n;
}
