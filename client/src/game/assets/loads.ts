// Counts the textures and models three.js is still fetching (everything that goes
// through the default loading manager), so the loading screen can wait for them.
// Imported first thing in main.ts so it sees every load.

import * as THREE from 'three';

let pending = 0;
let waiters: (() => void)[] = [];

const m = THREE.DefaultLoadingManager as { itemStart(url: string): void; itemEnd(url: string): void };
const start = m.itemStart.bind(m);
const end = m.itemEnd.bind(m);
// Loaders call itemError and then itemEnd on failure, so start/end alone keep the count right.
m.itemStart = (url: string) => {
  pending++;
  start(url);
};
m.itemEnd = (url: string) => {
  pending = Math.max(0, pending - 1);
  end(url);
  if (pending === 0) {
    const w = waiters;
    waiters = [];
    for (const f of w) f();
  }
};

/** Assets still on their way. */
export function pendingLoads() {
  return pending;
}

/** Resolves once nothing is loading any more (or after `timeoutMs`, so a stuck file can't hold up the game). */
export function loadsSettled(timeoutMs = 8000): Promise<void> {
  if (pending === 0) return Promise.resolve();
  return new Promise((resolve) => {
    const t = setTimeout(done, timeoutMs);
    function done() {
      clearTimeout(t);
      waiters = waiters.filter((f) => f !== done);
      resolve();
    }
    waiters.push(done);
  });
}
