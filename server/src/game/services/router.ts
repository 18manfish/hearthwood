// Connections: a socket becomes a session; client messages are parsed and routed to
// the services (after the hello and character checks).

import {
  type ClientMessage, clientMessageParser, normalizeHotbar, parse, SchemaError,
} from '@hearthwood/shared';
import type { WebSocket } from 'ws';
import { config } from '../../config.ts';
import { logger } from '../../log.ts';
import { Session } from '../Session.ts';
import { runAction } from '../actions/index.ts';
import type { PlayerRecord } from '../../types.ts';
import type { Game } from '../Game.ts';
import { createCharacter, hello, kick, uniqueCode } from './accounts.ts';
import { devCommand } from './dev.ts';
import { afterAction } from './progress.ts';
import { setGeo, setRole } from './roles.ts';
import { boardOp, chat, friendOp, pushFriendsToFriendsOf } from './social.ts';
import { homeIsland, mapFor, move, travel } from './travel.ts';
import { sendSelf } from './views.ts';

const log = logger('game');

export function accessLabel(a: string) {
  return ({ private: 'Nobody', friends: 'Friends only', invite: 'Friends + invite code', public: 'Everyone' } as Record<string, string>)[a] ?? a;
}

export function handleConnection(game: Game, ws: WebSocket, ip: string) {
  const s = new Session(ws, ip);
  log.debug('socket opened', { ip });
  const helloTimer = setTimeout(() => {
    if (!s.player) {
      log.info('hello timeout', { ip });
      ws.close(4001, 'hello timeout');
    }
  }, config.helloTimeoutMs);

  ws.on('pong', () => (s.alive = true));
  const hb = setInterval(() => {
    if (!s.alive) {
      log.info('heartbeat lost', { player: s.player?.id, ip });
      return ws.terminate();
    }
    s.alive = false;
    ws.ping();
  }, config.heartbeatMs);

  ws.on('message', (data, isBinary) => {
    if (isBinary) return s.strike();
    if (!s.allowMessage()) return;
    let msg: ClientMessage;
    try {
      msg = parse(clientMessageParser, JSON.parse(data.toString()));
    } catch (e) {
      s.strike();
      log.warn('rejected message', { player: s.player?.id, ip, reason: e instanceof SchemaError ? e.message : 'malformed JSON' });
      s.send({ t: 'err', code: 'bad_message', msg: e instanceof SchemaError ? e.message : 'Malformed message' });
      return;
    }
    try {
      onMessage(game, s, msg);
    } catch (e) {
      log.error('handler error', { player: s.player?.id, type: msg.t, err: e });
      s.send({ t: 'err', code: 'server', msg: 'Something went wrong.' });
    }
  });

  ws.on('close', (code, reason) => {
    log.info('disconnected', { player: s.player?.id, name: s.player?.name, ip, code, reason: reason.toString() || undefined });
    clearTimeout(helloTimer);
    clearInterval(hb);
    disconnect(game, s);
  });
}

export function disconnect(game: Game, s: Session) {
  s.clearCast();
  s.room?.leave(s);
  if (s.player && game.online.get(s.player.id) === s) {
    game.online.delete(s.player.id);
    s.player.lastSeen = Date.now();
    game.store.markPlayer(s.player.id);
    pushFriendsToFriendsOf(game, s.player);
  }
}

export function onMessage(game: Game, s: Session, m: ClientMessage) {
  if (m.t === 'ping') return s.send({ t: 'pong', ct: m.ct, st: Date.now() });
  if (m.t === 'hello') return hello(game, s, m.token, m.v);
  const p = s.player;
  if (!p) return s.send({ t: 'err', code: 'auth', msg: 'Say hello first.' });
  if (m.t === 'create') return createCharacter(game, s, m);
  if (!p.created) return s.send({ t: 'err', code: 'no_character', msg: 'Create your character first.' });

  const route = ROUTES[m.t as Routed] as ((game: Game, s: Session, m: ClientMessage, p: PlayerRecord) => void) | undefined;
  route?.(game, s, m, p);
}

/** Messages handled once the player has said hello and has a character. */
type Routed = Exclude<ClientMessage['t'], 'ping' | 'hello' | 'create'>;

const ROUTES: { [T in Routed]: (game: Game, s: Session, m: Extract<ClientMessage, { t: T }>, p: PlayerRecord) => void } = {
  move: (game, s, m) => move(game, s, m.x, m.z, m.r),
  act(game, s, m, p) {
    const res = runAction(game, s, m.a);
    if (!res.ok) log.debug('action refused', { player: p.id, action: m.a.k, err: res.err });
    s.send({ t: 'res', seq: m.seq, ...res });
    if (res.ok) afterAction(game, s, m.a.k);
  },
  travel: (game, s, m) => travel(game, s, m.to),
  chat: (game, s, m) => chat(game, s, m.text),
  friend: (game, s, m) => friendOp(game, s, m.op, m.code, m.id),
  access(game, s, m, p) {
    const isl = homeIsland(game, p);
    if (!isl) return;
    isl.access = m.access;
    game.store.markIsland(isl.id);
    sendSelf(game, s);
    s.send({ t: 'toast', text: `Visitors: ${accessLabel(m.access)}`, kind: 'good' });
  },
  newInvite(game, s, _m, p) {
    const isl = homeIsland(game, p);
    if (!isl) return;
    game.store.setInviteCode(isl, uniqueCode(game, 8));
    sendSelf(game, s);
  },
  kick(game, s, m, p) {
    const room = s.room;
    const target = game.online.get(m.id);
    if (!room || !room.isOwner(p.id) || room.kind !== 'island' || !target || target.room !== room || target === s) return;
    if (room.isResident(m.id)) return s.send({ t: 'toast', text: 'Residents live here – remove their residency first.', kind: 'warn' });
    log.info('visitor sent home', { owner: p.id, visitor: m.id, room: room.id });
    target.send({ t: 'toast', text: `${p.name} sent you home.`, kind: 'warn' });
    travel(game, target, { kind: 'home' });
  },
  map: (_game, s, _m, p) => s.send({ t: 'map', islands: mapFor(_game, p) }),
  role: (game, s, m) => setRole(game, s, m.id, m.role),
  geo: (game, s, m) => setGeo(game, s, m.lat, m.lon, m.tz),
  hotbar(game, _s, m, p) {
    p.hotbar = normalizeHotbar(m.slots);
    game.store.markPlayer(p.id);
  },
  board: (game, s, m) => boardOp(game, s, m.op, m.text, m.id),
  dev(game, s, m) {
    if (!config.devFast) return s.send({ t: 'toast', text: 'Dev commands need the server in dev mode (npm run dev:fast).', kind: 'warn' });
    return devCommand(game, s, m.cmd, m.args);
  },
};
