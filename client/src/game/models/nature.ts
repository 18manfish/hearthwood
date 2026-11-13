// Everything else that grows or lands on an island: rocks, bushes, flowers, mushrooms,
// stumps, washed-up finds, and birds.

import * as THREE from 'three';
import { BIOMES, BIRD_BY_ID, ITEMS, type BiomeId, type Season, type WorldObject } from '@hearthwood/shared';
import { kitModel } from '../assets/kit.ts';
import { decorModel } from '../decor.ts';
import { fishShadowModel } from './fish.ts';
import { furnitureModel } from './furniture.ts';
import { mat, part, rand } from './primitives.ts';
import { treeModel } from './trees.ts';

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
      const worn = Math.min(1, (o.hits ?? 0) / 8);
      const kit = kitRock(o, bushColor, worn);
      if (kit) return kit;
      const g = new THREE.Group();
      g.add(part('dodeca', '#8d8f93', 0.48 - worn * 0.12, 0.38 - worn * 0.12, 0.42 - worn * 0.1, 0, 0.25, 0));
      g.add(part('dodeca', '#a3a5a8', 0.22, 0.2, 0.22, 0.3, 0.15, 0.2));
      g.rotation.y = rand(o.id) * 6;
      return g;
    }
    case 'bush': {
      const kit = kitBush(o, snowy, bushColor);
      if (kit) return kit;
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
    case 'washed':
      return washedModel(o.item ?? 'seashell', o.id);
    case 'mushroom': {
      const kit = kitModel(o.rare ? 'glowcap' : rand(o.id, 3) < 0.35 ? 'mushroom_brown' : 'mushroom');
      if (kit) return spin(kit, o.id);
      const g = new THREE.Group();
      const cap = o.rare ? mat('#4dd0e1', { emissive: '#26c6da', ei: 0.9 }) : mat('#d84315');
      g.add(part('cyl', '#f5ecd7', 0.05, 0.18, 0.05, 0, 0.09, 0));
      const c = part('sphere', cap, 0.16, 0.1, 0.16, 0, 0.19, 0);
      g.add(c);
      if (!o.rare) for (let i = 0; i < 3; i++) g.add(part('sphere', '#ffffff', 0.03, 0.02, 0.03, Math.cos(i * 2) * 0.09, 0.26, Math.sin(i * 2) * 0.09, false));
      return g;
    }
    case 'flower': {
      const colors = ['#ff6f91', '#ffd166', '#c77dff', '#ffffff', '#ff9f1c', '#4cc9f0'];
      const pick = Math.floor(rand(o.id) * colors.length);
      // Same colour order as the kit flowers (art/kit/plants.py).
      const kit = kitModel(`flower_${FLOWER_KINDS[pick]}`);
      if (kit) return spin(kit, o.id);
      const g = new THREE.Group();
      const col = colors[pick];
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
    case 'bird':
      return birdModel(o.bird ?? 'bird_sparrow', o.rot ?? 0);
    case 'fish':
      return fishShadowModel(o.size ?? 'medium', o.id);
  }
}

const FLOWER_KINDS = ['tulip', 'buttercup', 'bell', 'daisy', 'poppy', 'cornflower'];
const SNOW_LEAF = '#cfe3d6';
const LEAFY = new Set(['leaves', 'leaf', 'mound', 'frond']);

function spin(g: THREE.Object3D, id: string) {
  g.rotation.y = rand(id, 7) * Math.PI * 2;
  return g;
}

/** The biome whose bushes have this colour (objectModel only gets the colour). */
function biomeOfBush(bushColor: string): BiomeId | undefined {
  return (Object.keys(BIOMES) as BiomeId[]).find((b) => BIOMES[b].bushColor === bushColor);
}

/** Kit bush for the biome: berries only while ripe, leaves frosted when snowy. */
function kitBush(o: WorldObject, snowy: boolean, bushColor: string): THREE.Object3D | null {
  const biome = biomeOfBush(bushColor);
  const g = biome ? kitModel(`bush_${biome}`, snowy ? (role) => (LEAFY.has(role) ? mat(SNOW_LEAF) : null) : undefined) : null;
  if (!g) return null;
  const berries = g.getObjectByName('berries');
  if (berries) berries.visible = !!o.ripe;
  return spin(g, o.id);
}

/** Kit rock: one of three shapes (mossy in the wet biomes), worn down as it is hit. */
function kitRock(o: WorldObject, bushColor: string, worn: number): THREE.Object3D | null {
  const biome = biomeOfBush(bushColor);
  const mossy = (biome === 'forest_edge' || biome === 'jungle' || biome === 'nordic') && rand(o.id, 2) < 0.4;
  const g = kitModel(mossy ? 'rock_mossy' : `rock_${1 + Math.floor(rand(o.id, 1) * 3)}`);
  if (!g) return null;
  g.scale.set(1 - worn * 0.25, 1 - worn * 0.3, 1 - worn * 0.25);
  g.rotation.y = rand(o.id) * 6;
  return g;
}

/**
 * A little bird, facing +z inside its `body` group so it can be animated:
 * `body` (hop/peck), `head` (look around), `wingL`/`wingR` (flap).
 * The kit model when it's loaded, otherwise a procedural one.
 */
export function birdModel(id: string, rot = 0): THREE.Object3D {
  const kit = kitBird(id);
  if (kit) {
    kit.rotation.y = (rot * Math.PI) / 2 + (rand(id, rot) - 0.5) * 0.8;
    kit.userData.bird = true;
    return kit;
  }
  const def = BIRD_BY_ID[id] ?? BIRD_BY_ID.bird_sparrow;
  const [body, wing, belly, beak] = def.colors;
  const root = new THREE.Group();
  const g = new THREE.Group();
  g.name = 'body';
  const s = 0.32 * def.size;
  const tall = id === 'bird_flamingo';
  const legH = tall ? 0.9 * s : 0.18 * s;
  // Legs.
  for (const x of [-0.12, 0.12]) g.add(part('cyl', '#d18b47', 0.02 * def.size, legH, 0.02 * def.size, x * s, legH / 2, 0, false));
  const by = legH + 0.32 * s;
  g.add(part('sphere', body, 0.42 * s, 0.36 * s, 0.55 * s, 0, by, 0));
  g.add(part('sphere', belly, 0.34 * s, 0.28 * s, 0.4 * s, 0, by - 0.08 * s, 0.1 * s, false));
  // Tail.
  const tail = part('box', wing, 0.22 * s, 0.05 * s, 0.4 * s, 0, by + 0.06 * s, -0.55 * s);
  tail.rotation.x = -0.45;
  g.add(tail);
  // Wings.
  for (const side of [-1, 1]) {
    const w = part('sphere', wing, 0.1 * s, 0.26 * s, 0.42 * s, 0, 0, 0);
    const pivot = new THREE.Group();
    pivot.name = side < 0 ? 'wingL' : 'wingR';
    pivot.position.set(side * 0.38 * s, by + 0.05 * s, -0.02 * s);
    pivot.add(w);
    g.add(pivot);
  }
  // Head with eyes and beak.
  const head = new THREE.Group();
  head.name = 'head';
  head.position.set(0, by + (tall ? 0.75 : 0.32) * s, 0.36 * s);
  if (tall) g.add(part('cyl', body, 0.05 * s, 0.75 * s, 0.05 * s, 0, by + 0.38 * s, 0.32 * s, false));
  head.add(part('sphere', body, 0.26 * s, 0.25 * s, 0.26 * s, 0, 0, 0));
  for (const x of [-0.14, 0.14]) head.add(part('sphere', '#111111', 0.045 * s, 0.045 * s, 0.045 * s, x * s, 0.05 * s, 0.17 * s, false));
  const bl = id === 'bird_toucan' ? 0.55 : id === 'bird_kingfisher' || id === 'bird_hummingbird' ? 0.4 : 0.18;
  const bk = part('cone', beak, 0.07 * s, bl * s, 0.07 * s, 0, -0.02 * s, (0.22 + bl / 2) * s, false);
  bk.rotation.x = Math.PI / 2;
  head.add(bk);
  if (id === 'bird_hoopoe' || id === 'bird_pheasant') head.add(part('cone', belly, 0.08 * s, 0.3 * s, 0.14 * s, 0, 0.26 * s, -0.04 * s, false));
  if (id === 'bird_owl') for (const x of [-0.12, 0.12]) head.add(part('cone', wing, 0.06 * s, 0.14 * s, 0.06 * s, x * s, 0.24 * s, 0, false));
  g.add(head);
  root.add(g);
  root.rotation.y = (rot * Math.PI) / 2 + (rand(id, rot) - 0.5) * 0.8;
  root.userData.bird = true;
  return root;
}

/** Kit bird: its `hop` node is the game's `body` (the body mesh itself becomes `torso`). */
function kitBird(id: string): THREE.Object3D | null {
  const g = kitModel(BIRD_BY_ID[id] ? id : 'bird_sparrow');
  if (!g) return null;
  const torso = g.getObjectByName('body');
  if (torso) torso.name = 'torso';
  const hop = g.getObjectByName('hop');
  if (hop) hop.name = 'body';
  return g;
}

/** Things lying on the beach. */
export function washedModel(item: string, id: string): THREE.Object3D {
  const g = new THREE.Group();
  g.rotation.y = rand(id) * 6.28;
  switch (item) {
    case 'driftwood':
      { const log = part('cyl', '#b8a088', 0.06, 0.7, 0.06, 0, 0.06, 0); log.rotation.z = Math.PI / 2; g.add(log); }
      g.add(part('cyl', '#a68d72', 0.04, 0.25, 0.04, 0.15, 0.08, 0.1));
      break;
    case 'seaweed':
      for (let i = 0; i < 4; i++) g.add(part('box', '#3d7a3a', 0.08, 0.025, 0.4, (i - 1.5) * 0.08, 0.015, Math.sin(i) * 0.06));
      break;
    case 'sea_glass':
      g.add(part('dodeca', mat('#7fe0c0', { opacity: 0.75, rough: 0.2 }), 0.08, 0.05, 0.07, 0, 0.04, 0));
      g.add(part('dodeca', mat('#8fc8ff', { opacity: 0.75, rough: 0.2 }), 0.06, 0.04, 0.05, 0.12, 0.03, 0.05));
      break;
    case 'coral':
      for (let i = 0; i < 4; i++) {
        const b = part('cyl', '#ff6f61', 0.03, 0.22, 0.03, Math.cos(i * 1.6) * 0.06, 0.11, Math.sin(i * 1.6) * 0.06);
        b.rotation.z = Math.cos(i * 1.6) * 0.5;
        b.rotation.x = Math.sin(i * 1.6) * 0.5;
        g.add(b);
      }
      break;
    case 'pearl':
      g.add(part('sphere', '#e9e2f0', 0.12, 0.05, 0.12, 0, 0.03, 0));
      g.add(part('sphere', mat('#ffffff', { emissive: '#f4ecff', ei: 0.4, rough: 0.2 }), 0.06, 0.06, 0.06, 0, 0.09, 0));
      break;
    case 'message_bottle': {
      const b = part('cyl', mat('#7fc8a8', { opacity: 0.7, rough: 0.15 }), 0.09, 0.36, 0.09, 0, 0.09, 0);
      b.rotation.z = Math.PI / 2;
      g.add(b);
      const neck = part('cyl', mat('#7fc8a8', { opacity: 0.7, rough: 0.15 }), 0.04, 0.12, 0.04, 0.23, 0.09, 0);
      neck.rotation.z = Math.PI / 2;
      g.add(neck);
      const cork = part('cyl', '#a0703f', 0.035, 0.05, 0.035, 0.31, 0.09, 0);
      cork.rotation.z = Math.PI / 2;
      g.add(cork);
      const paper = part('cyl', '#f5ecd7', 0.04, 0.22, 0.04, -0.02, 0.09, 0, false);
      paper.rotation.z = Math.PI / 2;
      g.add(paper);
      break;
    }
    case 'conch':
      { const shell = part('cone', '#f2c9a0', 0.12, 0.3, 0.12, 0, 0.1, 0); shell.rotation.z = Math.PI / 2.4; g.add(shell); }
      g.add(part('sphere', '#f7a7a0', 0.08, 0.06, 0.06, -0.1, 0.06, 0));
      break;
    default: // seashell
      g.add(part('sphere', '#f6d5c4', 0.12, 0.04, 0.1, 0, 0.03, 0));
      for (let i = -2; i <= 2; i++) g.add(part('box', '#e8b8a0', 0.015, 0.02, 0.18, i * 0.04, 0.06, 0, false));
  }
  return g;
}
