// Birds land, hop around for a few minutes and fly off. They are never saved.

import { BIRD_BY_ID, BIRDS, birdsFor, DIRS, type EnvView, Tile } from '@hearthwood/shared';
import type { Room } from '../Room.ts';

/** Birds land, hop around for a few minutes and fly off. They are never saved. */
export function birdTick(room: Room, now: number, env: EnvView) {
  const birds = [...room.objects.values()].filter((o) => o.kind === 'bird');
  const here = birdsFor(room.biome, env.hour, env.season);
  for (const b of birds) {
    const def = BIRD_BY_ID[b.bird ?? ''];
    if (!def || (b.leaveAt ?? 0) <= now || (!here.includes(def) && room.birdRng.chance(0.04))) room.removeObject(b.id, 'fly');
    else if (room.birdRng.chance(0.12)) {
      // Hop to a neighbouring free tile.
      const [dx, dz] = DIRS[room.birdRng.int(0, 3)];
      if (birdSpot(room, b.x + dx, b.z + dz, def.perch ?? 'ground')) room.replaceObject(b, (t) => { t.x += dx; t.z += dz; t.rot = room.birdRng.int(0, 3); });
    }
  }
  // Only bother landing new birds while someone is around to see them.
  if (!room.sessions.size || !here.length) return;
  const max = Math.max(2, Math.round((room.layout.size * room.layout.size) / 700));
  if (birds.length >= max || !room.birdRng.chance(0.15)) return;
  const def = room.birdRng.weighted(here, (b) => b.rarity)!;
  for (let tries = 0; tries < 30; tries++) {
    const x = room.birdRng.int(1, room.layout.size - 2);
    const z = room.birdRng.int(1, room.layout.size - 2);
    if (!birdSpot(room, x, z, def.perch ?? 'ground')) continue;
    if ([...room.sessions].some((s) => Math.hypot(s.x - x - 0.5, s.z - z - 0.5) < 5)) continue;
    room.addObject({ id: room.newId('w'), kind: 'bird', bird: def.id, x, z, rot: room.birdRng.int(0, 3), leaveAt: now + room.birdRng.range(3, 7) * 60000 });
    return;
  }
}

/** Dev helper: land birds within a few tiles of a point (any species of the biome). */
export function landBirdsNear(room: Room, px: number, pz: number, count: number) {
  const env = room.env();
  const now = birdsFor(room.biome, env.hour, env.season);
  const pool = now.length ? now : BIRDS.filter((b) => b.biomes.includes(room.biome));
  let n = 0;
  for (let tries = 0; tries < 200 && n < count; tries++) {
    const def = pool[room.birdRng.int(0, pool.length - 1)];
    if (!def) break;
    const x = Math.floor(px) + room.birdRng.int(-5, 5), z = Math.floor(pz) + room.birdRng.int(-5, 5);
    if (Math.hypot(x + 0.5 - px, z + 0.5 - pz) < 1.2) continue;
    // Dev only: if the spot suits another perch, let the bird land anyway.
    if (!birdSpot(room, x, z, 'ground') && !birdSpot(room, x, z, 'shore')) continue;
    room.addObject({ id: room.newId('w'), kind: 'bird', bird: def.id, x, z, rot: 0, leaveAt: Date.now() + 10 * 60000 });
    n++;
  }
  return n;
}

export function birdSpot(room: Room, x: number, z: number, perch: 'ground' | 'shore') {
  const g = room.grid;
  if (!g.inBounds(x, z) || g.ramp(x, z) >= 0) return false;
  const t = g.tile(x, z);
  if (perch === 'shore' ? t !== Tile.Shore : t !== Tile.Ground) return false;
  if (g.occupied[z * g.size + x]) return false;
  for (const o of room.objects.values()) if (o.kind === 'bird' && o.x === x && o.z === z) return false;
  return true;
}
