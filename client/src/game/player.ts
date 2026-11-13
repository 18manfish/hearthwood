// The player character: a chibi body that always wears trousers and an
// undershirt (colours from the Look), a face put together from the Look's face
// options, and clothes layered on top, one per slot (data/clothing.ts):
//   hat · top (shirt, pullover, dress) · bottom (skirt) · outer (jacket, coat) · shoes · gloves
// Parts that move sit in the rig's limb pivots, so sleeves swing with the arms
// and shoes walk with the feet.

import * as THREE from 'three';
import { garmentOf, ITEMS, isDress, type Gender, type Look, type Outfit } from '@hearthwood/shared';
import { bend, bentDepth } from './bend.ts';
import { mat, part } from './models.ts';
import { addHair, setHat, type Rig } from './characters.ts';

// ── Building blocks ────────────────────────────────────────────────────────
const geoCache = new Map<string, THREE.BufferGeometry>();

/** Tapered tube (y from -0.5 to 0.5); `arc` < 2π leaves an opening at the front (+z). */
function tubeGeo(rTop: number, rBot: number, seg = 14, arc = Math.PI * 2, open = false) {
  const key = `t${rTop.toFixed(3)}|${rBot.toFixed(3)}|${seg}|${arc.toFixed(3)}|${open}`;
  let g = geoCache.get(key);
  if (!g) {
    // three's cylinders start their arc at +z (the front): leave the gap centred there.
    g = new THREE.CylinderGeometry(rTop, rBot, 1, seg, 1, open, (Math.PI * 2 - arc) / 2, arc);
    geoCache.set(key, g);
  }
  return g;
}

function torusGeo(r: number, tube: number, arc: number) {
  const key = `o${r}|${tube}|${arc}`;
  let g = geoCache.get(key);
  if (!g) {
    g = new THREE.TorusGeometry(r, tube, 5, 10, arc);
    geoCache.set(key, g);
  }
  return g;
}

function mesh(geo: THREE.BufferGeometry, color: string | THREE.Material, x: number, y: number, z: number, shadow = true) {
  const m = new THREE.Mesh(geo, typeof color === 'string' ? mat(color) : color);
  m.position.set(x, y, z);
  m.castShadow = shadow;
  m.receiveShadow = true;
  if (shadow) m.customDepthMaterial = bentDepth;
  return m;
}

/** A tube between heights y0 (bottom) and y1 (top), optionally flattened front-to-back. */
function tube(color: string, rBot: number, rTop: number, y0: number, y1: number, depth = 1, opts: { arc?: number; open?: boolean; seg?: number } = {}) {
  const m = mesh(tubeGeo(rTop, rBot, opts.seg ?? 14, opts.arc, opts.open), opts.open ? openMat(color) : color, 0, (y0 + y1) / 2, 0);
  m.scale.set(1, y1 - y0, depth);
  return m;
}

/** A flat ring closing a tube's top (shoulders), at height y. */
function shoulders(color: string | THREE.Material, rIn: number, rOut: number, y: number, depth: number, arc?: number) {
  const m = mesh(tubeGeo(rIn, rOut, 16, arc, arc !== undefined), color, 0, y, 0);
  m.scale.set(1, 0.03, depth);
  return m;
}

/** Open shells (jackets) are seen from inside through the gap. */
const openMats = new Map<string, THREE.Material>();
function openMat(color: string) {
  let m = openMats.get(color);
  if (!m) {
    m = bend(new THREE.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0, flatShading: true, side: THREE.DoubleSide }));
    openMats.set(color, m);
  }
  return m;
}

function shade(hex: string, f: number) {
  const c = new THREE.Color(hex);
  if (f < 1) c.multiplyScalar(f);
  else c.lerp(new THREE.Color('#ffffff'), f - 1);
  return `#${c.getHexString()}`;
}

function pivot(x: number, y: number, z = 0) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  return g;
}

// ── Proportions ────────────────────────────────────────────────────────────
const HIP_Y = 0.36;
const SHOULDER_Y = 0.69;
const SHOULDER_X = 0.235;
const LEG_X = 0.095;
const LEG_LEN = 0.3;
const ARM_LEN = 0.3;
const HEAD_Y = 0.98;
/** Head radii (x, y, z). */
const HEAD = [0.32, 0.3, 0.3] as const;
const TORSO_DEPTH = 0.78;

/** The z of the head's surface at (x, y) in head space, plus `out`. */
function onFace(x: number, y: number, out = 0) {
  const k = 1 - (x / HEAD[0]) ** 2 - (y / HEAD[1]) ** 2;
  return HEAD[2] * Math.sqrt(Math.max(0, k)) + out;
}

// ── The body ───────────────────────────────────────────────────────────────
interface Limbs {
  footL: THREE.Group;
  footR: THREE.Group;
  handL: THREE.Group;
  handR: THREE.Group;
}

function body(look: Look): { rig: Rig; limbs: Limbs } {
  const root = new THREE.Group();
  const b = new THREE.Group();
  root.add(b);
  const { skin, shirt, pants } = look;
  // Trousers: seat and two legs.
  b.add(tube(pants, 0.2, 0.19, 0.3, 0.45, TORSO_DEPTH + 0.04));
  const legL = pivot(-LEG_X, HIP_Y), legR = pivot(LEG_X, HIP_Y);
  const footL = pivot(0, -LEG_LEN), footR = pivot(0, -LEG_LEN);
  for (const [leg, foot] of [[legL, footL], [legR, footR]] as const) {
    leg.add(tube(pants, 0.068, 0.078, -LEG_LEN + 0.04, 0.02));
    leg.add(tube(shade(pants, 0.85), 0.07, 0.07, -LEG_LEN + 0.03, -LEG_LEN + 0.06));
    leg.add(foot);
    b.add(leg);
  }
  // Undershirt: torso and little cap sleeves.
  b.add(tube(shirt, 0.19, 0.165, 0.42, 0.72, TORSO_DEPTH));
  b.add(shoulders(shirt, 0.12, 0.165, 0.735, TORSO_DEPTH));
  // Neck.
  b.add(tube(skin, 0.06, 0.055, 0.72, 0.8, 0.9));
  const armL = pivot(-SHOULDER_X, SHOULDER_Y), armR = pivot(SHOULDER_X, SHOULDER_Y);
  const handL = pivot(0, -ARM_LEN), handR = pivot(0, -ARM_LEN);
  for (const [arm, hand, sgn] of [[armL, handL, -1], [armR, handR, 1]] as const) {
    arm.rotation.z = sgn * 0.08;
    arm.add(part('sphere', shirt, 0.075, 0.07, 0.07, 0, -0.01, 0));
    arm.add(tube(shirt, 0.06, 0.066, -0.11, -0.01));
    arm.add(tube(skin, 0.042, 0.048, -ARM_LEN + 0.03, -0.1));
    arm.add(hand);
    b.add(arm);
  }
  const head = pivot(0, HEAD_Y);
  b.add(head);
  const hatSlot = new THREE.Group();
  head.add(hatSlot);
  const tool = pivot(0, -ARM_LEN - 0.02, 0.04);
  armR.add(tool);
  const rig: Rig = { root, body: b, head, armL, armR, legL, legR, hatSlot, tool, phase: Math.random() * 6 };
  return { rig, limbs: { footL, footR, handL, handR } };
}

function bareFeet(l: Limbs, skin: string) {
  for (const f of [l.footL, l.footR]) f.add(part('sphere', skin, 0.065, 0.04, 0.095, 0, -0.025, 0.03));
}

function bareHands(l: Limbs, skin: string) {
  for (const h of [l.handL, l.handR]) h.add(part('sphere', skin, 0.058, 0.062, 0.058, 0, -0.02, 0));
}

// ── The face ───────────────────────────────────────────────────────────────
function face(head: THREE.Group, look: Look) {
  const { skin, eyes, hairColor } = look;
  head.add(part('sphere', skin, HEAD[0], HEAD[1], HEAD[2], 0, 0, 0));
  for (const x of [-0.31, 0.31]) head.add(part('sphere', skin, 0.06, 0.08, 0.05, x, -0.01, 0));
  const ink = '#2a1d17';
  const eyeAt = (x: number, shape: string) => {
    const y = 0.02;
    const z = onFace(x, y, -0.005);
    switch (shape) {
      case 'happy':
      case 'closed': {
        // ^ shaped, smiling eyes.
        const arc = mesh(torusGeo(0.04, 0.012, Math.PI), ink, x, y - 0.01, z + 0.01, false);
        arc.rotation.y = x * 0.9;
        head.add(arc);
        return;
      }
      case 'sleepy': {
        const e = part('sphere', eyes, 0.05, 0.032, 0.03, x, y - 0.012, z, false);
        head.add(e);
        const lid = part('box', ink, 0.11, 0.014, 0.02, x, y + 0.012, z + 0.012, false);
        lid.rotation.y = x * 0.9;
        head.add(lid);
        return;
      }
      case 'wide':
        head.add(part('sphere', '#ffffff', 0.062, 0.075, 0.03, x, y + 0.005, z - 0.005, false));
        head.add(part('sphere', eyes, 0.042, 0.056, 0.03, x, y, z + 0.006, false));
        head.add(part('sphere', '#ffffff', 0.016, 0.016, 0.01, x + 0.015, y + 0.03, z + 0.028, false));
        return;
      default:
        head.add(part('sphere', eyes, 0.045, 0.062, 0.03, x, y, z, false));
        head.add(part('sphere', '#ffffff', 0.015, 0.015, 0.01, x + 0.015, y + 0.028, z + 0.022, false));
    }
  };
  const shape = look.eyeShape ?? 'round';
  eyeAt(-0.1, shape === 'wink' ? 'round' : shape);
  eyeAt(0.1, shape === 'wink' ? 'closed' : shape);
  // Brows.
  const brows = look.brows ?? 'soft';
  if (brows !== 'none') {
    for (const x of [-0.1, 0.1]) {
      const y = brows === 'raised' ? 0.135 : 0.11;
      const br = part('box', shade(hairColor, 0.8), brows === 'bold' ? 0.085 : 0.07, brows === 'bold' ? 0.024 : 0.013, 0.02, x, y, onFace(x, y, 0.004), false);
      br.rotation.y = x * 0.9;
      br.rotation.z = (x > 0 ? -1 : 1) * (brows === 'raised' ? 0.25 : brows === 'bold' ? -0.08 : 0.06);
      head.add(br);
    }
  }
  // Nose.
  const nose = look.nose ?? 'dot';
  if (nose === 'dot') head.add(part('sphere', shade(skin, 0.86), 0.02, 0.016, 0.014, 0, -0.04, onFace(0, -0.04, 0.002), false));
  if (nose === 'button') head.add(part('sphere', shade(skin, 0.94), 0.035, 0.03, 0.03, 0, -0.045, onFace(0, -0.045, 0.004), false));
  // Mouth.
  const my = -0.105, mz = onFace(0, my, 0);
  switch (look.mouth ?? 'smile') {
    case 'grin': {
      const g = part('sphere', '#ffffff', 0.06, 0.03, 0.02, 0, my, mz - 0.004, false);
      head.add(g);
      const lip = mesh(torusGeo(0.058, 0.009, Math.PI), '#9c3b3b', 0, my + 0.008, mz, false);
      lip.rotation.z = Math.PI;
      head.add(lip);
      break;
    }
    case 'open':
      head.add(part('sphere', '#6b2a2a', 0.035, 0.03, 0.015, 0, my - 0.005, mz, false));
      head.add(part('sphere', '#ef8a8a', 0.022, 0.012, 0.012, 0, my - 0.018, mz + 0.006, false));
      break;
    case 'small':
      head.add(part('box', ink, 0.035, 0.01, 0.015, 0, my, mz, false));
      break;
    case 'cat':
      for (const x of [-0.022, 0.022]) {
        const c = mesh(torusGeo(0.022, 0.007, Math.PI), ink, x, my + 0.006, mz, false);
        c.rotation.z = Math.PI;
        head.add(c);
      }
      break;
    default: {
      const s = mesh(torusGeo(0.04, 0.009, Math.PI), ink, 0, my + 0.012, mz, false);
      s.rotation.z = Math.PI;
      head.add(s);
    }
  }
  // Cheeks.
  const cheeks = look.cheeks ?? 'blush';
  if (cheeks === 'blush') for (const x of [-0.17, 0.17]) head.add(part('sphere', mat('#ff9aa2', { opacity: 0.7 }), 0.05, 0.025, 0.012, x, -0.06, onFace(x, -0.06, -0.006), false));
  if (cheeks === 'freckles')
    for (const x of [-0.17, 0.17])
      for (const [dx, dy] of [[-0.03, 0], [0, 0.018], [0.03, -0.004], [0.012, -0.022]])
        head.add(part('sphere', shade(skin, 0.72), 0.008, 0.008, 0.006, x + dx, -0.055 + dy, onFace(x + dx, -0.055 + dy, 0.001), false));
}

// ── Clothes ────────────────────────────────────────────────────────────────
const colorOf = (item: string) => ITEMS[item]?.color ?? '#c0392b';

/** Sleeve from the shoulder down to `len` (0..1 of the arm), radius r. */
function sleeve(arm: THREE.Object3D, color: string, r: number, len: number, cuff?: string) {
  const y0 = -ARM_LEN * len;
  arm.add(part('sphere', color, r + 0.018, r + 0.012, r + 0.012, 0, -0.01, 0));
  arm.add(tube(color, r * 0.92, r, y0, -0.005));
  if (cuff) arm.add(tube(cuff, r * 0.95, r * 0.95, y0, y0 + 0.035));
}

function skirt(b: THREE.Group, color: string, top: number, bottom: number, rTop: number, rBot: number) {
  b.add(tube(color, rBot, rTop, bottom, top, TORSO_DEPTH + 0.1, { seg: 16 }));
  b.add(tube(shade(color, 0.8), rBot + 0.004, rBot + 0.002, bottom, bottom + 0.025, TORSO_DEPTH + 0.1, { seg: 16 }));
}

/** Skirt lengths: hem height and flare. */
const HEMS: Record<string, [number, number]> = { short: [0.25, 0.27], knee: [0.13, 0.3], long: [0.035, 0.34] };

function wearTop(rig: Rig, item: string) {
  const c = colorOf(item);
  const g = garmentOf(item);
  const b = rig.body;
  switch (g) {
    case 'tshirt':
      b.add(tube(c, 0.205, 0.178, 0.41, 0.725, TORSO_DEPTH));
      b.add(shoulders(c, 0.11, 0.178, 0.74, TORSO_DEPTH));
      for (const arm of [rig.armL, rig.armR]) sleeve(arm, c, 0.068, 0.4, shade(c, 0.88));
      return;
    case 'shirt':
      b.add(tube(c, 0.205, 0.178, 0.39, 0.725, TORSO_DEPTH));
      b.add(shoulders(c, 0.11, 0.178, 0.74, TORSO_DEPTH));
      for (const sgn of [-1, 1]) {
        const col = part('box', shade(c, 1.15), 0.075, 0.05, 0.015, sgn * 0.045, 0.745, 0.13);
        col.rotation.z = sgn * 0.5;
        col.rotation.x = -0.35;
        b.add(col);
      }
      for (const y of [0.66, 0.58, 0.5]) b.add(part('sphere', shade(c, 0.65), 0.012, 0.012, 0.008, 0, y, 0.152 + (0.66 - y) * 0.06, false));
      for (const arm of [rig.armL, rig.armR]) sleeve(arm, c, 0.064, 0.92, shade(c, 1.15));
      return;
    case 'pullover':
      b.add(tube(c, 0.215, 0.19, 0.4, 0.735, TORSO_DEPTH + 0.02));
      b.add(tube(shade(c, 0.85), 0.218, 0.214, 0.38, 0.42, TORSO_DEPTH + 0.02));
      b.add(tube(shade(c, 0.85), 0.085, 0.1, 0.725, 0.77, 0.95));
      for (let i = -2; i <= 2; i++) b.add(part('box', shade(c, 0.88), 0.012, 0.22, 0.01, i * 0.05, 0.57, 0.168 - Math.abs(i) * 0.006, false));
      for (const arm of [rig.armL, rig.armR]) sleeve(arm, c, 0.072, 0.95, shade(c, 0.85));
      return;
    default: {
      if (!isDress(item)) return;
      const [hem, flare] = HEMS[g.slice(6)] ?? HEMS.knee;
      b.add(tube(c, 0.195, 0.175, 0.48, 0.73, TORSO_DEPTH));
      b.add(shoulders(c, 0.105, 0.175, 0.745, TORSO_DEPTH));
      b.add(tube(shade(c, 0.78), 0.2, 0.198, 0.47, 0.51, TORSO_DEPTH + 0.02));
      skirt(b, c, 0.5, hem, 0.2, flare);
      for (const arm of [rig.armL, rig.armR]) arm.add(part('sphere', c, 0.085, 0.07, 0.08, 0, -0.03, 0));
    }
  }
}

function wearBottom(rig: Rig, item: string) {
  const c = colorOf(item);
  const [hem, flare] = HEMS[garmentOf(item).slice(6)] ?? HEMS.knee;
  skirt(rig.body, c, 0.47, hem, 0.205, flare);
  rig.body.add(tube(shade(c, 0.8), 0.208, 0.206, 0.445, 0.475, TORSO_DEPTH + 0.1));
}

function wearOuter(rig: Rig, item: string, longSkirt: boolean) {
  const c = colorOf(item);
  const coat = garmentOf(item) === 'coat';
  const b = rig.body;
  const arc = Math.PI * 2 - 0.85;
  const bottom = coat ? 0.15 : 0.37;
  const flare = coat ? (longSkirt ? 0.36 : 0.29) : 0.235;
  b.add(tube(c, flare, 0.2, bottom, 0.74, TORSO_DEPTH + 0.06, { arc, open: true, seg: 16 }));
  // Shoulders, collar and lapels.
  b.add(shoulders(openMat(c), 0.12, 0.2, 0.755, TORSO_DEPTH + 0.06, arc));
  // Radius of the shell at height y, and a point on its front at x.
  const rAt = (y: number) => flare + ((0.2 - flare) * (y - bottom)) / (0.74 - bottom);
  const front = (x: number, y: number, out = 0.006) => Math.sqrt(Math.max(0, rAt(y) ** 2 - x * x)) * (TORSO_DEPTH + 0.06) + out;
  const edge = (y: number) => rAt(y) * Math.sin((Math.PI * 2 - arc) / 2) + 0.02;
  for (const sgn of [-1, 1]) {
    const ly = coat ? 0.63 : 0.64;
    const lap = part('box', shade(c, 0.85), 0.05, coat ? 0.2 : 0.16, 0.015, sgn * edge(ly), ly, front(edge(ly), ly, 0.004));
    lap.rotation.z = sgn * 0.22;
    lap.rotation.y = sgn * 0.35;
    b.add(lap);
    // Pockets.
    const py = coat ? 0.3 : 0.45, px = sgn * (edge(py) + 0.06);
    const pk = part('box', shade(c, 0.88), 0.07, 0.05, 0.012, px, py, front(px, py), false);
    pk.rotation.y = sgn * 0.5;
    b.add(pk);
  }
  if (coat) {
    for (const y of [0.56, 0.46, 0.36]) for (const sgn of [-1, 1]) {
      const x = sgn * (edge(y) + 0.025);
      b.add(part('sphere', shade(c, 0.6), 0.014, 0.014, 0.008, x, y, front(x, y, 0.003), false));
    }
    b.add(tube(shade(c, 0.7), rAt(0.47) + 0.006, rAt(0.44) + 0.006, 0.44, 0.47, TORSO_DEPTH + 0.07, { arc, open: true }));
  } else {
    b.add(tube(shade(c, 0.85), flare + 0.003, flare, bottom, bottom + 0.035, TORSO_DEPTH + 0.06, { arc, open: true }));
  }
  for (const arm of [rig.armL, rig.armR]) sleeve(arm, c, 0.08, 0.96, shade(c, 0.82));
}

function wearShoes(l: Limbs, item: string, skin: string) {
  const c = colorOf(item);
  for (const f of [l.footL, l.footR]) {
    switch (garmentOf(item)) {
      case 'boots':
        f.add(tube(c, 0.075, 0.08, -0.01, 0.12));
        f.add(part('sphere', c, 0.072, 0.05, 0.105, 0, -0.02, 0.03));
        f.add(part('box', shade(c, 0.55), 0.13, 0.025, 0.2, 0, -0.06, 0.03));
        f.add(tube(shade(c, 0.8), 0.083, 0.083, 0.1, 0.125));
        break;
      case 'sandals':
        f.add(part('sphere', skin, 0.062, 0.035, 0.09, 0, -0.02, 0.03));
        f.add(part('box', c, 0.12, 0.02, 0.19, 0, -0.055, 0.03));
        for (const z of [0, 0.07]) f.add(part('box', shade(c, 0.85), 0.13, 0.018, 0.02, 0, -0.02, z));
        break;
      default:
        // Sneakers: white sole, coloured upper, laces.
        f.add(part('box', '#f7f5ef', 0.13, 0.03, 0.2, 0, -0.055, 0.035));
        f.add(part('sphere', c, 0.068, 0.045, 0.1, 0, -0.025, 0.03));
        f.add(part('box', '#ffffff', 0.04, 0.012, 0.06, 0, 0.01, 0.07, false));
    }
  }
}

function wearGloves(l: Limbs, item: string) {
  const c = colorOf(item);
  const mitt = garmentOf(item) === 'mittens';
  for (const [h, sgn] of [[l.handL, -1], [l.handR, 1]] as const) {
    if (mitt) {
      h.add(part('sphere', c, 0.072, 0.076, 0.066, 0, -0.025, 0));
      h.add(part('sphere', c, 0.03, 0.04, 0.03, -sgn * 0.055, -0.01, 0.02));
      h.add(tube('#f4f1ea', 0.06, 0.062, 0.015, 0.05));
    } else {
      h.add(part('sphere', c, 0.064, 0.068, 0.062, 0, -0.022, 0));
      h.add(part('sphere', c, 0.022, 0.032, 0.022, -sgn * 0.05, -0.01, 0.025));
      h.add(tube(shade(c, 0.85), 0.055, 0.06, 0.01, 0.05));
    }
  }
}

/** A player in their outfit. Old callers may still pass just a hat. */
export function makePlayer(_gender: Gender, look: Look, outfit: Outfit | string | null = {}): Rig {
  const o: Outfit = typeof outfit === 'string' ? { hat: outfit } : outfit ?? {};
  const { rig, limbs } = body(look);
  face(rig.head, look);
  addHair(rig.head, look.hair, look.hairColor);
  const top = o.top && ITEMS[o.top]?.wear === 'top' ? o.top : undefined;
  if (top) wearTop(rig, top);
  const bottom = o.bottom && ITEMS[o.bottom]?.wear === 'bottom' && !isDress(top) ? o.bottom : undefined;
  if (bottom) wearBottom(rig, bottom);
  const long = [top, bottom].some((i) => i && garmentOf(i).endsWith('_long'));
  if (o.outer && ITEMS[o.outer]?.wear === 'outer') wearOuter(rig, o.outer, long);
  if (o.shoes && ITEMS[o.shoes]?.wear === 'shoes') wearShoes(limbs, o.shoes, look.skin);
  else bareFeet(limbs, look.skin);
  if (o.gloves && ITEMS[o.gloves]?.wear === 'gloves') wearGloves(limbs, o.gloves);
  else bareHands(limbs, look.skin);
  setHat(rig, o.hat ?? null);
  return rig;
}
