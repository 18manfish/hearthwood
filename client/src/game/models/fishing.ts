// Fishing gear: the rod in the player's hand, the float on the water and the
// line between them.
//
// The rod is built along +y inside its own group (butt at the bottom, tip at the
// top) and then tilted forward, so "under the rod" – where the reel hangs and the
// line runs through the guides – is +z in rod space.

import * as THREE from 'three';
import { bend } from '../bend.ts';
import { mat } from './primitives.ts';

export type RodStyle = 'basic' | 'pro';

const ROD_LEN = 1.35; // butt cap to tip, in tiles
const BLANK_START = 0.2; // where the cork fore-grip ends and the blank begins
const ROD_TILT = 1.0; // radians from straight up towards the front

const STYLE: Record<RodStyle, { blank: string; wrap: string; trim: string; reel: string }> = {
  basic: { blank: '#24453a', wrap: '#c0392b', trim: '#b8bec6', reel: '#5f6670' },
  pro: { blank: '#1f2230', wrap: '#d4a537', trim: '#d4a537', reel: '#2f3440' },
};

// Shared geometries (made once).
const TUBE = new THREE.CylinderGeometry(1, 1, 1, 10);
const RING = new THREE.TorusGeometry(1, 0.18, 5, 12);
const ARC = new THREE.TorusGeometry(1, 0.1, 4, 10, Math.PI);
const RIPPLE = new THREE.TorusGeometry(1, 0.07, 3, 40);
const HALF_TOP = new THREE.SphereGeometry(1, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2);
const HALF_BOTTOM = new THREE.SphereGeometry(1, 14, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);

/** Metal trim is a little shinier than everything else. */
const SHINY = new Set(['#b8bec6', '#d4a537', '#9aa0a6', '#d9dde2']);

function mesh(geo: THREE.BufferGeometry, color: string, sx: number, sy: number, sz: number, x = 0, y = 0, z = 0, shadow = false) {
  const m = new THREE.Mesh(geo, mat(color, SHINY.has(color) ? { rough: 0.45 } : {}));
  m.scale.set(sx, sy, sz);
  m.position.set(x, y, z);
  m.castShadow = shadow;
  m.receiveShadow = true;
  return m;
}

/** A tube along the rod (y) from y0 to y1, tapering from r0 to r1. */
function rodTube(color: string, y0: number, y1: number, r0: number, r1 = r0, opts: { rough?: number } = {}) {
  const g = new THREE.CylinderGeometry(r1, r0, y1 - y0, 10);
  const m = new THREE.Mesh(g, mat(color, opts));
  m.position.y = (y0 + y1) / 2;
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** Blank radius at height y (tapers from the grip to the tip). */
function blankR(y: number) {
  const t = (y - BLANK_START) / (ROD_LEN - BLANK_START);
  return 0.017 + (0.005 - 0.017) * Math.min(1, Math.max(0, t));
}

/** A thin line material that bends with the world like everything else. */
function lineMat(color: string, opacity: number) {
  return bend(new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity }));
}

/**
 * The fishing rod for the player's hand. The returned group holds an object
 * named `rodTip` at the tip, where the line leaves the rod.
 */
export function fishingRodModel(style: RodStyle = 'basic'): THREE.Group {
  const s = STYLE[style];
  const outer = new THREE.Group();
  const rod = new THREE.Group();
  rod.rotation.x = ROD_TILT;
  outer.add(rod);

  // Grip: rubber butt cap, rear cork grip, metal reel seat, cork fore-grip.
  rod.add(rodTube('#2b2b2b', -0.17, -0.14, 0.03, 0.028));
  rod.add(rodTube('#c9a06a', -0.14, 0.0, 0.027, 0.025));
  rod.add(rodTube(s.trim, 0.0, 0.09, 0.022, 0.022, { rough: 0.45 }));
  rod.add(rodTube('#c9a06a', 0.09, BLANK_START, 0.025, 0.02));
  for (const y of [-0.1, -0.05, 0.13, 0.17]) rod.add(rodTube('#a8814e', y, y + 0.006, 0.0275, 0.0275));
  rod.add(rodTube(s.trim, BLANK_START - 0.01, BLANK_START + 0.01, 0.021, 0.019, { rough: 0.45 }));

  // Blank: one tapered tube, a thread wrap near the grip.
  rod.add(rodTube(s.blank, BLANK_START, ROD_LEN, 0.017, 0.005, { rough: 0.5 }));
  rod.add(rodTube(s.wrap, BLANK_START + 0.02, BLANK_START + 0.06, 0.0185, 0.0182));

  // Line guides under the blank (rings shrink towards the tip), each with a wrap.
  const guides: THREE.Vector3[] = [];
  for (const [y, r] of [[0.42, 0.024], [0.68, 0.017], [0.9, 0.013], [1.1, 0.01], [1.26, 0.008]] as const) {
    const br = blankR(y);
    const z = br + r + 0.004;
    const ring = mesh(RING, s.trim, r, r, r, 0, y, z);
    ring.rotation.x = Math.PI / 2; // ring plane across the rod
    rod.add(ring);
    rod.add(mesh(TUBE, s.trim, 0.003, 0.03, 0.003, 0, y, br + 0.002)); // foot
    rod.add(rodTube(s.wrap, y - 0.018, y + 0.018, br + 0.0015, br + 0.0012));
    guides.push(new THREE.Vector3(0, y, z));
  }
  // Tip-top.
  const tipRing = mesh(RING, s.trim, 0.006, 0.006, 0.006, 0, ROD_LEN, 0.008);
  tipRing.rotation.x = Math.PI / 2;
  rod.add(tipRing);
  const tip = new THREE.Object3D();
  tip.name = 'rodTip';
  tip.position.set(0, ROD_LEN + 0.004, 0.008);
  rod.add(tip);

  // Spinning reel hanging under the reel seat.
  const reel = new THREE.Group();
  reel.position.set(0, 0.045, 0.0);
  rod.add(reel);
  reel.add(mesh(TUBE, s.reel, 0.008, 0.012, 0.045, 0, 0, 0.032)); // stem
  const body = mesh(TUBE, s.reel, 0.03, 0.05, 0.03, 0, 0.0, 0.075, true);
  reel.add(body);
  reel.add(mesh(HALF_BOTTOM, s.reel, 0.03, 0.02, 0.03, 0, -0.025, 0.075));
  reel.add(mesh(TUBE, '#d9dde2', 0.027, 0.03, 0.027, 0, 0.04, 0.075)); // spool
  reel.add(mesh(TUBE, '#f2f2f0', 0.022, 0.026, 0.022, 0, 0.04, 0.075)); // line on the spool
  reel.add(mesh(TUBE, s.trim, 0.029, 0.006, 0.029, 0, 0.058, 0.075)); // spool lip
  const bail = mesh(ARC, s.trim, 0.034, 0.034, 0.034, 0, 0.05, 0.075);
  bail.rotation.y = Math.PI / 2;
  reel.add(bail);
  // Crank on the side, with a knob.
  const arm = mesh(TUBE, s.reel, 0.004, 0.05, 0.004, 0.045, 0.0, 0.075);
  arm.rotation.z = Math.PI / 2;
  reel.add(arm);
  reel.add(mesh(TUBE, s.reel, 0.004, 0.035, 0.004, 0.07, 0.0, 0.092));
  reel.add(mesh(TUBE, '#2b2b2b', 0.009, 0.02, 0.009, 0.07, -0.01, 0.105));

  // The line from the spool, through the guides, to the tip.
  const pts = [new THREE.Vector3(0, 0.085, 0.075), ...guides, tip.position.clone()];
  const runner = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), lineMat('#f4f4f0', 0.9));
  rod.add(runner);

  return outer;
}

/** The world-space position of a rod's tip (or null if this isn't a rod). */
export function rodTipWorld(tool: THREE.Object3D, out: THREE.Vector3): THREE.Vector3 | null {
  const tip = tool.getObjectByName('rodTip');
  if (!tip) return null;
  return tip.getWorldPosition(out);
}

/**
 * A classic float: red cap over a white body with a black band, a thin antenna
 * with a bright tip on top and a keel stem below. Its waist (y = 0) sits on the
 * water. `lineAttach` marks where the line ties on; `ripple` is a ring on the
 * water around it.
 */
export function bobberModel(): THREE.Group {
  const g = new THREE.Group();
  const float = new THREE.Group();
  float.name = 'float';
  g.add(float);
  float.add(mesh(HALF_TOP, '#e53935', 0.06, 0.05, 0.06, 0, 0, 0, true));
  float.add(mesh(HALF_BOTTOM, '#f6f3ec', 0.06, 0.085, 0.06, 0, 0, 0, true));
  float.add(mesh(TUBE, '#1f1f1f', 0.0645, 0.012, 0.0645, 0, 0, 0)); // band at the waist
  float.add(mesh(TUBE, '#f6f3ec', 0.007, 0.1, 0.007, 0, 0.095, 0)); // antenna
  float.add(mesh(TUBE, '#ffd23f', 0.009, 0.03, 0.009, 0, 0.15, 0)); // bright tip
  float.add(mesh(HALF_TOP, '#ffd23f', 0.009, 0.008, 0.009, 0, 0.165, 0));
  float.add(mesh(TUBE, '#3a3532', 0.005, 0.06, 0.005, 0, -0.11, 0)); // keel stem
  const eye = mesh(RING, '#9aa0a6', 0.008, 0.008, 0.008, 0, 0.176, 0);
  float.add(eye);
  const attach = new THREE.Object3D();
  attach.name = 'lineAttach';
  attach.position.set(0, 0.17, 0);
  float.add(attach);
  // Ripple ring on the water (kept at the water line by the caller).
  // Its own material: its opacity is animated (the shared cached ones must stay as they are).
  const ripple = new THREE.Mesh(RIPPLE, bend(new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.45, depthWrite: false })));
  ripple.name = 'ripple';
  ripple.rotation.x = Math.PI / 2;
  ripple.scale.set(0.1, 0.1, 0.05);
  g.add(ripple);
  // A touch bigger than life so it reads from the game camera.
  g.scale.setScalar(1.5);
  return g;
}

/** The fishing line from the rod tip to the float: a sagging curve, updated every frame. */
export const LINE_SEGMENTS = 20;

export function fishingLineModel(): THREE.Line {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array((LINE_SEGMENTS + 1) * 3), 3));
  const line = new THREE.Line(geo, lineMat('#f4f4f0', 0.85));
  line.frustumCulled = false;
  line.visible = false;
  return line;
}

/**
 * Lay the line from `a` (rod tip) to `b` (float) with a sag below the straight
 * line; `sag` is in tiles (0 = taut). `twitch` shakes the line a little (a bite).
 */
export function layLine(line: THREE.Line, a: THREE.Vector3, b: THREE.Vector3, sag: number, twitch = 0, t = 0) {
  const pos = (line.geometry as THREE.BufferGeometry).getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i <= LINE_SEGMENTS; i++) {
    const f = i / LINE_SEGMENTS;
    const drop = 4 * f * (1 - f) * sag;
    const jig = twitch ? Math.sin(f * Math.PI) * Math.sin(t * 40 + f * 9) * twitch : 0;
    pos.setXYZ(i, a.x + (b.x - a.x) * f + jig, a.y + (b.y - a.y) * f - drop, a.z + (b.z - a.z) * f + jig * 0.6);
  }
  pos.needsUpdate = true;
}

