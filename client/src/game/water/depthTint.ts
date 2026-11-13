// Depth tint: shallow water stays clear, deeper water darkens, out into the open ocean.

import * as THREE from 'three';
import { SEA_LEVEL, Tile, isFreshWater, type Grid } from '@hearthwood/shared';
import { bend } from '../bend.ts';
import { floorAt, type WaterLayer } from './common.ts';

/** Depth tint over the sea, beaches and sea-level rivers: clear shallows, dark deep water. */
export function addDepthTint(g: Grid, color: string, pad: number, { group, bobbed }: WaterLayer) {
  const size = g.size;
  {
    const deep = new THREE.Color(color).lerp(new THREE.Color('#06213d'), 0.75);
    const pos: number[] = [], col: number[] = [];
    const alphaAt = (px: number, pz: number) => {
      const depth = SEA_LEVEL - floorAt(g, px, pz);
      const t = Math.min(1, Math.max(0, (depth - 0.08) / 1.3));
      return 0.78 * t * t * (3 - 2 * t);
    };
    const v = (px: number, pz: number, a: number) => {
      pos.push(px, 0, pz);
      col.push(deep.r, deep.g, deep.b, a);
    };
    const S = 2; // samples per tile
    for (let z = -pad; z < size + pad; z++)
      for (let x = -pad; x < size + pad; x++) {
        const t = g.tile(x, z);
        const wet = t === Tile.Sea || t === Tile.Dock || (g.isCoastal(x, z) && (t === Tile.River || t === Tile.Shore)) || (isFreshWater(t) && g.level(x, z) === 0);
        if (!wet) continue;
        // Dry beach tiles add nothing; a fully deep tile is one quad.
        const corners = [alphaAt(x, z), alphaAt(x + 1, z), alphaAt(x + 1, z + 1), alphaAt(x, z + 1), alphaAt(x + 0.5, z + 0.5)];
        if (corners.every((a) => a <= 0.001)) continue;
        if (corners.every((a) => Math.abs(a - corners[0]) < 0.003)) {
          const a = corners[0];
          v(x, z, a); v(x, z + 1, a); v(x + 1, z + 1, a);
          v(x, z, a); v(x + 1, z + 1, a); v(x + 1, z, a);
          continue;
        }
        for (let j = 0; j < S; j++)
          for (let i = 0; i < S; i++) {
            const x0 = x + i / S, x1 = x + (i + 1) / S, z0 = z + j / S, z1 = z + (j + 1) / S;
            const a00 = alphaAt(x0, z0), a01 = alphaAt(x0, z1), a11 = alphaAt(x1, z1), a10 = alphaAt(x1, z0);
            v(x0, z0, a00); v(x0, z1, a01); v(x1, z1, a11);
            v(x0, z0, a00); v(x1, z1, a11); v(x1, z0, a10);
          }
      }
    // The open ocean beyond: one big frame at full depth.
    const far = 160, a = 0.78, lo = -pad, hi = size + pad;
    const rect = (x0: number, z0: number, x1: number, z1: number) => {
      v(x0, z0, a); v(x0, z1, a); v(x1, z1, a);
      v(x0, z0, a); v(x1, z1, a); v(x1, z0, a);
    };
    rect(lo - far, lo - far, hi + far, lo);
    rect(lo - far, hi, hi + far, hi + far);
    rect(lo - far, lo, lo, hi);
    rect(hi, lo, hi + far, hi);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
    const m = new THREE.Mesh(geo, bend(new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false })));
    m.name = 'seaTint';
    m.renderOrder = 1;
    m.userData.baseY = SEA_LEVEL + 0.004;
    m.position.y = m.userData.baseY;
    group.add(m);
    bobbed.push(m);
  }
}
