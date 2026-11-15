// Rain puddles: scattered over open, flat ground (never on paths, under objects or
// on slopes), they fill while it rains and dry up afterwards, each at its own pace.
// One merged mesh of quads; the shader draws an irregular puddle inside each quad
// that grows with how wet the ground is (groundLook.ts), reflects the sky, shows
// raindrop rings while it rains, and leaves a darker ring of wet soil round it.

import * as THREE from 'three';
import { Tile, hashString, type Grid } from '@hearthwood/shared';
import { bend } from './bend.ts';

/** Set every frame by environment.ts. */
export const puddleUniforms = {
  uTime: { value: 0 },
  /** How wet the ground is, 0 (dry) … 1 (puddles full). */
  uWet: { value: 0 },
  /** Rain falling right now, 0 … 1 (raindrop rings). */
  uRain: { value: 0 },
  /** What the puddles reflect: the sky colour. */
  uSky: { value: new THREE.Color('#8fd3f4') },
  /** Light on the ground (for the wet soil round the edge), as for the surf foam. */
  uLight: { value: new THREE.Color(1, 1, 1) },
};

/** Roughly one puddle per this many open, flat ground tiles. */
const EVERY = 22;

function puddleMaterial() {
  const m = bend(new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, depthWrite: false, fog: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  const inner = m.onBeforeCompile;
  m.onBeforeCompile = (shader: { uniforms: Record<string, unknown>; vertexShader: string; fragmentShader: string }, r: unknown) => {
    (inner as (s: unknown, r: unknown) => void)(shader, r);
    Object.assign(shader.uniforms, puddleUniforms);
    shader.vertexShader = shader.vertexShader.replace(
      'void main() {',
      'attribute vec2 aUv;\nattribute float aSeed;\nvarying vec2 vUv;\nvarying float vSeed;\nvoid main() {\n  vUv = aUv;\n  vSeed = aSeed;',
    );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        'void main() {',
        `uniform float uTime;
uniform float uWet;
uniform float uRain;
uniform vec3 uSky;
uniform vec3 uLight;
varying vec2 vUv;
varying float vSeed;
float pHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float pNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(pHash(i), pHash(i + vec2(1.0, 0.0)), u.x), mix(pHash(i + vec2(0.0, 1.0)), pHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
void main() {`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          vec2 sp = vec2(vSeed * 17.3, vSeed * 9.1);
          // An irregular blob: distance from the middle, pushed in and out by noise.
          float n = pNoise(vUv * 1.7 + sp) * 0.7 + pNoise(vUv * 4.3 + sp * 1.7) * 0.3;
          float shape = length(vUv) + (n - 0.5) * 0.6;
          // Each puddle fills at its own pace: the small, quick ones first.
          float fill = clamp(uWet * 1.35 - vSeed * 0.35, 0.0, 1.0);
          float th = 0.12 + 0.56 * fill;
          float water = (1.0 - smoothstep(th - 0.05, th, shape)) * step(0.02, fill);
          float soil = (1.0 - smoothstep(th, th + 0.22, shape)) * smoothstep(0.0, 0.25, fill) * (1.0 - water);
          // Raindrop rings: one drop at a time per cell, each ring spreading and fading.
          float ring = 0.0;
          vec2 q = vUv * 3.2 + sp;
          vec2 cell = floor(q);
          for (int k = 0; k < 2; k++) {
            vec2 c = cell + vec2(float(k), 0.0);
            float ph = pHash(c + 3.1);
            float age = fract(uTime * (0.7 + 0.5 * ph) + ph * 7.0);
            vec2 drop = c + 0.2 + 0.6 * vec2(pHash(c + 1.7 + floor(uTime * (0.7 + 0.5 * ph) + ph * 7.0)), pHash(c + 5.3));
            float rd = length(q - drop);
            ring = max(ring, (1.0 - smoothstep(0.0, 0.07, abs(rd - age * 0.55))) * (1.0 - age));
          }
          vec3 refl = mix(uSky * 0.8, vec3(0.16, 0.2, 0.24) * uLight, 0.4);
          refl += uSky * 0.35 * ring * uRain;
          // A faint bright lip where the water meets the ground.
          refl += uSky * 0.18 * (smoothstep(th - 0.09, th - 0.03, shape) * water);
          vec3 col = mix(vec3(0.22, 0.17, 0.11) * uLight, refl, water);
          float inQuad = 1.0 - smoothstep(0.86, 1.0, max(abs(vUv.x), abs(vUv.y))); // never a straight edge
          diffuseColor = vec4(col, max(water * 0.9, soil * 0.35) * inQuad);
        }`,
      );
  };
  m.customProgramCacheKey = () => 'hw-puddles1';
  return m;
}

let material: THREE.Material | null = null;

/** Puddle spots for this island (fixed per island, so the same puddles come back each shower). */
export function buildPuddles(g: Grid, seedKey: string): THREE.Mesh | null {
  const pos: number[] = [], uv: number[] = [], seed: number[] = [], idx: number[] = [];
  const size = g.size;
  for (let z = 1; z < size - 1; z++)
    for (let x = 1; x < size - 1; x++) {
      const i = z * size + x;
      if (g.tile(x, z) !== Tile.Ground || g.occupied[i] || g.paths[i] || g.ramp(x, z) >= 0) continue;
      const h = g.cornerHeights(x, z);
      if (Math.max(...h) - Math.min(...h) > 0.01) continue; // flat ground only
      let r = hashString(`${seedKey}:${x}:${z}:puddle`);
      const rnd = () => {
        r = Math.imul(r ^ (r >>> 15), 2246822507) ^ Math.imul(r ^ (r >>> 13), 3266489909);
        return ((r >>>= 0) % 100000) / 100000;
      };
      if (rnd() > 1 / EVERY) continue;
      const cx = x + 0.5 + (rnd() - 0.5) * 0.16, cz = z + 0.5 + (rnd() - 0.5) * 0.16;
      const sx = 0.34 + rnd() * 0.1, sz = 0.26 + rnd() * 0.16, a = rnd() * Math.PI;
      const ca = Math.cos(a), sa = Math.sin(a), y = g.surfaceY(cx, cz) + 0.008, s = rnd();
      const base = pos.length / 3;
      for (const [u, v] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const lx = u * sx, lz = v * sz;
        pos.push(cx + lx * ca - lz * sa, y, cz + lx * sa + lz * ca);
        uv.push(u, v);
        seed.push(s);
      }
      idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
    }
  if (!pos.length) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('aUv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('aSeed', new THREE.Float32BufferAttribute(seed, 1));
  geo.setIndex(idx);
  material ??= puddleMaterial();
  const mesh = new THREE.Mesh(geo, material);
  mesh.name = 'puddles';
  mesh.renderOrder = 1; // over the ground, under the footprints and players
  mesh.frustumCulled = false; // spans the island; the bend moves it anyway
  mesh.visible = puddleUniforms.uWet.value > 0;
  return mesh;
}

export function disposePuddles(m: THREE.Mesh) {
  m.geometry.dispose();
}
