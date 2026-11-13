// Trees: the Blender models when they're loaded (treeAssets.ts), otherwise procedural
// shapes per species, with seasonal foliage, bare winter branches, snow and fruit.

import * as THREE from 'three';
import { type Season, TREES, type WorldObject } from '@hearthwood/shared';
import { kitModel } from '../assets/kit.ts';
import { gltfTree } from '../treeAssets.ts';
import { G, mat, part, rand } from './primitives.ts';

export const FRUIT_COLORS: Record<string, string> = {
  apple: '#e53935', cherry: '#b71c1c', coconut: '#6d4c2f', banana: '#f6d743', dates: '#a0522d', pinecone: '#7a5230', prickly_pear: '#d81b60',
};

export function treeModel(o: WorldObject, season: Season, visual: 'spring' | 'summer' | 'autumn' | 'winter', snowy: boolean) {
  const def = TREES[o.species ?? 'oak'];
  const g = new THREE.Group();
  const stage = o.stage ?? 2;
  const scale = stage === 0 ? 0.3 : stage === 1 ? 0.65 : 1;
  const foliage = def.foliage[season] ?? def.foliage[visual] ?? def.foliage.default ?? '#4f9e3a';
  const bare = def.deciduous && visual === 'winter';
  const fruitColor = def.fruit ? FRUIT_COLORS[def.fruit] : undefined;
  const fruits: [number, number, number][] = [];

  // Prefer the Blender models when they are loaded (saplings come from the art kit).
  if (stage > 0) {
    const m = gltfTree(
      o,
      { trunk: def.trunk, foliage, bare: !!bare, snowy, fruitColor: stage === 2 ? fruitColor : undefined, fruitCount: o.fruit ?? 0 },
      (c) => mat(c),
      (c, x, y, z) => part('sphere', c, 0.11, 0.11, 0.11, x, y, z),
    );
    if (m) {
      m.scale.setScalar(scale);
      m.rotation.y = rand(o.id) * Math.PI * 2;
      return m;
    }
  }

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
    // Sapling: the kit sprout, else a tiny procedural one.
    const kit = kitModel('sapling');
    if (kit) {
      kit.rotation.y = rand(o.id) * Math.PI * 2;
      return kit;
    }
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
