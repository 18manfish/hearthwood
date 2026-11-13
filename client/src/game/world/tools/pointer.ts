// Mouse input on the 3D view: aiming, painting strokes, clicking placement ghosts,
// and zooming with the wheel.

import type { World } from '../../World.ts';
import { paintHere, updatePaintGhost } from './paint.ts';

export function bindPointer(self: World) {
  const container = self.container;
  container.addEventListener('wheel', (e) => {
    self.camDist = Math.max(8, Math.min(24, self.camDist + Math.sign(e.deltaY) * 1.2));
  }, { passive: true });
  container.addEventListener('pointermove', (e) => {
    const r = self.renderer.domElement.getBoundingClientRect();
    self.mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    if (Math.abs(e.movementX) + Math.abs(e.movementY) > 2) self.padAim = false;
    if (self.paint?.down) {
      updatePaintGhost(self);
      paintHere(self);
    }
  });
  container.addEventListener('pointerdown', (e) => {
    if (!self.paint || e.button !== 0) return;
    self.paint.down = true;
    self.paint.last = '';
    updatePaintGhost(self);
    paintHere(self);
  });
  window.addEventListener('pointerup', () => {
    if (self.paint) self.paint.down = false;
  });
  container.addEventListener('click', () => {
    if (self.ghost) self.onGhostClick();
  });
}
