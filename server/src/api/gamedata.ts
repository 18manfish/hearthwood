// HTTP API: the game data everyone needs to play, and (dev mode only) the game
// creation tool that edits it.

import { DEFAULT_GAME_DATA, GAME_TABLES, migrateGameData, snapshotGameData, validateGameData, type GameData, type GameTable } from '@hearthwood/shared';
import { HttpError, readJson } from '../http.ts';
import type { Api } from './context.ts';

export function gameDataRoutes(api: Api) {
  const { r, game, store, dev, actor } = api;
  r.on('GET', '/api/gamedata', () => game.gameDataOverrides);

  // ── Game creation tool (dev mode only) ──────────────────────────────────
  r.on('GET', '/api/dev/gamedata', ({ req }) => {
    dev(req);
    return { current: snapshotGameData(), defaults: DEFAULT_GAME_DATA, overridden: store.gameDataInfo() };
  });

  r.on('PUT', '/api/dev/gamedata/:table', async ({ req, params }) => {
    const me = dev(req);
    const table = params.table as GameTable;
    if (!GAME_TABLES.includes(table)) throw new HttpError(404, 'Unknown table.');
    const body = await readJson(req);
    const next = { ...snapshotGameData(), [table]: body.data } as GameData;
    const errors = validateGameData(next);
    if (errors.length) throw new HttpError(400, errors.join('\n'));
    game.setGameData({ [table]: body.data }, actor(me));
    return { ok: true };
  });

  r.on('DELETE', '/api/dev/gamedata/:table', ({ req, params }) => {
    const me = dev(req);
    const table = params.table as GameTable;
    if (!GAME_TABLES.includes(table)) throw new HttpError(404, 'Unknown table.');
    game.resetGameData([table], actor(me));
    return { ok: true };
  });

  /** Import a whole data set (e.g. a file exported from another server). */
  r.on('PUT', '/api/dev/gamedata', async ({ req }) => {
    const me = dev(req);
    const body = await readJson(req);
    const data = body.data as Partial<GameData>;
    if (!data || typeof data !== 'object') throw new HttpError(400, 'Expected { data: {...} }');
    migrateGameData(data); // files exported by an older version
    const tables = GAME_TABLES.filter((t) => t in data);
    const next = { ...snapshotGameData(), ...data } as GameData;
    const errors = validateGameData(next);
    if (errors.length) throw new HttpError(400, errors.join('\n'));
    game.setGameData(Object.fromEntries(tables.map((t) => [t, data[t]])), actor(me));
    return { ok: true, tables };
  });
}

