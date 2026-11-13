// Loading a .glb once: the promise never rejects (a missing or broken file means
// the game falls back to its procedural look), and a failure only logs a warning.

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/**
 * Load `url` and hand its scene (and animation clips) to `read`. `label` names the asset in warnings,
 * `fallback` says what the game does without it. If `read` throws, `onError` runs.
 */
export function loadGlb(url: string, label: string, fallback: string, read: (scene: THREE.Object3D, animations: THREE.AnimationClip[]) => void, onError?: () => void): Promise<void> {
  return new Promise<void>((resolve) => {
    new GLTFLoader().load(
      url,
      (gltf: { scene: THREE.Object3D; animations?: THREE.AnimationClip[] }) => {
        try {
          read(gltf.scene, gltf.animations ?? []);
        } catch (e) {
          console.warn(`${label}: could not read`, e);
          onError?.();
        }
        resolve();
      },
      undefined,
      (e: unknown) => {
        console.warn(`${label}: not loaded, ${fallback}`, e);
        resolve();
      },
    );
  });
}
