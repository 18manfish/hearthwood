// Island roles (builder, resident) granted by the owner, and the player's location and time zone.

import {
  isValidTimeZone,
} from '@hearthwood/shared';
import { logger } from '../../log.ts';
import { Session } from '../Session.ts';
import type { Game } from '../Game.ts';
import { islandRooms } from './rooms.ts';
import { homeIsland } from './travel.ts';
import { sendSelf } from './views.ts';

const log = logger('game');

/** The island owner lets a friend build here, live here – or neither. */
export function setRole(game: Game, s: Session, targetId: string, role: 'none' | 'builder' | 'resident') {
  const p = s.player!;
  const isl = homeIsland(game, p);
  if (!isl) return;
  const target = game.store.players.get(targetId);
  if (!target || target.id === p.id) return s.send({ t: 'toast', text: 'Pick one of your friends.', kind: 'warn' });
  if (role !== 'none' && !p.friends.includes(target.id)) return s.send({ t: 'toast', text: 'You can only grant this to friends.', kind: 'warn' });
  isl.builders = (isl.builders ?? []).filter((x) => x !== target.id);
  isl.residents = (isl.residents ?? []).filter((x) => x !== target.id);
  if (role === 'builder') isl.builders.push(target.id);
  if (role === 'resident') isl.residents.push(target.id);
  game.store.markIsland(isl.id);
  log.info('island role changed', { island: isl.id, owner: p.id, player: target.id, role });
  sendSelf(game, s);
  const text = role === 'none' ? `${target.name} no longer builds or lives on ${isl.name}.`
    : role === 'builder' ? `${target.name} can now build on ${isl.name}.` : `${target.name} is now a resident of ${isl.name}!`;
  s.send({ t: 'toast', text, kind: 'good' });
  const ts = game.online.get(target.id);
  if (ts) {
    sendSelf(game, ts);
    ts.send({ t: 'toast', text: role === 'none' ? `You no longer build or live on ${isl.name}.` : role === 'builder' ? `🔨 ${p.name} lets you build on ${isl.name}!` : `🏡 ${p.name} made you a resident of ${isl.name}! Build your own house there.`, kind: role === 'none' ? 'info' : 'good' });
  }
  // Everyone affected who stands on the island gets their new rights straight away.
  for (const r of islandRooms(game, isl.id)) for (const x of r.sessions) if (x.player?.id === target.id) r.resendView(x);
}

/** Change your location / time zone: your island's sun, seasons and clock follow it. */
export function setGeo(game: Game, s: Session, lat: number, lon: number, tz: string) {
  const p = s.player!;
  if (!isValidTimeZone(tz)) return s.send({ t: 'toast', text: 'Unknown time zone.', kind: 'warn' });
  p.geo = { lat: Math.round(lat * 2) / 2, lon: Math.round(lon * 2) / 2, tz }; // ≈ 50 km – enough for the sun
  game.store.markPlayer(p.id);
  if (p.homeIslandId) for (const r of islandRooms(game, p.homeIslandId)) {
    r.geo = p.geo;
    r.invalidateEnv();
    r.broadcast({ t: 'env', env: r.env() });
  }
  sendSelf(game, s);
  s.send({ t: 'toast', text: `📍 Location saved – your island now follows ${tz.replace(/_/g, ' ')}.`, kind: 'good' });
}
