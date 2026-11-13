// Surf: sets of waves rolling in and breaking along the beaches (a shader on the swash zone).
//
// Each vertex knows how far it is from the water line (a smooth distance field, so the
// crests don't follow the tile staircase of the sea floor). Crests travel in along that
// distance, a few at a time; each crest is broken into its own pieces, and the waves die
// down where a river runs out into the sea.

import * as THREE from 'three';
import { SEA_LEVEL, Tile, type Grid } from '@hearthwood/shared';
import { bend } from '../bend.ts';
import { floorAt, type WaterLayer } from './common.ts';
import { wavy } from './waves.ts';

/** Distance-field samples per tile. */
const FS = 4;
/** Surf reaches this far out from the water line (tiles). */
const REACH = 3.2;

/** Shader patch: breaking waves from per-vertex depth, distance to the water line, river damping and time. */
function surfMaterial(uTime: { value: number }) {
  const m = bend(new THREE.MeshBasicMaterial({ color: '#f2f9fc', transparent: true, depthWrite: false, fog: true }));
  const inner = m.onBeforeCompile;
  m.onBeforeCompile = (shader: { uniforms: Record<string, unknown>; vertexShader: string; fragmentShader: string }, r: unknown) => {
    (inner as (s: unknown, r: unknown) => void)(shader, r);
    shader.uniforms.uTime = uTime;
    shader.vertexShader = shader.vertexShader.replace(
      'void main() {',
      'attribute float aDepth;\nattribute float aDist;\nattribute float aCalm;\nattribute vec2 aXZ;\nvarying float vDepth;\nvarying float vDist;\nvarying float vCalm;\nvarying vec2 vXZ;\nvoid main() {\n  vDepth = aDepth;\n  vDist = aDist;\n  vCalm = aCalm;\n  vXZ = aXZ;',
    );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        'void main() {',
        `uniform float uTime;
varying float vDepth;
varying float vDist;
varying float vCalm;
varying vec2 vXZ;
float hwHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float hwNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hwHash(i), hwHash(i + vec2(1.0, 0.0)), u.x), mix(hwHash(i + vec2(0.0, 1.0)), hwHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
void main() {`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          float d = vDepth, r = vDist;
          // Soft, slowly drifting foam texture.
          float foam = hwNoise(vXZ * 5.0 + vec2(uTime * 0.12, -uTime * 0.05)) * 0.6 + hwNoise(vXZ * 13.0 - uTime * 0.08) * 0.4;
          // Crests a little over a tile apart, rolling in towards the water line; gently wavy along the shore.
          float wob = (hwNoise(vXZ * 0.32) - 0.5) * 0.8 + (hwNoise(vXZ * 1.1 + 7.0) - 0.5) * 0.25;
          float u = (r + wob) / 1.15 + uTime * 0.1;
          float n = floor(u), f = fract(u);
          // Every crest breaks up into its own pieces (n stays the same while a crest travels).
          float pieces = smoothstep(0.42, 0.62, hwNoise(vXZ * 0.55 + vec2(n * 3.7, n * 1.9)));
          // Faint swells far out, wider white foam where they break close in.
          float near = 1.0 - smoothstep(0.25, 1.5, r);
          float crest = smoothstep(0.0, 0.04, f) * (1.0 - smoothstep(0.04, mix(0.11, 0.22, near), f));
          float trail = smoothstep(0.0, 0.04, f) * (1.0 - smoothstep(0.04, 0.55, f));
          float reach = 1.0 - smoothstep(${(REACH - 1.2).toFixed(2)}, ${REACH.toFixed(2)}, r);
          float wave = (crest * (0.35 + 0.65 * near) * (0.65 + 0.35 * foam) + trail * foam * 0.55 * near) * pieces * reach;
          wave *= smoothstep(0.0, 0.12, r);
          // The line where the water laps the sand, sliding up and back.
          // (by distance, not depth: the beach shelves so gently that a depth line would smear over the flats)
          float lap = 0.03 + 0.1 * (0.5 + 0.5 * sin(uTime * 0.55 + hwNoise(vXZ * 0.4) * 6.283));
          float edge = (1.0 - smoothstep(0.0, 0.07, abs(r - lap))) * (0.5 + 0.5 * foam) * 0.8;
          float wet = smoothstep(-0.04, 0.0, d);
          diffuseColor.a *= wet * vCalm * min(1.0, max(wave, edge) * 0.95);
        }`,
      );
  };
  m.customProgramCacheKey = () => 'hw-surf3';
  return m;
}

/** Surf: waves breaking along the beaches. */
export function addSurf(g: Grid, { group, bobbed }: WaterLayer) {
  const size = g.size;
  // Distance (tiles) from every wet sample to the nearest dry one: two-pass chamfer, then a light blur.
  const M = Math.ceil(REACH) + 3;
  const W = (size + 2 * M) * FS + 1;
  const at = (i: number, j: number) => j * W + i;
  const pt = (i: number, j: number): [number, number] => [i / FS - M, j / FS - M];
  const depthOf = (px: number, pz: number) => {
    const x = Math.floor(px), z = Math.floor(pz);
    const t = g.tile(x, z);
    if (!g.isCoastal(x, z) && t !== Tile.Pond && t !== Tile.River) return -1; // land and cliffs
    return SEA_LEVEL - floorAt(g, px, pz);
  };
  const depth = new Float32Array(W * W);
  const dist = new Float32Array(W * W);
  for (let j = 0; j < W; j++)
    for (let i = 0; i < W; i++) {
      const [px, pz] = pt(i, j);
      const d = depthOf(px, pz);
      depth[at(i, j)] = d;
      dist[at(i, j)] = d > 0 ? 1e6 : 0;
    }
  const D = Math.SQRT2;
  for (let j = 0; j < W; j++)
    for (let i = 0; i < W; i++) {
      const k = at(i, j);
      if (!dist[k]) continue;
      let v = dist[k];
      if (i > 0) v = Math.min(v, dist[k - 1] + 1);
      if (j > 0) v = Math.min(v, dist[k - W] + 1);
      if (i > 0 && j > 0) v = Math.min(v, dist[k - W - 1] + D);
      if (i < W - 1 && j > 0) v = Math.min(v, dist[k - W + 1] + D);
      dist[k] = v;
    }
  for (let j = W - 1; j >= 0; j--)
    for (let i = W - 1; i >= 0; i--) {
      const k = at(i, j);
      if (!dist[k]) continue;
      let v = dist[k];
      if (i < W - 1) v = Math.min(v, dist[k + 1] + 1);
      if (j < W - 1) v = Math.min(v, dist[k + W] + 1);
      if (i < W - 1 && j < W - 1) v = Math.min(v, dist[k + W + 1] + D);
      if (i > 0 && j < W - 1) v = Math.min(v, dist[k + W - 1] + D);
      dist[k] = v;
    }
  const sm = new Float32Array(W * W);
  for (let it = 0; it < 2; it++) {
    for (let j = 1; j < W - 1; j++)
      for (let i = 1; i < W - 1; i++) {
        const k = at(i, j);
        sm[k] = dist[k] ? (dist[k] * 4 + dist[k - 1] + dist[k + 1] + dist[k - W] + dist[k + W]) / 8 : 0;
      }
    dist.set(sm);
  }
  // Calm water: rivers and their mouths (the current holds the waves off), so no foam lines along river banks.
  const calmAt = (px: number, pz: number) => {
    const dr = g.coastField().dist(px, pz)[3];
    const u = Math.min(1, Math.max(0, (dr - 0.3) / 1.7));
    return u * u * (3 - 2 * u);
  };

  const pos: number[] = [], dep: number[] = [], dis: number[] = [], calm: number[] = [], xz: number[] = [];
  const S = FS;
  for (let z = -M + 1; z < size + M - 1; z++)
    for (let x = -M + 1; x < size + M - 1; x++) {
      const t = g.tile(x, z);
      if (!(t === Tile.Shore || t === Tile.Sea || t === Tile.River) || !g.isCoastal(x, z)) continue;
      // Only tiles within reach of the water line.
      const i0 = (x + M) * FS, j0 = (z + M) * FS;
      let lo = Infinity, hi = -Infinity, wet = false;
      for (let j = 0; j <= S; j++)
        for (let i = 0; i <= S; i++) {
          const k = at(i0 + i, j0 + j);
          lo = Math.min(lo, dist[k] / FS);
          hi = Math.max(hi, depth[k]);
          if (depth[k] > -0.06) wet = true;
        }
      if (!wet || lo > REACH || hi < -0.06) continue;
      const v = (i: number, j: number) => {
        const k = at(i0 + i, j0 + j);
        const [px, pz] = pt(i0 + i, j0 + j);
        pos.push(px, 0, pz);
        dep.push(depth[k]);
        dis.push(dist[k] / FS);
        calm.push(calmAt(px, pz));
        xz.push(px, pz);
      };
      for (let j = 0; j < S; j++)
        for (let i = 0; i < S; i++) {
          v(i, j); v(i, j + 1); v(i + 1, j + 1);
          v(i, j); v(i + 1, j + 1); v(i + 1, j);
        }
    }
  if (!pos.length) return;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('aDepth', new THREE.Float32BufferAttribute(dep, 1));
  geo.setAttribute('aDist', new THREE.Float32BufferAttribute(dis, 1));
  geo.setAttribute('aCalm', new THREE.Float32BufferAttribute(calm, 1));
  geo.setAttribute('aXZ', new THREE.Float32BufferAttribute(xz, 2));
  const uTime = { value: 0 };
  const m = new THREE.Mesh(geo, wavy(surfMaterial(uTime)));
  m.name = 'surf';
  m.renderOrder = 3;
  m.userData.baseY = SEA_LEVEL + 0.012;
  m.userData.surfTime = uTime;
  m.position.y = m.userData.baseY;
  group.add(m);
  bobbed.push(m);
}
