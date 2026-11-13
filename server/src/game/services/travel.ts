// Getting around: who may visit which island, travelling between rooms and islands,
// the world map, and validating every movement step.

import {
  atDoor, BIOME_IDS, BIOMES, ENTERABLE, hashString, type MapIsland, MYSTERY_TOUR_COST, nearBuilding, type TravelTarget, villagerDef, wrapAngle,
} from '@hearthwood/shared';
import crypto from 'node:crypto';
import { config } from '../../config.ts';
import { logger } from '../../log.ts';
import { Room } from '../Room.ts';
import { Session } from '../Session.ts';
import type { IslandRecord, PlayerRecord } from '../../types.ts';
import type { Game } from '../Game.ts';
import { sendQuest } from './progress.ts';
import { interiorRoom, islandRoom, sharedRoom } from './rooms.ts';
import { chat } from './social.ts';
import { sendInv } from './views.ts';

const log = logger('game');

export function enterIsland(game: Game, s: Session, islandId: string) {
  const room = islandRoom(game, islandId);
  if (!room) return s.send({ t: 'err', code: 'no_island', msg: 'Island not found.' });
  moveToRoom(game, s, room);
}

export function moveToRoom(game: Game, s: Session, room: Room, at?: { x: number; z: number; r?: number }) {
  const from = s.room;
  s.room?.leave(s);
  room.join(s, at);
  log.debug('entered room', { player: s.player!.id, room: room.id, from: from?.id });
  if (room.kind === 'island' && room.ownerId !== s.player!.id && from?.interior?.parentId !== room.id) {
    room.broadcast({ t: 'chat', from: '', name: '', text: `${s.player!.name} is visiting!`, sys: true }, s);
  }
  sendQuest(game, s);
}

export function canVisit(game: Game, p: PlayerRecord, isl: IslandRecord, viaCode: boolean, s?: Session): boolean {
  if (isl.ownerId === p.id) return true;
  if (isl.residents?.includes(p.id) || isl.builders?.includes(p.id)) return true;
  if (isl.access === 'private') return false;
  const owner = game.store.players.get(isl.ownerId);
  const friend = !!owner?.friends.includes(p.id);
  if (isl.access === 'public') return true;
  if (friend) return true; // friends may visit unless private
  if (isl.access === 'invite') return viaCode || !!s?.inviteGrants.has(isl.id);
  return false;
}

export function travel(game: Game, s: Session, to: TravelTarget): void {
  const p = s.player!;
  switch (to.kind) {
    case 'enter': {
      const room = s.room;
      const b = room?.buildings.get(to.id);
      if (!room || (room.kind !== 'island' && room.kind !== 'shared') || !b || !ENTERABLE.includes(b.type)) return s.send({ t: 'toast', text: 'You can\u2019t go in there.', kind: 'warn' });
      if (b.completeAt > Date.now()) return s.send({ t: 'toast', text: 'It\u2019s still being built.', kind: 'warn' });
      if (!atDoor(b, s.x, s.z)) return s.send({ t: 'toast', text: 'Stand in front of the door to go in.', kind: 'warn' });
      const inside = interiorRoom(game, room, b);
      if (!inside) return s.send({ t: 'toast', text: 'It\u2019s locked.', kind: 'warn' });
      if (b.villagerId && !inside.villagers.has(b.villagerId)) s.send({ t: 'toast', text: `${villagerDef(b.villagerId)?.name ?? 'They'} is out and about – they’re home from 19:00 to 07:00.`, kind: 'info' });
      return moveToRoom(game, s, inside);
    }
    case 'exit': {
      const room = s.room;
      if (!room?.interior) return;
      const pid = room.interior.parentId;
      const parent = game.rooms.get(pid) ?? (pid.startsWith('shared_') ? sharedRoom(game, pid.slice(7)) : islandRoom(game, pid));
      if (!parent) return travel(game, s, { kind: 'home' });
      const b = parent.buildings.get(room.interior.buildingId);
      const at = b ? { x: b.x + b.w / 2, z: b.z + b.h + 0.45, r: 0 } : undefined;
      return moveToRoom(game, s, parent, at);
    }
    case 'home':
      return enterIsland(game, s, p.homeIslandId!);
    case 'shared': {
      const room = sharedRoom(game, to.id);
      if (!room) return s.send({ t: 'toast', text: 'Unknown destination.', kind: 'warn' });
      return moveToRoom(game, s, room);
    }
    case 'island':
    case 'code': {
      const isl = to.kind === 'island' ? game.store.islands.get(to.id) : game.store.islandByInvite(to.code);
      if (!isl) return s.send({ t: 'toast', text: to.kind === 'code' ? 'No island has that invite code.' : 'Island not found.', kind: 'warn' });
      if (!canVisit(game, p, isl, to.kind === 'code', s)) return s.send({ t: 'toast', text: `${isl.name} isn’t open to you right now.`, kind: 'warn' });
      if (to.kind === 'code') s.inviteGrants.add(isl.id);
      return enterIsland(game, s, isl.id);
    }
    case 'tour': {
      const home = islandRoom(game, p.homeIslandId!);
      if (!home || home.completedCount('travel_agent') < 1) return s.send({ t: 'toast', text: 'Build a Travel Agent to book mystery tours.', kind: 'warn' });
      const here = s.room;
      const atAgent = here?.interior?.parentId === home.id && [...here.buildings.values()].some((b) => b.role === 'travel_agent' && nearBuilding(b, s.x, s.z, config.buildingReach));
      if (!atAgent) return s.send({ t: 'toast', text: 'Book tours at the counter inside your Travel Agent.', kind: 'warn' });
      if (p.coins < MYSTERY_TOUR_COST) return s.send({ t: 'toast', text: `A tour costs ${MYSTERY_TOUR_COST} coins.`, kind: 'warn' });
      p.coins -= MYSTERY_TOUR_COST;
      sendInv(game, s);
      const biome = BIOME_IDS[crypto.randomInt(0, BIOME_IDS.length)];
      const id = `tour_${p.id}_${Date.now().toString(36)}`;
      const room = new Room({ id, kind: 'tour', name: `Mystery ${BIOMES[biome].name}`, biome, ownerId: p.id, ownerName: p.name, geo: p.geo, seed: hashString(id), elevation: true });
      room.slowTick(Date.now());
      game.rooms.set(id, room);
      s.send({ t: 'toast', text: `Welcome to a mystery ${BIOMES[biome].name}! Gather all you like.`, kind: 'good' });
      return moveToRoom(game, s, room);
    }
  }
}

export function homeIsland(game: Game, p: PlayerRecord) {
  return p.homeIslandId ? game.store.islands.get(p.homeIslandId) : undefined;
}

export function mapFor(game: Game, p: PlayerRecord): MapIsland[] {
  const out: MapIsland[] = [];
  for (const isl of game.store.islands.values()) {
    const mine = isl.ownerId === p.id;
    const owner = game.store.players.get(isl.ownerId);
    if (!owner) continue;
    const helps = !!(isl.residents?.includes(p.id) || isl.builders?.includes(p.id));
    const friend = owner.friends.includes(p.id) || helps;
    const visible = mine || helps || isl.access === 'public' || (friend && isl.access !== 'private');
    if (!visible) continue;
    const room = game.rooms.get(isl.id);
    out.push({
      id: isl.id, name: isl.name, owner: owner.name, biome: isl.biome, x: isl.map.x, y: isl.map.y, access: isl.access,
      friend, mine, online: game.online.has(owner.id), visitors: room ? room.sessions.size : 0,
    });
    if (out.length > 300) break;
  }
  return out;
}

export function move(game: Game, s: Session, x: number, z: number, r: number) {
  const room = s.room;
  if (!room) return;
  const now = Date.now();
  const dt = Math.min(1, Math.max(0.05, (now - s.lastMoveAt) / 1000));
  const dist = Math.hypot(x - s.x, z - s.z);
  const maxDist = config.playerSpeed * dt * config.moveTolerance + 0.2;
  let ok = dist <= maxDist && room.grid.walkable(x, z);
  // Walk the path in small steps so nobody tunnels through obstacles or climbs cliffs.
  if (ok) {
    const steps = Math.max(1, Math.ceil(dist / 0.25));
    let px = s.x, pz = s.z;
    for (let i = 1; i <= steps && ok; i++) {
      const t = i / steps;
      const nx = s.x + (x - s.x) * t, nz = s.z + (z - s.z) * t;
      ok = room.grid.canMove(px, pz, nx, nz, i === steps ? 0.2 : 0.12);
      px = nx;
      pz = nz;
    }
  }
  s.lastMoveAt = now;
  if (!ok) {
    s.send({ t: 'corr', x: s.x, z: s.z });
    return;
  }
  if (dist > 0.0001 || Math.abs(r - s.r) > 0.01) {
    s.x = x;
    s.z = z;
    s.r = wrapAngle(r);
    s.moved = true;
  }
}
