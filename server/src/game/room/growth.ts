// Depletion and regrowth: respawning trees, rocks and bushes, and the daily refresh
// (fruit, stones, mushrooms, flowers).

import { BIOMES, findFreeSpot, hashMany, Rng, Tile, TREES, type WorldObject } from '@hearthwood/shared';
import { config } from '../../config.ts';
import type { Respawn } from '../../types.ts';
import type { Room } from '../Room.ts';

export function scheduleRespawn(room: Room, kind: Respawn['kind'], x: number, z: number, now = Date.now()) {
  const minutes = config.respawnMinutes[kind];
  room.respawns.push({ kind, x, z, at: now + (minutes * 60000) / config.timeFactor });
  room.dirty = true;
}

/** Bring back due resources at their old spot, or the nearest free one on the lot. */
export function processRespawns(room: Room, now: number) {
  if (!room.respawns.length) return;
  const due = room.respawns.filter((r) => r.at <= now);
  if (!due.length) return;
  room.respawns = room.respawns.filter((r) => r.at > now);
  const rng = new Rng(hashMany(room.id, now));
  const def = BIOMES[room.biome];
  for (const r of due) {
    const ok = (x: number, z: number) => {
      if (room.grid.tile(x, z) !== Tile.Ground || !room.grid.canSpawn(x, z)) return false;
      for (const s of room.sessions) if (Math.floor(s.x) === x && Math.floor(s.z) === z) return false;
      if (r.kind === 'tree' || r.kind === 'rock') {
        // Keep breathing room around trees and rocks.
        for (const o of room.objects.values()) if ((o.kind === 'tree' || o.kind === 'stump' || o.kind === 'rock') && Math.abs(o.x - x) <= 1 && Math.abs(o.z - z) <= 1) return false;
      }
      return true;
    };
    const spot = findFreeSpot(room.grid, r.x, r.z, ok, () => rng.float());
    if (!spot) {
      room.respawns.push({ ...r, at: now + 3600_000 / config.timeFactor }); // try again later
      continue;
    }
    if (r.kind === 'rock') room.addObject({ id: room.newId('r'), kind: 'rock', x: spot.x, z: spot.z, hits: 0 });
    else if (r.kind === 'bush') room.addObject({ id: room.newId('k'), kind: 'bush', x: spot.x, z: spot.z, ripe: true });
    else {
      const species = rng.weighted(def.trees, (t) => t.weight)!.species;
      room.addObject({ id: room.newId('t'), kind: 'tree', x: spot.x, z: spot.z, species, stage: 0, hits: 0, fruit: 0, growAt: now + (config.treeStageMinutes * 60000) / config.timeFactor });
    }
  }
  room.dirty = true;
}

/** New day: fruit regrows, loose stones refill, mushrooms & flowers spawn. */
export function dailyRefresh(room: Room, dayKey: string, _now: number) {
  const first = room.dayKey === '';
  room.dayKey = dayKey;
  room.dirty = true;
  if (first && room.kind !== 'island') return;
  const def = BIOMES[room.biome];
  const rng = new Rng(hashMany(room.id, dayKey));
  let mushrooms = 0;
  let flowers = 0;
  for (const o of room.objects.values()) {
    if (o.kind === 'mushroom') mushrooms++;
    if (o.kind === 'flower') flowers++;
  }
  const trees: WorldObject[] = [];
  for (const o of [...room.objects.values()]) {
    if (o.kind === 'rock' && o.hits && o.hits <= 2) {
      // Hand-gathered stones come back; shovel damage stays until it crumbles.
      o.hits = 0;
      room.updateObject(o);
    } else if (o.kind === 'tree' && o.stage === 2) {
      trees.push(o);
      const fruit = TREES[o.species!].fruit ? 3 : 0;
      if ((o.fruit ?? 0) < fruit || o.shook) {
        o.fruit = fruit;
        delete o.shook;
        room.updateObject(o);
      }
    }
  }
  const freeNear = (x: number, z: number) => {
    const dirs = rng.shuffle([[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]);
    for (const [dx, dz] of dirs) if (room.grid.canSpawn(x + dx, z + dz)) return { x: x + dx, z: z + dz };
    return null;
  };
  for (const t of trees) {
    if (mushrooms >= 10) break;
    if (!rng.chance(def.mushroomChance * 2)) continue;
    const p = freeNear(t.x, t.z);
    if (!p) continue;
    room.addObject({ id: room.newId('m'), kind: 'mushroom', x: p.x, z: p.z, rare: rng.chance(def.rareMushroomChance) });
    mushrooms++;
  }
  for (let i = 0; i < 4 && flowers < 12; i++) {
    const x = rng.int(1, room.layout.size - 2);
    const z = rng.int(1, room.layout.size - 2);
    if (room.grid.tile(x, z) === Tile.Ground && room.grid.canSpawn(x, z)) {
      room.addObject({ id: room.newId('f'), kind: 'flower', x, z });
      flowers++;
    }
  }
}
