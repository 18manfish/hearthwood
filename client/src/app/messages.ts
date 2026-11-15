// Server messages that update the client state, the HUD or the world.

import { BIOMES, type RoomView, type ServerMessage } from '@hearthwood/shared';
import { net } from '../net.ts';
import { set, state } from '../state.ts';
import { showCreator, showRecreate } from '../ui/creator.ts';
import { game, app, startGame, statusScreen } from './session.ts';
import { fishBite, fishResult } from '../audio/actions.ts';
import { hideLoading, loadingAwaitsRoom, loadingStep, loadingVisible, roomArrived, showLoading } from '../ui/loading.ts';

let roomSeq = 0;
/** World updates that arrive while a new room is still being set up; replayed once it's loaded. */
let held: ServerMessage[] | null = null;

function toWorld(m: ServerMessage) {
  if (held) held.push(m);
  else game.world?.handle(m);
}
const islandOf = (id: string) => id.split('~')[0];
const nextFrame = () => new Promise((res) => requestAnimationFrame(() => res(null)));

/** What the loading screen says while you arrive somewhere. */
function arrival(room: RoomView, door?: string): [string, string] {
  const biome = BIOMES[room.biome]?.name ?? '';
  if (room.kind === 'tour') return [room.name, 'Mystery tour'];
  if (room.kind === 'shared') return [room.name, biome];
  if (room.kind === 'interior') return [room.name, ''];
  const mine = room.ownerId === state.self?.id;
  const whose = mine ? 'Your island' : room.ownerName ? `${room.ownerName}’s island` : '';
  const home = door ? room.buildings.find((b) => b.id === door) : undefined;
  const sub = home ? `Stepping out of your ${home.type === 'tent' ? 'tent' : 'house'}…` : [whose, biome].filter(Boolean).join(' · ');
  return [room.name, sub];
}

/**
 * A new room from the server. Moving to another island (or arriving for the first
 * time) goes through the loading screen: it's painted first, then the island is
 * built behind it, textures and shaders warmed up, and it fades away. Going in and
 * out of buildings on the same island stays instant.
 */
async function enterRoom(m: Extract<ServerMessage, { t: 'room' }>) {
  const seq = ++roomSeq;
  roomArrived();
  const prev = state.room;
  const travelled = !prev || islandOf(prev.id) !== islandOf(m.room.id) || loadingVisible();
  if (travelled) {
    const [title, sub] = arrival(m.room, m.door);
    showLoading(title, sub);
    loadingStep('Building the island…', 0.25);
    if (game.world) game.world.hold = true;
    held = []; // anything queued for a room we never finished entering is stale
    await nextFrame(); // let the loading screen paint before the heavy work
    await nextFrame();
    if (seq !== roomSeq) return; // another room arrived meanwhile
  }
  startGame();
  state.env = m.env;
  set('room', m.room);
  const world = game.world!;
  world.hold = travelled;
  world.load(m.room);
  if (m.door) world.stepOut(m.door);
  const backlog = held ?? [];
  held = null;
  for (const x of backlog) world.handle(x);
  game.hud!.close();
  game.hud!.closeDialog();
  if (!travelled) return;
  await world.warmUp(loadingStep);
  if (seq !== roomSeq) return;
  world.hold = false;
  await hideLoading();
}

export function bindMessages() {
  net.on((m: ServerMessage) => {
    switch (m.t) {
      case 'welcome':
        set('dev', m.dev);
        if (!m.you && m.recreate) {
          // New character model: redo your looks, then on to your island.
          if (game.creating) return;
          game.creating = true;
          showRecreate(app, m.recreate, (r) => {
            statusScreen('Back to your island…');
            net.send({ t: 'recreate', ...r });
          });
          return;
        }
        if (!m.you) {
          if (game.creating) return;
          game.creating = true;
          showCreator(app, (r) => {
            statusScreen('Sailing to your new island…');
            net.send({ t: 'create', ...r });
          });
          return;
        }
        game.creating = false;
        set('self', m.you);
        set('inv', m.you.inv);
        set('coins', m.you.coins);
        set('album', m.you.album);
        startGame();
        return;
      case 'self':
        set('self', m.you);
        set('coins', m.you.coins);
        return;
      case 'album':
        set('album', m.album);
        return;
      case 'inv':
        set('coins', m.coins);
        set('inv', m.inv);
        return;
      case 'friends':
        state.incoming = m.incoming;
        state.outgoing = m.outgoing;
        set('friends', m.list);
        set('incoming', m.incoming);
        return;
      case 'mail':
        set('mail', m.list);
        return;
      case 'quest':
        set('quest', m.q);
        return;
      case 'map':
        set('map', m.islands);
        return;
      case 'room':
        void enterRoom(m);
        return;
      case 'board':
        toWorld(m);
        if (state.room) set('room', state.room); // refresh an open billboard panel
        return;
      case 'env':
        set('env', m.env);
        toWorld(m);
        return;
      case 'toast':
        if (m.kind === 'warn' && loadingAwaitsRoom()) void hideLoading(true); // the trip was refused
        game.hud?.toast(m.text, m.kind);
        return;
      case 'chat':
        game.hud?.chat(m.name, m.text, m.sys);
        return;
      case 'talk':
        game.hud?.onTalk(m.v);
        toWorld(m);
        return;
      case 'fish':
        fishResult(m.ok);
        toWorld(m);
        if (!m.ok) game.hud?.toast(m.msg, 'warn');
        else game.hud?.toast(`🎣 ${m.msg}`, 'good');
        return;
      case 'bite':
        fishBite();
        if (game.world?.cast && !game.world.cast.id) game.world.cast.id = m.castId;
        toWorld(m);
        game.hud?.setPrompt('❗ Reel in!', true);
        return;
      case 'err':
        if (m.code === 'bad_message' || m.code === 'server') console.warn('[server]', m.msg);
        if (['auth', 'register', 'banned', 'kicked'].includes(m.code)) return; // handled by net.onAuth / onStatus
        if (loadingAwaitsRoom()) void hideLoading(true);
        if (!game.world) statusScreen(m.msg);
        else game.hud?.toast(m.msg, 'warn');
        return;
      default:
        toWorld(m);
    }
  });
}
