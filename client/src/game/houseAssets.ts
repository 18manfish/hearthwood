// Starter House tiers made in Blender (art/house_build.py → client/public/models/house.glb).
//
// The .glb holds one root node per tier, `house_<tier>`, with one child mesh
// per material, `house_<tier>_<material>`. Colours come from the materials and
// are swapped for the game's shared (flat-shaded, bent) materials; `glass` and
// `sea_glass` meshes become the windows. If the file is missing, models.ts falls
// back to the procedural houses.

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { bentDepth } from './bend.ts';

export const HOUSE_MODEL_URL = '/models/house.glb';

interface Part {
  geometry: THREE.BufferGeometry;
  color: string;
  material: string;
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  scale: THREE.Vector3;
}

const templates = new Map<number, Part[]>();
let loading: Promise<void> | null = null;

/** Starts loading the house models once; resolves even if they can't be loaded. */
export function loadHouseAssets(url = HOUSE_MODEL_URL): Promise<void> {
  if (loading) return loading;
  loading = new Promise<void>((resolve) => {
    new GLTFLoader().load(
      url,
      (gltf: { scene: THREE.Object3D }) => {
        try {
          for (let level = 1; level <= 3; level++) {
            const root = gltf.scene.getObjectByName(`house_${level}`);
            if (!root) continue;
            const parts: Part[] = [];
            root.traverse((c: THREE.Object3D) => {
              const m = c as THREE.Mesh;
              if (!m.isMesh || c === root) return;
              const src = (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.MeshStandardMaterial;
              const prefix = `house_${level}_`;
              // Blender may add ".001" suffixes; the material name is the reliable role.
              const role = src?.name || (c.name.startsWith(prefix) ? c.name.slice(prefix.length) : c.name);
              parts.push({
                geometry: m.geometry,
                color: `#${src?.color?.getHexString?.() ?? '888888'}`,
                material: role.replace(/\.\d+$/, ''),
                position: c.position.clone(),
                quaternion: c.quaternion.clone(),
                scale: c.scale.clone(),
              });
            });
            if (parts.length) templates.set(level, parts);
          }
        } catch (e) {
          console.warn('house models: could not read', e);
        }
        resolve();
      },
      undefined,
      (e: unknown) => {
        console.warn('house models: not loaded, using procedural houses', e);
        resolve();
      },
    );
  });
  return loading;
}

export function hasHouseModel(level: number) {
  return templates.has(level);
}

/**
 * A ready-to-place house for a tier, or null when the model isn't loaded.
 * `mat` and `glass` come from models.ts so materials stay shared and bent.
 */
export function gltfHouse(level: number, mat: (color: string) => THREE.Material, glass: () => THREE.Material): THREE.Group | null {
  const parts = templates.get(level);
  if (!parts) return null;
  const g = new THREE.Group();
  for (const p of parts) {
    const isGlass = p.material === 'glass' || p.material === 'sea_glass';
    const m = new THREE.Mesh(p.geometry, isGlass ? glass() : mat(p.color));
    m.position.copy(p.position);
    m.quaternion.copy(p.quaternion);
    m.scale.copy(p.scale);
    m.castShadow = !isGlass;
    m.receiveShadow = true;
    if (m.castShadow) m.customDepthMaterial = bentDepth;
    if (isGlass) m.name = 'window';
    g.add(m);
  }
  return g;
}
