// Interior decoration models. Items are strings like 'sofa|#c0392b' (model id
// plus an optional colour). Items starting with 'w_' hang on the back wall;
// their tile is the wall tile, so they are built against its inner face.

import * as THREE from 'three';
import { emojiSprite, furnitureModel } from './models/furniture.ts';
import { mat, part } from './models/primitives.ts';

const WOOD = '#a0703f';
const DARK = '#6d4c2f';

/** Offset that puts a wall item flush against the inside face of the back wall. */
const WALL_Z = 0.5;

export function decorModel(item: string, rot = 0): THREE.Object3D {
  const [id, arg] = item.split('|');
  const c = arg ?? '#c0392b';
  const g = new THREE.Group();
  switch (id) {
    case 'none':
      break;
    case 'rug':
      g.add(part('cyl', c, 1.15, 0.02, 0.8, 0, 0.012, 0, false));
      g.add(part('cyl', mat('#ffffff', { opacity: 0.35 }), 0.9, 0.022, 0.58, 0, 0.013, 0, false));
      break;
    case 'lantern': {
      g.add(part('box', '#3b3b48', 0.22, 0.04, 0.22, 0, 0.02, 0));
      g.add(part('box', mat('#fff3c4', { emissive: '#ffcf6b', ei: 1.2 }), 0.16, 0.24, 0.16, 0, 0.16, 0, false));
      g.add(part('box', '#3b3b48', 0.22, 0.04, 0.22, 0, 0.3, 0));
      const l = new THREE.PointLight('#ffcf8a', 1.2, 5, 1.5);
      l.position.set(0, 0.5, 0);
      g.add(l);
      break;
    }
    case 'table':
      g.add(part('box', c, 0.9, 0.06, 0.7, 0, 0.6, 0));
      for (const [x, z] of [[-0.38, -0.28], [0.38, -0.28], [-0.38, 0.28], [0.38, 0.28]]) g.add(part('box', DARK, 0.06, 0.6, 0.06, x, 0.3, z));
      break;
    case 'chair':
      g.add(part('box', c, 0.42, 0.05, 0.42, 0, 0.4, 0));
      g.add(part('box', c, 0.42, 0.45, 0.05, 0, 0.62, -0.19));
      for (const [x, z] of [[-0.17, -0.17], [0.17, -0.17], [-0.17, 0.17], [0.17, 0.17]]) g.add(part('box', DARK, 0.04, 0.4, 0.04, x, 0.2, z));
      break;
    case 'bookshelf': {
      g.add(part('box', c, 0.9, 1.7, 0.4, 0, 0.85, -0.25));
      const books = ['#c0392b', '#2e86de', '#f1c40f', '#27ae60', '#8e44ad', '#e67e22'];
      for (let row = 0; row < 3; row++) {
        // Dark shelf opening sits just proud of the case; books sit recessed inside it
        // (no two faces share a plane, so nothing flickers).
        g.add(part('box', '#3b2f25', 0.8, 0.42, 0.32, 0, 0.32 + row * 0.5, -0.19, false));
        for (let i = 0; i < 6; i++) g.add(part('box', books[(i + row * 2) % books.length], 0.1, 0.32 + ((i * 7) % 3) * 0.03, 0.24, -0.3 + i * 0.12, 0.3 + row * 0.5, -0.2, false));
      }
      break;
    }
    case 'plant':
      g.add(part('cyl', '#c1663f', 0.2, 0.32, 0.16, 0, 0.16, 0));
      g.add(part('ico', '#3f8f3f', 0.35, 0.45, 0.35, 0, 0.6, 0));
      g.add(part('ico', '#4fa04a', 0.25, 0.32, 0.25, 0.12, 0.9, 0.05));
      break;
    case 'plant_small':
      g.add(part('cyl', '#e8dcc6', 0.13, 0.2, 0.11, 0, 0.1, 0));
      g.add(part('ico', '#5aa845', 0.18, 0.18, 0.18, 0, 0.3, 0));
      g.add(part('sphere', '#ff8fb1', 0.05, 0.05, 0.05, 0.06, 0.42, 0.04, false));
      break;
    case 'bed_big':
      // Spans two tiles (this one and the one in front of it).
      g.add(part('box', DARK, 0.95, 0.32, 1.95, 0, 0.16, 0.5));
      g.add(part('box', '#f5ecd7', 0.88, 0.14, 1.85, 0, 0.38, 0.5));
      g.add(part('box', c, 0.9, 0.16, 1.17, 0, 0.4, 0.86)); // blanket overhangs the mattress a little
      g.add(part('box', '#ffffff', 0.6, 0.12, 0.32, 0, 0.47, -0.2));
      g.add(part('box', DARK, 0.99, 0.85, 0.08, 0, 0.42, -0.46));
      break;
    case 'sofa':
      g.add(part('box', c, 1.5, 0.3, 0.7, 0, 0.3, 0));
      g.add(part('box', c, 1.5, 0.5, 0.18, 0, 0.6, -0.28));
      for (const x of [-0.7, 0.7]) g.add(part('box', c, 0.16, 0.42, 0.7, x, 0.42, 0));
      for (const x of [-0.35, 0.35]) g.add(part('box', mat('#ffffff', { opacity: 0.25 }), 0.6, 0.06, 0.5, x, 0.47, 0.05, false));
      break;
    case 'armchair':
      g.add(part('box', c, 0.75, 0.32, 0.7, 0, 0.3, 0));
      g.add(part('box', c, 0.75, 0.6, 0.16, 0, 0.6, -0.28));
      for (const x of [-0.34, 0.34]) g.add(part('box', c, 0.12, 0.42, 0.7, x, 0.45, 0));
      break;
    case 'pillow':
      g.add(part('box', c, 0.45, 0.14, 0.45, 0, 0.07, 0));
      g.add(part('box', '#ff8fb1', 0.38, 0.12, 0.38, 0.25, 0.06, 0.2));
      break;
    case 'tv':
      g.add(part('box', DARK, 1.0, 0.45, 0.4, 0, 0.225, -0.2));
      g.add(part('box', '#222222', 0.9, 0.55, 0.06, 0, 0.75, -0.25));
      g.add(part('box', mat('#7fc8ff', { emissive: '#4fa3ff', ei: 0.6 }), 0.8, 0.45, 0.01, 0, 0.75, -0.21, false));
      break;
    case 'radio':
      g.add(part('box', '#e8604c', 0.45, 0.28, 0.2, 0, 0.14, 0));
      {
        const knob = part('cyl', '#3b2f25', 0.08, 0.02, 0.08, -0.1, 0.16, 0.11, false);
        knob.rotation.x = Math.PI / 2;
        g.add(knob);
      }
      break;
    case 'balloons':
      for (const [x, z, col] of [[0, 0, '#ff5d8f'], [0.15, 0.1, '#ffd166'], [-0.12, 0.08, '#4cc9f0']] as [number, number, string][]) {
        g.add(part('cyl', '#ffffff', 0.005, 1.0, 0.005, x * 0.5, 0.5, z * 0.5, false));
        g.add(part('sphere', col, 0.17, 0.21, 0.17, x, 1.15 + z, z));
      }
      break;
    case 'punching_bag':
      g.add(part('cyl', '#3b3b48', 0.03, 0.4, 0.03, 0, 1.7, 0));
      g.add(part('cyl', '#c0392b', 0.22, 0.9, 0.22, 0, 1.05, 0));
      break;
    case 'dumbbells':
      for (const z of [-0.12, 0.12]) {
        const bar = part('cyl', '#9e9e9e', 0.025, 0.4, 0.025, 0, 0.08, z);
        bar.rotation.z = Math.PI / 2;
        g.add(bar);
        for (const x of [-0.18, 0.18]) g.add(part('cyl', '#3b3b48', 0.08, 0.1, 0.08, x, 0.08, z));
      }
      break;
    case 'easel': {
      for (const x of [-0.25, 0.25]) {
        const leg = part('box', WOOD, 0.04, 1.4, 0.04, x, 0.7, 0);
        leg.rotation.z = x > 0 ? -0.12 : 0.12;
        g.add(leg);
      }
      g.add(part('box', '#ffffff', 0.6, 0.5, 0.03, 0, 1.0, 0.05));
      g.add(part('box', '#3fa7d6', 0.25, 0.2, 0.01, -0.1, 1.05, 0.07, false));
      g.add(part('box', '#f2c14e', 0.2, 0.15, 0.01, 0.12, 0.9, 0.07, false));
      break;
    }
    case 'teddy':
      g.add(part('sphere', c, 0.17, 0.2, 0.15, 0, 0.18, 0));
      g.add(part('sphere', c, 0.14, 0.13, 0.13, 0, 0.45, 0));
      for (const x of [-0.1, 0.1]) g.add(part('sphere', c, 0.05, 0.05, 0.04, x, 0.57, 0));
      g.add(part('sphere', '#3b2f25', 0.025, 0.025, 0.02, 0, 0.44, 0.13, false));
      break;
    case 'aquarium':
      g.add(part('box', DARK, 0.9, 0.5, 0.45, 0, 0.25, 0));
      g.add(part('box', mat('#6fc3e8', { emissive: '#3fa7d6', ei: 0.35, opacity: 0.6 }), 0.85, 0.5, 0.4, 0, 0.75, 0, false));
      g.add(part('box', '#e6d6a3', 0.84, 0.06, 0.39, 0, 0.53, 0, false));
      for (const [x, y, col] of [[-0.2, 0.75, '#ff9f1c'], [0.15, 0.85, '#ffd166'], [0.25, 0.65, '#e8604c']] as [number, number, string][]) g.add(part('sphere', col, 0.06, 0.04, 0.03, x, y, 0.05, false));
      g.add(part('box', '#3f8f3f', 0.05, 0.25, 0.05, -0.3, 0.68, -0.08, false));
      break;
    case 'cake':
      // On its own little round side table.
      g.add(part('cyl', '#a0703f', 0.32, 0.05, 0.32, 0, 0.6, 0));
      g.add(part('cyl', DARK, 0.05, 0.6, 0.05, 0, 0.3, 0));
      g.add(part('cyl', '#ffffff', 0.18, 0.02, 0.18, 0, 0.64, 0, false));
      g.add(part('cyl', '#f8c8dc', 0.13, 0.14, 0.13, 0, 0.72, 0));
      g.add(part('cyl', '#ffffff', 0.135, 0.03, 0.135, 0, 0.8, 0, false));
      g.add(part('sphere', '#e53935', 0.03, 0.03, 0.03, 0, 0.84, 0, false));
      break;
    case 'fruit_bowl':
      g.add(part('cyl', '#c49a62', 0.32, 0.05, 0.32, 0, 0.6, 0));
      g.add(part('cyl', DARK, 0.05, 0.6, 0.05, 0, 0.3, 0));
      g.add(part('cyl', '#e8dcc6', 0.18, 0.08, 0.14, 0, 0.67, 0));
      for (const [x, z, col] of [[0, 0, '#e53935'], [0.08, 0.04, '#f6d743'], [-0.07, 0.05, '#ff9f1c'], [0.02, -0.07, '#9ccc65']] as [number, number, string][]) g.add(part('sphere', col, 0.06, 0.06, 0.06, x, 0.74, z, false));
      break;
    case 'rocks':
      g.add(part('box', DARK, 0.85, 0.5, 0.4, 0, 0.25, 0));
      for (const [x, col] of [[-0.25, '#9e9e9e'], [0, '#c49a62'], [0.25, '#6fc3e8']] as [number, string][]) g.add(part('dodeca', col, 0.1, 0.09, 0.1, x, 0.58, 0));
      break;
    case 'telescope': {
      for (const a of [0, 2.1, 4.2]) {
        const leg = part('box', DARK, 0.03, 0.9, 0.03, Math.cos(a) * 0.12, 0.42, Math.sin(a) * 0.12);
        leg.rotation.z = Math.cos(a) * 0.2;
        leg.rotation.x = -Math.sin(a) * 0.2;
        g.add(leg);
      }
      const tube = part('cyl', '#b08d57', 0.07, 0.8, 0.07, 0, 0.95, 0);
      tube.rotation.x = -0.9;
      g.add(tube);
      break;
    }
    case 'globe':
      g.add(part('cyl', DARK, 0.15, 0.6, 0.15, 0, 0.3, 0));
      g.add(part('sphere', '#3fa7d6', 0.22, 0.22, 0.22, 0, 0.85, 0));
      g.add(part('sphere', '#59cd90', 0.12, 0.08, 0.1, 0.12, 0.92, 0.12, false));
      break;
    case 'wardrobe':
      g.add(part('box', c, 0.85, 1.8, 0.5, 0, 0.9, -0.2));
      g.add(part('box', '#000000', 0.01, 1.6, 0.01, 0, 0.9, 0.06, false));
      for (const x of [-0.07, 0.07]) g.add(part('sphere', '#f6c445', 0.03, 0.03, 0.03, x, 0.95, 0.07, false));
      break;
    case 'mirror':
      g.add(part('box', '#f6c445', 0.6, 1.6, 0.08, 0, 0.9, -0.3));
      g.add(part('box', mat('#dff3ff', { emissive: '#bfe6ff', ei: 0.25 }), 0.5, 1.45, 0.02, 0, 0.9, -0.25, false));
      break;
    case 'mushroom_lamp':
      g.add(part('cyl', '#f5ecd7', 0.06, 0.5, 0.08, 0, 0.25, 0));
      g.add(part('sphere', mat('#e53935', { emissive: '#ff6f61', ei: 0.6 }), 0.28, 0.16, 0.28, 0, 0.52, 0));
      for (let i = 0; i < 4; i++) g.add(part('sphere', '#ffffff', 0.04, 0.03, 0.04, Math.cos(i * 1.7) * 0.15, 0.62, Math.sin(i * 1.7) * 0.15, false));
      break;
    case 'tool_rack':
      g.add(part('box', DARK, 0.9, 1.2, 0.1, 0, 0.7, -0.35));
      for (let i = 0; i < 3; i++) g.add(part('box', '#9e9e9e', 0.06, 0.6, 0.04, -0.3 + i * 0.3, 0.8, -0.28));
      break;
    case 'shelf': {
      g.add(part('box', '#8b6338', 0.9, 1.5, 0.45, 0, 0.75, 0));
      const goods = ['#9e9e9e', '#e8604c', '#3fa7d6', '#f2c14e', '#59cd90'];
      for (let row = 0; row < 3; row++) for (let i = 0; i < 4; i++) g.add(part('box', goods[(row + i) % goods.length], 0.15, 0.2, 0.25, -0.3 + i * 0.2, 0.32 + row * 0.45, 0.12, false));
      break;
    }
    case 'rack':
      for (const x of [-0.45, 0.45]) g.add(part('box', '#9e9e9e', 0.04, 1.3, 0.04, x, 0.65, 0));
      g.add(part('box', '#9e9e9e', 0.94, 0.04, 0.04, 0, 1.28, 0));
      for (let i = 0; i < 5; i++) g.add(part('box', ['#e74c3c', '#3498db', '#f1c40f', '#2ecc71', '#9b59b6'][i], 0.12, 0.6, 0.35, -0.32 + i * 0.16, 0.95, 0));
      break;
    case 'mannequin':
      g.add(part('cyl', '#3b3b48', 0.2, 0.05, 0.2, 0, 0.03, 0));
      g.add(part('cyl', '#3b3b48', 0.025, 0.7, 0.025, 0, 0.4, 0));
      g.add(part('box', c, 0.42, 0.55, 0.25, 0, 0.98, 0));
      g.add(part('sphere', '#e8dcc6', 0.12, 0.14, 0.12, 0, 1.4, 0));
      break;
    case 'stove':
      g.add(part('box', '#4a4a4a', 0.9, 0.85, 0.6, 0, 0.425, -0.1));
      g.add(part('box', mat('#ff7b00', { emissive: '#ff5500', ei: 0.8 }), 0.4, 0.25, 0.02, 0, 0.35, 0.21, false));
      g.add(part('cyl', '#9e9e9e', 0.16, 0.12, 0.16, -0.2, 0.92, -0.1));
      g.add(part('cyl', '#c0392b', 0.13, 0.18, 0.13, 0.2, 0.94, -0.1));
      g.add(part('cyl', '#555555', 0.06, 1.2, 0.06, 0.3, 1.45, -0.3));
      break;
    case 'dining':
      g.add(part('cyl', '#f5ecd7', 0.45, 0.04, 0.45, 0, 0.62, 0));
      g.add(part('cyl', '#e8604c', 0.47, 0.02, 0.47, 0, 0.6, 0, false));
      g.add(part('cyl', DARK, 0.05, 0.6, 0.05, 0, 0.3, 0));
      for (const x of [-0.18, 0.18]) g.add(part('cyl', '#ffffff', 0.1, 0.015, 0.1, x, 0.65, 0, false));
      g.add(part('cyl', mat('#fff3c4', { emissive: '#ffcf6b', ei: 0.8 }), 0.03, 0.1, 0.03, 0, 0.7, 0, false));
      break;
    case 'stairs': {
      // Spiral staircase winding up out of sight.
      g.add(part('cyl', '#5d4037', 0.06, 3.2, 0.06, 0, 1.6, 0));
      for (let i = 0; i < 12; i++) {
        const a = i * 0.55;
        const step = part('box', WOOD, 0.7, 0.06, 0.28, Math.cos(a) * 0.35, 0.15 + i * 0.22, Math.sin(a) * 0.35);
        step.rotation.y = -a;
        g.add(step);
      }
      break;
    }
    case 'desk':
      g.add(part('box', WOOD, 1.0, 0.06, 0.55, 0, 0.7, 0));
      for (const x of [-0.45, 0.45]) g.add(part('box', DARK, 0.06, 0.7, 0.5, x, 0.35, 0));
      g.add(part('box', '#f5ecd7', 0.35, 0.01, 0.25, -0.15, 0.74, 0, false));
      g.add(part('box', mat('#fff3c4', { emissive: '#ffcf6b', ei: 0.8 }), 0.1, 0.18, 0.1, 0.3, 0.82, -0.1, false));
      break;
    // ── Wall-mounted (built against the back wall's inner face) ────────────
    case 'w_window': {
      const w = new THREE.Group();
      w.add(part('box', '#f5ecd7', 0.85, 0.75, 0.06, 0, 1.45, 0));
      const glass = part('box', mat('#bfe6ff', { emissive: '#ffd27a', ei: 0 }), 0.7, 0.6, 0.02, 0, 1.45, 0.03, false);
      glass.name = 'window';
      w.add(glass);
      w.add(part('box', '#f5ecd7', 0.05, 0.6, 0.03, 0, 1.45, 0.04, false));
      w.add(part('box', '#f5ecd7', 0.7, 0.05, 0.03, 0, 1.45, 0.04, false));
      w.position.z = WALL_Z + 0.03;
      g.add(w);
      break;
    }
    case 'w_painting':
      g.add(part('box', '#c49a62', 0.75, 0.55, 0.05, 0, 1.55, WALL_Z + 0.025));
      g.add(part('box', c, 0.62, 0.42, 0.02, 0, 1.55, WALL_Z + 0.055, false));
      g.add(part('sphere', '#ffffff', 0.08, 0.08, 0.01, -0.1, 1.6, WALL_Z + 0.07, false));
      break;
    case 'w_poster':
      g.add(part('box', c, 0.5, 0.7, 0.02, 0, 1.5, WALL_Z + 0.02));
      g.add(part('box', '#ffffff', 0.36, 0.12, 0.01, 0, 1.68, WALL_Z + 0.035, false));
      break;
    case 'w_clock': {
      const face = part('cyl', '#f5ecd7', 0.2, 0.05, 0.2, 0, 1.85, WALL_Z + 0.03, false);
      face.rotation.x = Math.PI / 2;
      g.add(face);
      g.add(part('box', '#3b2f25', 0.02, 0.14, 0.01, 0, 1.9, WALL_Z + 0.06, false));
      break;
    }
    case 'w_fireplace': {
      g.add(part('box', '#9a8f84', 1.2, 1.1, 0.4, 0, 0.55, WALL_Z + 0.2));
      g.add(part('box', '#2b2118', 0.7, 0.55, 0.05, 0, 0.35, WALL_Z + 0.41, false));
      const fire = part('cone', mat('#ffb347', { emissive: '#ff7b00', ei: 1.4 }), 0.15, 0.3, 0.15, 0, 0.25, WALL_Z + 0.3, false);
      fire.name = 'flame';
      g.add(fire);
      g.add(part('box', '#7a5230', 1.35, 0.08, 0.5, 0, 1.12, WALL_Z + 0.22));
      const l = new THREE.PointLight('#ff9a3c', 1.5, 5, 1.5);
      l.position.set(0, 0.5, WALL_Z + 0.8);
      l.name = 'firelight';
      g.add(l);
      break;
    }
    case 'w_map':
      g.add(part('box', '#efe1c0', 1.1, 0.75, 0.02, 0, 1.55, WALL_Z + 0.02));
      g.add(part('ico', '#59cd90', 0.25, 0.18, 0.01, -0.1, 1.55, WALL_Z + 0.035, false));
      g.add(part('ico', '#e6d6a3', 0.12, 0.1, 0.01, 0.25, 1.7, WALL_Z + 0.035, false));
      g.add(part('sphere', '#e53935', 0.03, 0.03, 0.01, -0.05, 1.5, WALL_Z + 0.045, false));
      break;
    case 'w_wheel': {
      const wheel = new THREE.Group();
      wheel.add(part('cyl', '#8b5e34', 0.3, 0.04, 0.3, 0, 0, 0));
      for (let i = 0; i < 8; i++) {
        const sp = part('box', '#6d4c2f', 0.04, 0.03, 0.8, 0, 0, 0);
        sp.rotation.y = (i / 8) * Math.PI;
        wheel.add(sp);
      }
      wheel.rotation.x = Math.PI / 2;
      wheel.position.set(0, 1.55, WALL_Z + 0.05);
      g.add(wheel);
      break;
    }
    case 'w_banner':
      g.add(part('box', '#f6c445', 0.6, 0.04, 0.04, 0, 2.05, WALL_Z + 0.03, false));
      g.add(part('box', c, 0.5, 1.0, 0.02, 0, 1.52, WALL_Z + 0.03));
      g.add(part('sphere', '#f6c445', 0.08, 0.08, 0.01, 0, 1.6, WALL_Z + 0.045, false));
      break;
    case 'w_net':
      for (let i = 0; i < 5; i++) g.add(part('box', '#c9b27a', 0.015, 0.8, 0.01, -0.3 + i * 0.15, 1.5, WALL_Z + 0.02, false));
      for (let i = 0; i < 5; i++) g.add(part('box', '#c9b27a', 0.8, 0.015, 0.01, 0, 1.2 + i * 0.15, WALL_Z + 0.02, false));
      g.add(part('sphere', '#ff9f1c', 0.06, 0.06, 0.06, 0.2, 1.3, WALL_Z + 0.06, false));
      break;
    case 'w_toolrack':
      g.add(part('box', DARK, 1.0, 0.6, 0.04, 0, 1.4, WALL_Z + 0.02));
      for (let i = 0; i < 4; i++) {
        g.add(part('box', '#7a5230', 0.04, 0.5, 0.03, -0.35 + i * 0.23, 1.4, WALL_Z + 0.05, false));
        g.add(part('box', '#9e9e9e', 0.14, 0.1, 0.03, -0.35 + i * 0.23, 1.6, WALL_Z + 0.05, false));
      }
      break;
    case 'barrel':
    case 'crate':
      return furnitureModel(id, rot);
    default: {
      const s = emojiSprite('❔', 0.4);
      s.position.y = 0.5;
      g.add(s);
    }
  }
  g.rotation.y = (rot * Math.PI) / 2;
  return g;
}
