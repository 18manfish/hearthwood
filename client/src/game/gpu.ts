// Who frees what on the GPU. three.js never frees geometries, materials or textures
// by itself: whoever made one for a single model has to dispose it when the model goes.
//
// Most of the game's resources are shared (the cached materials of models/primitives.ts,
// the primitive geometries, everything loaded from a .glb) and live as long as the page.
// The ones made for one model instance are marked with `own()`; `disposeTree()` frees
// exactly those when the model leaves the scene.

import * as THREE from 'three';

type Res = { userData: Record<string, unknown> };

/** Mark a geometry, material or texture as made for one model instance (see disposeTree). */
export function own<T extends Res>(res: T): T {
  res.userData.owned = true;
  return res;
}

const TEXTURE_SLOTS = ['map', 'normalMap', 'emissiveMap', 'roughnessMap', 'metalnessMap', 'alphaMap', 'aoMap', 'bumpMap'] as const;

function disposeMaterial(m: THREE.Material) {
  if (!m.userData.owned) return;
  for (const slot of TEXTURE_SLOTS) {
    const t = (m as unknown as Record<string, THREE.Texture | null | undefined>)[slot];
    if (t?.userData.owned) t.dispose();
  }
  m.dispose();
}

/**
 * Free the GPU resources a model owns (it is leaving the scene for good). Shared
 * resources are left alone.
 */
export function disposeTree(root: THREE.Object3D) {
  root.traverse((o: THREE.Object3D) => {
    const m = o as THREE.Mesh;
    const geo = m.geometry as THREE.BufferGeometry | undefined;
    if (!geo) return; // groups, lights, labels
    if (geo.userData.owned) geo.dispose();
    const mats = m.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mats)) mats.forEach(disposeMaterial);
    else if (mats) disposeMaterial(mats);
    const sk = m as THREE.SkinnedMesh;
    if (sk.isSkinnedMesh) sk.skeleton?.dispose(); // the bone texture
    const im = m as THREE.InstancedMesh;
    if (im.isInstancedMesh) im.dispose();
  });
}

/**
 * Free every geometry and material under a layer that is built from scratch each
 * time (the terrain with its water, docks and stairs). Anything in it that is shared
 * after all is simply uploaded again when it is next drawn.
 */
export function disposeAll(root: THREE.Object3D) {
  root.traverse((o: THREE.Object3D) => {
    const m = o as THREE.Mesh;
    (m.geometry as THREE.BufferGeometry | undefined)?.dispose();
    const mats = m.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mats)) mats.forEach((x) => x.dispose());
    else mats?.dispose();
    if ((m as THREE.InstancedMesh).isInstancedMesh) (m as THREE.InstancedMesh).dispose();
  });
}
