// What players see of themselves and others: self, inventory, looks, letters, the album,
// and the admin view of an island.

import {
  type Album, DEFAULT_HOTBAR, encodeTiles, LEGACY_ISLAND_SIZE, normalizeHotbar, type SelfView,
  isTransient,
} from '@hearthwood/shared';
import { Room } from '../Room.ts';
import { Session } from '../Session.ts';
import type { IslandRecord, PlayerRecord } from '../../types.ts';
import type { Game } from '../Game.ts';
import { isAdmin } from './accounts.ts';
import { sendQuest } from './progress.ts';
import { homeIsland } from './travel.ts';

/** The player's album (created on first use). */
export function albumOf(p: PlayerRecord): Album {
  return (p.album ??= { fish: {}, birds: {} });
}

export function selfView(game: Game, p: PlayerRecord): SelfView {
  const isl = homeIsland(game, p);
  return {
    id: p.id, name: p.name, code: p.code, gender: p.gender, look: p.look, hat: p.hat,
    homeIslandId: p.homeIslandId, islandName: isl?.name ?? null, biome: isl?.biome ?? null,
    access: isl?.access ?? 'friends', inviteCode: isl?.inviteCode ?? null, coins: p.coins, inv: p.inv,
    permits: p.permits ?? [], hotbar: normalizeHotbar(p.hotbar ?? DEFAULT_HOTBAR), album: albumOf(p),
    username: p.username ?? null, admin: isAdmin(game, p), geo: p.geo,
    islandRoles: isl ? Object.fromEntries([...(isl.builders ?? []).map((id) => [id, 'builder'] as const), ...(isl.residents ?? []).map((id) => [id, 'resident'] as const)]) : {},
    helping: [...game.store.islands.values()]
      .filter((i) => i.residents?.includes(p.id) || i.builders?.includes(p.id))
      .map((i) => ({ id: i.id, name: i.name, owner: game.store.players.get(i.ownerId)?.name ?? '?', role: i.residents?.includes(p.id) ? 'resident' as const : 'builder' as const })),
  };
}

export function sendSelf(game: Game, s: Session) {
  s.send({ t: 'self', you: selfView(game, s.player!) });
}

export function sendInv(game: Game, s: Session) {
  s.send({ t: 'inv', inv: s.player!.inv, coins: s.player!.coins });
}

export function broadcastLook(game: Game, s: Session) {
  const p = s.player!;
  s.room?.broadcast({ t: 'pLook', id: p.id, look: p.look, hat: p.hat });
}

export function notifyMail(game: Game, playerId: string) {
  const s = game.online.get(playerId);
  if (!s) return;
  s.send({ t: 'mail', list: s.player!.mail });
  s.send({ t: 'toast', text: 'You’ve got mail! 📬', kind: 'good' });
}

/** What the admin map needs: the record plus the terrain as the game sees it. */
export function adminIslandView(game: Game, rec: IslandRecord) {
  const live = game.rooms.get(rec.id);
  const room = live ?? new Room({
    id: rec.id, kind: 'island', name: rec.name, biome: rec.biome, ownerId: rec.ownerId, ownerName: null,
    geo: { lat: 47, lon: 8, tz: 'UTC' }, seed: rec.seed, record: rec, elevation: (rec.gen ?? 1) >= 2, size: rec.size ?? LEGACY_ISLAND_SIZE,
  });
  const g = room.grid;
  const owner = game.store.players.get(rec.ownerId);
  return {
    record: { ...rec, objects: live ? [...live.objects.values()].filter((o) => !isTransient(o)) : rec.objects, buildings: live ? [...live.buildings.values()] : rec.buildings },
    owner: owner ? { id: owner.id, name: owner.name, username: owner.username ?? null } : null,
    size: g.size,
    tiles: encodeTiles(g.tiles), levels: encodeTiles(g.levels), ramps: encodeTiles(g.ramps), paths: encodeTiles(g.paths),
    spawn: room.layout.spawn,
    loaded: !!live,
    players: live ? [...live.sessions].map((s) => ({ id: s.player!.id, name: s.player!.name, x: s.x, z: s.z })) : [],
    villagers: [...room.villagers.values()].map((v) => ({ id: v.id, x: v.x, z: v.z, home: room.villagerView(v).home })),
    birds: live ? [...live.objects.values()].filter((o) => o.kind === 'bird') : [],
  };
}

/** Re-send a player's own state after an admin edit. */
export function refreshPlayer(game: Game, id: string) {
  const s = game.online.get(id);
  if (!s?.player) return;
  sendSelf(game, s);
  sendInv(game, s);
  sendQuest(game, s);
  s.send({ t: 'album', album: albumOf(s.player) });
}
