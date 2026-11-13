// Villagers walking around their house by day and staying in at night.

import { villagerAtHome } from '@hearthwood/shared';
import type { Room } from '../Room.ts';

export interface VillagerRuntime {
  id: string;
  houseId: string;
  x: number;
  z: number;
  r: number;
  tx: number;
  tz: number;
  idleUntil: number;
  home: boolean;
  dirty: boolean;
}

/** Positions go over the wire with two decimals. */
export function round2(n: number) {
  return Math.round(n * 100) / 100;
}

export function spawnVillager(room: Room, defId: string, houseId: string) {
  const house = room.buildings.get(houseId);
  const door = house ? { x: house.x + house.w / 2, z: house.z + house.h + 0.6 } : room.layout.spawn;
  const v: VillagerRuntime = { id: defId, houseId, x: door.x, z: door.z, r: 0, tx: door.x, tz: door.z, idleUntil: 0, home: false, dirty: true };
  room.villagers.set(defId, v);
  return v;
}

export function villagerTick(room: Room, dt: number, now: number) {
  if (room.sessions.size === 0 || room.villagers.size === 0) return;
  const env = room.env(now);
  const night = villagerAtHome(env.hour);
  const updates: [string, number, number, number, 0 | 1][] = [];
  const rng = Math.random;
  for (const v of room.villagers.values()) {
    const house = room.buildings.get(v.houseId);
    if (!house) continue;
    const doorX = house.x + house.w / 2;
    const doorZ = house.z + house.h + 0.6;
    if (night !== v.home) {
      v.home = night;
      if (night) {
        v.x = doorX;
        v.z = doorZ;
      }
      v.dirty = true;
    }
    if (!v.home && now >= v.idleUntil) {
      const dx = v.tx - v.x;
      const dz = v.tz - v.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.1) {
        v.idleUntil = now + 2000 + rng() * 6000;
        for (let i = 0; i < 8; i++) {
          const tx = doorX + (rng() - 0.5) * 14;
          const tz = doorZ + (rng() - 0.5) * 14;
          // Stay on the same cliff level as the house.
          if (room.grid.walkable(tx, tz, 0.3, false) && room.grid.level(Math.floor(tx), Math.floor(tz)) === room.grid.level(house.x, house.z)) {
            v.tx = tx;
            v.tz = tz;
            break;
          }
        }
      } else {
        const step = Math.min(d, 1.3 * dt);
        const nx = v.x + (dx / d) * step;
        const nz = v.z + (dz / d) * step;
        if (room.grid.canMove(v.x, v.z, nx, nz, 0.25, false) || !room.grid.walkable(v.x, v.z, 0.25, false)) {
          v.x = nx;
          v.z = nz;
          v.r = Math.atan2(dx, dz);
        } else {
          v.tx = v.x;
          v.tz = v.z;
        }
        v.dirty = true;
      }
    }
    if (v.dirty) {
      v.dirty = false;
      updates.push([v.id, round2(v.x), round2(v.z), round2(v.r), v.home ? 1 : 0]);
    }
  }
  if (updates.length) room.broadcast({ t: 'vs', l: updates });
}
