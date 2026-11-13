// Messages in bottles: delivering thrown bottles to a random island when they are due.

import { logger } from '../../log.ts';
import type { Game } from '../Game.ts';

const log = logger('game');

/** Bottles whose time has come wash up on a random player's island (never the sender's). */
export function deliverBottles(game: Game, now = Date.now()) {
  const due = game.store.dueBottles(now);
  if (!due.length) return;
  const all = [...game.store.players.values()].filter((p) => p.created && p.homeIslandId && game.store.islands.has(p.homeIslandId) && !p.banned);
  const active = all.filter((p) => now - p.lastSeen < 30 * 86400_000 || game.online.has(p.id));
  for (const b of due) {
    const pool = (active.length > 1 ? active : all).filter((p) => p.id !== b.from_id);
    // Nobody else around: it drifts back to the sender's own beach.
    const to = pool.length ? pool[Math.floor(Math.random() * pool.length)] : all.find((p) => p.id === b.from_id);
    if (!to) {
      game.store.bottleSent(b.id, '');
      continue;
    }
    const isl = game.store.islands.get(to.homeIslandId!)!;
    (isl.bottles ??= []).push({ id: b.id, from: b.from_id, fromName: b.from_name, text: b.text, at: now });
    game.store.markIsland(isl.id);
    game.store.bottleSent(b.id, to.id);
    log.info('bottle washed up', { bottle: b.id, to: to.id, island: isl.id });
    const live = game.rooms.get(isl.id);
    if (live) live.slowTick(now); // land it on the beach right away
    const s = game.online.get(to.id);
    if (s) s.send({ t: 'toast', text: '🍾 Something washed up on your beach…', kind: 'info' });
  }
}
