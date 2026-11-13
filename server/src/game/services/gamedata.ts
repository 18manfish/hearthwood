// Game data overrides from the game creation tool: load, change, reset, announce.

import {
  applyGameData, DEFAULT_GAME_DATA, GAME_TABLES, type GameData, type GameTable, snapshotGameData, validateGameData,
} from '@hearthwood/shared';
import { logger } from '../../log.ts';
import type { Game } from '../Game.ts';

const log = logger('game');

/** Apply stored overrides at startup (invalid ones are skipped and logged). */
export function loadGameData(game: Game) {
  const stored = game.store.gameData() as Partial<GameData>;
  const tables = GAME_TABLES.filter((t) => t in stored);
  if (!tables.length) return;
  const merged = { ...snapshotGameData(), ...stored } as GameData;
  const errors = validateGameData(merged);
  if (errors.length) {
    log.error('stored game data is invalid – using the built-in data', { errors: errors.slice(0, 10) });
    return;
  }
  applyGameData(stored);
  game.gameDataOverrides = Object.fromEntries(tables.map((t) => [t, stored[t]]));
  log.info('game data overrides loaded', { tables });
}

/** Apply already-validated tables, save them and tell everyone online. */
export function setGameData(game: Game, tables: Partial<GameData>, author: string) {
  applyGameData(tables);
  for (const [t, data] of Object.entries(tables)) {
    game.store.setGameData(t, data, author);
    (game.gameDataOverrides as Record<string, unknown>)[t] = data;
  }
  game.store.audit(author, 'gamedata.set', Object.keys(tables).join(','));
  log.info('game data changed', { by: author, tables: Object.keys(tables) });
  announceDataChange(game);
}

export function resetGameData(game: Game, tables: GameTable[], author: string) {
  applyGameData(Object.fromEntries(tables.map((t) => [t, DEFAULT_GAME_DATA[t]])));
  for (const t of tables) {
    game.store.deleteGameData(t);
    delete game.gameDataOverrides[t];
  }
  game.store.audit(author, 'gamedata.reset', tables.join(','));
  log.info('game data reset', { by: author, tables });
  announceDataChange(game);
}

export function announceDataChange(game: Game) {
  for (const s of game.online.values()) s.send({ t: 'toast', text: '🛠️ Game data was updated – reload the page to see every change.', kind: 'info' });
}
