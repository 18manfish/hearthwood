// Decorative ground cover: grass tufts, ferns, reeds, wildflowers, fallen
// leaves and snow clumps. Purely visual (client-side), deterministic per tile
// so it doesn't reshuffle when rebuilt, and drawn with a handful of
// InstancedMeshes so thousands of tufts stay cheap. Everything sways in the
// wind and follows the world bend.

import * as THREE from 'three';
import { isFreshWater, BIOMES, Tile, hashString, type BiomeId, type Grid, type Season, type WorldObject } from '@hearthwood/shared';
import { bend } from './bend.ts';

type Vis = 'spring' | 'summer' | 'autumn' | 'winter';

// ── Geometries (local y = height above ground, used by the sway shader) ────
function tuftGeometry(blades: number, height: number, width: number, lean = 0.12) {
  const pos: number[] = [];
  for (let i = 0; i < blades; i++) {
    const a = (i / blades) * Math.PI + (i % 2) * 0.4;
    const dx = Math.cos(a) * width, dz = Math.sin(a) * width;
    const h = height * (0.75 + ((i * 37) % 10) / 40);
    const lx = Math.cos(a + 1.57) * lean * h, lz = Math.sin(a + 1.57) * lean * h;
    pos.push(-dx, 0, -dz, dx, 0, dz, lx, h, lz);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  // Grass normals point up so it is lit like the ground (no dark blades).
  const n = g.attributes.normal as THREE.BufferAttribute;
  for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0);
  return g;
}

function fernGeometry() {
  const pos: number[] = [];
  const fronds = 6;
  for (let i = 0; i < fronds; i++) {
    const a = (i / fronds) * Math.PI * 2;
    const ca = Math.cos(a), sa = Math.sin(a);
    // Arched diamond frond: base → mid (high) → tip (low).
    const L = 0.42, w = 0.07;
    const px = -sa * w, pz = ca * w;
    const mid = [ca * L * 0.5, 0.26, sa * L * 0.5];
    const tip = [ca * L, 0.12, sa * L];
    pos.push(0, 0.02, 0, mid[0] + px, mid[1], mid[2] + pz, mid[0] - px, mid[1], mid[2] - pz);
    pos.push(mid[0] + px, mid[1], mid[2] + pz, tip[0], tip[1], tip[2], mid[0] - px, mid[1], mid[2] - pz);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  const n = g.attributes.normal as THREE.BufferAttribute;
  for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0);
  return g;
}

const GEO = {
  grass: tuftGeometry(5, 0.26, 0.05),
  tall: tuftGeometry(7, 0.5, 0.05, 0.08),
  reed: tuftGeometry(5, 0.75, 0.03, 0.04),
  fern: fernGeometry(),
  flower: new THREE.IcosahedronGeometry(0.045, 0).translate(0, 0.17, 0),
  leaf: new THREE.CircleGeometry(0.07, 5).rotateX(-Math.PI / 2).translate(0, 0.015, 0),
  snow: new THREE.SphereGeometry(0.18, 7, 4, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.45, 1),
  stem: tuftGeometry(1, 0.17, 0.008, 0),
};
type Kind = keyof typeof GEO;

const MATERIALS: Partial<Record<Kind, THREE.Material>> = {};
function material(kind: Kind) {
  let m = MATERIALS[kind];
  if (!m) {
    const sway = kind !== 'leaf' && kind !== 'snow';
    // Per-instance colours only (no vertex colours); both faces lit like the ground.
    m = bend(new THREE.MeshStandardMaterial({
      color: '#ffffff', roughness: 1, side: kind === 'snow' ? THREE.FrontSide : THREE.DoubleSide, flatShading: kind === 'snow',
    }), { sway, twoSidedLight: kind !== 'snow' });
    MATERIALS[kind] = m;
  }
  return m;
}

// ── Palettes ────────────────────────────────────────────────────────────────
interface Palette {
  grass: string[];
  density: number; // tufts per ground tile (average)
  tallChance: number;
  fernChance: number;
  flowerChance: number;
  flowers: string[];
  leaves: string[] | null;
  snow: boolean;
  dry: boolean;
}

function palette(biome: BiomeId, season: Season, vs: Vis, snowy: boolean): Palette {
  const model = BIOMES[biome].seasonModel;
  const base: Palette = {
    grass: ['#6fbf4a', '#5fae45', '#7fca55'], density: 2.4, tallChance: 0.12, fernChance: 0.02, flowerChance: 0.06,
    flowers: ['#ffffff', '#ffd166', '#ff8fb1'], leaves: null, snow: false, dry: false,
  };
  if (model === 'arid') {
    return { ...base, grass: season === 'hot' ? ['#c9b46a', '#b9a35a', '#d6c27a'] : ['#a9a85e', '#b8b06a', '#98a05a'], density: 0.6, tallChance: 0.25, fernChance: 0, flowerChance: season === 'cool' ? 0.04 : 0.01, flowers: ['#ff9f1c', '#e85d75'], dry: true };
  }
  if (model === 'tropical') {
    return { ...base, grass: season === 'wet' ? ['#3fb04a', '#4fc04f', '#2f9a40'] : ['#6cb84a', '#7cc455', '#5aa845'], density: 3, tallChance: biome === 'jungle' ? 0.35 : 0.18, fernChance: biome === 'jungle' ? 0.22 : 0.05, flowerChance: 0.05, flowers: ['#ff5d8f', '#ffb703', '#c77dff', '#ffffff'] };
  }
  const forest = biome === 'nordic' || biome === 'forest_edge';
  switch (vs) {
    case 'spring':
      return { ...base, grass: ['#86d15a', '#9ad965', '#74c34f'], flowerChance: 0.2, flowers: ['#ffffff', '#ffd166', '#ff8fb1', '#a0c4ff', '#cdb4db'], fernChance: forest ? 0.12 : 0.03 };
    case 'summer':
      return { ...base, grass: ['#5fae45', '#4f9e3a', '#6dba4f'], density: 2.8, tallChance: 0.2, flowerChance: 0.08, flowers: ['#ffd166', '#ffffff', '#f15bb5'], fernChance: forest ? 0.15 : 0.03 };
    case 'autumn':
      return { ...base, grass: ['#a8a24a', '#b9a250', '#94943f', '#c2a85a'], density: 2.2, tallChance: 0.18, flowerChance: 0.02, flowers: ['#ff9f1c'], leaves: ['#d9822b', '#c0392b', '#e0a83a', '#a0522d', '#f0c419'], fernChance: forest ? 0.1 : 0.02 };
    case 'winter':
      return snowy
        ? { ...base, grass: ['#c8d3c4', '#b9c7b8', '#dfe6dc'], density: 0.45, tallChance: 0.35, fernChance: 0, flowerChance: 0, flowers: [], snow: true }
        : { ...base, grass: ['#8a9a6a', '#9aa678', '#7d8e60'], density: 1.2, tallChance: 0.15, flowerChance: 0, fernChance: 0.02 };
  }
}

// ── Builder ─────────────────────────────────────────────────────────────────
interface Inst {
  x: number;
  y: number;
  z: number;
  rot: number;
  s: number;
  color: string;
}

export function buildFoliage(grid: Grid, biome: BiomeId, season: Season, vs: Vis, snowy: boolean, objects: Iterable<WorldObject>): THREE.Group {
  const pal = palette(biome, season, vs, snowy);
  const out: Record<Kind, Inst[]> = { grass: [], tall: [], reed: [], fern: [], flower: [], leaf: [], snow: [], stem: [] };
  const size = grid.size;
  const nearTree = new Uint8Array(size * size);
  for (const o of objects) {
    if (o.kind !== 'tree' || (o.stage ?? 2) < 2) continue;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const x = o.x + dx, z = o.z + dz;
      if (grid.inBounds(x, z)) nearTree[z * size + x] = 1;
    }
  }
  const nearWater = (x: number, z: number) => {
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (isFreshWater(grid.tile(x + dx, z + dz))) return true;
    return false;
  };
  const tropicalBeach = biome === 'tropical' || biome === 'desert' || biome === 'oasis';
  for (let z = 0; z < size; z++)
    for (let x = 0; x < size; x++) {
      const t = grid.tile(x, z);
      const i = z * size + x;
      if (grid.occupied[i] || grid.paths[i]) continue;
      if (t !== Tile.Ground && !(t === Tile.Shore && tropicalBeach) && t !== Tile.Ramp) continue;
      let h = hashString(`${x}:${z}:fol`);
      const r = () => {
        h = Math.imul(h ^ (h >>> 15), 2246822507) ^ Math.imul(h ^ (h >>> 13), 3266489909);
        return ((h >>>= 0) % 100000) / 100000;
      };
      const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
      const place = (kind: Kind, s = 1, color = pick(pal.grass)) => {
        const px = x + 0.12 + r() * 0.76, pz = z + 0.12 + r() * 0.76;
        out[kind].push({ x: px, y: grid.surfaceY(px, pz), z: pz, rot: r() * Math.PI * 2, s: s * (0.8 + r() * 0.45), color });
      };
      if (t === Tile.Shore) {
        if (r() < 0.12) place('tall', 0.8, pick(['#b9b26a', '#a8a45a']));
        continue;
      }
      // Reeds & cattails by ponds.
      if (nearWater(x, z) && !pal.snow && r() < 0.55) {
        place('reed', 1, pick(['#5f9a3a', '#6fa845', '#7a9a40']));
        if (r() < 0.6) place('reed', 0.9, pick(['#5f9a3a', '#6fa845']));
      }
      const count = Math.floor(pal.density + r());
      for (let k = 0; k < count; k++) place(r() < pal.tallChance ? 'tall' : 'grass');
      if (r() < pal.fernChance * (nearTree[i] ? 3 : 1)) place('fern', 1, pick(biome === 'jungle' ? ['#2f8f3a', '#3fa045'] : ['#4f9a3a', '#5aa845', '#6aa850']));
      if (r() < pal.flowerChance) {
        const c = pick(pal.flowers);
        const px = x + 0.15 + r() * 0.7, pz = z + 0.15 + r() * 0.7, y = grid.surfaceY(px, pz);
        out.flower.push({ x: px, y, z: pz, rot: 0, s: 1, color: c });
        out.stem.push({ x: px, y, z: pz, rot: 0, s: 1, color: '#4f9e3a' });
      }
      if (pal.leaves && nearTree[i]) for (let k = 0; k < 3; k++) if (r() < 0.7) place('leaf', 1, pick(pal.leaves));
      if (pal.snow && r() < 0.22) place('snow', 0.8 + r() * 0.6, '#f4f8fb');
    }

  const group = new THREE.Group();
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const col = new THREE.Color();
  for (const kind of Object.keys(out) as Kind[]) {
    const list = out[kind];
    if (!list.length) continue;
    const mesh = new THREE.InstancedMesh(GEO[kind], material(kind), list.length);
    list.forEach((it, idx) => {
      q.setFromAxisAngle(up, it.rot);
      m4.compose(new THREE.Vector3(it.x, it.y, it.z), q, new THREE.Vector3(it.s, it.s, it.s));
      mesh.setMatrixAt(idx, m4);
      col.set(it.color).offsetHSL(0, 0, ((idx * 7919) % 100) / 100 * 0.06 - 0.03);
      mesh.setColorAt(idx, col);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    mesh.frustumCulled = false; // instances span the whole island; the bend moves them anyway
    group.add(mesh);
  }
  return group;
}

export function disposeFoliage(group: THREE.Group) {
  for (const c of group.children) (c as THREE.InstancedMesh).dispose?.();
}
