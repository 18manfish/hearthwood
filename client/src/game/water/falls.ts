// Waterfalls: wherever fresh water drops to lower water, a sheet curves over the lip,
// tucks into the rock at its sides, and foam and spray rise where it lands.

import * as THREE from 'three';
import { DIRS, Tile, isFreshWater, isWaterTile, type Grid } from '@hearthwood/shared';
import { bend } from '../bend.ts';
import { surfaceOf, type WaterLayer } from './common.ts';
import { dotTexture, fallTexture } from './textures.ts';

export interface Waterfall {
  x: number; z: number; dx: number; dz: number;
  /** Top and bottom water surfaces. */
  top: number; bottom: number;
}

/** Every place where fresh water drops to lower water next to it. */
export function findWaterfalls(g: Grid): Waterfall[] {
  const out: Waterfall[] = [];
  for (let z = 0; z < g.size; z++)
    for (let x = 0; x < g.size; x++) {
      if (!isFreshWater(g.tile(x, z))) continue;
      const top = surfaceOf(g, x, z);
      for (const [dx, dz] of DIRS) {
        const nx = x + dx, nz = z + dz;
        if (!isWaterTile(g.tile(nx, nz)) || g.tile(nx, nz) === Tile.Dock) continue;
        const bottom = surfaceOf(g, nx, nz);
        if (bottom < top - 0.01) out.push({ x, z, dx, dz, top, bottom });
      }
    }
  return out;
}

/** Waterfalls: a sheet curving over the lip, foam and spray where it lands. Returns the spray animation. */
export function addWaterfalls(g: Grid, { group }: WaterLayer): (t: number) => void {
  const falls = findWaterfalls(g);
  const spray: { x: number; y: number; z: number; dx: number; dz: number; px: number; pz: number; seed: number; mist: boolean }[] = [];
  if (falls.length) {
    const pos: number[] = [], uv: number[] = [], foam: number[] = [];
    // Sheet profile: [outwards from the edge, fraction of the drop].
    const prof: [number, number][] = [[-0.04, 0], [0.05, 0.06], [0.1, 0.22], [0.12, 0.5], [0.13, 1]];
    const W = 5;
    for (const f of falls) {
      const { x, z, dx, dz, top, bottom } = f;
      const px = dz !== 0 ? 1 : 0, pz = dx !== 0 ? 1 : 0; // across the fall
      // Edge line between the tiles, a little wider than the tile so it tucks into the rock.
      const ex = x + 0.5 + dx * 0.5, ez = z + 0.5 + dz * 0.5;
      const hgt = top - bottom;
      // Beside rock the sheet's edges curl back into the cliff (hidden); beside more falling water it just meets it.
      const sideOpen = (sg: number) => {
        const sx2 = x + px * sg, sz2 = z + pz * sg;
        return isFreshWater(g.tile(sx2, sz2)) && g.level(sx2, sz2) === g.level(x, z);
      };
      const cols: [number, number][] = []; // [across, pushed back upstream]
      if (!sideOpen(-1)) cols.push([-0.6, 0.35]);
      for (let i = 0; i <= W; i++) cols.push([-0.5 + i / W, 0]);
      if (!sideOpen(1)) cols.push([0.6, 0.35]);
      const at = (c: [number, number], k: number): [number, number, number] => {
        const [s, back] = c;
        const [out, f] = prof[k];
        const wob = Math.sin(s * 9 + k) * 0.012 * k;
        const o = out + wob - back;
        return [ex + px * s + dx * o, top - hgt * f + (k === 0 ? 0.004 : 0), ez + pz * s + dz * o];
      };
      for (let i = 0; i < cols.length - 1; i++) {
        const c0 = cols[i], c1 = cols[i + 1];
        for (let k = 0; k < prof.length - 1; k++) {
          const a = at(c0, k), b = at(c0, k + 1), c = at(c1, k + 1), d = at(c1, k);
          pos.push(...a, ...b, ...c, ...a, ...c, ...d);
          const v0 = prof[k][1] * hgt * 1.6, v1 = prof[k + 1][1] * hgt * 1.6;
          const u0 = c0[0] + 0.5, u1 = c1[0] + 0.5;
          uv.push(u0, -v0, u0, -v1, u1, -v1, u0, -v0, u1, -v1, u1, -v0);
        }
      }
      // Foam on the pool below.
      const fx = ex + dx * 0.4, fz = ez + dz * 0.4, s = 0.62, fy = bottom + 0.025;
      foam.push(fx - s, fy, fz - s, fx - s, fy, fz + s, fx + s, fy, fz + s, fx - s, fy, fz - s, fx + s, fy, fz + s, fx + s, fy, fz - s);
      for (let k = 0; k < 26; k++) spray.push({ x: ex + dx * 0.14, y: bottom, z: ez + dz * 0.14, dx, dz, px, pz, seed: k * 0.6180339 + x * 0.13 + z * 0.29, mist: k >= 20 });
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.computeVertexNormals();
    const sheet = new THREE.Mesh(geo, bend(new THREE.MeshStandardMaterial({ map: fallTexture, roughness: 0.35, side: THREE.DoubleSide })));
    sheet.renderOrder = 2;
    group.add(sheet);
    const fg = new THREE.BufferGeometry();
    fg.setAttribute('position', new THREE.Float32BufferAttribute(foam, 3));
    const fm = new THREE.Mesh(fg, bend(new THREE.MeshBasicMaterial({ map: dotTexture, color: '#ffffff', transparent: true, opacity: 0.75, depthWrite: false })));
    fm.renderOrder = 3;
    // Round foam patches: reuse the soft dot as the texture.
    const fuv: number[] = [];
    for (let i = 0; i < foam.length / 18; i++) fuv.push(0, 0, 0, 1, 1, 1, 0, 0, 1, 1, 1, 0);
    fg.setAttribute('uv', new THREE.Float32BufferAttribute(fuv, 2));
    group.add(fm);
  }
  let points: THREE.Points | null = null;
  if (spray.length) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(spray.length * 3), 3));
    const pm = bend(new THREE.PointsMaterial({ map: dotTexture, color: '#ffffff', size: 0.16, transparent: true, opacity: 0.85, depthWrite: false, sizeAttenuation: true }));
    points = new THREE.Points(geo, pm);
    points.name = 'spray';
    points.renderOrder = 4;
    points.frustumCulled = false;
    group.add(points);
  }
  return (t: number) => {
    if (points) {
      const arr = (points.geometry.getAttribute('position') as THREE.BufferAttribute).array as Float32Array;
      for (let i = 0; i < spray.length; i++) {
        const p = spray[i];
        const life = p.mist ? 2.4 : 0.9;
        const age = (((t / life + p.seed) % 1) + 1) % 1;
        const r1 = Math.sin(p.seed * 91.7) * 0.5 + 0.5, r2 = Math.sin(p.seed * 47.3 + 2) * 0.5 + 0.5;
        const across = (r1 - 0.5) * 0.85;
        let ox: number, oy: number;
        if (p.mist) {
          // Mist drifts up and away slowly.
          ox = 0.15 + age * 0.5;
          oy = 0.05 + age * 0.55;
        } else {
          // Droplets thrown up and out, falling back.
          const vOut = 0.4 + r2 * 0.7, vUp = 0.9 + r1 * 0.9;
          ox = vOut * age;
          oy = vUp * age - 2.6 * age * age;
          if (oy < 0) oy = 0;
        }
        arr[i * 3] = p.x + p.px * across + p.dx * ox;
        arr[i * 3 + 1] = p.y + oy;
        arr[i * 3 + 2] = p.z + p.pz * across + p.dz * ox;
      }
      (points.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    }
  };
}
