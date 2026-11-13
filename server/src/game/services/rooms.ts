// The room registry: loading islands, interiors and shared hubs on demand, syncing
// and reloading islands, villagers coming home, and old-save upgrades.

import {
  BIOMES, type Building, BUILDINGS, hashString, houseLevel, interiorSpecFor, LEGACY_ISLAND_SIZE, Rng, sharedLocation, villagerDef,
} from '@hearthwood/shared';
import { Room } from '../Room.ts';
import { Session } from '../Session.ts';
import type { IslandRecord } from '../../types.ts';
import type { Game } from '../Game.ts';
import { buildingCompleted, houseUpgraded } from './progress.ts';
import { moveToRoom, travel } from './travel.ts';

/** One-off upgrades for islands saved by older versions. */
export function migrateIsland(rec: IslandRecord) {
  for (const b of rec.buildings) {
    // The 3×3 Post Office became a 1×1 Mailbox (placed at its front-centre).
    if ((b.type as string) === 'post_office') {
      b.type = 'mailbox';
      b.x += 1;
      b.z += 2;
      b.w = 1;
      b.h = 1;
    }
  }
}

export function mapSpot(game: Game, biome: string, seed: number) {
  const region = BIOMES[biome as keyof typeof BIOMES].map;
  const rng = new Rng(seed);
  const others = [...game.store.islands.values()].map((i) => i.map);
  let best = { x: region.x, y: region.y };
  let bestD = -1;
  for (let i = 0; i < 30; i++) {
    const ang = rng.range(0, Math.PI * 2);
    const rad = Math.sqrt(rng.float()) * region.r * 0.85;
    const c = { x: Math.round(region.x + Math.cos(ang) * rad), y: Math.round(region.y + Math.sin(ang) * rad) };
    const d = others.reduce((m, o) => Math.min(m, Math.hypot(o.x - c.x, o.y - c.y)), Infinity);
    if (d > bestD) {
      bestD = d;
      best = c;
    }
    if (d > 14) break;
  }
  return best;
}

export function islandRoom(game: Game, id: string): Room | null {
  const existing = game.rooms.get(id);
  if (existing) return existing;
  const rec = game.store.islands.get(id);
  if (!rec) return null;
  const owner = game.store.players.get(rec.ownerId);
  migrateIsland(rec);
  const room = new Room({
    id: rec.id, kind: 'island', name: rec.name, biome: rec.biome, ownerId: rec.ownerId, ownerName: owner?.name ?? null,
    geo: owner?.geo ?? { lat: 47, lon: 8, tz: 'UTC' }, seed: rec.seed, record: rec, elevation: (rec.gen ?? 1) >= 2, size: rec.size ?? LEGACY_ISLAND_SIZE,
  });
  room.onBuildingComplete = (r, b) => buildingCompleted(game, r, b);
  room.onHouseUpgraded = (r, b) => houseUpgraded(game, r, b);
  game.rooms.set(id, room);
  // Catch up on everything that happened while nobody was here.
  room.slowTick(Date.now());
  return room;
}

/** The inside of a building. Shares the island record (villagers, furniture in your home). */
export function interiorRoom(game: Game, parent: Room, b: Building): Room | null {
  const id = `${parent.id}~${b.id}`;
  const existing = game.rooms.get(id);
  const villager = b.villagerId ? villagerDef(b.villagerId) : undefined;
  const level = b.type === 'cabin' ? houseLevel(b, Date.now()) : 1;
  if (existing && existing.interior?.spec.style === 'cabin' && (existing.interior.spec.level ?? 1) !== level && existing.sessions.size === 0) {
    // The house was upgraded: rebuild the (bigger) interior, keeping the furniture.
    if (existing.syncRecord()) game.store.markIsland(parent.id);
    game.rooms.delete(id);
  } else if (existing) {
    syncVillagerAtHome(game, parent, existing, b);
    return existing;
  }
  const spec = interiorSpecFor(b.type, b.id, villager, level);
  if (!spec) return null;
  const houseOwnerId = b.ownerId ?? parent.ownerId ?? undefined;
  const owner = (b.ownerId ? game.store.players.get(b.ownerId)?.name : parent.ownerName) ?? 'Someone';
  const name =
    spec.style === 'tent' ? `${owner}\u2019s tent`
    : spec.style === 'cabin' ? `${owner}\u2019s house`
    : spec.style === 'villager' ? `${villager?.name ?? 'A villager'}\u2019s house`
    : spec.style === 'shack' ? 'Fisher\u2019s cottage'
    : BUILDINGS[b.type].name;
  const room = new Room({
    id, kind: 'interior', name, biome: parent.biome,
    ownerId: parent.ownerId, ownerName: parent.ownerName, geo: parent.geo, seed: parent.seed, record: parent.record,
    interior: { spec, buildingId: b.id, parentId: parent.id, houseOwnerId },
  });
  game.rooms.set(id, room);
  syncVillagerAtHome(game, parent, room, b);
  return room;
}

/** Rooms belonging to an island: the island itself and its interiors. */
export function islandRooms(game: Game, id: string) {
  return [...game.rooms.values()].filter((r) => r.id === id || r.id.startsWith(`${id}~`));
}

/** Copy the live state of a loaded island (and its interiors) into its record. */
export function syncIsland(game: Game, id: string) {
  for (const r of islandRooms(game, id)) r.syncRecord(true);
}

/**
 * Throw away the loaded rooms of an island and rebuild them from the record
 * (after an admin edit). Everyone inside lands back on the fresh island.
 */
export function reloadIsland(game: Game, id: string) {
  const rooms = islandRooms(game, id);
  if (!rooms.length) return;
  const moving: { s: Session; at?: { x: number; z: number; r: number } }[] = [];
  for (const r of rooms) {
    for (const s of r.sessions) moving.push({ s, at: r.id === id ? { x: s.x, z: s.z, r: s.r } : undefined });
    game.rooms.delete(r.id);
  }
  const fresh = islandRoom(game, id);
  for (const { s, at } of moving) {
    if (!fresh) {
      travel(game, s, { kind: 'home' });
      continue;
    }
    moveToRoom(game, s, fresh, at && fresh.grid.walkable(at.x, at.z) ? at : undefined);
    s.send({ t: 'toast', text: 'This island was updated by an admin.', kind: 'info' });
  }
}

export function sharedRoom(game: Game, id: string): Room | null {
  const key = `shared_${id}`;
  const existing = game.rooms.get(key);
  if (existing) return existing;
  const loc = sharedLocation(id);
  if (!loc) return null;
  const design = id === 'harbor' ? 'harbor' : id === 'aurora' ? 'aurora' : undefined;
  const room = new Room({ id: key, kind: 'shared', name: loc.name, biome: loc.biome, ownerId: null, ownerName: null, geo: loc.geo, seed: hashString(key), design });
  if ([...room.buildings.values()].some((b) => b.type === 'billboard')) room.board = game.store.boards[key] ??= [];
  room.slowTick(Date.now());
  game.rooms.set(key, room);
  return room;
}

/** Villagers are at home (inside) at night – you can visit them there. */
export function syncVillagerAtHome(game: Game, parent: Room, inside: Room, b: Building) {
  if (!b.villagerId) return;
  const outside = parent.villagers.get(b.villagerId);
  const home = !!outside?.home;
  const present = inside.villagers.has(b.villagerId);
  if (home && !present) {
    const v = inside.spawnVillager(b.villagerId, b.id);
    const mid = inside.layout.size / 2;
    v.x = v.tx = mid + 1.2;
    v.z = v.tz = mid - 0.5;
    v.r = 0;
    inside.broadcast({ t: 'vAdd', v: [inside.villagerView(v)] });
    if (inside.sessions.size) inside.broadcast({ t: 'chat', from: '', name: '', text: `${villagerDef(b.villagerId)?.name ?? 'Someone'} came home.`, sys: true });
  } else if (!home && present) {
    const v = inside.villagers.get(b.villagerId)!;
    inside.broadcast({ t: 'vs', l: [[v.id, v.x, v.z, v.r, 1]] }); // hides them on clients
    inside.removeVillager(b.villagerId);
    inside.broadcast({ t: 'chat', from: '', name: '', text: `${villagerDef(b.villagerId)?.name ?? 'They'} headed out for the day.`, sys: true });
  }
}
