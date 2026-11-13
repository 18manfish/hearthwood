// Progress: quests and chapters, buildings finishing, villager friendship levels.

import {
  type Building, BUILDINGS, chapterDone, tiersOf, buildingTier, CHAPTERS, friendshipLevel, goalDone, hashString, ITEMS, type ProgressInput, type QuestView, Rng, villagerDef, VILLAGERS,
} from '@hearthwood/shared';
import { logger } from '../../log.ts';
import { Room } from '../Room.ts';
import { Session } from '../Session.ts';
import * as inv from '../inventory.ts';
import type { Friendship, PlayerRecord } from '../../types.ts';
import type { Game } from '../Game.ts';
import { islandRoom } from './rooms.ts';
import { sendInv, sendSelf } from './views.ts';

const log = logger('game');

export function afterAction(game: Game, s: Session, kind: string) {
  const p = s.player!;
  game.store.markPlayer(p.id);
  if (s.room?.record) game.store.markIsland(s.room.id);
  sendInv(game, s);
  if (kind === 'craft' || kind === 'build' || kind === 'demolish') sendQuest(game, s);
  if (kind === 'wear' || kind === 'restyle') sendSelf(game, s);
}

/** A finished house upgrade: tell the owner, refresh their upgrade panel. */
export function houseUpgraded(game: Game, room: Room, b: Building) {
  const ownerId = b.type === 'cabin' ? b.ownerId ?? room.ownerId : room.ownerId;
  const tier = buildingTier(b, Date.now());
  log.info('building upgraded', { island: room.id, building: b.id, type: b.type, level: b.level });
  game.store.markIsland(room.id);
  const s = ownerId ? game.online.get(ownerId) : undefined;
  if (s && tier) {
    const whose = b.type === 'villager_house' && b.villagerId ? `${villagerDef(b.villagerId)?.name ?? 'Your villager'}’s` : 'Your';
    s.send({ t: 'toast', text: `${tier.icon} ${whose} ${tier.name} is finished!`, kind: 'good' });
    sendQuest(game, s);
  }
  if (b.type !== 'cabin') room.broadcast({ t: 'chat', from: '', name: '', text: `🏗️ The builders are done: there's a new ${tier?.name ?? BUILDINGS[b.type].name} on the island!`, sys: true });
}

/** A player's own Starter House on an island room. */
export function ownHouse(room: Room, playerId: string): Building | undefined {
  for (const b of room.buildings.values()) if (b.type === 'cabin' && (b.ownerId ?? room.ownerId) === playerId) return b;
  return undefined;
}

export function buildingCompleted(game: Game, room: Room, b: Building) {
  log.info('building completed', { island: room.id, building: b.type, id: b.id });
  const owner = room.ownerId ? game.online.get(room.ownerId) : undefined;
  if (b.type === 'villager_house' && !b.villagerId && room.record) {
    const taken = new Set(room.record.villagers.map((v) => v.defId));
    const candidates = VILLAGERS.filter((v) => !taken.has(v.id));
    if (!candidates.length) return;
    const def = new Rng(hashString(b.id + room.id)).pick(candidates);
    b.villagerId = def.id;
    room.record.villagers.push({ defId: def.id, houseId: b.id, movedInAt: Date.now(), friendship: {} });
    const v = room.spawnVillager(def.id, b.id);
    room.broadcast({ t: 'bAdd', b: [b] });
    room.broadcast({ t: 'vAdd', v: [room.villagerView(v)] });
    room.broadcast({ t: 'chat', from: '', name: '', text: `${def.name} the ${def.species} moved in! Say hi!`, sys: true });
    room.dirty = true;
    game.store.markIsland(room.id);
  } else if (b.completeAt > 0) {
    room.broadcast({ t: 'bAdd', b: [b] });
    if (owner?.room === room && BUILDINGS[b.type].buildMinutes > 0) owner.send({ t: 'toast', text: `${BUILDINGS[b.type].name} is finished!`, kind: 'good' });
  }
  if (owner) sendQuest(game, owner);
}

export function levelUpCheck(game: Game, s: Session, room: Room, defId: string, f: Friendship) {
  const lvl = friendshipLevel(f.pts).level;
  const prev = f.level ?? 0;
  if (lvl <= prev) return;
  f.level = lvl;
  const def = villagerDef(defId)!;
  const rewards = ['flower_pot', 'bench', 'lamp', 'picnic_table', 'gnome'];
  const it = rewards[Math.min(lvl, rewards.length) - 1];
  if (it && inv.add(s.player!, it, 1)) {
    s.send({ t: 'toast', text: `${def.name} is now your ${friendshipLevel(f.pts).name}! They gave you a ${ITEMS[it].name}.`, kind: 'good' });
  }
}

export function progress(game: Game, p: PlayerRecord): ProgressInput & { day: number } {
  const room = p.homeIslandId ? islandRoom(game, p.homeIslandId) : null;
  const built: ProgressInput['built'] = {};
  let villagers = 0;
  let day = 1;
  if (room) {
    const now = Date.now();
    for (const b of room.buildings.values()) if (b.completeAt <= now) built[b.type] = (built[b.type] ?? 0) + 1;
    villagers = room.villagers.size;
    day = room.islandDay(now);
  }
  return { crafted: p.crafted, built, villagers, day };
}

export function sendQuest(game: Game, s: Session) {
  const p = s.player!;
  const prog = progress(game, p);
  // Pay out rewards for every completed chapter, in order.
  let chapter = 1;
  for (const c of CHAPTERS) {
    if (!chapterDone(c, prog)) break;
    if (p.chapterRewarded < c.id) {
      p.chapterRewarded = c.id;
      p.coins += c.reward.coins;
      for (const [id, n] of Object.entries(c.reward.items ?? {})) inv.add(p, id, n);
      s.send({ t: 'toast', text: `Chapter complete: ${c.title}! +${c.reward.coins} coins`, kind: 'good' });
      game.store.markPlayer(p.id);
      sendInv(game, s);
    }
    chapter = c.id + 1;
  }
  const cur = CHAPTERS[chapter - 1];
  const q: QuestView = { chapter, done: cur ? cur.goals.map((g) => goalDone(g, prog)) : [], islandDay: prog.day, villagers: prog.villagers };
  const isl = s.room?.kind === 'island' ? s.room : s.room?.interior ? game.rooms.get(s.room.interior.parentId) : undefined;
  const house = isl && isl.ownsHere(p.id) ? ownHouse(isl, p.id) : undefined;
  if (house && house.completeAt <= Date.now()) q.house = { level: house.level ?? 1, upgrade: house.upgrade };
  if (isl && isl.isOwner(p.id)) {
    q.upgrades = [...isl.buildings.values()]
      .filter((b) => b.type !== 'cabin' && tiersOf(b.type).length && b.completeAt <= Date.now())
      .map((b) => ({ id: b.id, type: b.type, level: b.level ?? 1, upgrade: b.upgrade, villagerId: b.villagerId }));
  }
  s.send({ t: 'quest', q });
}
