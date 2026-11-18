// The parts of a model.
//
// Models are groups of meshes. A few nodes carry a name: the parts the game moves
// or looks up after the model is built (a lighthouse beam, a moored boat, the tip
// of a fishing rod). Everything about telling those apart lives here.

import type * as THREE from 'three';

const named = new WeakMap<THREE.Object3D, Map<string, THREE.Object3D>>();

/**
 * `root.getObjectByName(name)` without the search: a model's named nodes are mapped
 * once, so asking every frame costs nothing. A model whose parts are swapped
 * afterwards says so with `forgetParts`.
 */
export function namedPart(root: THREE.Object3D, name: string): THREE.Object3D | undefined {
  let parts = named.get(root);
  if (!parts) {
    const found = new Map<string, THREE.Object3D>();
    root.traverse((o: THREE.Object3D) => {
      if (o.name && !found.has(o.name)) found.set(o.name, o);
    });
    named.set(root, (parts = found));
  }
  return parts.get(name);
}

export function forgetParts(root: THREE.Object3D) {
  named.delete(root);
}

/**
 * The named parts that keep moving on a placed model (animateProps, and the
 * shopkeeper behind a counter). Everything else on a placed model stands still, so
 * it can be instanced, baked into one mesh and have its matrices frozen.
 */
const MOVING = new Set(['beam', 'spout', 'flame', 'swing', 'boat', 'keeper']);

export function isMovingPart(o: THREE.Object3D) {
  return MOVING.has(o.name);
}

/** One geometry, one material, no skinning or morphing: a mesh that can be merged with others or instanced. */
function isPlainMesh(o: THREE.Object3D): o is THREE.Mesh {
  const mesh = o as THREE.Mesh;
  if (!mesh.isMesh || (mesh as THREE.InstancedMesh).isInstancedMesh || (mesh as THREE.SkinnedMesh).isSkinnedMesh) return false;
  return !Array.isArray(mesh.material) && !mesh.morphTargetInfluences;
}

/**
 * The visible plain meshes of a model, appended to `out`. Hidden subtrees are left
 * out, and so are the subtrees `skip` picks (moving parts, say).
 */
export function plainMeshes(o: THREE.Object3D, skip: (o: THREE.Object3D) => boolean, out: THREE.Mesh[] = [], root = o): THREE.Mesh[] {
  if (!o.visible || (o !== root && skip(o))) return out;
  if (isPlainMesh(o)) out.push(o);
  for (const c of o.children) plainMeshes(c, skip, out, root);
  return out;
}
