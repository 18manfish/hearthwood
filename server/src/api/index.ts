// HTTP API: accounts, public game data, the admin tool and (dev mode only)
// the game creation tool. One file per group of routes.

import type { Router } from '../http.ts';
import type { Game } from '../game/Game.ts';
import type { Store } from '../store.ts';
import { accountRoutes } from './accounts.ts';
import { makeApi } from './context.ts';
import { gameDataRoutes } from './gamedata.ts';
import { giftRoutes } from './gifts.ts';
import { islandRoutes } from './islands.ts';
import { newsRoutes } from './news.ts';
import { playerRoutes } from './players.ts';

export function buildApi(game: Game, store: Store): Router {
  const api = makeApi(game, store);
  accountRoutes(api);
  newsRoutes(api);
  giftRoutes(api);
  gameDataRoutes(api);
  playerRoutes(api);
  islandRoutes(api);
  api.r.on('GET', '/api/admin/audit', ({ req, url }) => {
    api.admin(req);
    return { entries: api.store.auditLog(Number(url.searchParams.get('limit')) || 200) };
  });
  return api.r;
}
