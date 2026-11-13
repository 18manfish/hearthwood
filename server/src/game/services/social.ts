// Friends, the billboard, chat and text sanitising.

import {
  BOARD_MAX_POSTS, BOARD_POST_COOLDOWN_MS, DEV_COMMANDS, type DevCommand, type FriendView, nearBuilding,
} from '@hearthwood/shared';
import crypto from 'node:crypto';
import { config } from '../../config.ts';
import { Session } from '../Session.ts';
import type { PlayerRecord } from '../../types.ts';
import type { Game } from '../Game.ts';
import { devCommand } from './dev.ts';

export function friendView(game: Game, id: string): FriendView | null {
  const f = game.store.players.get(id);
  if (!f) return null;
  return { id: f.id, name: f.name, code: f.code, online: game.online.has(f.id), islandId: f.homeIslandId };
}

export function sendFriends(game: Game, s: Session) {
  const p = s.player!;
  const map = (ids: string[]) => ids.map((id) => friendView(game, id)).filter((x): x is FriendView => !!x);
  s.send({ t: 'friends', list: map(p.friends), incoming: map(p.reqIn), outgoing: map(p.reqOut) });
}

export function pushFriendsToFriendsOf(game: Game, p: PlayerRecord) {
  for (const id of p.friends) {
    const fs = game.online.get(id);
    if (fs) sendFriends(game, fs);
  }
}

export function friendOp(game: Game, s: Session, op: 'request' | 'accept' | 'decline' | 'remove' | 'cancel', code?: string, id?: string) {
  const p = s.player!;
  const other = code ? game.store.playerByCode(code) : id ? game.store.players.get(id) : undefined;
  if (!other || !other.created) return s.send({ t: 'toast', text: 'No player found with that code.', kind: 'warn' });
  if (other.id === p.id) return s.send({ t: 'toast', text: 'That’s you!', kind: 'warn' });
  const del = (arr: string[], v: string) => {
    const i = arr.indexOf(v);
    if (i >= 0) arr.splice(i, 1);
  };
  const befriend = () => {
    del(p.reqIn, other.id); del(p.reqOut, other.id); del(other.reqIn, p.id); del(other.reqOut, p.id);
    if (!p.friends.includes(other.id)) p.friends.push(other.id);
    if (!other.friends.includes(p.id)) other.friends.push(p.id);
    s.send({ t: 'toast', text: `You and ${other.name} are now friends!`, kind: 'good' });
    game.online.get(other.id)?.send({ t: 'toast', text: `You and ${p.name} are now friends!`, kind: 'good' });
  };
  switch (op) {
    case 'request':
      if (p.friends.includes(other.id)) return s.send({ t: 'toast', text: 'Already friends.', kind: 'info' });
      if (p.friends.length >= 100) return s.send({ t: 'toast', text: 'Friend list is full.', kind: 'warn' });
      if (p.reqIn.includes(other.id)) befriend();
      else if (!p.reqOut.includes(other.id)) {
        if (other.reqIn.length >= 50) return s.send({ t: 'toast', text: 'They have too many pending requests.', kind: 'warn' });
        p.reqOut.push(other.id);
        other.reqIn.push(p.id);
        s.send({ t: 'toast', text: `Friend request sent to ${other.name}.`, kind: 'info' });
        game.online.get(other.id)?.send({ t: 'toast', text: `${p.name} wants to be friends!`, kind: 'info' });
      }
      break;
    case 'accept':
      if (!p.reqIn.includes(other.id)) return;
      befriend();
      break;
    case 'decline':
      del(p.reqIn, other.id); del(other.reqOut, p.id);
      break;
    case 'cancel':
      del(p.reqOut, other.id); del(other.reqIn, p.id);
      break;
    case 'remove':
      del(p.friends, other.id); del(other.friends, p.id);
      break;
  }
  game.store.markPlayer(p.id);
  game.store.markPlayer(other.id);
  sendFriends(game, s);
  const os = game.online.get(other.id);
  if (os) sendFriends(game, os);
}

export function boardOp(game: Game, s: Session, op: 'post' | 'delete', text?: string, id?: string) {
  const room = s.room;
  const p = s.player!;
  const board = room?.board;
  if (!room || !board) return s.send({ t: 'toast', text: 'There’s no billboard here.', kind: 'warn' });
  if (op === 'post') {
    const bb = [...room.buildings.values()].find((b) => b.type === 'billboard')!;
    if (!nearBuilding(bb, s.x, s.z, config.buildingReach + 0.5)) return s.send({ t: 'toast', text: 'Walk up to the billboard to pin a note.', kind: 'warn' });
    const clean = sanitize(game, text ?? '');
    if (!clean) return;
    const now = Date.now();
    const wait = (game.lastPost.get(p.id) ?? 0) + BOARD_POST_COOLDOWN_MS - now;
    if (wait > 0) return s.send({ t: 'toast', text: `You can pin another note in ${Math.ceil(wait / 1000)}s.`, kind: 'warn' });
    game.lastPost.set(p.id, now);
    board.unshift({ id: `n${now.toString(36)}${crypto.randomBytes(3).toString('hex')}`, by: p.id, name: p.name, text: clean, at: now });
    if (board.length > BOARD_MAX_POSTS) board.length = BOARD_MAX_POSTS;
    s.send({ t: 'toast', text: '📌 Note pinned to the billboard!', kind: 'good' });
  } else {
    const i = board.findIndex((n) => n.id === id);
    if (i < 0) return;
    if (board[i].by !== p.id) return s.send({ t: 'toast', text: 'You can only take down your own notes.', kind: 'warn' });
    board.splice(i, 1);
  }
  game.store.markBoards();
  room.broadcast({ t: 'board', posts: board });
}

export function sanitize(game: Game, text: string) {
  // Strip control & bidi characters, collapse whitespace.
  return text.replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, '').replace(/\s+/g, ' ').trim();
}

export function chat(game: Game, s: Session, raw: string) {
  if (!s.room) return;
  if (!s.allowChat()) return s.send({ t: 'toast', text: 'You’re chatting too fast.', kind: 'warn' });
  const text = sanitize(game, raw);
  if (!text) return;
  if (text.startsWith('/') && config.devFast) {
    const [cmd, ...args] = text.slice(1).split(' ');
    if ((DEV_COMMANDS as readonly string[]).includes(cmd)) return devCommand(game, s, cmd as DevCommand, args.slice(0, 4));
    return s.send({ t: 'chat', from: '', name: '', text: `Dev commands: ${DEV_COMMANDS.map((c) => '/' + c).join(' ')}`, sys: true });
  }
  s.room.broadcast({ t: 'chat', from: s.player!.id, name: s.player!.name, text });
}
