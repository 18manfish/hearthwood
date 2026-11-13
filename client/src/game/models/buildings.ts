// Buildings: tents, cabins, shops, the town hall, bridges, docks… built from primitives.

import * as THREE from 'three';
import { type Building, buildingLevel, BUILDINGS, hashString, houseLevel, tiersOf } from '@hearthwood/shared';
import { kitModel } from '../assets/kit.ts';
import { gltfHouse } from '../houseAssets.ts';
import { bend } from '../bend.ts';
import { dockProps } from './dockProps.ts';
import { emojiSprite } from './furniture.ts';
import { mat, part } from './primitives.ts';

export function houseBody(g: THREE.Group, w: number, d: number, wallH: number, wall: string, roof: string, door = '#7a4f2a') {
  const ww = w - 0.4;
  const dd = d - 0.4;
  g.add(part('box', '#c9b79c', ww + 0.15, 0.15, dd + 0.15, 0, 0.075, 0));
  g.add(part('box', wall, ww, wallH, dd, 0, 0.15 + wallH / 2, 0));
  // Roof overhangs the walls a little on every side.
  g.add(part('roof', roof, ww / 2 + 0.25, 1.1, dd / 2 + 0.25, 0, 0.15 + wallH + 0.55, 0));
  // Door & windows face south (+z), towards the camera.
  g.add(part('box', door, 0.5, 0.85, 0.05, 0, 0.15 + 0.425, dd / 2 + 0.02));
  const win = mat('#bfe6ff', { emissive: '#ffd27a', ei: 0 });
  for (const x of [-ww / 3, ww / 3]) {
    const wmesh = part('box', win, 0.38, 0.38, 0.05, x, 0.15 + wallH * 0.62, dd / 2 + 0.02, false);
    wmesh.name = 'window';
    g.add(wmesh);
  }
}

export function buildingModel(b: Building, now: number, style: 'tent' | 'cabin' = 'cabin', opts: { flagUp?: boolean; notes?: number } = {}): THREE.Group {
  const def = BUILDINGS[b.type];
  const g = new THREE.Group();
  const done = b.completeAt <= now;
  if (!done) {
    // Construction site.
    const ww = b.w - 0.3, dd = b.h - 0.3;
    g.add(part('box', '#c9b79c', ww, 0.1, dd, 0, 0.05, 0));
    for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) g.add(part('box', '#d9a441', 0.08, 1.4, 0.08, (x * ww) / 2.2, 0.7, (z * dd) / 2.2));
    g.add(part('box', mat('#ffffff', { opacity: 0.25 }), ww * 0.9, 1.2, dd * 0.9, 0, 0.7, 0, false));
    g.add(part('box', '#a0703f', 0.5, 0.25, 0.3, ww / 3, 0.15, dd / 3));
    return g;
  }
  // Town Hall, shops and villager houses: the kit model of their current tier.
  if (b.type !== 'cabin' && tiersOf(b.type).length) {
    const level = buildingLevel(b, now);
    const model = kitBuilding(b, level);
    if (model) {
      g.add(model);
      if (b.upgrade && b.upgrade.at > now) scaffolding(g, b.w, b.h, level);
      return g;
    }
  }
  switch (b.type) {
    case 'bridge_ns':
    case 'bridge_ew':
    case 'bridge_ns_long':
    case 'bridge_ew_long': {
      // Deck running along the long axis, planks across it, posts and rails on both sides.
      const along = b.type.startsWith('bridge_ns');
      const len = along ? b.h : b.w, wid = along ? b.w : b.h;
      const deck = new THREE.Group();
      const deckY = 0.16;
      for (let i = 0; i < len * 4; i++) {
        const o = -len / 2 + 0.125 + i * 0.25;
        deck.add(part('box', i % 3 === 0 ? '#9c7a52' : i % 3 === 1 ? '#8b6b47' : '#a8875c', wid - 0.1, 0.07, 0.23, 0, deckY - 0.035, o));
      }
      for (const s of [-1, 1]) {
        deck.add(part('box', '#6d4c2f', 0.1, 0.08, len - 0.2, s * (wid / 2 - 0.12), deckY - 0.1, 0));
        for (let i = 0; i <= len; i++) deck.add(part('box', '#7a5230', 0.09, 0.55, 0.09, s * (wid / 2 - 0.1), deckY + 0.27, -len / 2 + 0.15 + i * ((len - 0.3) / len)));
        deck.add(part('box', '#a0703f', 0.08, 0.07, len - 0.2, s * (wid / 2 - 0.1), deckY + 0.52, 0));
      }
      if (!along) deck.rotation.y = Math.PI / 2;
      g.add(deck);
      break;
    }
    case 'exit':
      g.add(part('box', '#8d5a3b', 0.9, 0.03, 0.7, 0, 0.02, 0, false));
      g.add(part('box', '#c0392b', 0.7, 0.035, 0.5, 0, 0.025, 0, false));
      break;
    case 'bed':
      if (style === 'tent') {
        // Sleeping bag + pillow.
        g.add(part('box', '#3d6fb6', 0.8, 0.14, 1.7, 0, 0.07, 0.05));
        g.add(part('box', '#5c86c9', 0.78, 0.16, 0.6, 0, 0.1, 0.5));
        g.add(part('box', '#f5ecd7', 0.6, 0.12, 0.35, 0, 0.12, -0.7));
      } else {
        g.add(part('box', '#8d5a3b', 0.9, 0.3, 1.9, 0, 0.15, 0));
        g.add(part('box', '#f5ecd7', 0.82, 0.14, 1.8, 0, 0.36, 0));
        // Blanket and headboard overlap their neighbours slightly so no faces are coplanar (no z-fighting).
        g.add(part('box', '#e8607a', 0.86, 0.17, 1.14, 0, 0.39, 0.37));
        g.add(part('box', '#8d5a3b', 0.94, 0.8, 0.1, 0, 0.4, -0.93));
        g.add(part('box', '#ffffff', 0.55, 0.1, 0.3, 0, 0.45, -0.65));
      }
      break;
    case 'chest':
      g.add(part('box', '#a0703f', 0.8, 0.5, 0.55, 0, 0.25, 0));
      g.add(part('box', '#8b5e34', 0.84, 0.12, 0.59, 0, 0.53, 0));
      g.add(part('box', '#f6c445', 0.12, 0.14, 0.04, 0, 0.42, 0.29, false));
      break;
    case 'shack': {
      // Colourful plank house with a gable roof, porch light and flower box.
      const h = hashString(b.id);
      const walls = ['#e8604c', '#f2c14e', '#3fa7d6', '#59cd90', '#ee6c4d', '#9b5de5', '#f7a072', '#4ecdc4'];
      const roofs = ['#2b4c7e', '#3d5a80', '#9a3b3b', '#5a7d9a', '#7f5539', '#2a9d8f'];
      const wall = walls[h % walls.length], roofC = roofs[(h >> 4) % roofs.length];
      const ww = b.w - 0.35, dd = b.h - 0.5, wh = 1.25;
      g.add(part('box', '#6d4c2f', ww + 0.2, 0.18, dd + 0.25, 0, 0.09, 0.05)); // porch deck
      g.add(part('box', wall, ww, wh, dd, 0, 0.18 + wh / 2, 0));
      // Vertical plank lines + darker corner trims.
      const plankLine = mat('#000000', { opacity: 0.12 });
      for (let i = 1; i < 6; i++) g.add(part('box', plankLine, 0.015, wh - 0.05, 0.01, -ww / 2 + (ww / 6) * i, 0.18 + wh / 2, dd / 2 + 0.006, false));
      for (const sx of [-1, 1]) g.add(part('box', '#5d4037', 0.08, wh, 0.08, (sx * ww) / 2, 0.18 + wh / 2, dd / 2));
      const roof = part('gable', roofC, ww + 0.45, 0.75, dd + 0.5, 0, 0.18 + wh, 0);
      g.add(roof);
      g.add(part('box', '#f5ecd7', ww + 0.5, 0.06, 0.08, 0, 0.18 + wh + 0.74, 0, false)); // ridge cap
      // Door, window with shutters, flower box, lantern, stove pipe.
      g.add(part('box', '#6d4c2f', 0.36, 0.72, 0.05, -ww / 4, 0.18 + 0.36, dd / 2 + 0.03));
      g.add(part('sphere', '#f6c445', 0.03, 0.03, 0.03, -ww / 4 + 0.12, 0.55, dd / 2 + 0.07, false));
      const win = part('box', mat('#bfe6ff', { emissive: '#ffd27a', ei: 0 }), 0.34, 0.3, 0.05, ww / 4, 0.18 + 0.78, dd / 2 + 0.03, false);
      win.name = 'window';
      g.add(win);
      for (const sx of [-1, 1]) g.add(part('box', roofC, 0.1, 0.32, 0.04, ww / 4 + sx * 0.23, 0.96, dd / 2 + 0.05, false));
      g.add(part('box', '#8b5e34', 0.4, 0.09, 0.12, ww / 4, 0.76, dd / 2 + 0.1, false));
      for (let i = 0; i < 4; i++) g.add(part('sphere', ['#ff6f91', '#ffd166', '#ffffff', '#c77dff'][(h + i) % 4], 0.045, 0.045, 0.045, ww / 4 - 0.14 + i * 0.09, 0.83, dd / 2 + 0.12, false));
      const lamp = part('box', mat('#fff3c4', { emissive: '#ffcf6b', ei: 0.2 }), 0.1, 0.14, 0.1, 0.02, 1.15, dd / 2 + 0.12, false);
      g.add(lamp);
      g.add(part('cyl', '#9e9e9e', 0.05, 0.5, 0.05, ww / 3, 0.18 + wh + 0.6, -dd / 4));
      break;
    }
    case 'stall': {
      // Market stall with a striped awning and produce crates.
      const h = hashString(b.id);
      const stripe = ['#e8604c', '#3fa7d6', '#59cd90', '#f2c14e'][h % 4];
      g.add(part('box', '#a0703f', b.w - 0.3, 0.55, 0.55, 0, 0.275, 0.05));
      g.add(part('box', '#c49a62', b.w - 0.2, 0.06, 0.65, 0, 0.58, 0.05));
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(part('box', '#6d4c2f', 0.06, 1.5, 0.06, (sx * (b.w - 0.35)) / 2, 0.75, sz * 0.32));
      for (let i = 0; i < 6; i++) {
        const st = part('box', i % 2 ? '#ffffff' : stripe, (b.w - 0.1) / 6, 0.05, 0.95, -b.w / 2 + 0.05 + ((b.w - 0.1) / 6) * (i + 0.5), 1.5, 0.05);
        st.rotation.x = -0.25;
        g.add(st);
      }
      const goods = [['#e53935', '#ff7043'], ['#f6d743', '#9ccc65'], ['#8ecae6', '#cfd8dc']][h % 3];
      for (let i = 0; i < 3; i++) {
        g.add(part('box', '#8b6338', 0.4, 0.12, 0.3, -0.55 + i * 0.55, 0.67, 0.05));
        for (let k = 0; k < 4; k++) g.add(part('sphere', goods[(i + k) % 2], 0.06, 0.06, 0.06, -0.65 + i * 0.55 + (k % 2) * 0.16, 0.76, -0.02 + Math.floor(k / 2) * 0.12, false));
      }
      break;
    }
    case 'lighthouse': {
      // Striped tower, gallery, glowing lamp room and a sweeping beam.
      for (let i = 0; i < 5; i++) g.add(part('cyl', i % 2 ? '#ffffff' : '#d64541', 0.62 - i * 0.05, 0.62, 0.62 - i * 0.05, 0, 0.31 + i * 0.62, 0));
      g.add(part('cyl', '#3b3b48', 0.6, 0.08, 0.6, 0, 3.14, 0));
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        g.add(part('box', '#3b3b48', 0.03, 0.25, 0.03, Math.cos(a) * 0.56, 3.3, Math.sin(a) * 0.56, false));
      }
      const lampRoom = part('cyl', mat('#fff3c4', { emissive: '#ffcf6b', ei: 0.2 }), 0.32, 0.45, 0.32, 0, 3.42, 0, false);
      g.add(lampRoom);
      g.add(part('cone', '#d64541', 0.42, 0.4, 0.42, 0, 3.85, 0));
      const beam = new THREE.Mesh(new THREE.ConeGeometry(0.9, 9, 12, 1, true).translate(0, -4.5, 0).rotateZ(Math.PI / 2), bend(new THREE.MeshBasicMaterial({ color: '#fff3c4', transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending })));
      const pivot = new THREE.Group();
      pivot.position.set(0, 3.42, 0);
      pivot.add(beam);
      pivot.name = 'beam';
      g.add(pivot);
      const light = new THREE.PointLight('#ffe2a8', 0, 12, 1.5);
      light.position.set(0, 3.4, 0);
      light.name = 'lighthouse-light';
      g.add(light);
      g.add(part('box', '#6d4c2f', 0.4, 0.62, 0.05, 0, 0.31, 0.6)); // door
      break;
    }
    case 'fountain': {
      g.add(part('cyl', '#b8b2a7', 0.95, 0.35, 0.95, 0, 0.175, 0));
      const water = part('cyl', mat('#6fc3e8', { emissive: '#3fa7d6', ei: 0.15, opacity: 0.85 }), 0.82, 0.04, 0.82, 0, 0.34, 0, false);
      water.name = 'fwater';
      g.add(water);
      g.add(part('cyl', '#a7a196', 0.14, 0.9, 0.14, 0, 0.6, 0));
      g.add(part('cyl', '#b8b2a7', 0.38, 0.1, 0.38, 0, 1.02, 0));
      g.add(part('cyl', mat('#6fc3e8', { emissive: '#3fa7d6', ei: 0.15, opacity: 0.85 }), 0.32, 0.03, 0.32, 0, 1.07, 0, false));
      const spout = part('cone', mat('#bfe6ff', { opacity: 0.6 }), 0.08, 0.35, 0.08, 0, 1.25, 0, false);
      spout.name = 'spout';
      g.add(spout);
      break;
    }
    case 'counter': {
      // Service counter with a bell.
      g.add(part('box', '#8b5e34', b.w - 0.1, 0.9, 0.7, 0, 0.45, 0));
      g.add(part('box', '#c49a62', b.w + 0.05, 0.08, 0.8, 0, 0.94, 0));
      g.add(part('cyl', '#f6c445', 0.08, 0.06, 0.08, 0.5, 1.0, 0.15));
      g.add(part('sphere', '#f6c445', 0.03, 0.03, 0.03, 0.5, 1.05, 0.15, false));
      break;
    }
    case 'billboard': {
      // Cork board on posts with a little roof; paper notes appear as players pin them.
      for (const sx of [-1, 1]) g.add(part('box', '#6d4c2f', 0.1, 1.9, 0.1, sx * 0.85, 0.95, 0));
      g.add(part('box', '#8b5e34', 1.8, 1.05, 0.08, 0, 1.2, 0.02));
      g.add(part('box', '#c99a5b', 1.62, 0.88, 0.04, 0, 1.2, 0.07));
      const roof = part('gable', '#9a3b3b', 2.0, 0.35, 0.4, 0, 1.75, 0.02);
      g.add(roof);
      const notes = Math.min(opts.notes ?? 0, 12);
      const colors = ['#fff8b5', '#ffd6e0', '#cdeffd', '#d9f7c8', '#ffffff'];
      for (let i = 0; i < notes; i++) {
        const nh = hashString(`${b.id}:${i}`);
        const nx = -0.65 + (i % 4) * 0.43 + ((nh % 7) - 3) * 0.01, ny = 1.48 - Math.floor(i / 4) * 0.3;
        const n = part('box', colors[nh % colors.length], 0.3, 0.22, 0.01, nx, ny, 0.1, false);
        n.rotation.z = ((nh % 11) - 5) * 0.03;
        g.add(n);
        g.add(part('sphere', '#e53935', 0.02, 0.02, 0.02, nx, ny + 0.08, 0.11, false));
      }
      break;
    }
    case 'campfire': {
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2;
        g.add(part('dodeca', '#8d8f93', 0.1, 0.08, 0.1, Math.cos(a) * 0.32, 0.06, Math.sin(a) * 0.32));
      }
      for (let i = 0; i < 3; i++) {
        const l = part('cyl', '#6d4c2f', 0.05, 0.5, 0.05, 0, 0.12, 0);
        l.rotation.z = Math.PI / 2.4;
        l.rotation.y = (i / 3) * Math.PI * 2;
        g.add(l);
      }
      const flame = part('cone', mat('#ffb347', { emissive: '#ff7b00', ei: 1.4 }), 0.18, 0.45, 0.18, 0, 0.35, 0, false);
      flame.name = 'flame';
      g.add(flame);
      const light = new THREE.PointLight('#ff9a3c', 2, 6, 1.5);
      light.position.set(0, 0.7, 0);
      light.name = 'firelight';
      g.add(light);
      break;
    }
    case 'tent': {
      g.add(part('roof', def.color, 0.85, 1.3, 0.85, 0, 0.65, 0));
      g.add(part('box', '#5d4037', 0.35, 0.6, 0.05, 0, 0.3, 0.58));
      g.add(part('box', def.roof, 0.05, 1.4, 0.05, 0, 0.7, 0));
      break;
    }
    case 'workbench':
      g.add(part('box', def.color, 0.9, 0.08, 0.6, 0, 0.55, 0));
      for (const [x, z] of [[-0.38, -0.22], [0.38, -0.22], [-0.38, 0.22], [0.38, 0.22]]) g.add(part('box', '#6d4c2f', 0.07, 0.55, 0.07, x, 0.27, z));
      g.add(part('box', '#9e9e9e', 0.25, 0.06, 0.1, 0.2, 0.62, 0));
      g.add(part('cyl', '#7a5230', 0.03, 0.3, 0.03, -0.2, 0.62, 0.05));
      break;
    case 'dock': {
      // The deck itself is part of the boardwalk mesh (piles and bollards too); add the fishing clutter.
      g.add(dockProps());
      break;
    }
    case 'cabin': {
      const level = houseLevel(b, now);
      const model = gltfHouse(level, (c) => mat(c), () => mat('#bfe6ff', { emissive: '#ffd27a', ei: 0 }));
      if (model) g.add(model);
      else proceduralHouse(g, b, level, def.color, def.roof);
      if (b.upgrade && b.upgrade.at > now) scaffolding(g, b.w, b.h, level);
      break;
    }
    case 'mailbox': {
      // Post + rounded-top box, door facing south, flag on the side.
      g.add(part('box', '#7a5230', 0.09, 0.75, 0.09, 0, 0.375, 0));
      g.add(part('box', def.color, 0.34, 0.24, 0.5, 0, 0.85, 0));
      const top = part('cyl', def.color, 0.17, 0.5, 0.17, 0, 0.97, 0);
      top.rotation.x = Math.PI / 2;
      g.add(top);
      g.add(part('box', '#f5ecd7', 0.2, 0.14, 0.02, 0, 0.88, 0.255, false));
      const flag = new THREE.Group();
      flag.position.set(0.19, 0.82, -0.1);
      flag.add(part('box', '#555555', 0.02, 0.32, 0.02, 0, 0.16, 0, false));
      flag.add(part('box', '#f6c445', 0.02, 0.1, 0.16, 0, 0.28, 0.08, false));
      flag.rotation.x = opts.flagUp ? 0 : -Math.PI / 2; // up = you've got mail
      g.add(flag);
      break;
    }
    case 'town_hall': {
      houseBody(g, b.w, b.h, 1.8, def.color, def.roof);
      // Clock tower rising through the roof ridge.
      g.add(part('box', def.color, 0.8, 1.4, 0.8, 0, 2.75, 0));
      g.add(part('roof', def.roof, 0.5, 0.7, 0.5, 0, 3.8, 0));
      const clock = part('cyl', '#ffffff', 0.25, 0.04, 0.25, 0, 3.05, 0.41);
      clock.rotation.x = Math.PI / 2; // face forward
      g.add(clock);
      const hand = part('box', '#3b2f25', 0.03, 0.17, 0.02, 0, 3.1, 0.44, false);
      g.add(hand);
      g.add(part('cyl', '#555555', 0.02, 0.6, 0.02, 0, 4.4, 0));
      g.add(part('box', '#e74c3c', 0.4, 0.25, 0.02, 0.2, 4.55, 0));
      break;
    }
    case 'villager_house':
      houseBody(g, b.w + 0.3, b.h + 0.3, 1.1, def.color, ['#6aa84f', '#e67e22', '#3d6fb6', '#c2185b', '#8e5a3c', '#16a085', '#f1c40f'][hashString(b.id) % 7]);
      break;
    default: {
      houseBody(g, b.w, b.h, 1.5, def.color, def.roof);
      // Awning
      g.add(part('box', def.roof, b.w - 0.3, 0.06, 0.5, 0, 1.25, b.h / 2 - 0.0));
    }
  }
  return g;
}

const ROOFS = ['#6aa84f', '#e67e22', '#3d6fb6', '#c2185b', '#8e5a3c', '#16a085', '#f1c40f'];
const WALLS = ['#f3d9b1', '#f6e7c8', '#e9d5c0', '#f2dfd6', '#e3ead2', '#dfe8ef', '#f4e4b8'];

/** Kit model `bld_<type>_<tier>`; villager houses get their own roof and wall colours. */
function kitBuilding(b: Building, level: number): THREE.Object3D | null {
  const h = hashString(b.id);
  const roof = ROOFS[h % ROOFS.length];
  const wall = WALLS[Math.floor(h / 7) % WALLS.length];
  const recolor = b.type === 'villager_house'
    ? (role: string) => (role === 'vroof' ? mat(roof) : role === 'vroof_dark' ? mat(shade(roof, 0.8)) : role === 'vwall' ? mat(wall) : null)
    : undefined;
  return kitModel(`bld_${b.type}_${level}`, recolor);
}

function shade(hex: string, f: number) {
  const c = new THREE.Color(hex).multiplyScalar(f);
  return `#${c.getHexString()}`;
}

/** Fallback Starter House tiers when house.glb isn't available. */
function proceduralHouse(g: THREE.Group, b: Building, level: number, wall: string, roof: string) {
  if (level <= 1) {
    houseBody(g, b.w, b.h, 1.4, wall, roof);
    g.add(part('box', '#5d4037', 0.25, 0.7, 0.25, b.w / 4, 2.3, -0.2));
  } else if (level === 2) {
    houseBody(g, b.w, b.h, 2.2, '#f3dfb8', '#4a6670', '#2f5d50');
    g.add(part('box', '#4e3523', b.w - 0.3, 0.1, b.h - 0.3, 0, 1.3, 0));
    g.add(part('box', '#9c4a3a', 0.3, 0.9, 0.3, -b.w / 4, 3.3, -0.3));
    g.add(part('box', '#8b6b47', 1.8, 0.3, 0.5, 0, 0.15, b.h / 2 - 0.05));
  } else {
    houseBody(g, b.w, b.h, 2.4, '#efe6d2', '#3d5a80', '#7a1f3d');
    g.add(part('box', '#fbf8f0', b.w - 0.3, 0.1, b.h - 0.3, 0, 1.5, 0));
    g.add(part('cyl', '#efe6d2', 0.4, 3.0, 0.4, -b.w / 2 + 0.5, 1.8, b.h / 2 - 0.7));
    g.add(part('cone', '#3d5a80', 0.5, 1.2, 0.5, -b.w / 2 + 0.5, 3.9, b.h / 2 - 0.7));
    for (const x of [-0.4, 0.4]) g.add(part('cyl', '#fbf8f0', 0.07, 1.0, 0.07, x, 0.65, b.h / 2 - 0.05));
    g.add(part('sphere', '#e0b43a', 0.08, 0.08, 0.08, -b.w / 2 + 0.5, 4.55, b.h / 2 - 0.7));
  }
}

/** Builders at work: poles, planks and a sign around the house being upgraded. */
function scaffolding(g: THREE.Group, w: number, d: number, level: number) {
  const top = [2.0, 2.9, 3.4][level - 1] ?? 2.4;
  const hx = w / 2 - 0.06, hz = d / 2 - 0.06;
  for (const [x, z] of [[-hx, hz], [hx, hz], [-hx, -hz], [hx, -hz], [0, hz]]) g.add(part('box', '#d9a441', 0.07, top, 0.07, x, top / 2, z));
  for (let y = 0.9; y < top; y += 0.9) {
    g.add(part('box', '#a0703f', w - 0.1, 0.05, 0.22, 0, y, hz));
    g.add(part('box', '#a0703f', 0.22, 0.05, d - 0.1, hx, y, 0));
  }
  const s = emojiSprite('🚧', 0.6);
  s.position.set(hx - 0.2, top + 0.4, hz);
  g.add(s);
}
