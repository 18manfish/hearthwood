// Creature, plant and furniture models built from the art kit (art/kit/*.py →
// client/public/models/*.glb, see art/kit/build_glbs.py).
//
// Every .glb holds one root node per model, named after it (`bird_robin`,
// `bush_nordic`, `boho_sofa`…), with child nodes `<model>_<group>` for the parts
// that move (wings, head, berries, the lamp bulb, the boat…). Materials are named
// by role and carry the colour; the game swaps them for its own shared, bent
// materials. When a file is missing the procedural models stay in use.

import * as THREE from 'three';
import { bentDepth } from '../bend.ts';
import { mat } from '../models/primitives.ts';
import { loadGlb } from './glb.ts';

export const KIT_FILES = ['birds', 'fish', 'plants', 'placeables', 'ambient_fish', 'furniture_boho', 'furniture_cottage', 'fish_school'] as const;

/** Roles that glow (emissive) instead of just being coloured. */
const GLOW = new Set(['glow', 'glow_spot', 'glass', 'candle']);
/** Parts too small or flat to throw a shadow worth drawing. */
const NO_SHADOW = new Set(['eye', 'eye_ring', 'eye_white', 'beak_spot', 'dot', 'dots', 'spot', 'spots', 'stripe', 'band', 'bar', 'pattern', 'glow_spot', 'rug']);

interface Template {
  root: THREE.Object3D;
}

const templates = new Map<string, Template>();
const clips = new Map<string, THREE.AnimationClip>();
let loading: Promise<void> | null = null;

/** Starts loading every kit file once; resolves even if some can't be loaded. */
export function loadKitAssets(base = '/models/'): Promise<void> {
  if (loading) return loading;
  loading = Promise.all(
    KIT_FILES.map((f) =>
      loadGlb(`${base}${f}.glb`, `${f} models`, 'using procedural models', (scene, animations) => {
        for (const node of [...scene.children]) templates.set(node.name, { root: prepare(node) });
        for (const a of animations ?? []) clips.set(a.name, a);
      }),
    ),
  ).then(() => undefined);
  return loading;
}

/** The material a kit part is drawn with: the game's shared, bent material for its colour. */
export function kitMaterial(role: string, color: string): THREE.Material {
  return GLOW.has(role) ? mat(color, { emissive: color, ei: role === 'glass' ? 0.35 : 0.9, rough: 0.3 }) : mat(color);
}

function hex(m: THREE.Material): string {
  const c = (m as THREE.MeshStandardMaterial).color;
  return c ? `#${c.getHexString()}` : '#ffffff';
}

function prepare(node: THREE.Object3D): THREE.Object3D {
  const root = node.clone(true);
  root.position.set(0, 0, 0);
  root.rotation.set(0, 0, 0);
  root.scale.set(1, 1, 1);
  const prefix = `${node.name}_`;
  root.traverse((c: THREE.Object3D) => {
    if (c !== root && c.name.startsWith(prefix)) c.name = c.name.slice(prefix.length);
    const m = c as THREE.Mesh;
    if (!m.isMesh) return;
    const src = m.material as THREE.Material;
    const role = src.name || 'part';
    m.userData.role = role;
    m.userData.color = hex(src);
    m.material = kitMaterial(role, m.userData.color as string);
    m.castShadow = !NO_SHADOW.has(role);
    m.receiveShadow = true;
    if (m.castShadow) m.customDepthMaterial = bentDepth;
  });
  return root;
}

export function hasKitModel(name: string): boolean {
  return templates.has(name);
}

/**
 * A copy of a kit model, or null when it isn't loaded. `recolor` may swap the
 * material of single parts (by role and file colour), e.g. snow on a bush.
 */
export function kitModel(name: string, recolor?: (role: string, color: string) => THREE.Material | null | undefined): THREE.Object3D | null {
  const t = templates.get(name);
  if (!t) return null;
  const o = t.root.clone(true);
  if (recolor)
    o.traverse((c: THREE.Object3D) => {
      const m = c as THREE.Mesh;
      if (!m.isMesh) return;
      const swap = recolor(m.userData.role as string, m.userData.color as string);
      if (swap) m.material = swap;
    });
  return o;
}

/** An animation clip from one of the kit files (e.g. the fish school's swim loop). */
export function kitClip(name: string): THREE.AnimationClip | null {
  return clips.get(name) ?? null;
}

/**
 * All the geometry of a kit model merged into one, for instancing (ground cover).
 * With `colors` the parts' colours become vertex colours.
 */
export function kitGeometry(name: string, colors = false): THREE.BufferGeometry | null {
  const t = templates.get(name);
  if (!t) return null;
  t.root.updateMatrixWorld(true);
  const pos: number[] = [];
  const col: number[] = [];
  const v = new THREE.Vector3();
  const c = new THREE.Color();
  t.root.traverse((o: THREE.Object3D) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const g = (m.geometry as THREE.BufferGeometry).index ? (m.geometry as THREE.BufferGeometry).toNonIndexed() : (m.geometry as THREE.BufferGeometry);
    const p = g.attributes.position as THREE.BufferAttribute;
    c.set(m.userData.color as string);
    for (let i = 0; i < p.count; i++) {
      v.set(p.getX(i), p.getY(i), p.getZ(i)).applyMatrix4(m.matrixWorld);
      pos.push(v.x, v.y, v.z);
      if (colors) col.push(c.r, c.g, c.b);
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  if (colors) g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g;
}
