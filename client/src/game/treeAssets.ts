// Tree models made in Blender (art/trees.blend → client/public/models/trees.glb).
//
// The .glb holds one root node per species, `tree_<species>`, with child meshes
// named by role. Colours come from the game data (TREES), not the file, so the
// game creation tool and the seasons keep working:
//   _trunk / _branches  → trunk colour (_branches only shows when bare in winter)
//   _foliage            → seasonal foliage colour (hidden when bare)
//   _snow               → only when snowy
//   _marks / _ribs      → fixed detail colours (birch bark marks, cactus ribs)
//   _fruit<i> (empties) → where fruit hangs
// If the file is missing or a species isn't in it, models.ts falls back to the
// procedural tree.

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { TREES, type WorldObject } from '@hearthwood/shared';
import { bentDepth } from './bend.ts';

export const TREE_MODEL_URL = '/models/trees.glb';

/** Largest canopy radius and height a tree may have, in tiles. */
const MAX_RADIUS = 1.1;
const MAX_HEIGHT = 2.9;

interface Template {
  root: THREE.Object3D;
  fruits: THREE.Vector3[];
  scale: number;
}

const templates = new Map<string, Template>();
let loading: Promise<void> | null = null;

/** Starts loading the tree models once; resolves even if they can't be loaded. */
export function loadTreeAssets(url = TREE_MODEL_URL): Promise<void> {
  if (loading) return loading;
  loading = new Promise<void>((resolve) => {
    new GLTFLoader().load(
      url,
      (gltf: { scene: THREE.Object3D }) => {
        try {
          for (const species of Object.keys(TREES)) {
            const node = gltf.scene.getObjectByName(`tree_${species}`);
            if (node) templates.set(species, prepare(node, species));
          }
        } catch (e) {
          console.warn('tree models: could not read', e);
        }
        resolve();
      },
      undefined,
      (e: unknown) => {
        console.warn('tree models: not loaded, using procedural trees', e);
        resolve();
      },
    );
  });
  return loading;
}

function prepare(node: THREE.Object3D, species: string): Template {
  const root = node.clone(true);
  root.position.set(0, 0, 0);
  root.rotation.set(0, 0, 0);
  root.scale.set(1, 1, 1);
  root.updateMatrixWorld(true);
  const fruits: THREE.Vector3[] = [];
  const prefix = `tree_${species}_fruit`;
  for (const c of [...root.children]) {
    if (c.name.startsWith(prefix)) {
      fruits[Number(c.name.slice(prefix.length)) || 0] = c.position.clone();
      root.remove(c);
    }
  }
  // Fit the tree into its tile budget (ignoring snow, which sits on top).
  const box = new THREE.Box3();
  root.traverse((c: THREE.Object3D) => {
    if ((c as THREE.Mesh).isMesh && !c.name.endsWith('_snow')) box.expandByObject(c);
  });
  const radius = Math.max(Math.abs(box.min.x), Math.abs(box.max.x), Math.abs(box.min.z), Math.abs(box.max.z));
  const height = box.max.y;
  const scale = Math.min(1, MAX_RADIUS / (radius || 1), MAX_HEIGHT / (height || 1));
  return { root, fruits: fruits.filter(Boolean), scale };
}

export function hasTreeModel(species: string) {
  return templates.has(species);
}

export interface TreeLook {
  trunk: string;
  foliage: string;
  bare: boolean;
  snowy: boolean;
  fruitColor?: string;
  fruitCount: number;
}

/**
 * A ready-to-place tree from the Blender models, or null when there is none.
 * `mat` and `fruit` come from models.ts so materials stay shared and bent.
 */
export function gltfTree(
  o: WorldObject,
  look: TreeLook,
  mat: (color: string) => THREE.Material,
  fruit: (color: string, x: number, y: number, z: number) => THREE.Object3D,
): THREE.Group | null {
  const t = templates.get(o.species ?? 'oak');
  if (!t) return null;
  const g = new THREE.Group();
  const tree = t.root.clone(true);
  const hasBranches = !!tree.children.find((c: THREE.Object3D) => c.name.endsWith('_branches'));
  for (const c of [...tree.children]) {
    const m = c as THREE.Mesh;
    if (!m.isMesh) continue;
    const role = c.name.slice(c.name.lastIndexOf('_') + 1);
    let visible = true;
    switch (role) {
      case 'trunk': m.material = mat(look.trunk); break;
      case 'branches': m.material = mat(look.trunk); visible = look.bare; break;
      case 'foliage': m.material = mat(look.foliage); visible = !(look.bare && hasBranches); break;
      case 'snow': m.material = mat('#ffffff'); visible = look.snowy && !look.bare; break;
      case 'marks': m.material = mat('#2b2622'); break;
      case 'ribs': m.material = mat(shade(look.trunk, 0.8)); break;
      default: break;
    }
    if (!visible) {
      tree.remove(c);
      continue;
    }
    m.castShadow = role !== 'snow' && role !== 'marks' && role !== 'ribs';
    m.receiveShadow = true;
    if (m.castShadow) m.customDepthMaterial = bentDepth;
  }
  if (look.fruitColor && !look.bare) {
    const n = Math.min(look.fruitCount, t.fruits.length);
    for (let i = 0; i < n; i++) tree.add(fruit(look.fruitColor, t.fruits[i].x, t.fruits[i].y, t.fruits[i].z));
  }
  tree.scale.setScalar(t.scale);
  g.add(tree);
  return g;
}

function shade(hex: string, f: number) {
  const c = new THREE.Color(hex);
  c.multiplyScalar(f);
  return `#${c.getHexString()}`;
}
