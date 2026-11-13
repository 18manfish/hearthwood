// Fish: the dark shadows swimming in the water (fishing spots, from the kit's
// ambient fish) and the fish you hold up when you catch one (the kit's fish).
// Both fall back to simple shapes when the models aren't loaded.

import * as THREE from 'three';
import { ITEMS, type FishShadow } from '@hearthwood/shared';
import { kitModel } from '../assets/kit.ts';
import { emojiSprite } from './furniture.ts';
import { mat, part, rand } from './primitives.ts';

/** Colour of every fish shadow. */
export const SHADOW_COLOR = '#1c2630';

/** Tail-beat period (s), length (tiles) and how far it roams around its spot, per size. */
export const SHADOW_SWIM: Record<FishShadow, { cycle: number; length: number; roam: number; depth: number }> = {
  small: { cycle: 0.45, length: 0.22, roam: 0.32, depth: 0.12 },
  medium: { cycle: 0.75, length: 0.5, roam: 0.3, depth: 0.16 },
  large: { cycle: 1.2, length: 1.1, roam: 0.22, depth: 0.22 },
};

/**
 * A fish shadow: the group sits on the spot's tile centre; its `swimmer` child
 * wanders about and its meshes' morph targets (swim_a, swim_b, fins) swim.
 */
export function fishShadowModel(size: FishShadow, id: string): THREE.Object3D {
  const g = new THREE.Group();
  const swimmer = kitModel(`ambient_fish_${size}`, () => mat(SHADOW_COLOR)) ?? fallbackShadow(size);
  swimmer.name = 'swimmer';
  const morphs: THREE.Mesh[] = [];
  swimmer.traverse((c: THREE.Object3D) => {
    const m = c as THREE.Mesh;
    if (!m.isMesh) return;
    m.castShadow = false;
    m.receiveShadow = false;
    if (m.morphTargetInfluences?.length) morphs.push(m);
  });
  g.add(swimmer);
  g.userData.fish = { size, phase: rand(id, 5) * Math.PI * 2, morphs };
  return g;
}

function fallbackShadow(size: FishShadow) {
  const L = SHADOW_SWIM[size].length;
  const g = new THREE.Group();
  g.add(part('sphere', SHADOW_COLOR, L * 0.12, L * 0.1, L * 0.45, 0, 0, 0, false));
  const tail = part('cone4', SHADOW_COLOR, L * 0.12, L * 0.25, L * 0.03, 0, 0, -L * 0.5, false);
  tail.rotation.x = -Math.PI / 2;
  g.add(tail);
  return g;
}

/** Drive a shadow's swim cycle: `speed` 1 = cruising. */
export function swimShadow(g: THREE.Object3D, t: number, speed = 1) {
  const f = g.userData.fish as { size: FishShadow; phase: number; morphs: THREE.Mesh[] } | undefined;
  if (!f) return;
  const ph = f.phase + ((t * Math.PI * 2) / SHADOW_SWIM[f.size].cycle) * speed;
  const a = Math.sin(ph), b = -Math.cos(ph), fins = 0.5 + 0.5 * Math.sin(ph * 2);
  for (const m of f.morphs) {
    const w = m.morphTargetInfluences!;
    w[0] = a;
    w[1] = b;
    if (w.length > 2) w[2] = fins;
  }
}

/** The fish you just caught, to hold up: its kit model, nose to the right; else its emoji. */
export function caughtFishModel(item: string): THREE.Object3D {
  const g = new THREE.Group();
  const kit = kitModel(item);
  if (kit) {
    // Fit any fish (sardine to oarfish) into about one tile.
    const box = new THREE.Box3().setFromObject(kit);
    const len = Math.max(box.max.z - box.min.z, box.max.x - box.min.x, 0.01);
    const s = Math.min(1.6, 0.9 / len);
    kit.scale.setScalar(s);
    kit.rotation.y = Math.PI / 2;
    kit.position.y = -((box.min.y + box.max.y) / 2) * s;
    g.add(kit);
  } else {
    const sp = emojiSprite(ITEMS[item]?.icon ?? '🐟', 0.7);
    g.add(sp);
  }
  return g;
}
