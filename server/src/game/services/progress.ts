// Progress: quests and chapters, buildings finishing, villager friendship levels.

import {
  type Building, BUILDINGS, chapterDone, CHAPTERS, friendshipLevel, goalDone, hashString, ITEMS, type ProgressInput, type QuestView, Rng, villagerDef, VILLAGERS,
} from '@hearthwood/shared';
import { logger } from '../../log.ts';
import { Room } from '../Room.ts';
import { Session } from '../Session.ts';
import * as inv from '../inventory.ts';
import type { Friendship, PlayerRecord } from '../../types.ts';
import type { Game } from '../Game.ts';
import { islandRoom } from './rooms.ts';
import { chat } from './social.ts';
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
  s.send({ t: 'quest', q });
}
