// Frames-per-second counter in the corner of the game view. Toggled from the
// ⚙️ Options menu; the choice is remembered in this browser.

import { debug } from '../../game/world/common.ts';
import { h } from '../dom.ts';

const KEY = 'hearthwood.showFps';

const el = h('div', { class: 'fps', style: 'display:none', title: 'Frames per second (turn off in ⚙️ Options)' });
let timer = 0;

function stored(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

function tick() {
  const fps = debug.fps;
  el.textContent = `${fps} FPS`;
  el.dataset.level = fps >= 50 ? 'good' : fps >= 30 ? 'ok' : 'bad';
}

/** Is the counter shown? */
export function fpsVisible(): boolean {
  return el.style.display !== 'none';
}

/** Show or hide the counter (and remember the choice). */
export function setFpsVisible(on: boolean, remember = true) {
  el.style.display = on ? '' : 'none';
  clearInterval(timer);
  if (on) {
    tick();
    timer = window.setInterval(tick, 250);
  }
  if (remember) {
    try {
      localStorage.setItem(KEY, on ? '1' : '0');
    } catch { /* private mode etc. */ }
  }
}

/** Add the counter to the HUD, in the state the player last chose. */
export function mountFps(root: HTMLElement) {
  root.append(el);
  setFpsVisible(stored(), false);
}
