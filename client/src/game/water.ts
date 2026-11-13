// Everything drawn on top of the terrain for water:
//  - raised ponds and rivers (sea-level water is the world's sea plane),
//  - depth tint: shallow water stays clear, deep water darkens,
//  - river flow: faint streaks drifting gently towards the sea,
//  - waterfalls: a curved sheet, foam and spray particles,
//  - surf: waves rolling in and breaking along the beaches.
// The group's userData.tick(t, dt, bob) animates it every frame.

import * as THREE from 'three';
import { CLIFF, DIRS, SEA_LEVEL, Tile, isWaterTile, type Grid } from '@hearthwood/shared';
import { bend } from './bend.ts';

const isFresh = (t: Tile) => t === Tile.Pond || t === Tile.River;
/** Water surface height of a water tile (the sea is always at sea level). */
const surfaceOf = (g: Grid, x: number, z: number) => (g.tile(x, z) === Tile.Sea ? 0 : g.level(x, z)) * CLIFF + SEA_LEVEL;

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
      if (!isFresh(g.tile(x, z))) continue;
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

/** Scrolling stripes for waterfalls (one shared texture, animated by the world). */
export const fallTexture = (() => {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#9fdcf2';
  g.fillRect(0, 0, 64, 128);
  for (let i = 0; i < 34; i++) {
    g.fillStyle = `rgba(255,255,255,${0.25 + (i % 4) * 0.15})`;
    g.fillRect((i * 13) % 64, (i * 37) % 128, 2 + (i % 3), 14 + (i % 5) * 8);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
})();

/** Faint streaks for river flow (scrolled along the flow direction). */
export const flowTexture = (() => {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, 64, 64);
  for (let i = 0; i < 18; i++) {
    const x = (i * 23) % 60, y = (i * 41) % 64, len = 6 + (i % 4) * 4;
    const grad = g.createLinearGradient(0, y, 0, y + len);
    grad.addColorStop(0, 'rgba(255,255,255,0)');
    grad.addColorStop(0.5, `rgba(255,255,255,${0.5 + (i % 3) * 0.2})`);
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(x, y, 1 + (i % 2), len);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
})();

/** A soft round dot for spray particles. */
const dotTexture = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.6)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(c);
})();

/** Floor height under the water at a point (sea floor, beach, river or pond bed). */
function floorAt(g: Grid, px: number, pz: number) {
  const x = Math.floor(px), z = Math.floor(pz);
  if (g.isCoastal(x, z)) return g.coastY(px, pz, g.tile(x, z));
  const h = g.cornerHeights(x, z);
  const fx = px - x, fz = pz - z;
  return (h[0] * (1 - fx) + h[1] * fx) * (1 - fz) + (h[3] * (1 - fx) + h[2] * fx) * fz;
}

/** Shader patch: alpha from a per-vertex depth (below the water line) and time. */
function surfMaterial() {
  const m = bend(new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, depthWrite: false, fog: true }));
  const inner = m.onBeforeCompile;
  m.onBeforeCompile = (shader: { uniforms: Record<string, unknown>; vertexShader: string; fragmentShader: string }, r: unknown) => {
    (inner as (s: unknown, r: unknown) => void)(shader, r);
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', 'attribute float aDepth;\nattribute float aAlong;\nvarying float vDepth;\nvarying float vAlong;\nvoid main() {\n  vDepth = aDepth;\n  vAlong = aAlong;');
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', 'uniform float uTime;\nvarying float vDepth;\nvarying float vAlong;\nvoid main() {')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          float d = vDepth;
          // Only the swash zone: just under the water line, fading out to sea and up the dry sand.
          float zone = smoothstep(-0.04, 0.0, d) * (1.0 - smoothstep(0.16, 0.34, d));
          // Waves roll in towards the beach (phase moves to smaller depth over time).
          float wob = sin(vAlong * 1.7) * 0.12 + sin(vAlong * 0.53 + 1.3) * 0.2;
          float ph = fract(uTime * 0.11 + d * 2.6 + wob);
          float crest = smoothstep(0.0, 0.04, ph) * (1.0 - smoothstep(0.04, 0.2, ph));
          // The line where the water laps the sand, sliding up and back.
          float lap = 0.025 + 0.025 * sin(uTime * 0.7 + vAlong * 0.4);
          float edge = 1.0 - smoothstep(0.0, 0.035, abs(d - lap));
          // Break-up so the foam isn't a solid line.
          float speck = 0.65 + 0.35 * sin(vAlong * 9.0 + d * 40.0 + uTime * 0.6);
          diffuseColor.a *= zone * max(crest * 0.75, edge * 0.8) * speck;
        }`,
      );
    shader.uniforms.uTime = (shader.uniforms.uTime as unknown) ?? { value: 0 };
  };
  m.customProgramCacheKey = () => 'hw-surf';
  return m;
}

/**
 * All water over the terrain. `color` is the biome's water colour; the world's
 * sea plane should be drawn in `deepColor(color)` underneath.
 */
export function buildWater(g: Grid, color: string, pad = 12): THREE.Group {
  const group = new THREE.Group();
  group.name = 'water';
  const size = g.size;
  const bobbed: THREE.Object3D[] = []; // sea-level layers that move with the sea plane

  // ---- Raised ponds and rivers (above sea level).
  const surf: number[] = [];
  for (let z = 0; z < size; z++)
    for (let x = 0; x < size; x++) {
      if (!isFresh(g.tile(x, z)) || g.level(x, z) === 0) continue;
      const y = surfaceOf(g, x, z);
      surf.push(x, y, z, x, y, z + 1, x + 1, y, z + 1, x, y, z, x + 1, y, z + 1, x + 1, y, z);
    }
  if (surf.length) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(surf, 3));
    geo.computeVertexNormals();
    const c = new THREE.Color(color).lerp(new THREE.Color('#0b2d4d'), 0.25);
    const m = new THREE.Mesh(geo, bend(new THREE.MeshStandardMaterial({ color: c, transparent: true, opacity: 0.85, roughness: 0.2, metalness: 0.05, side: THREE.DoubleSide })));
    m.receiveShadow = true;
    m.renderOrder = 1;
    group.add(m);
  }

  // ---- Depth tint over the sea, beaches and sea-level rivers: clear shallows, dark deep water.
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
        const wet = t === Tile.Sea || t === Tile.Dock || (g.isCoastal(x, z) && (t === Tile.River || t === Tile.Shore)) || (isFresh(t) && g.level(x, z) === 0);
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

  // ---- River flow: which way each river tile drains (towards the sea, via the shortest way).
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
    for (let z = 0; z < size; z++)
      for (let x = 0; x < size; x++) {
        const d = flowDist[z * size + x];
        if (d < 0) continue;
        let fx = 0, fz = 0;
        let best = Infinity;
        for (const [dx, dz] of DIRS) {
          const nx = x + dx, nz = z + dz;
          const nd = g.tile(nx, nz) === Tile.Sea ? -1 : g.inBounds(nx, nz) ? flowDist[nz * size + nx] : -2;
          if (nd === -2 || (nd < 0 && g.tile(nx, nz) !== Tile.Sea)) continue;
          if (nd < best) { best = nd; fx = dx; fz = dz; }
        }
        if (!fx && !fz) continue;
        // A one-tile-wide river gets fainter streaks.
        const px = fz, pz = fx;
        const narrow = !isWaterTile(g.tile(x + px, z + pz)) && !isWaterTile(g.tile(x - px, z - pz));
        const a = narrow ? 0.45 : 0.9;
        const L = g.level(x, z);
        const y = L === 0 ? 0.008 : surfaceOf(g, x, z) + 0.006;
        const [P, U, C] = L === 0 ? [lowFlat, lowUv, lowCol] : [pos, uv, col];
        const corner = (cx: number, cz: number) => {
          P.push(cx, y, cz);
          U.push((cx * px + cz * pz) * 0.7, (cx * fx + cz * fz) * 0.45);
          C.push(1, 1, 1, a);
        };
        corner(x, z); corner(x, z + 1); corner(x + 1, z + 1);
        corner(x, z); corner(x + 1, z + 1); corner(x + 1, z);
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

  // ---- Surf: waves breaking along the beaches.
  {
    const pos: number[] = [], depth: number[] = [], along: number[] = [];
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
      const m = new THREE.Mesh(geo, surfMaterial());
      m.name = 'surf';
      m.renderOrder = 3;
      m.userData.baseY = SEA_LEVEL + 0.012;
      m.position.y = m.userData.baseY;
      group.add(m);
      bobbed.push(m);
    }
  }

  // ---- Waterfalls: a sheet curving over the lip, foam and spray where it lands.
  const falls = findWaterfalls(g);
  const spray: { x: number; y: number; z: number; dx: number; dz: number; px: number; pz: number; seed: number; mist: boolean }[] = [];
  if (falls.length) {
    const pos: number[] = [], uv: number[] = [], foam: number[] = [];
    // Sheet profile: [outwards from the edge, fraction of the drop].
    const prof: [number, number][] = [[-0.04, 0], [0.05, 0.06], [0.1, 0.22], [0.12, 0.5], [0.13, 1]];
    const W = 6;
    for (const f of falls) {
      const { x, z, dx, dz, top, bottom } = f;
      const px = dz !== 0 ? 1 : 0, pz = dx !== 0 ? 1 : 0; // across the fall
      // Edge line between the tiles, a little wider than the tile so it tucks into the rock.
      const ex = x + 0.5 + dx * 0.5, ez = z + 0.5 + dz * 0.5;
      const hgt = top - bottom;
      const at = (s: number, k: number): [number, number, number] => {
        const [out, f] = prof[k];
        const wob = Math.sin(s * 9 + k) * 0.012 * k;
        return [ex + px * s + dx * (out + wob), top - hgt * f + (k === 0 ? 0.004 : 0), ez + pz * s + dz * (out + wob)];
      };
      for (let i = 0; i < W; i++) {
        const s0 = -0.56 + (1.12 * i) / W, s1 = -0.56 + (1.12 * (i + 1)) / W;
        for (let k = 0; k < prof.length - 1; k++) {
          const a = at(s0, k), b = at(s0, k + 1), c = at(s1, k + 1), d = at(s1, k);
          pos.push(...a, ...b, ...c, ...a, ...c, ...d);
          const v0 = prof[k][1] * hgt * 1.6, v1 = prof[k + 1][1] * hgt * 1.6;
          const u0 = s0 + 0.5, u1 = s1 + 0.5;
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
    const sheet = new THREE.Mesh(geo, bend(new THREE.MeshStandardMaterial({ map: fallTexture, transparent: true, opacity: 0.92, roughness: 0.3, side: THREE.DoubleSide })));
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

  group.userData.tick = (t: number, bob: number) => {
    for (const o of bobbed) o.position.y = (o.userData.baseY as number) + bob;
    flowTexture.offset.y = -t * 0.22; // gentle drift downstream
    fallTexture.offset.y = (t * 1.6) % 1;
    if (points) {
      const arr = (points.geometry.getAttribute('position') as THREE.BufferAttribute).array as Float32Array;
      for (let i = 0; i < spray.length; i++) {
        const p = spray[i];
        const life = p.mist ? 2.4 : 0.9;
        const age = (((t / life + p.seed) % 1) + 1) % 1;
        const r1 = Math.sin(p.seed * 91.7) * 0.5 + 0.5, r2 = Math.sin(p.seed * 47.3 + 2) * 0.5 + 0.5;
        const across = (r1 - 0.5) * 0.95;
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
  return group;
}

/** The sea plane's colour: the biome water colour, deeper. */
export function seaColor(color: string) {
  return `#${new THREE.Color(color).lerp(new THREE.Color('#0b4a6e'), 0.2).getHexString()}`;
}
