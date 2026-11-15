// Draw-call batching for the island's static scenery.
//
// Hundreds of trees, rocks, bushes and flowers are built from a handful of shared
// geometries and cached materials, so instead of one draw call per part (per object,
// twice with shadows) every (geometry, material, shadow flags) pair becomes one
// InstancedMesh per chunk of the island. Parts that move (named nodes such as a bush's
// `berries` or a swinging chair) stay ordinary meshes in the object's own group.
//
// Culling: the world bends away from the player (bend.ts), so three's frustum test on
// the unbent positions is wrong far away. Each chunk keeps a bounding sphere and is
// tested here against the camera with the bend drop applied (bentCulling). The same is
// used for the foliage chunks.

import * as THREE from 'three';
import { bendDrop } from './bend.ts';

// Tiles per chunk side. Bigger chunks = fewer draw calls but less culled; these were
// tuned against draw calls + triangles on a full island (see the perf notes in the PR).
export const CHUNKS = { foliage: 48, objects: 32 };

interface Cullable {
  mesh: THREE.Object3D;
  sphere: THREE.Sphere;
  /** Extra radius for things whose shadows can reach into view from outside it. */
  margin: number;
}

const cullables = new Set<Cullable>();
const frustum = new THREE.Frustum();
const projScreen = new THREE.Matrix4();
const tmpSphere = new THREE.Sphere();

export function registerCullable(mesh: THREE.Object3D, sphere: THREE.Sphere, margin = 0) {
  mesh.frustumCulled = false; // culled here instead
  const c = { mesh, sphere, margin };
  cullables.add(c);
  return c;
}

export function unregisterCullable(c: Cullable | undefined) {
  if (c) cullables.delete(c);
}

/** Per frame: show only what the (bent) view can see. */
export function bentCulling(camera: THREE.Camera) {
  camera.updateMatrixWorld();
  projScreen.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  frustum.setFromProjectionMatrix(projScreen);
  for (const c of cullables) {
    if (c.sphere.radius < 0) continue; // empty
    tmpSphere.copy(c.sphere);
    tmpSphere.center.y -= bendDrop(c.sphere.center.z);
    tmpSphere.radius += c.margin;
    c.mesh.visible = frustum.intersectsSphere(tmpSphere);
  }
}

/** Bounding sphere of an InstancedMesh's instances (world = parent space). */
function instancesSphere(mesh: THREE.InstancedMesh, out: THREE.Sphere) {
  const geo = mesh.geometry;
  if (!geo.boundingSphere) geo.computeBoundingSphere();
  const gs = geo.boundingSphere!;
  const box = new THREE.Box3();
  const m = new THREE.Matrix4();
  const s = new THREE.Sphere();
  for (let i = 0; i < mesh.count; i++) {
    mesh.getMatrixAt(i, m);
    s.copy(gs).applyMatrix4(m);
    box.expandByPoint(s.center.clone().addScalar(s.radius));
    box.expandByPoint(s.center.clone().subScalar(s.radius));
  }
  if (box.isEmpty()) out.radius = -1;
  else box.getBoundingSphere(out);
  return out;
}

/** Foliage: split one big InstancedMesh into culled chunks (same look, far fewer triangles drawn). */
export function chunkInstances(src: THREE.InstancedMesh, parent: THREE.Object3D): THREE.InstancedMesh[] {
  const m = new THREE.Matrix4();
  const c = new THREE.Color();
  const buckets = new Map<string, number[]>();
  for (let i = 0; i < src.count; i++) {
    src.getMatrixAt(i, m);
    const key = `${Math.floor(m.elements[12] / CHUNKS.foliage)},${Math.floor(m.elements[14] / CHUNKS.foliage)}`;
    let b = buckets.get(key);
    if (!b) buckets.set(key, (b = []));
    b.push(i);
  }
  const out: THREE.InstancedMesh[] = [];
  for (const idx of buckets.values()) {
    const im = new THREE.InstancedMesh(src.geometry, src.material, idx.length);
    idx.forEach((i, j) => {
      src.getMatrixAt(i, m);
      im.setMatrixAt(j, m);
      if (src.instanceColor) {
        src.getColorAt(i, c);
        im.setColorAt(j, c);
      }
    });
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.castShadow = src.castShadow;
    im.receiveShadow = src.receiveShadow;
    im.customDepthMaterial = src.customDepthMaterial;
    const sphere = instancesSphere(im, new THREE.Sphere());
    sphere.radius += 0.6; // wind sway
    im.userData.cull = registerCullable(im, sphere);
    parent.add(im);
    out.push(im);
  }
  return out;
}

export function releaseChunks(group: THREE.Object3D) {
  for (const c of group.children) unregisterCullable(c.userData.cull as Cullable | undefined);
}

// ── Static objects ───────────────────────────────────────────────────────

interface Batch {
  mesh: THREE.InstancedMesh;
  ids: string[]; // owner of each instance slot
  cull: Cullable;
  dirty: boolean;
}

/** A moving or swapped part keeps its own mesh: any named node and everything under it. */
function movable(o: THREE.Object3D, root: THREE.Object3D) {
  for (let p: THREE.Object3D | null = o; p && p !== root; p = p.parent) if (p.name && KEEP.test(p.name)) return true;
  return false;
}
/** Names the game animates or looks up (see world/room/objects.ts and friends). */
const KEEP = /^(beam|spout|flame|firelight|swing|boat|body|head|swimmer|window|bulb|berries|float|ripple|hop|model|lighthouse-light|keeper|wade|bird)$/;

export class StaticBatcher {
  private batches = new Map<string, Batch>();
  private owned = new Map<string, { key: string; count: number }[]>();
  private readonly m = new THREE.Matrix4();

  constructor(private readonly parent: THREE.Object3D) {}

  /**
   * Take the static parts of `root` (already placed, not yet added to the scene) into
   * instanced batches; what's left of `root` (moving parts, lights…) stays a group.
   */
  add(id: string, root: THREE.Object3D) {
    this.remove(id);
    root.updateMatrixWorld(true);
    const take: THREE.Mesh[] = [];
    root.traverse((o: THREE.Object3D) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || (mesh as THREE.InstancedMesh).isInstancedMesh || (mesh as THREE.SkinnedMesh).isSkinnedMesh) return;
      if (Array.isArray(mesh.material) || mesh.morphTargetInfluences) return;
      for (let p: THREE.Object3D | null = o; p; p = p.parent) if (!p.visible) return;
      if (movable(o, root)) return;
      take.push(mesh);
    });
    const counts = new Map<string, number>();
    for (const mesh of take) {
      const key = this.key(mesh);
      const b = this.batch(key, mesh);
      this.place(b, id, mesh.matrixWorld);
      counts.set(key, (counts.get(key) ?? 0) + 1);
      mesh.removeFromParent();
    }
    this.owned.set(id, [...counts].map(([key, count]) => ({ key, count })));
  }

  remove(id: string) {
    const own = this.owned.get(id);
    if (!own) return;
    this.owned.delete(id);
    for (const { key } of own) {
      const b = this.batches.get(key);
      if (!b) continue;
      // swap-remove every slot of this id
      for (let i = b.ids.length - 1; i >= 0; i--) {
        if (b.ids[i] !== id) continue;
        const last = b.ids.length - 1;
        if (i !== last) {
          b.mesh.getMatrixAt(last, this.m);
          b.mesh.setMatrixAt(i, this.m);
          b.ids[i] = b.ids[last];
        }
        b.ids.pop();
      }
      b.mesh.count = b.ids.length;
      b.dirty = true;
    }
  }

  clear() {
    for (const b of this.batches.values()) {
      unregisterCullable(b.cull);
      b.mesh.removeFromParent();
      b.mesh.dispose();
    }
    this.batches.clear();
    this.owned.clear();
  }

  /** Once per frame: refresh changed batches. */
  flush() {
    for (const b of this.batches.values()) {
      if (!b.dirty) continue;
      b.dirty = false;
      b.mesh.instanceMatrix.needsUpdate = true;
      instancesSphere(b.mesh, b.cull.sphere);
    }
  }

  get drawCalls() {
    let n = 0;
    for (const b of this.batches.values()) if (b.mesh.count && b.mesh.visible) n++;
    return n;
  }

  private key(mesh: THREE.Mesh) {
    const e = mesh.matrixWorld.elements;
    const chunk = `${Math.floor(e[12] / CHUNKS.objects)},${Math.floor(e[14] / CHUNKS.objects)}`;
    return `${mesh.geometry.uuid}|${(mesh.material as THREE.Material).uuid}|${mesh.castShadow ? 1 : 0}${mesh.receiveShadow ? 1 : 0}|${chunk}`;
  }

  private batch(key: string, like: THREE.Mesh): Batch {
    let b = this.batches.get(key);
    if (!b) {
      const mesh = new THREE.InstancedMesh(like.geometry, like.material as THREE.Material, 8);
      mesh.count = 0;
      mesh.castShadow = like.castShadow;
      mesh.receiveShadow = like.receiveShadow;
      mesh.customDepthMaterial = like.customDepthMaterial;
      this.parent.add(mesh);
      b = { mesh, ids: [], cull: registerCullable(mesh, new THREE.Sphere(new THREE.Vector3(), -1), like.castShadow ? 5 : 0), dirty: true };
      this.batches.set(key, b);
    }
    return b;
  }

  private place(b: Batch, id: string, matrix: THREE.Matrix4) {
    const cap = b.mesh.instanceMatrix.count;
    if (b.ids.length >= cap) this.grow(b, cap * 2);
    b.mesh.setMatrixAt(b.ids.length, matrix);
    b.ids.push(id);
    b.mesh.count = b.ids.length;
    b.dirty = true;
  }

  private grow(b: Batch, cap: number) {
    const old = b.mesh;
    const mesh = new THREE.InstancedMesh(old.geometry, old.material, cap);
    for (let i = 0; i < b.ids.length; i++) {
      old.getMatrixAt(i, this.m);
      mesh.setMatrixAt(i, this.m);
    }
    mesh.count = b.ids.length;
    mesh.castShadow = old.castShadow;
    mesh.receiveShadow = old.receiveShadow;
    mesh.customDepthMaterial = old.customDepthMaterial;
    this.parent.add(mesh);
    old.removeFromParent();
    old.dispose();
    unregisterCullable(b.cull);
    b.cull = registerCullable(mesh, b.cull.sphere, b.cull.margin);
    b.mesh = mesh;
  }
}
