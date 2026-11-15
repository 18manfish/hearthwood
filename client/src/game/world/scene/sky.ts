// The scenery around every island: the sea plane, stars, northern lights and the
// rain / snow particles. Built once when the World starts.

import * as THREE from 'three';
import { bend } from '../../bend.ts';
import { auroraTexture, WATER_Y } from '../common.ts';
import { seaMaterial } from '../../water/waves.ts';

/**
 * Light and fairly clear in the shallows, dark out at sea, with rolling waves
 * (water/waves.ts). The grid is fine (half a unit) where the camera looks and coarse
 * (4 units) towards the fogged-out edge: ~65k triangles instead of ~390k. It travels
 * with the player in steps of 4, a whole number of cells of both spacings, so every
 * vertex stays on the same world lattice and the waves don't swim.
 */
export function seaGrid(half = 110, core = 36, fine = 0.5, coarse = 4): THREE.BufferGeometry {
  const xs: number[] = [];
  for (let x = -half; x < -core; x += coarse) xs.push(x);
  for (let x = -core; x < core; x += fine) xs.push(x);
  for (let x = core; x <= half + 1e-6; x += coarse) xs.push(Math.min(x, half));
  if (xs[xs.length - 1] < half) xs.push(half);
  const n = xs.length;
  const pos = new Float32Array(n * n * 3), uv = new Float32Array(n * n * 2);
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const k = j * n + i;
      pos[k * 3] = xs[i];
      pos[k * 3 + 1] = 0;
      pos[k * 3 + 2] = xs[j];
      uv[k * 2] = (xs[i] + half) / (2 * half);
      uv[k * 2 + 1] = 1 - (xs[j] + half) / (2 * half);
    }
  const idx: number[] = [];
  for (let j = 0; j < n - 1; j++)
    for (let i = 0; i < n - 1; i++) {
      const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(n * n * 3).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

export function createSea(): THREE.Mesh {
  const wg = seaGrid();
  const water = new THREE.Mesh(wg, seaMaterial(bend(new THREE.MeshStandardMaterial({ color: '#4fb7d8', transparent: true, opacity: 0.66, roughness: 0.25, metalness: 0.05 }))));
  water.position.y = WATER_Y;
  water.receiveShadow = true;
  return water;
}

export function createStars(): THREE.Points {
  const sp = new Float32Array(900 * 3);
  for (let i = 0; i < 900; i++) {
    const th = Math.random() * Math.PI * 2;
    const ph = Math.acos(Math.random() * 0.9);
    sp[i * 3] = Math.sin(ph) * Math.cos(th) * 150;
    sp[i * 3 + 1] = Math.cos(ph) * 150;
    sp[i * 3 + 2] = Math.sin(ph) * Math.sin(th) * 150;
  }
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
  return new THREE.Points(sg, new THREE.PointsMaterial({ color: '#ffffff', size: 1.2, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false }));
}

/**
 * Northern lights: curtains of light hung in the sky band above the curved
 * horizon. They live in camera space (always in view, behind the land) and ripple slowly.
 */
export function createAurora(): THREE.Group {
  const aurora = new THREE.Group();
  const curtainTex = auroraTexture();
  const tints = ['#5dffa8', '#3cf0c0', '#9d7dff'];
  for (let i = 0; i < 3; i++) {
    const g = new THREE.PlaneGeometry(420, 70, 90, 1);
    const tex = curtainTex.clone();
    tex.needsUpdate = true;
    const m = new THREE.MeshBasicMaterial({ map: tex, color: tints[i], transparent: true, opacity: 0, side: THREE.DoubleSide, fog: false, depthWrite: false, blending: THREE.AdditiveBlending });
    const mesh = new THREE.Mesh(g, m);
    mesh.position.set(-30 + i * 40, 30 + i * 12, -220 - i * 25);
    mesh.renderOrder = -10;
    mesh.frustumCulled = false;
    mesh.userData.base = Float32Array.from((g.attributes.position as THREE.BufferAttribute).array as Float32Array);
    aurora.add(mesh);
  }
  return aurora;
}

/** Rain and snow: falling points that the environment update moves. */
export function createRain(): { rain: THREE.Points; vel: Float32Array } {
  const N = 1600;
  const rp = new Float32Array(N * 3);
  const vel = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    rp[i * 3] = (Math.random() - 0.5) * 40;
    rp[i * 3 + 1] = Math.random() * 20;
    rp[i * 3 + 2] = (Math.random() - 0.5) * 40;
    vel[i] = 0.7 + Math.random() * 0.6;
  }
  const rg = new THREE.BufferGeometry();
  rg.setAttribute('position', new THREE.BufferAttribute(rp, 3));
  const rain = new THREE.Points(rg, bend(new THREE.PointsMaterial({ color: '#cfe8ff', size: 0.08, transparent: true, opacity: 0.8, depthWrite: false })));
  rain.visible = false;
  rain.frustumCulled = false;
  return { rain, vel };
}

// ── Clouds ──────────────────────────────────────────────────────────────────

/** A soft, lumpy cloud: round puffs merged into one shape and blurred, flat-ish at the bottom, shaded underneath. */
function cloudTexture(seed: number): THREE.CanvasTexture {
  const W = 256, H = 128;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  let s = seed * 9301 + 49297;
  const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  const base = H * 0.74;
  // One solid silhouette (no seams between the puffs), softened as a whole.
  g.filter = 'blur(5px)';
  g.fillStyle = '#ffffff';
  g.beginPath();
  const puffs = 7 + Math.floor(rnd() * 5);
  for (let i = 0; i < puffs; i++) {
    const t = (i + 0.5) / puffs;
    const x = W * (0.16 + t * 0.68) + (rnd() - 0.5) * 14;
    const r = 13 + Math.sin(t * Math.PI) * (18 + rnd() * 14);
    const y = base - r * (0.45 + rnd() * 0.3);
    g.moveTo(x + r, y);
    g.arc(x, y, r, 0, Math.PI * 2);
  }
  g.rect(W * 0.16, base - 16, W * 0.68, 16); // the flat underside
  g.fill('nonzero');
  g.filter = 'none';
  // Shade the underside, keeping the shape.
  g.globalCompositeOperation = 'source-atop';
  const shade = g.createLinearGradient(0, H * 0.2, 0, base + 4);
  shade.addColorStop(0, 'rgba(255,255,255,0)');
  shade.addColorStop(0.55, 'rgba(160,168,180,0.18)');
  shade.addColorStop(1, 'rgba(112,122,136,0.6)');
  g.fillStyle = shade;
  g.fillRect(0, 0, W, H);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** A long, soft band of cloud low over the horizon, for heavy skies (tiles sideways). */
function cloudBankTexture(): THREE.CanvasTexture {
  const W = 512, H = 96;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  // A lumpy top edge (periodic, so the texture tiles), drawn three times wide so the blur wraps.
  g.filter = 'blur(6px)';
  g.fillStyle = '#ffffff';
  for (const off of [-W, 0, W]) {
    g.beginPath();
    g.moveTo(off, H);
    for (let x = 0; x <= W; x += 4) {
      const top = 34 - 12 * Math.sin((x / W) * Math.PI * 6) * Math.sin((x / W) * Math.PI * 2 + 1) - 6 * Math.sin((x / W) * Math.PI * 14);
      g.lineTo(off + x, top);
    }
    g.lineTo(off + W, H);
    g.closePath();
    g.fill();
  }
  g.filter = 'none';
  // Fade out towards the bottom (it sinks behind the horizon) and shade it.
  g.globalCompositeOperation = 'destination-in';
  const fade = g.createLinearGradient(0, 0, 0, H);
  fade.addColorStop(0, 'rgba(0,0,0,1)');
  fade.addColorStop(0.7, 'rgba(0,0,0,0.9)');
  fade.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = fade;
  g.fillRect(0, 0, W, H);
  g.globalCompositeOperation = 'source-atop';
  const shade = g.createLinearGradient(0, 20, 0, H);
  shade.addColorStop(0, 'rgba(255,255,255,0)');
  shade.addColorStop(1, 'rgba(120,128,140,0.45)');
  g.fillStyle = shade;
  g.fillRect(0, 0, W, H);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export const CLOUD_SPAN = 300;

/**
 * Clouds for grey weather: puffs hung in the sky band above the curved horizon,
 * in camera space like the northern lights (always in view, behind the land),
 * plus a darker bank low over the horizon. The environment update fades them in
 * with the weather, colours them for the time of day and lets them drift.
 */
export function createClouds(): THREE.Group {
  const clouds = new THREE.Group();
  clouds.name = 'clouds';
  clouds.visible = false;
  const textures = [0, 1, 2, 3, 4].map((i) => cloudTexture(i + 1));
  const bank = new THREE.Mesh(
    new THREE.PlaneGeometry(CLOUD_SPAN * 3, 46),
    new THREE.MeshBasicMaterial({ map: cloudBankTexture(), transparent: true, opacity: 0, fog: false, depthWrite: false }),
  );
  (bank.material as THREE.MeshBasicMaterial).map!.repeat.set(3, 1);
  bank.position.set(0, 24, -275);
  bank.renderOrder = -12;
  bank.frustumCulled = false;
  bank.userData.bank = true;
  clouds.add(bank);
  const N = 48;
  for (let i = 0; i < N; i++) {
    const w = 50 + Math.random() * 64;
    const far = Math.random(); // 0 near … 1 far: higher up, smaller, slower
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(w, w * 0.5),
      new THREE.MeshBasicMaterial({ map: textures[i % textures.length], transparent: true, opacity: 0, fog: false, depthWrite: false, side: THREE.DoubleSide, forceSinglePass: true }),
    );
    mesh.position.set((Math.random() - 0.5) * CLOUD_SPAN * 2, 26 + far * 30 + Math.random() * 6, -230 - far * 40);
    if (Math.random() < 0.5) mesh.scale.x = -1; // mirrored for variety
    mesh.renderOrder = -11 + far * 0.5;
    mesh.frustumCulled = false;
    // rank: the cover at which this puff appears (a few for overcast, all of them in a storm)
    mesh.userData = { rank: (i + 0.5) / N, far };
    clouds.add(mesh);
  }
  // Light rank order is spread across the sky, not left to right.
  const puffs = clouds.children.filter((c: THREE.Object3D) => !c.userData.bank);
  for (let i = puffs.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [puffs[i].userData.rank, puffs[j].userData.rank] = [puffs[j].userData.rank, puffs[i].userData.rank];
  }
  return clouds;
}
