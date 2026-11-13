// Furniture and decor items, and emoji signs (sprites) over buildings.

import * as THREE from 'three';
import { furnitureShape, ITEMS } from '@hearthwood/shared';
import { kitModel } from '../assets/kit.ts';
import { bend } from '../bend.ts';
import { drawEmoji } from '../../ui/emoji.ts';
import { mat, part } from './primitives.ts';

const HULLS = ['#e8604c', '#3fa7d6', '#f2c14e', '#59cd90'];

export function furnitureModel(item: string, rot = 0): THREE.Object3D {
  const g = new THREE.Group();
  const kit = kitFurniture(item, rot);
  if (kit) {
    g.add(kit);
    g.rotation.y = (rot * Math.PI) / 2;
    return g;
  }
  const wood = '#a0703f';
  // Items can borrow another model (set in the game creation tool).
  switch (ITEMS[item]?.model ?? item) {
    case 'bench':
      g.add(part('box', wood, 0.9, 0.07, 0.35, 0, 0.32, 0));
      g.add(part('box', wood, 0.9, 0.3, 0.06, 0, 0.5, -0.16));
      for (const x of [-0.38, 0.38]) g.add(part('box', '#5d4037', 0.06, 0.32, 0.3, x, 0.16, 0));
      break;
    case 'lamp': {
      g.add(part('cyl', '#37474f', 0.04, 1.4, 0.04, 0, 0.7, 0));
      g.add(part('box', '#37474f', 0.26, 0.04, 0.26, 0, 1.42, 0));
      const bulb = part('box', mat('#fff3c4', { emissive: '#ffcf6b', ei: 0.2 }), 0.2, 0.24, 0.2, 0, 1.28, 0);
      bulb.name = 'bulb';
      g.add(bulb);
      break;
    }
    case 'flower_pot':
      g.add(part('cyl', '#c1663f', 0.2, 0.28, 0.16, 0, 0.14, 0));
      g.add(part('ico', '#4f9e3a', 0.22, 0.18, 0.22, 0, 0.38, 0));
      g.add(part('sphere', '#ff6f91', 0.07, 0.07, 0.07, 0.08, 0.5, 0.05));
      g.add(part('sphere', '#ffd166', 0.07, 0.07, 0.07, -0.08, 0.48, -0.03));
      break;
    case 'fence':
      for (const x of [-0.42, 0.42]) g.add(part('box', '#e8dcc6', 0.08, 0.6, 0.08, x, 0.3, 0));
      g.add(part('box', '#e8dcc6', 1, 0.08, 0.04, 0, 0.42, 0));
      g.add(part('box', '#e8dcc6', 1, 0.08, 0.04, 0, 0.22, 0));
      break;
    case 'picnic_table':
      g.add(part('box', '#c0392b', 0.95, 0.05, 0.6, 0, 0.5, 0));
      g.add(part('box', '#ecf0f1', 0.3, 0.051, 0.6, 0, 0.5, 0));
      for (const x of [-0.38, 0.38]) g.add(part('box', wood, 0.06, 0.5, 0.5, x, 0.25, 0));
      for (const z of [-0.45, 0.45]) g.add(part('box', wood, 0.9, 0.05, 0.18, 0, 0.28, z));
      break;
    case 'gnome':
      g.add(part('cone', '#e53935', 0.14, 0.32, 0.14, 0, 0.62, 0));
      g.add(part('sphere', '#fde0c8', 0.11, 0.11, 0.11, 0, 0.42, 0));
      g.add(part('cone', '#ffffff', 0.1, 0.2, 0.1, 0, 0.3, 0.06));
      g.add(part('cyl', '#1e88e5', 0.15, 0.3, 0.15, 0, 0.15, 0));
      break;
    case 'signpost':
      g.add(part('cyl', wood, 0.04, 0.9, 0.04, 0, 0.45, 0));
      g.add(part('box', '#d7b98e', 0.6, 0.25, 0.04, 0.1, 0.75, 0));
      break;
    case 'barrel':
      g.add(part('cyl', '#9a6a3c', 0.26, 0.62, 0.26, 0, 0.31, 0));
      g.add(part('cyl', '#a8784a', 0.285, 0.34, 0.285, 0, 0.31, 0));
      for (const y of [0.1, 0.52]) g.add(part('cyl', '#4a4a4a', 0.27, 0.04, 0.27, 0, y, 0, false));
      g.add(part('cyl', '#7a5230', 0.24, 0.02, 0.24, 0, 0.62, 0, false));
      break;
    case 'crate':
      g.add(part('box', '#c49a62', 0.6, 0.55, 0.6, 0, 0.275, 0));
      for (const y of [0.04, 0.51]) for (const z of [-0.29, 0.29]) g.add(part('box', '#8b6338', 0.62, 0.06, 0.04, 0, y, z, false));
      for (const x of [-0.29, 0.29]) g.add(part('box', '#8b6338', 0.04, 0.55, 0.04, x, 0.275, 0.3, false));
      const brace = part('box', '#8b6338', 0.04, 0.75, 0.04, 0, 0.275, 0.305, false);
      brace.rotation.z = 0.8;
      g.add(brace);
      break;
    case 'rowboat': {
      // Hull tapers to a bow; striped gunwale; bench and oars. Floats at water level.
      const c0 = HULLS[Math.abs(Math.floor(rot * 7 + 3)) % HULLS.length];
      const hull = new THREE.Group();
      hull.add(part('box', '#f5ecd7', 0.62, 0.22, 1.25, 0, 0.12, 0));
      hull.add(part('box', c0, 0.66, 0.08, 1.29, 0, 0.26, 0));
      const bow = part('cone4', '#f5ecd7', 0.44, 0.5, 0.44, 0, 0.12, 0.8);
      bow.rotation.x = Math.PI / 2;
      bow.rotation.y = Math.PI / 4;
      bow.scale.set(0.44, 0.5, 0.17);
      hull.add(bow);
      hull.add(part('box', '#8b6338', 0.58, 0.04, 0.18, 0, 0.27, 0));
      for (const sx of [-1, 1]) {
        const oar = part('box', '#a0703f', 0.04, 0.03, 1.0, sx * 0.42, 0.3, -0.05);
        oar.rotation.y = sx * 0.35;
        hull.add(oar);
      }
      hull.name = 'boat';
      g.add(hull);
      break;
    }
    default:
      g.add(part('box', wood, 0.5, 0.5, 0.5, 0, 0.25, 0));
  }
  g.rotation.y = (rot * Math.PI) / 2;
  return g;
}

/**
 * Kit furniture (placeables and the Bohemian pack). Wall pieces are modelled on
 * the wall tile; placed from the floor tile in front, they move back onto the wall.
 */
function kitFurniture(item: string, rot: number): THREE.Object3D | null {
  const model = ITEMS[item]?.model ?? item;
  const trim = HULLS[Math.abs(Math.floor(rot * 7 + 3)) % HULLS.length];
  const k = kitModel(model, model === 'rowboat' ? (role) => (role === 'trim' ? mat(trim) : null) : undefined);
  if (!k) return null;
  if (furnitureShape(item) === 'wall') k.position.z = -1;
  return k;
}

/** Emoji sign as a sprite (shop icons). */
export const signCache = new Map<string, THREE.SpriteMaterial>();

export function emojiSprite(emoji: string, size = 0.8) {
  let m = signCache.get(emoji);
  if (!m) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#fffdf7';
    ctx.beginPath();
    ctx.arc(64, 64, 58, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 6;
    ctx.strokeStyle = '#eadfcb';
    ctx.stroke();
    const tex = new THREE.CanvasTexture(c);
    // The pixel icon (redrawn once it has loaded).
    const face = () => {
      ctx.fillStyle = '#fffdf7';
      ctx.beginPath();
      ctx.arc(64, 64, 52, 0, Math.PI * 2);
      ctx.fill();
      drawEmoji(ctx, emoji, 64, 66, 80, () => {
        face();
        tex.needsUpdate = true;
      });
    };
    face();
    tex.colorSpace = THREE.SRGBColorSpace;
    m = bend(new THREE.SpriteMaterial({ map: tex, depthWrite: false }));
    signCache.set(emoji, m);
  }
  const s = new THREE.Sprite(m);
  s.scale.set(size, size, size);
  return s;
}
