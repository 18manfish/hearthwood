// Houses made in Blender, in the style of Animal Crossing (art/houses/houses_build.py):
//
//   models/house.glb                  Starter House tiers, roots `house_<tier>`
//   models/houses/villager_houses.glb villager houses, roots `vhouse_<tier>`
//   models/houses/tex_<kind>.jpg      white tileable wall / roof textures (+ `_n` normals)
//
// Each root holds one mesh per material, `house_<tier>_<material>`. The models keep
// their own textured, smooth-shaded materials (made bendable). Two materials are the
// game's own: `glass` (windows, lit at night) and `lamp` (porch lamps). On villager
// houses `vwall`, `vroof`, `vtrim` and `vdoor` are white and get each villager's
// colours and wall / roof texture. Without the files the game draws procedural houses.

import * as THREE from 'three';
import { hashString } from '@hearthwood/shared';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { bend, bentDepth, standardClone } from './bend.ts';

export const HOUSE_MODEL_URL = '/models/house.glb';
export const VILLAGER_HOUSE_URL = '/models/houses/villager_houses.glb';
const TEX_BASE = '/models/houses/';

interface Part {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  role: string;
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  scale: THREE.Vector3;
}

const templates = new Map<string, Part[]>();
let loading: Promise<void> | null = null;

function readRoots(scene: THREE.Object3D, prefix: string) {
  for (let level = 1; level <= 3; level++) {
    const name = `${prefix}_${level}`;
    const root = scene.getObjectByName(name);
    if (!root) continue;
    const parts: Part[] = [];
    const mats = new Map<THREE.Material, THREE.Material>();
    root.traverse((c: THREE.Object3D) => {
      const m = c as THREE.Mesh;
      if (!m.isMesh) return;
      const src = (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.MeshStandardMaterial;
      // Blender may add ".001" suffixes; the material name is the reliable role.
      const role = (src?.name || c.name.slice(name.length + 1)).replace(/\.\d+$/, '');
      let mat = mats.get(src);
      if (!mat) {
        const cl = standardClone(src);
        cl.flatShading = false;
        if (cl.map) cl.map.anisotropy = 4;
        mat = bend(cl);
        mats.set(src, mat);
      }
      c.updateWorldMatrix(true, false);
      const local = new THREE.Matrix4().copy(root.matrixWorld).invert().multiply(c.matrixWorld);
      const position = new THREE.Vector3(), quaternion = new THREE.Quaternion(), scale = new THREE.Vector3();
      local.decompose(position, quaternion, scale);
      parts.push({ geometry: m.geometry, material: mat, role, position, quaternion, scale });
    });
    if (parts.length) templates.set(name, parts);
  }
}

function loadInto(url: string, prefix: string): Promise<void> {
  return new Promise<void>((resolve) => {
    new GLTFLoader().load(
      url,
      (gltf: { scene: THREE.Object3D }) => {
        try {
          gltf.scene.updateMatrixWorld(true);
          readRoots(gltf.scene, prefix);
        } catch (e) {
          console.warn(`${url}: could not read`, e);
        }
        resolve();
      },
      undefined,
      (e: unknown) => {
        console.warn(`${url}: not loaded, using procedural houses`, e);
        resolve();
      },
    );
  });
}

/** Starts loading the house models once; resolves even if they can't be loaded. */
export function loadHouseAssets(url = HOUSE_MODEL_URL): Promise<void> {
  loading ??= Promise.all([loadInto(url, 'house'), loadInto(VILLAGER_HOUSE_URL, 'vhouse')]).then(() => undefined);
  return loading;
}

/** The game's own materials for roles it lights itself (windows, lamps). */
export type SharedMat = (role: 'glass' | 'lamp') => THREE.Material;

function assemble(parts: Part[], shared: SharedMat, override?: (role: string) => THREE.Material | null) {
  const g = new THREE.Group();
  for (const p of parts) {
    const isGlass = p.role === 'glass';
    const material = isGlass ? shared('glass') : p.role === 'lamp' ? shared('lamp') : override?.(p.role) ?? p.material;
    const m = new THREE.Mesh(p.geometry, material);
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

/** A ready-to-place Starter House for a tier, or null when the model isn't loaded. */
export function gltfHouse(level: number, shared: SharedMat): THREE.Group | null {
  const parts = templates.get(`house_${level}`);
  return parts ? assemble(parts, shared) : null;
}

// ── Villager houses: every villager's own colours and materials ───────────

export type WallKind = 'siding' | 'stucco' | 'brick' | 'logs' | 'stone';
export type RoofKind = 'tiles' | 'shingles' | 'thatch';

export interface HouseStyle {
  wall: WallKind;
  wallColor: string;
  roof: RoofKind;
  roofColor: string;
  trim: string;
  door: string;
}

/** Each villager's house, matched to who they are (like the houses on a New Horizons island). */
export const VILLAGER_HOUSE_STYLES: Record<string, HouseStyle> = {
  v_maple: { wall: 'logs', wallColor: '#d9a066', roof: 'shingles', roofColor: '#c4572b', trim: '#fff4e0', door: '#8a4b2a' },
  v_bruno: { wall: 'logs', wallColor: '#a87650', roof: 'shingles', roofColor: '#6b4a32', trim: '#e9d7b8', door: '#4f6b3a' },
  v_pip: { wall: 'stucco', wallColor: '#fdeef2', roof: 'tiles', roofColor: '#f2a5bd', trim: '#ffffff', door: '#e58aa8' },
  v_rex: { wall: 'stone', wallColor: '#b9bec4', roof: 'tiles', roofColor: '#4c5a6e', trim: '#3b4250', door: '#5a3a2e' },
  v_juno: { wall: 'stucco', wallColor: '#e8e2f2', roof: 'tiles', roofColor: '#5a4a8a', trim: '#fff6d8', door: '#f2c94c' },
  v_biscuit: { wall: 'siding', wallColor: '#ffe3a8', roof: 'tiles', roofColor: '#d9533f', trim: '#ffffff', door: '#3b6fb6' },
  v_saffron: { wall: 'siding', wallColor: '#fff4e6', roof: 'tiles', roofColor: '#e46b2e', trim: '#ffffff', door: '#3f8f5a' },
  v_hoot: { wall: 'brick', wallColor: '#b5654a', roof: 'shingles', roofColor: '#4f4a45', trim: '#efe0c4', door: '#2f4a3a' },
  v_fawn: { wall: 'siding', wallColor: '#f1e2c8', roof: 'thatch', roofColor: '#d8b878', trim: '#ffffff', door: '#a0603a' },
  v_ribbit: { wall: 'stucco', wallColor: '#e3f2d0', roof: 'tiles', roofColor: '#5fae4a', trim: '#fff8e0', door: '#e2b33c' },
  v_waddle: { wall: 'siding', wallColor: '#e6f1fa', roof: 'tiles', roofColor: '#2c3e50', trim: '#ffffff', door: '#f2a03d' },
  v_eucy: { wall: 'stucco', wallColor: '#e9eef0', roof: 'thatch', roofColor: '#b9a77c', trim: '#ffffff', door: '#6d8f5a' },
  v_puddle: { wall: 'siding', wallColor: '#fffbe8', roof: 'tiles', roofColor: '#f2b33d', trim: '#ffffff', door: '#6ec1e4' },
  v_nibbles: { wall: 'brick', wallColor: '#f0c49a', roof: 'tiles', roofColor: '#c46a8f', trim: '#fff4e0', door: '#7a3b69' },
  v_cinder: { wall: 'siding', wallColor: '#ffe9d6', roof: 'tiles', roofColor: '#e07b39', trim: '#ffffff', door: '#c0392b' },
  v_tundra: { wall: 'logs', wallColor: '#dfe6ee', roof: 'shingles', roofColor: '#7f9bb5', trim: '#ffffff', door: '#3b5f99' },
  v_coco: { wall: 'brick', wallColor: '#d9927a', roof: 'tiles', roofColor: '#6d4c3d', trim: '#f0d9c5', door: '#e46b2e' },
  v_barley: { wall: 'logs', wallColor: '#e2c08c', roof: 'thatch', roofColor: '#c9a35c', trim: '#fff0d4', door: '#8e5a3c' },
};

const WALL_KINDS: WallKind[] = ['siding', 'stucco', 'brick', 'logs', 'stone'];
const ROOF_COLORS = ['#d9533f', '#3f8f8a', '#4f73b8', '#c2185b', '#8e5a3c', '#f1c40f', '#6aa84f'];
const WALL_COLORS = ['#fbf1dc', '#e3f2d0', '#fdeef2', '#e6f1fa', '#fff4e6', '#f1e2c8'];

export function villagerHouseStyle(villagerId: string | undefined, buildingId: string): HouseStyle {
  const s = villagerId ? VILLAGER_HOUSE_STYLES[villagerId] : undefined;
  if (s) return s;
  const h = hashString(buildingId);
  return { wall: WALL_KINDS[h % WALL_KINDS.length], wallColor: WALL_COLORS[(h >> 3) % WALL_COLORS.length], roof: 'tiles', roofColor: ROOF_COLORS[(h >> 6) % ROOF_COLORS.length], trim: '#ffffff', door: '#8a4b2a' };
}

const texCache = new Map<string, THREE.Texture>();
function tex(kind: string, normal: boolean) {
  const key = `${kind}${normal ? '_n' : ''}`;
  let t = texCache.get(key);
  if (!t) {
    t = new THREE.TextureLoader().load(`${TEX_BASE}tex_${key}.jpg`);
    t.flipY = false; // glTF UVs
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 4;
    if (!normal) t.colorSpace = THREE.SRGBColorSpace;
    texCache.set(key, t);
  }
  return t;
}

const styleMats = new Map<string, THREE.Material>();
/** How strongly each swapped texture's relief shows. */
const NORMAL_SCALE: Record<string, number> = { thatch: 0.3, stucco: 0.45, siding: 0.7, logs: 0.8, brick: 0.9, stone: 1, tiles: 1, shingles: 0.8 };

/** A villager's house for a tier, in their style, or null when the model isn't loaded. */
export function gltfVillagerHouse(level: number, style: HouseStyle, shared: SharedMat): THREE.Group | null {
  const parts = templates.get(`vhouse_${level}`);
  if (!parts) return null;
  const roleMat = (role: string, base: THREE.Material): THREE.Material | null => {
    const spec = role === 'vwall' ? { color: style.wallColor, kind: style.wall }
      : role === 'vroof' ? { color: style.roofColor, kind: style.roof }
      : role === 'vtrim' ? { color: style.trim }
      : role === 'vdoor' ? { color: style.door } : null;
    if (!spec) return null;
    const key = `${role}|${spec.color}|${'kind' in spec ? spec.kind : ''}`;
    let m = styleMats.get(key);
    if (!m) {
      const cl = standardClone(base);
      cl.color.set(spec.color);
      if ('kind' in spec && spec.kind) {
        cl.map = tex(spec.kind, false);
        cl.normalMap = tex(spec.kind, true);
        const k = NORMAL_SCALE[spec.kind] ?? 0.8;
        cl.normalScale = new THREE.Vector2(k, k);
      }
      m = bend(cl);
      styleMats.set(key, m);
    }
    return m;
  };
  const byRole = new Map(parts.map((p) => [p.role, p.material]));
  return assemble(parts, shared, (role) => (byRole.has(role) ? roleMat(role, byRole.get(role)!) : null));
}
