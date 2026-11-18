// Frames-per-second counter in the corner of the game view. Toggled from the
// ⚙️ Options menu; the choice is remembered in this browser.

import { debug } from '../../game/world/common.ts';
import { h } from '../dom.ts';
import { remembered } from './remembered.ts';

const choice = remembered('hearthwood.showFps');

const el = h('div', { class: 'fps', style: 'display:none', title: 'Frames per second (turn off in ⚙️ Options)' });
let timer = 0;

function tick() {
  const fps = debug.fps;
  el.textContent = `${fps} FPS`;
  el.dataset.level = fps >= 50 ? 'good' : fps >= 30 ? 'ok' : 'bad';
}

/** Is the counter shown? */
export function fpsVisible(): boolean {
  return el.style.display !== 'none';
}

function show(on: boolean) {
  el.style.display = on ? '' : 'none';
  clearInterval(timer);
  if (on) {
    tick();
    timer = window.setInterval(tick, 250);
  }
}

/** Show or hide the counter, and remember the choice. */
export function setFpsVisible(on: boolean) {
  show(on);
  choice.set(on);
}

/** Add the counter to the HUD, in the state the player last chose. */
export function mountFps(root: HTMLElement) {
  root.append(el);
  show(choice.get());
}
