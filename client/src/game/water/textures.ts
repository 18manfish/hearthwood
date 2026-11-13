// Canvas-drawn textures for the water: waterfall stripes, river-flow streaks, soft dots.

import * as THREE from 'three';

/** Scrolling stripes for waterfalls (one shared texture, animated by the world). */
export const fallTexture = (() => {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#9fdcf2';
  g.fillRect(0, 0, 64, 128);
  for (let i = 0; i < 34; i++) {
    g.fillStyle = `rgba(255,255,255,${0.25 + (i % 4) * 0.15})`;
    g.fillRect((i * 13) % 64, (i * 37) % 128, 2 + (i % 3), 14 + (i % 5) * 8);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
})();

/** Faint streaks for river flow (scrolled along the flow direction). */
export const flowTexture = (() => {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, 64, 64);
  for (let i = 0; i < 18; i++) {
    const x = (i * 23) % 60, y = (i * 41) % 64, len = 6 + (i % 4) * 4;
    const grad = g.createLinearGradient(0, y, 0, y + len);
    grad.addColorStop(0, 'rgba(255,255,255,0)');
    grad.addColorStop(0.5, `rgba(255,255,255,${0.5 + (i % 3) * 0.2})`);
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(x, y, 1 + (i % 2), len);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
})();

/** A soft round dot for spray particles. */
export const dotTexture = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.6)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(c);
})();
