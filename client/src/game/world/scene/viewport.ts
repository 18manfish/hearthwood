// The picture itself: how big it is drawn, at what resolution, how far the camera
// stands back, and what happens when the browser takes the WebGL context away.

import { debug } from '../common.ts';
import type { World } from '../../World.ts';

export function zoom(self: World, delta: number) {
  self.camDist = Math.max(8, Math.min(24, self.camDist + delta));
}

/** Size of the drawing area the renderer was last fitted to (width, height, pixel ratio). */
const fitted = new WeakMap<World, string>();
/** The largest viewport this browser allows, per renderer (looked up once). */
const limits = new WeakMap<World, number>();

/**
 * Fit the renderer to its container. Called every frame: it only does work when
 * the size or pixel ratio changed, so it catches everything a 'resize' event can
 * miss (F11 / fullscreen, docking the window, moving to another monitor).
 *
 * Browsers cap how big the drawing area may be. On a big, sharp screen – e.g.
 * fullscreen on a wide monitor – width × pixel ratio can go past that cap, and
 * the browser then draws only part of the picture. So the pixel ratio is lowered
 * just enough for the drawing area to fit.
 *
 * Only limits the browser really enforces count: MAX_VIEWPORT_DIMS, the drawing
 * buffer it actually hands out and the viewport it actually applies. Not
 * MAX_RENDERBUFFER_SIZE – LibreWolf / Firefox with fingerprinting protection
 * report a fake minimum there (1024) that doesn't limit the screen at all, and
 * going by it made the game blurry.
 */
export function resize(self: World) {
  const w = self.container.clientWidth || window.innerWidth;
  const h = self.container.clientHeight || window.innerHeight;
  const want = Math.min(self.quality.maxPixelRatio, window.devicePixelRatio || 1) * debug.resScale;
  const key = `${w}x${h}@${want}`;
  if (fitted.get(self) === key) return;
  fitted.set(self, key);
  const gl = self.renderer.getContext();
  let max = limits.get(self);
  if (max === undefined) {
    const vp = gl.getParameter(gl.MAX_VIEWPORT_DIMS) as ArrayLike<number> | null;
    max = Math.max(1024, Math.min(vp?.[0] ?? 16384, vp?.[1] ?? 16384));
    limits.set(self, max);
  }
  let dpr = Math.min(want, max / w, max / h);
  apply(self, w, h, dpr);
  // Shrink further only if the browser actually gave less than asked for:
  // a smaller drawing buffer, or a viewport clamped below the canvas size.
  const cw = self.renderer.domElement.width, ch = self.renderer.domElement.height;
  const view = gl.getParameter(gl.VIEWPORT) as ArrayLike<number> | null;
  const gotW = Math.min(gl.drawingBufferWidth, view?.[2] ?? cw);
  const gotH = Math.min(gl.drawingBufferHeight, view?.[3] ?? ch);
  if (gotW < cw - 1 || gotH < ch - 1) {
    dpr *= Math.min(gotW / cw, gotH / ch) * 0.999;
    apply(self, w, h, dpr);
  }
}

function apply(self: World, w: number, h: number, dpr: number) {
  if (self.renderer.getPixelRatio() !== dpr) self.renderer.setPixelRatio(dpr);
  self.renderer.setSize(w, h);
  self.labels.setSize(w, h);
  self.camera.aspect = w / h;
  self.camera.updateProjectionMatrix();
}

// ── Dynamic resolution ─────────────────────────────────────────────────────
// The standard way to hold the frame rate on slow GPUs: when frames take too long
// for a while, render fewer pixels (the canvas is scaled up by the browser); when
// there is headroom again, go back up. Steps rather than a continuous scale so the
// picture doesn't keep changing.
const RES_STEPS = [1, 0.85, 0.7, 0.55];
const res = { step: 0, acc: 0, frames: 0, slow: 0, fast: 0 };

export function setAutoResolution(self: World, on: boolean) {
  debug.autoRes = on;
  res.step = 0;
  res.acc = res.frames = res.slow = res.fast = 0;
  debug.resScale = 1;
  resize(self);
}

export function adaptResolution(self: World, rawDt: number) {
  if (!debug.autoRes || document.hidden) return;
  res.acc += rawDt;
  res.frames++;
  if (res.acc < 1) return; // judge whole seconds (coarse browser clocks give 0 now and then)
  const ms = (res.acc / res.frames) * 1000;
  res.acc = 0;
  res.frames = 0;
  if (ms > 22) { res.slow++; res.fast = 0; } // under ~45 fps
  else if (ms < 15) { res.fast++; res.slow = 0; } // over ~65 fps (vsync caps at 60: stays)
  else { res.slow = 0; res.fast = 0; }
  let step = res.step;
  if (res.slow >= 2 && step < RES_STEPS.length - 1) step++;
  if (res.fast >= 5 && step > 0) step--;
  if (step === res.step) return;
  res.step = step;
  res.slow = res.fast = 0;
  debug.resScale = RES_STEPS[step];
  resize(self);
}

// ── Losing the WebGL context ───────────────────────────────────────────────
// A browser may take the GPU away from a page at any time (driver reset, too many
// tabs with 3D, a phone that needs the memory). three.js restores its own state and
// re-uploads everything when the context comes back; what's left to do is to stop
// drawing meanwhile, say so, and fit the canvas again afterwards.
export function watchContext(self: World) {
  const canvas = self.renderer.domElement;
  let notice: HTMLElement | null = null;
  canvas.addEventListener('webglcontextlost', (e: Event) => {
    e.preventDefault(); // "we'll take it back": without this the context never returns
    self.contextLost = true;
    notice ??= document.createElement('div');
    notice.className = 'gfx-notice';
    notice.textContent = 'The graphics were interrupted – bringing them back…';
    self.container.appendChild(notice);
  });
  canvas.addEventListener('webglcontextrestored', () => {
    self.contextLost = false;
    notice?.remove();
    fitted.delete(self);
    limits.delete(self);
    resize(self);
    self.renderer.shadowMap.needsUpdate = true;
  });
}
