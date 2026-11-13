// Starting up: server info → game data → log in → start screen (logo + news) →
// models loaded → connect.

import { net } from '../net.ts';
import { loadTreeAssets } from '../game/treeAssets.ts';
import { loadTileset } from '../game/tileAssets.ts';
import { loadKitAssets } from '../game/assets/kit.ts';
import { api, clearToken, health, loadGameData, token, type Health } from '../auth.ts';
import { showLogin } from '../ui/login.ts';
import { showStart } from '../ui/start.ts';
import { app, game, statusScreen } from './session.ts';

/** Connection status screens. */
export function bindStatus() {
  net.onStatus = (s, msg) => {
    if (s === 'connecting' && !game.world) statusScreen('Connecting to the islands…');
    if (s === 'offline') statusScreen('Connection lost – reconnecting…', 'Is the server running? (npm run dev)');
    if (s === 'fatal') statusScreen(msg ?? 'Disconnected.', 'Refresh the page to play again.');
  };
}

// ── Boot: server info → game data → log in → connect ─────────────────────
let serverInfo: Health | null = null;

/** Log in (or claim a guest account) when the server asks for it. */
export function bindAuth() {
  net.onAuth = async (kind, msg) => {
    if (game.world) {
      // Mid-game: start over cleanly.
      location.reload();
      return;
    }
    if (kind === 'banned') return statusScreen(msg, 'Contact the server admin if you think this is a mistake.');
    await showLogin(app, { health: serverInfo!, mode: kind === 'register' ? 'claim' : 'login', message: msg });
    net.connect();
  };
}

export async function boot() {
  statusScreen('Connecting to the islands…');
  const models = Promise.all([loadTreeAssets(), loadTileset(), loadKitAssets()]); // in parallel with login; never rejects
  try {
    serverInfo = await health();
    await loadGameData();
  } catch {
    statusScreen('Can’t reach the server.', 'Is it running? (npm run dev) – retrying…');
    setTimeout(boot, 3000);
    return;
  }
  // Log in first if needed, then the start screen (logo + news), then into the world.
  let me: { username: string | null } | null = null;
  while (!me) {
    if (!token()) await showLogin(app, { health: serverInfo });
    try {
      me = await api<{ username: string | null }>('GET', '/api/me');
    } catch (e) {
      if ((e as { status?: number }).status !== 401) {
        setTimeout(boot, 3000);
        return statusScreen('Can’t reach the server.', 'Retrying…');
      }
      clearToken();
    }
  }
  await showStart(app, me.username ?? 'a guest');
  await models;
  net.connect();
}
