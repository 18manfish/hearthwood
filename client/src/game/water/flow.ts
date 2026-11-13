// River flow: faint streaks drifting downstream to the sea (fainter on one-tile streams),
// carrying on a little way into the sea at the mouth and fading out.

import * as THREE from 'three';
import { DIRS, SEA_LEVEL, Tile, isWaterTile, type Grid } from '@hearthwood/shared';
import { bend } from '../bend.ts';
import { surfaceOf, type WaterLayer } from './common.ts';
import { flowTexture } from './textures.ts';

/** River flow: which way each river tile drains (towards the sea, via the shortest way). */
export function addRiverFlow(g: Grid, { group, bobbed }: WaterLayer) {
  const size = g.size;
  const flowDist = new Int32Array(size * size).fill(-1);
  {
    const q: number[] = [];
    for (let z = 0; z < size; z++)
      for (let x = 0; x < size; x++) {
        if (g.tile(x, z) !== Tile.River) continue;
        if (DIRS.some(([dx, dz]) => g.tile(x + dx, z + dz) === Tile.Sea)) {
          flowDist[z * size + x] = 0;
          q.push(z * size + x);
        }
      }
    for (let h = 0; h < q.length; h++) {
      const i = q[h], x = i % size, z = Math.floor(i / size);
      for (const [dx, dz] of DIRS) {
        const nx = x + dx, nz = z + dz;
        if (!g.inBounds(nx, nz) || g.tile(nx, nz) !== Tile.River || flowDist[nz * size + nx] >= 0) continue;
        flowDist[nz * size + nx] = flowDist[i] + 1;
        q.push(nz * size + nx);
      }
    }
  }
  {
    const pos: number[] = [], uv: number[] = [], col: number[] = [];
    const lowFlat: number[] = [], lowUv: number[] = [], lowCol: number[] = [];
    const dirOf = new Int8Array(size * size).fill(-1); // index into DIRS
    const downstream = (x: number, z: number) => {
      let best = Infinity, k = -1;
      for (let i = 0; i < 4; i++) {
        const [dx, dz] = DIRS[i];
        const nx = x + dx, nz = z + dz;
        if (!g.inBounds(nx, nz)) continue;
        const nd = flowDist[nz * size + nx];
        if (g.tile(nx, nz) === Tile.River && nd >= 0 && nd < best) { best = nd; k = i; }
      }
      return k;
    };
    for (let z = 0; z < size; z++)
      for (let x = 0; x < size; x++) {
        const d = flowDist[z * size + x];
        if (d > 0) dirOf[z * size + x] = downstream(x, z);
      }
    // At the mouth, keep going the way the water came from (no sudden turn), else straight out to sea.
    for (let z = 0; z < size; z++)
      for (let x = 0; x < size; x++) {
        if (flowDist[z * size + x] !== 0) continue;
        let k = -1;
        for (let i = 0; i < 4 && k < 0; i++) {
          const [dx, dz] = DIRS[i];
          const ux = x - dx, uz = z - dz; // a neighbour upstream flowing into us
          if (g.inBounds(ux, uz) && dirOf[uz * size + ux] === i) k = i;
        }
        if (k < 0) for (let i = 0; i < 4 && k < 0; i++) if (g.tile(x + DIRS[i][0], z + DIRS[i][1]) === Tile.Sea) k = i;
        dirOf[z * size + x] = k;
      }
    const emit = (x: number, z: number, k: number, a0: number, a1: number, y: number, P: number[], U: number[], C: number[]) => {
      const [fx, fz] = DIRS[k];
      const px = fz, pz = fx;
      // Alpha a0 on the upstream edge, a1 on the downstream edge.
      const corner = (cx: number, cz: number) => {
        P.push(cx, y, cz);
        U.push((cx * px + cz * pz) * 0.7, (cx * fx + cz * fz) * 0.45);
        const along = ((cx - (x + 0.5)) * fx + (cz - (z + 0.5)) * fz) + 0.5; // 0 upstream .. 1 downstream
        C.push(1, 1, 1, a0 + (a1 - a0) * along);
      };
      corner(x, z); corner(x, z + 1); corner(x + 1, z + 1);
      corner(x, z); corner(x + 1, z + 1); corner(x + 1, z);
    };
    const FADE = 3; // tiles the flow carries on into the sea, fading away
    for (let z = 0; z < size; z++)
      for (let x = 0; x < size; x++) {
        const k = dirOf[z * size + x];
        if (k < 0) continue;
        const [fx, fz] = DIRS[k];
        const narrow = !isWaterTile(g.tile(x + fz, z + fx)) && !isWaterTile(g.tile(x - fz, z - fx));
        const a = narrow ? 0.45 : 0.9;
        const L = g.level(x, z);
        if (L === 0) emit(x, z, k, a, a, 0.008, lowFlat, lowUv, lowCol);
        else emit(x, z, k, a, a, surfaceOf(g, x, z) + 0.006, pos, uv, col);
        // The mouth: the current runs on into the sea and fades out.
        if (flowDist[z * size + x] === 0 && L === 0) {
          for (let i = 1; i <= FADE; i++) {
            const sx = x + fx * i, sz = z + fz * i;
            if (g.tile(sx, sz) !== Tile.Sea) break;
            emit(sx, sz, k, a * (1 - (i - 1) / FADE), a * (1 - i / FADE), 0.008, lowFlat, lowUv, lowCol);
          }
        }
      }
    const mat = () => bend(new THREE.MeshBasicMaterial({ map: flowTexture, vertexColors: true, transparent: true, opacity: 0.32, depthWrite: false }));
    for (const [P, U, C, low] of [[pos, uv, col, false], [lowFlat, lowUv, lowCol, true]] as const) {
      if (!P.length) continue;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(C, 4));
      const m = new THREE.Mesh(geo, mat());
      m.name = 'riverFlow';
      m.renderOrder = 2;
      if (low) {
        m.userData.baseY = SEA_LEVEL;
        m.position.y = SEA_LEVEL;
        bobbed.push(m);
      }
      group.add(m);
    }
  }
}
