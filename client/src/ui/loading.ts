// Loading screen: covers the game while an island is being built, the first time
// you arrive and whenever you travel to another island. Sits above everything
// (it lives on <body>, so it survives the app swapping its screens).

import { h } from './dom.ts';

const TIPS = [
  'Hold Shift to run.',
  'Fish leave shadows in the water – cast your line near one.',
  'Villagers are home from 19:00 to 07:00.',
  'Build a Travel Agent to book mystery tours to faraway islands.',
  'Give friends your island’s invite code so they can visit.',
  'Upgrade your house and it grows a little bigger inside.',
  'You can rearrange the furniture in your own home.',
  'Press F4 to see the rendering stats.',
];

const MIN_SHOWN_MS = 700;
const FADE_MS = 380;
const STUCK_MS = 20_000;

let el: HTMLElement | null = null;
let titleEl: HTMLElement, subEl: HTMLElement, stepEl: HTMLElement, barEl: HTMLElement;
let shownAt = 0;
let waitingForRoom = false;
let stuckTimer = 0;
let hiding: Promise<void> | null = null;

function build() {
  titleEl = h('div', { class: 'ld-title' });
  subEl = h('div', { class: 'ld-sub' });
  stepEl = h('div', { class: 'ld-step' });
  barEl = h('div', { class: 'ld-fill' });
  const boat = h('div', { class: 'ld-scene' }, h('div', { class: 'ld-boat' }, '⛵'), h('div', { class: 'ld-waves' }));
  const tip = h('div', { class: 'ld-tip' }, `💡 ${TIPS[Math.floor(Math.random() * TIPS.length)]}`);
  return h('div', { class: 'loading-screen', role: 'status', 'aria-live': 'polite' },
    h('div', { class: 'ld-card' }, boat, titleEl, subEl, h('div', { class: 'ld-bar' }, barEl), stepEl, tip));
}

/**
 * Show (or retitle) the loading screen. `awaitRoom`: we've asked the server to
 * travel and are waiting for the new room – a refusal hides it again.
 */
export function showLoading(title: string, sub = '', awaitRoom = false) {
  if (!el || hiding) {
    el?.remove();
    hiding = null;
    el = build();
    document.body.appendChild(el);
    shownAt = performance.now();
    loadingStep('', 0.05);
  }
  titleEl.textContent = title;
  subEl.textContent = sub;
  waitingForRoom = awaitRoom;
  clearTimeout(stuckTimer);
  stuckTimer = window.setTimeout(() => void hideLoading(true), STUCK_MS); // never trap the player behind it
}

/** Progress text and bar (0–1); the bar only moves forward. */
export function loadingStep(text: string, frac: number) {
  if (!el) return;
  stepEl.textContent = text;
  const cur = parseFloat(barEl.style.width) || 0;
  barEl.style.width = `${Math.max(cur, Math.min(100, frac * 100))}%`;
}

export function loadingVisible() {
  return !!el && !hiding;
}

/** Waiting for the server to send the room we asked to travel to. */
export function loadingAwaitsRoom() {
  return loadingVisible() && waitingForRoom;
}

export function roomArrived() {
  waitingForRoom = false;
}

/** Fade out (after a short minimum so it doesn't flash); `now` skips the minimum. */
export function hideLoading(now = false): Promise<void> {
  if (!el) return Promise.resolve();
  if (hiding) return hiding;
  clearTimeout(stuckTimer);
  waitingForRoom = false;
  const node = el;
  const wait = now ? 0 : Math.max(0, MIN_SHOWN_MS - (performance.now() - shownAt));
  hiding = new Promise<void>((resolve) => {
    setTimeout(() => {
      loadingStep('', 1);
      node.classList.add('out');
      setTimeout(() => {
        node.remove();
        if (el === node) {
          el = null;
          hiding = null;
        }
        resolve();
      }, FADE_MS);
    }, wait);
  });
  return hiding;
}
