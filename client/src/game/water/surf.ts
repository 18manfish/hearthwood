// Surf: waves rolling in and breaking along the beaches (a shader on the swash zone).

import * as THREE from 'three';
import { SEA_LEVEL, Tile, type Grid } from '@hearthwood/shared';
import { bend } from '../bend.ts';
import { floorAt, type WaterLayer } from './common.ts';

/** Shader patch: breaking waves from a per-vertex depth (below the water line), position and time. */
function surfMaterial() {
  const m = bend(new THREE.MeshBasicMaterial({ color: '#f2f9fc', transparent: true, depthWrite: false, fog: true }));
  const inner = m.onBeforeCompile;
  m.onBeforeCompile = (shader: { uniforms: Record<string, unknown>; vertexShader: string; fragmentShader: string }, r: unknown) => {
    (inner as (s: unknown, r: unknown) => void)(shader, r);
    shader.vertexShader = shader.vertexShader.replace(
      'void main() {',
      'attribute float aDepth;\nattribute float aAlong;\nattribute vec2 aXZ;\nvarying float vDepth;\nvarying float vAlong;\nvarying vec2 vXZ;\nvoid main() {\n  vDepth = aDepth;\n  vAlong = aAlong;\n  vXZ = aXZ;',
    );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        'void main() {',
        `uniform float uTime;
varying float vDepth;
varying float vAlong;
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
          float d = vDepth;
          // Only the swash zone: just under the water line, fading out to sea and up the dry sand.
          float zone = smoothstep(-0.04, 0.0, d) * (1.0 - smoothstep(0.2, 0.36, d));
          // Soft, slowly drifting foam texture (breaks the lines up a little, never into dots).
          float foam = hwNoise(vXZ * 5.0 + vec2(uTime * 0.12, -uTime * 0.05)) * 0.6 + hwNoise(vXZ * 13.0 - uTime * 0.08) * 0.4;
          // Waves roll in to the beach: crests follow the depth contours (parallel to the
          // shore) and move into shallower water over time.
          float ph = fract(uTime * 0.085 + d * 3.0 + sin(vAlong * 0.31 + 0.7) * 0.04);
          float crest = smoothstep(0.0, 0.025, ph) * (1.0 - smoothstep(0.025, 0.12, ph));
          float trail = smoothstep(0.0, 0.025, ph) * (1.0 - smoothstep(0.025, 0.45, ph));
          float shallow = 1.0 - smoothstep(0.1, 0.34, d);
          float wave = (crest * (0.6 + 0.4 * foam) + trail * foam * 0.3) * shallow;
          // The line where the water laps the sand, sliding up and back.
          float lap = 0.02 + 0.03 * (0.5 + 0.5 * sin(uTime * 0.55 + vAlong * 0.15));
          float edge = (1.0 - smoothstep(0.0, 0.045, abs(d - lap))) * (0.55 + 0.45 * foam);
          diffuseColor.a *= zone * min(1.0, max(wave, edge) * 0.95);
        }`,
      );
  };
  m.customProgramCacheKey = () => 'hw-surf2';
  return m;
}

/** Surf: waves breaking along the beaches. */
export function addSurf(g: Grid, { group, bobbed }: WaterLayer) {
  const size = g.size;
  {
    const pos: number[] = [], depth: number[] = [], along: number[] = [], uvs: number[] = [];
    const S = 4;
    for (let z = -2; z < size + 2; z++)
      for (let x = -2; x < size + 2; x++) {
        const t = g.tile(x, z);
        if (!(t === Tile.Shore || t === Tile.Sea) || !g.isCoastal(x, z)) continue;
        // Only tiles that the water line crosses or comes close to.
        const ys = [floorAt(g, x, z), floorAt(g, x + 1, z), floorAt(g, x + 1, z + 1), floorAt(g, x, z + 1), floorAt(g, x + 0.5, z + 0.5)];
        if (Math.min(...ys) > SEA_LEVEL + 0.06 || Math.max(...ys) < SEA_LEVEL - 0.4) continue;
        for (let j = 0; j < S; j++)
          for (let i = 0; i < S; i++) {
            const x0 = x + i / S, x1 = x + (i + 1) / S, z0 = z + j / S, z1 = z + (j + 1) / S;
            const pt = (px: number, pz: number) => {
              pos.push(px, 0, pz);
              depth.push(SEA_LEVEL - floorAt(g, px, pz));
              along.push(px * 0.73 + pz * 0.61);
              uvs.push(px, pz);
            };
            pt(x0, z0); pt(x0, z1); pt(x1, z1);
            pt(x0, z0); pt(x1, z1); pt(x1, z0);
          }
      }
    if (pos.length) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('aDepth', new THREE.Float32BufferAttribute(depth, 1));
      geo.setAttribute('aAlong', new THREE.Float32BufferAttribute(along, 1));
      geo.setAttribute('aXZ', new THREE.Float32BufferAttribute(uvs, 2));
      const m = new THREE.Mesh(geo, surfMaterial());
      m.name = 'surf';
      m.renderOrder = 3;
      m.userData.baseY = SEA_LEVEL + 0.012;
      m.position.y = m.userData.baseY;
      group.add(m);
      bobbed.push(m);
    }
  }
}
