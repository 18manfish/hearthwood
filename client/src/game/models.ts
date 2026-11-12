// Procedural low-poly models. Everything is built from primitives so the game
// needs no external assets.

import * as THREE from 'three';
import { BUILDINGS, ITEMS, TREES, hashString, type Building, type Season, type WorldObject } from '@hearthwood/shared';
import { bend, bentDepth } from './bend.ts';
import { decorModel } from './decor.ts';

const matCache = new Map<string, THREE.MeshStandardMaterial>();
export function mat(color: string, opts: { emissive?: string; ei?: number; opacity?: number; rough?: number } = {}) {
  const key = `${color}|${opts.emissive ?? ''}|${opts.ei ?? 0}|${opts.opacity ?? 1}|${opts.rough ?? 0.9}`;
  let m = matCache.get(key);
  if (!m) {
    m = bend(new THREE.MeshStandardMaterial({ color, roughness: opts.rough ?? 0.9, metalness: 0, flatShading: true }));
    if (opts.emissive) {
      m.emissive = new THREE.Color(opts.emissive);
      m.emissiveIntensity = opts.ei ?? 1;
    }
    if (opts.opacity !== undefined && opts.opacity < 1) {
      m.transparent = true;
      m.opacity = opts.opacity;
      m.depthWrite = false;
    }
    matCache.set(key, m);
  }
  return m;
}

// Shared geometries.
const G = {
  box: new THREE.BoxGeometry(1, 1, 1),
  cyl: new THREE.CylinderGeometry(1, 1, 1, 8),
  cyl6: new THREE.CylinderGeometry(1, 1, 1, 6),
  cone: new THREE.ConeGeometry(1, 1, 8),
  cone4: new THREE.ConeGeometry(1, 1, 4),
  /** Gable roof: triangular prism, ridge along x, 1 wide (x), 1 deep (z), 1 tall. */
  gable: (() => {
    const sh = new THREE.Shape();
    sh.moveTo(-0.5, 0);
    sh.lineTo(0.5, 0);
    sh.lineTo(0, 1);
    sh.closePath();
    const g = new THREE.ExtrudeGeometry(sh, { depth: 1, bevelEnabled: false });
    g.translate(0, 0, -0.5);
    g.rotateY(Math.PI / 2); // ridge along x, slopes face north/south
    return g;
  })(),
  /** Square pyramid with its base edges aligned to x/z, half-width 1. */
  roof: new THREE.ConeGeometry(Math.SQRT2, 1, 4).rotateY(Math.PI / 4),
  sphere: new THREE.SphereGeometry(1, 10, 8),
  ico: new THREE.IcosahedronGeometry(1, 0),
  dodeca: new THREE.DodecahedronGeometry(1, 0),
};

export function part(geo: keyof typeof G, color: string | THREE.Material, sx: number, sy: number, sz: number, x = 0, y = 0, z = 0, shadow = true) {
  const m = new THREE.Mesh(G[geo], typeof color === 'string' ? mat(color) : color);
  m.scale.set(sx, sy, sz);
  m.position.set(x, y, z);
  m.castShadow = shadow;
  m.receiveShadow = true;
  if (shadow) m.customDepthMaterial = bentDepth;
  return m;
}

const FRUIT_COLORS: Record<string, string> = {
  apple: '#e53935', cherry: '#b71c1c', coconut: '#6d4c2f', banana: '#f6d743', dates: '#a0522d', pinecone: '#7a5230', prickly_pear: '#d81b60',
};

function rand(id: string, i = 0) {
  return (hashString(`${id}:${i}`) % 1000) / 1000;
}

export function treeModel(o: WorldObject, season: Season, visual: 'spring' | 'summer' | 'autumn' | 'winter', snowy: boolean) {
  const def = TREES[o.species ?? 'oak'];
  const g = new THREE.Group();
  const stage = o.stage ?? 2;
  const scale = stage === 0 ? 0.3 : stage === 1 ? 0.65 : 1;
  const foliage = def.foliage[season] ?? def.foliage[visual] ?? def.foliage.default ?? '#4f9e3a';
  const bare = def.deciduous && visual === 'winter';
  const fruitColor = def.fruit ? FRUIT_COLORS[def.fruit] : undefined;
  const fruits: [number, number, number][] = [];

  switch (def.shape) {
    case 'round':
      g.add(part('cyl', def.trunk, 0.13, 1.1, 0.13, 0, 0.55, 0));
      if (bare) {
        for (let i = 0; i < 4; i++) {
          const b = part('cyl', def.trunk, 0.04, 0.6, 0.04, 0, 1.2, 0);
          b.rotation.z = (i % 2 ? 1 : -1) * 0.6;
          b.rotation.y = i * 1.4;
          b.position.x = Math.sin(i * 1.4) * 0.15;
          g.add(b);
        }
        if (snowy) g.add(part('ico', '#ffffff', 0.35, 0.12, 0.35, 0, 1.15, 0));
      } else {
        g.add(part('ico', foliage, 0.75, 0.68, 0.75, 0, 1.45, 0));
        g.add(part('ico', foliage, 0.5, 0.45, 0.5, 0.35, 1.85, 0.1));
        if (snowy) g.add(part('ico', '#ffffff', 0.55, 0.22, 0.55, 0.05, 1.98, 0));
        fruits.push([0.5, 1.35, 0.45], [-0.45, 1.5, 0.4], [0.1, 1.2, 0.68]);
      }
      break;
    case 'tall':
      g.add(part('cyl', def.trunk, 0.1, 1.8, 0.1, 0, 0.9, 0));
      for (let i = 0; i < 4; i++) g.add(part('box', '#333333', 0.105, 0.04, 0.105, 0, 0.4 + i * 0.35, 0, false));
      if (!bare) g.add(part('ico', foliage, 0.5, 0.85, 0.5, 0, 1.9, 0));
      break;
    case 'cone':
      g.add(part('cyl', def.trunk, 0.12, 0.6, 0.12, 0, 0.3, 0));
      for (let i = 0; i < 3; i++) {
        g.add(part('cone', foliage, 0.8 - i * 0.2, 0.9, 0.8 - i * 0.2, 0, 0.8 + i * 0.55, 0));
        if (snowy) g.add(part('cone', '#ffffff', 0.45 - i * 0.12, 0.3, 0.45 - i * 0.12, 0, 1.1 + i * 0.55, 0));
      }
      fruits.push([0.35, 0.8, 0.45], [-0.4, 1.0, 0.3]);
      break;
    case 'palm': {
      let x = 0;
      for (let i = 0; i < 5; i++) {
        x += 0.05;
        g.add(part('cyl', def.trunk, 0.12 - i * 0.01, 0.42, 0.12 - i * 0.01, x, 0.21 + i * 0.4, 0));
      }
      for (let i = 0; i < 6; i++) {
        const leaf = part('box', foliage, 0.28, 0.04, 1.2, x, 2.05, 0);
        leaf.geometry = G.box;
        const pivot = new THREE.Group();
        pivot.position.set(x, 2.05, 0);
        leaf.position.set(0, 0, 0.55);
        leaf.rotation.x = 0.45;
        pivot.add(leaf);
        pivot.rotation.y = (i / 6) * Math.PI * 2;
        g.add(pivot);
      }
      fruits.push([x + 0.15, 1.85, 0.12], [x - 0.12, 1.85, 0.1], [x, 1.82, -0.16]);
      break;
    }
    case 'flat':
      g.add(part('cyl', def.trunk, 0.15, 1.7, 0.15, 0, 0.85, 0));
      g.add(part('cyl', foliage, 1.0, 0.35, 1.0, 0, 1.85, 0));
      g.add(part('cyl', foliage, 0.6, 0.3, 0.6, 0.2, 2.1, 0.1));
      break;
    case 'cactus':
      g.add(part('cyl', foliage, 0.22, 1.4, 0.22, 0, 0.7, 0));
      g.add(part('cyl', foliage, 0.12, 0.5, 0.12, 0.32, 0.9, 0));
      g.add(part('cyl', foliage, 0.12, 0.25, 0.12, 0.22, 0.65, 0));
      g.add(part('cyl', foliage, 0.11, 0.45, 0.11, -0.3, 1.05, 0));
      fruits.push([0, 1.45, 0], [0.32, 1.2, 0], [-0.3, 1.33, 0]);
      break;
  }
  if (fruitColor && stage === 2) {
    const n = Math.min(o.fruit ?? 0, fruits.length);
    for (let i = 0; i < n; i++) g.add(part('sphere', fruitColor, 0.11, 0.11, 0.11, ...fruits[i]));
  }
  if (stage === 0) {
    // Sapling: a tiny sprout.
    g.clear();
    g.add(part('cyl', '#7a5230', 0.04, 0.4, 0.04, 0, 0.2, 0));
    g.add(part('ico', '#7fc650', 0.16, 0.12, 0.16, 0.06, 0.42, 0));
    g.add(part('ico', '#7fc650', 0.13, 0.1, 0.13, -0.08, 0.34, 0));
    g.add(part('cyl', '#6b4a2e', 0.2, 0.03, 0.2, 0, 0.02, 0, false));
    return g;
  }
  g.scale.setScalar(scale);
  g.rotation.y = rand(o.id) * Math.PI * 2;
  return g;
}

export function objectModel(o: WorldObject, season: Season, visual: 'spring' | 'summer' | 'autumn' | 'winter', snowy: boolean, bushColor: string, bushItem: string): THREE.Object3D {
  switch (o.kind) {
    case 'tree':
      return treeModel(o, season, visual, snowy);
    case 'stump': {
      const g = new THREE.Group();
      g.add(part('cyl', '#7a5230', 0.22, 0.25, 0.22, 0, 0.12, 0));
      g.add(part('cyl', '#d9b48f', 0.2, 0.02, 0.2, 0, 0.255, 0, false));
      return g;
    }
    case 'rock': {
      const g = new THREE.Group();
      const worn = Math.min(1, (o.hits ?? 0) / 8);
      g.add(part('dodeca', '#8d8f93', 0.48 - worn * 0.12, 0.38 - worn * 0.12, 0.42 - worn * 0.1, 0, 0.25, 0));
      g.add(part('dodeca', '#a3a5a8', 0.22, 0.2, 0.22, 0.3, 0.15, 0.2));
      g.rotation.y = rand(o.id) * 6;
      return g;
    }
    case 'bush': {
      const g = new THREE.Group();
      const c = snowy ? '#cfe3d6' : bushColor;
      g.add(part('ico', c, 0.42, 0.35, 0.42, 0, 0.32, 0));
      g.add(part('ico', c, 0.3, 0.28, 0.3, 0.25, 0.25, 0.1));
      g.add(part('ico', c, 0.28, 0.26, 0.28, -0.22, 0.24, -0.08));
      if (o.ripe) {
        const bc = ITEMS[bushItem]?.id === 'cloudberry' ? '#ff9f1c' : bushItem === 'herbs' ? '#c5e17a' : '#5c3fa8';
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2;
          g.add(part('sphere', bc, 0.06, 0.06, 0.06, Math.cos(a) * 0.38, 0.32 + (i % 2) * 0.12, Math.sin(a) * 0.32, false));
        }
      }
      return g;
    }
    case 'mushroom': {
      const g = new THREE.Group();
      const cap = o.rare ? mat('#4dd0e1', { emissive: '#26c6da', ei: 0.9 }) : mat('#d84315');
      g.add(part('cyl', '#f5ecd7', 0.05, 0.18, 0.05, 0, 0.09, 0));
      const c = part('sphere', cap, 0.16, 0.1, 0.16, 0, 0.19, 0);
      g.add(c);
      if (!o.rare) for (let i = 0; i < 3; i++) g.add(part('sphere', '#ffffff', 0.03, 0.02, 0.03, Math.cos(i * 2) * 0.09, 0.26, Math.sin(i * 2) * 0.09, false));
      return g;
    }
    case 'flower': {
      const g = new THREE.Group();
      const colors = ['#ff6f91', '#ffd166', '#c77dff', '#ffffff', '#ff9f1c', '#4cc9f0'];
      const col = colors[Math.floor(rand(o.id) * colors.length)];
      g.add(part('cyl', '#4f9e3a', 0.02, 0.3, 0.02, 0, 0.15, 0, false));
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        g.add(part('sphere', col, 0.06, 0.03, 0.06, Math.cos(a) * 0.07, 0.31, Math.sin(a) * 0.07, false));
      }
      g.add(part('sphere', '#ffd54f', 0.04, 0.04, 0.04, 0, 0.32, 0, false));
      return g;
    }
    case 'furniture':
      return furnitureModel(o.item ?? 'bench', o.rot ?? 0);
    case 'decor':
      return decorModel(o.item ?? 'none', o.rot ?? 0);
  }
}

export function furnitureModel(item: string, rot = 0): THREE.Object3D {
  const g = new THREE.Group();
  const wood = '#a0703f';
  switch (item) {
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
      const hulls = ['#e8604c', '#3fa7d6', '#f2c14e', '#59cd90'];
      const c0 = hulls[Math.abs(Math.floor(rot * 7 + 3)) % hulls.length];
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

/** Emoji sign as a sprite (shop icons). */
const signCache = new Map<string, THREE.SpriteMaterial>();
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
    ctx.font = '72px serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(emoji, 64, 70);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    m = bend(new THREE.SpriteMaterial({ map: tex, depthWrite: false }));
    signCache.set(emoji, m);
  }
  const s = new THREE.Sprite(m);
  s.scale.set(size, size, size);
  return s;
}

function houseBody(g: THREE.Group, w: number, d: number, wallH: number, wall: string, roof: string, door = '#7a4f2a') {
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
    const s = emojiSprite('🚧', 0.7);
    s.position.set(0, 1.9, 0);
    g.add(s);
    return g;
  }
  switch (b.type) {
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
        g.add(part('box', '#e8607a', 0.84, 0.16, 1.1, 0, 0.38, 0.35));
        g.add(part('box', '#8d5a3b', 0.9, 0.8, 0.1, 0, 0.4, -0.92));
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
      // Service counter with a bell and a sign showing what it's for.
      g.add(part('box', '#8b5e34', b.w - 0.1, 0.9, 0.7, 0, 0.45, 0));
      g.add(part('box', '#c49a62', b.w + 0.05, 0.08, 0.8, 0, 0.94, 0));
      g.add(part('cyl', '#f6c445', 0.08, 0.06, 0.08, 0.5, 1.0, 0.15));
      g.add(part('sphere', '#f6c445', 0.03, 0.03, 0.03, 0.5, 1.05, 0.15, false));
      const role = b.role ? BUILDINGS[b.role] : null;
      const s = emojiSprite(role?.icon ?? '🛎️', 0.6);
      s.position.set(0, 1.75, -0.1);
      g.add(s);
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
      const s = emojiSprite('📌', 0.5);
      s.position.set(0, 2.25, 0.1);
      g.add(s);
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
      // The deck itself is part of the boardwalk mesh; add mooring posts and a sign.
      for (const x of [-b.w / 2 + 0.1, b.w / 2 - 0.1]) g.add(part('cyl', '#5d4037', 0.08, 0.6, 0.08, x, 0.35, b.h / 2 - 0.15));
      const s = emojiSprite('⚓', 0.6);
      s.position.set(0, 1.2, b.h / 2 - 0.3);
      g.add(s);
      break;
    }
    case 'cabin':
      houseBody(g, b.w, b.h, 1.4, def.color, def.roof);
      g.add(part('box', '#5d4037', 0.25, 0.7, 0.25, b.w / 4, 2.3, -0.2));
      break;
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
      const s = emojiSprite(def.icon, 0.7);
      s.position.set(0, 2.0, b.h / 2 + 0.1);
      g.add(s);
      break;
    }
    case 'villager_house':
      houseBody(g, b.w + 0.3, b.h + 0.3, 1.1, def.color, ['#6aa84f', '#e67e22', '#3d6fb6', '#c2185b', '#8e5a3c', '#16a085', '#f1c40f'][hashString(b.id) % 7]);
      break;
    default: {
      houseBody(g, b.w, b.h, 1.5, def.color, def.roof);
      const s = emojiSprite(def.icon, 0.75);
      s.position.set(0, 1.95, b.h / 2 + 0.1);
      g.add(s);
      // Awning
      g.add(part('box', def.roof, b.w - 0.3, 0.06, 0.5, 0, 1.25, b.h / 2 - 0.0));
    }
  }
  return g;
}
