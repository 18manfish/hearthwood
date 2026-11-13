// Chibi characters: the rig, animal villagers, hair and hats. The player model
// (body, face, clothes) is in player.ts.

import * as THREE from 'three';
import { garmentOf, ITEMS, type VillagerDef } from '@hearthwood/shared';
import { mat, part } from './models.ts';

export interface Rig {
  root: THREE.Group;
  body: THREE.Group;
  head: THREE.Group;
  armL: THREE.Object3D;
  armR: THREE.Object3D;
  legL: THREE.Object3D;
  legR: THREE.Object3D;
  hatSlot: THREE.Group;
  tool: THREE.Group;
  phase: number;
}

function limb(color: string, w: number, h: number, x: number, y: number) {
  // Pivot at the top so limbs swing from the shoulder / hip.
  const pivot = new THREE.Group();
  pivot.position.set(x, y, 0);
  const m = part('box', color, w, h, w, 0, -h / 2, 0);
  pivot.add(m);
  return pivot;
}

function baseRig(skin: string, shirt: string, pants: string, shoes: string, skirt: boolean): Rig {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const legL = limb(pants, 0.13, 0.32, -0.1, 0.36);
  const legR = limb(pants, 0.13, 0.32, 0.1, 0.36);
  legL.add(part('box', shoes, 0.15, 0.08, 0.2, 0, -0.32, 0.03));
  legR.add(part('box', shoes, 0.15, 0.08, 0.2, 0, -0.32, 0.03));
  body.add(legL, legR);
  body.add(part('box', shirt, 0.38, 0.36, 0.26, 0, 0.53, 0));
  if (skirt) body.add(part('cone', pants, 0.3, 0.26, 0.3, 0, 0.36, 0));
  else body.add(part('box', pants, 0.39, 0.1, 0.27, 0, 0.36, 0));
  const armL = limb(shirt, 0.1, 0.3, -0.25, 0.69);
  const armR = limb(shirt, 0.1, 0.3, 0.25, 0.69);
  armL.add(part('sphere', skin, 0.06, 0.06, 0.06, 0, -0.32, 0));
  armR.add(part('sphere', skin, 0.06, 0.06, 0.06, 0, -0.32, 0));
  body.add(armL, armR);
  const head = new THREE.Group();
  head.position.y = 0.98;
  body.add(head);
  const hatSlot = new THREE.Group();
  head.add(hatSlot);
  const tool = new THREE.Group();
  tool.position.set(0, -0.32, 0.04);
  armR.add(tool);
  return { root, body, head, armL, armR, legL, legR, hatSlot, tool, phase: Math.random() * 6 };
}

function addFace(head: THREE.Group, eyes: string, z: number, y = 0, blush = true) {
  for (const x of [-0.1, 0.1]) {
    head.add(part('sphere', eyes, 0.045, 0.06, 0.03, x, y + 0.02, z, false));
    head.add(part('sphere', '#ffffff', 0.015, 0.015, 0.01, x + 0.015, y + 0.045, z + 0.02, false));
  }
  if (blush) for (const x of [-0.17, 0.17]) head.add(part('sphere', mat('#ff9aa2', { opacity: 0.7 }), 0.05, 0.025, 0.01, x, y - 0.06, z - 0.03, false));
}

export function addHair(head: THREE.Group, style: string, color: string) {
  const c = mat(color);
  const cap = part('sphere', c, 0.34, 0.3, 0.34, 0, 0.06, -0.02);
  cap.scale.set(0.34, 0.3, 0.34);
  switch (style) {
    case 'buzz':
      head.add(part('sphere', c, 0.325, 0.27, 0.325, 0, 0.06, -0.03));
      return;
    case 'short':
      head.add(cap);
      head.add(part('box', c, 0.5, 0.1, 0.18, 0, 0.2, 0.18));
      return;
    case 'spiky':
      head.add(cap);
      for (let i = 0; i < 7; i++) {
        const sp = part('cone', c, 0.08, 0.22, 0.08, Math.cos(i) * 0.18, 0.3, Math.sin(i) * 0.15);
        sp.rotation.z = -Math.cos(i) * 0.6;
        sp.rotation.x = Math.sin(i) * 0.6;
        head.add(sp);
      }
      return;
    case 'curly':
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        head.add(part('sphere', c, 0.11, 0.11, 0.11, Math.cos(a) * 0.24, 0.2 + (i % 2) * 0.08, Math.sin(a) * 0.22 - 0.03));
      }
      head.add(part('sphere', c, 0.2, 0.15, 0.2, 0, 0.3, 0));
      return;
    case 'long':
      head.add(cap);
      head.add(part('box', c, 0.6, 0.6, 0.2, 0, -0.12, -0.2));
      return;
    case 'ponytail':
      head.add(cap);
      head.add(part('sphere', c, 0.12, 0.22, 0.12, 0, 0.0, -0.4));
      head.add(part('sphere', mat('#e86fae'), 0.05, 0.05, 0.05, 0, 0.12, -0.33));
      return;
    case 'bob':
      // Kept behind the face so it frames it instead of covering it.
      head.add(part('sphere', c, 0.37, 0.34, 0.31, 0, 0.0, -0.085));
      head.add(part('box', c, 0.56, 0.1, 0.18, 0, 0.2, 0.2));
      return;
    case 'pigtails':
      head.add(cap);
      for (const x of [-0.36, 0.36]) head.add(part('sphere', c, 0.12, 0.16, 0.12, x, -0.02, -0.08));
      return;
  }
}

export function setHat(rig: Rig, hat: string | null) {
  rig.hatSlot.clear();
  if (!hat) return;
  const col = ITEMS[hat]?.color ?? '#e8c872';
  switch (garmentOf(hat)) {
    case 'straw_hat':
      rig.hatSlot.add(part('cyl', col, 0.5, 0.03, 0.5, 0, 0.26, 0));
      rig.hatSlot.add(part('cyl', col, 0.26, 0.16, 0.26, 0, 0.34, 0));
      rig.hatSlot.add(part('cyl', '#c0392b', 0.265, 0.04, 0.265, 0, 0.3, 0));
      break;
    case 'beanie':
      rig.hatSlot.add(part('sphere', col, 0.35, 0.25, 0.35, 0, 0.16, 0));
      rig.hatSlot.add(part('sphere', '#ffffff', 0.08, 0.08, 0.08, 0, 0.42, 0));
      break;
    case 'cap':
      rig.hatSlot.add(part('sphere', col, 0.34, 0.2, 0.34, 0, 0.18, 0));
      rig.hatSlot.add(part('box', col, 0.32, 0.03, 0.25, 0, 0.17, 0.33));
      break;
    case 'sun_hat':
      rig.hatSlot.add(part('cyl', col, 0.58, 0.025, 0.58, 0, 0.24, 0));
      rig.hatSlot.add(part('sphere', col, 0.27, 0.2, 0.27, 0, 0.27, 0));
      rig.hatSlot.add(part('cyl', '#e07a5f', 0.272, 0.05, 0.272, 0, 0.29, 0));
      rig.hatSlot.add(part('sphere', '#ffd166', 0.05, 0.05, 0.03, 0.2, 0.3, 0.17));
      break;
    case 'bucket_hat': {
      rig.hatSlot.add(part('sphere', col, 0.31, 0.24, 0.31, 0, 0.2, 0));
      const brim = part('cone', col, 0.44, 0.1, 0.44, 0, 0.17, 0);
      brim.rotation.x = Math.PI;
      rig.hatSlot.add(brim);
      rig.hatSlot.add(part('cyl', '#3d3d3d', 0.315, 0.035, 0.315, 0, 0.22, 0));
      break;
    }
    case 'flower_crown':
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        rig.hatSlot.add(part('sphere', i % 2 ? '#ff8fb1' : '#ffd166', 0.06, 0.06, 0.06, Math.cos(a) * 0.3, 0.22, Math.sin(a) * 0.3));
      }
      break;
  }
}

export function makeVillager(def: VillagerDef): Rig {
  const rig = baseRig(def.color, def.accent, def.color, def.color, false);
  const h = rig.head;
  const c = def.color;
  const a = def.accent;
  h.add(part('sphere', c, 0.33, 0.3, 0.31, 0, 0, 0));
  const ear = (geo: 'cone' | 'sphere' | 'box', sx: number, sy: number, sz: number, x: number, y: number, z: number, rz = 0) => {
    for (const sgn of [-1, 1]) {
      const e = part(geo, c, sx, sy, sz, x * sgn, y, z);
      e.rotation.z = -rz * sgn;
      h.add(e);
    }
  };
  switch (def.species) {
    case 'cat':
    case 'fox':
    case 'wolf':
      ear('cone', 0.1, 0.2, 0.08, 0.18, 0.3, 0, 0.3);
      h.add(part('sphere', a, 0.14, 0.1, 0.12, 0, -0.08, 0.24));
      h.add(part('sphere', '#2b1d14', 0.04, 0.03, 0.03, 0, -0.04, 0.36, false));
      break;
    case 'dog':
      ear('box', 0.08, 0.24, 0.14, 0.33, -0.02, 0, -0.2);
      h.add(part('sphere', a, 0.15, 0.11, 0.13, 0, -0.08, 0.24));
      h.add(part('sphere', '#2b1d14', 0.05, 0.04, 0.04, 0, -0.03, 0.37, false));
      break;
    case 'rabbit':
      ear('sphere', 0.07, 0.25, 0.05, 0.12, 0.45, 0, 0.1);
      h.add(part('sphere', a, 0.1, 0.07, 0.07, 0, -0.1, 0.27));
      break;
    case 'bear':
    case 'koala':
    case 'hamster':
      ear('sphere', def.species === 'koala' ? 0.15 : 0.09, def.species === 'koala' ? 0.13 : 0.09, 0.06, 0.26, 0.24, 0);
      h.add(part('sphere', def.species === 'koala' ? '#3b3b48' : a, 0.11, 0.08, 0.08, 0, -0.08, 0.27));
      break;
    case 'deer':
      ear('sphere', 0.1, 0.05, 0.05, 0.33, 0.12, 0);
      for (const sgn of [-1, 1]) {
        const an = part('cyl', '#8a5a2b', 0.02, 0.28, 0.02, 0.13 * sgn, 0.38, 0);
        an.rotation.z = -0.4 * sgn;
        h.add(an);
      }
      h.add(part('sphere', a, 0.12, 0.08, 0.1, 0, -0.1, 0.25));
      break;
    case 'owl':
      ear('cone', 0.08, 0.14, 0.06, 0.2, 0.3, 0, 0.5);
      h.add(part('cone', '#f2a03d', 0.05, 0.1, 0.05, 0, -0.04, 0.32));
      for (const x of [-0.11, 0.11]) h.add(part('sphere', a, 0.1, 0.1, 0.04, x, 0.04, 0.24, false));
      break;
    case 'duck':
    case 'penguin':
      h.add(part('box', '#f2a03d', 0.18, 0.06, 0.16, 0, -0.06, 0.3));
      if (def.species === 'penguin') h.add(part('sphere', a, 0.25, 0.2, 0.1, 0, -0.04, 0.2));
      break;
    case 'frog':
      for (const x of [-0.14, 0.14]) h.add(part('sphere', c, 0.11, 0.11, 0.11, x, 0.26, 0.08));
      h.add(part('box', '#c0392b', 0.2, 0.02, 0.05, 0, -0.1, 0.29, false));
      break;
    case 'squirrel': {
      ear('cone', 0.07, 0.15, 0.06, 0.18, 0.3, 0, 0.2);
      const tail = part('sphere', c, 0.18, 0.4, 0.15, 0, 0.6, -0.3);
      rig.body.add(tail);
      h.add(part('sphere', a, 0.11, 0.08, 0.08, 0, -0.08, 0.27));
      break;
    }
  }
  addFace(h, '#1b1b1b', def.species === 'frog' ? 0.28 : 0.27, def.species === 'frog' ? 0.22 : 0.02);
  if (def.species === 'cat' || def.species === 'fox' || def.species === 'wolf' || def.species === 'dog') {
    rig.body.add(part('cone', c, 0.06, 0.4, 0.06, 0, 0.42, -0.2));
  }
  return rig;
}

export function setTool(rig: Rig, tool: 'axe' | 'shovel' | 'rod' | null) {
  if (rig.tool.userData.kind === tool) return;
  rig.tool.userData.kind = tool;
  rig.tool.clear();
  if (!tool) return;
  const handle = part('cyl', '#7a5230', 0.025, 0.55, 0.025, 0, 0, 0.18);
  handle.rotation.x = Math.PI / 2;
  rig.tool.add(handle);
  if (tool === 'axe') rig.tool.add(part('box', '#9e9e9e', 0.04, 0.16, 0.14, 0, 0.06, 0.4));
  if (tool === 'shovel') rig.tool.add(part('box', '#9e9e9e', 0.16, 0.02, 0.18, 0, 0, 0.5));
  if (tool === 'rod') {
    const r = part('cyl', '#3e2723', 0.012, 1.1, 0.012, 0, 0.25, 0.6);
    r.rotation.x = Math.PI / 2.6;
    rig.tool.add(r);
  }
}

/** Walk cycle / idle bob. `swing` > 0 plays a one-shot tool swing. */
export function animateRig(rig: Rig, dt: number, speed: number, swing: number) {
  rig.phase += dt * (speed > 0.05 ? 11 : 2);
  const s = speed > 0.05 ? Math.sin(rig.phase) * 0.7 : 0;
  rig.legL.rotation.x = s;
  rig.legR.rotation.x = -s;
  rig.armL.rotation.x = -s * 0.8;
  rig.armR.rotation.x = swing > 0 ? -2.2 * Math.sin(swing * Math.PI) - 0.4 : s * 0.8;
  rig.body.position.y = speed > 0.05 ? Math.abs(Math.sin(rig.phase)) * 0.05 : Math.sin(rig.phase) * 0.01;
  rig.head.rotation.z = speed > 0.05 ? 0 : Math.sin(rig.phase * 0.5) * 0.03;
}
