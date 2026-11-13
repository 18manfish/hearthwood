// The running game: the World and the HUD once a character is in, and the screens
// before that (status messages). Shared by the boot, input and message code.

import { net } from '../net.ts';
import { state } from '../state.ts';
import { World } from '../game/World.ts';
import { Hud } from '../ui/hud.ts';
import { h, clear } from '../ui/dom.ts';
import { confirmGhost, queuePaint } from './actions.ts';
import { bindKeys } from '../input/keyboard.ts';
import { updateAmbience } from '../audio/ambience.ts';

export const app = document.getElementById('app')!;
export const game = {
  world: null as World | null,
  hud: null as Hud | null,
  /** Character creation is on screen. */
  creating: false,
};

export function statusScreen(text: string, sub = '') {
  if (game.world) return game.hud?.toast(text, 'warn');
  clear(app);
  app.appendChild(h('div', { class: 'screen' }, h('div', { class: 'card col', style: 'align-items:center;text-align:center;max-width:420px' },
    h('div', { class: 'title' }, '🌿 Hearthwood'), h('div', {}, text), sub ? h('div', { class: 'muted' }, sub) : null)));
}

export function startGame() {
  if (game.world) return;
  clear(app);
  const container = h('div', { style: 'position:absolute;inset:0' });
  app.appendChild(container);
  game.world = new World(container);
  game.hud = new Hud(app, game.world);
  game.world.onGhostClick = () => confirmGhost();
  game.world.onPaint = (x, z, type) => queuePaint(x, z, type ? { k: 'pave', x, z, path: type } : { k: 'unpave', x, z });
  game.world.onTerra = (x, z, op, dir) => queuePaint(x, z, { k: 'terra', op, x, z, dir });
  // Debug handle for the browser console when the server runs in dev mode.
  if (state.dev) (window as unknown as Record<string, unknown>).hearthwood = { world: game.world, hud: game.hud, state, net };
  game.world.onFrame = (dt) => updateAmbience(game.world!, dt);
  bindKeys();
}

