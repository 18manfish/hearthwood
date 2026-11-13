// River flow: faint streaks drifting downstream (the scrolling flow texture), laid out
// by a smooth flow field that follows the channel (however wide, round any bend) and
// fans out into the sea.
//
// The field is sampled FS times per tile. Each river sample gets a potential: the
// cheapest way through the water to the open sea, where leaving the channel costs
// more than following it. Water runs down that potential, so a river that hugs the
// beach keeps flowing along itself instead of spilling sideways into the shallows.

import * as THREE from 'three';
import { SEA_LEVEL, Tile, type Grid } from '@hearthwood/shared';
import { bend } from '../bend.ts';
import { floorAt, surfaceOf, type WaterLayer } from './common.ts';
import { flowTexture } from './textures.ts';

/** Field samples per tile. */
const FS = 4;
/** How far the current carries on into the sea (tiles). */
const PLUME = 3;
/** Sea counts as open (a flow target) from this depth. */
const OPEN_DEPTH = 0.9;
/** Moving through the sea costs this much more than following the river. */
const SEA_COST = 4;

const sstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Binary min-heap of sample indices keyed by a distance array. */
function heap(dist: Float32Array) {
  const h: number[] = [];
  const up = (i: number) => {
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (dist[h[p]] <= dist[h[i]]) break;
      [h[p], h[i]] = [h[i], h[p]];
      i = p;
    }
  };
  const down = (i: number) => {
    for (;;) {
      const l = 2 * i + 1, r = l + 1;
      let m = i;
      if (l < h.length && dist[h[l]] < dist[h[m]]) m = l;
      if (r < h.length && dist[h[r]] < dist[h[m]]) m = r;
      if (m === i) break;
      [h[m], h[i]] = [h[i], h[m]];
      i = m;
    }
  };
  return {
    push(k: number) { h.push(k); up(h.length - 1); },
    pop() { const top = h[0]; const last = h.pop()!; if (h.length) { h[0] = last; down(0); } return top; },
    get size() { return h.length; },
  };
}

const N8: [number, number, number][] = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];

/** River flow over every river (and the sea just off each river mouth). */
export function addRiverFlow(g: Grid, { group, bobbed }: WaterLayer) {
  const size = g.size;
  let anyRiver = false;
  for (let i = 0; i < size * size && !anyRiver; i++) anyRiver = g.tiles[i] === Tile.River;
  if (!anyRiver) return;

  // The field covers the rivers plus a margin (open water is never far from a river mouth).
  const E = PLUME + 4;
  let x0 = size, z0 = size, x1 = -1, z1 = -1;
  for (let z = 0; z < size; z++)
    for (let x = 0; x < size; x++)
      if (g.tiles[z * size + x] === Tile.River) { x0 = Math.min(x0, x); z0 = Math.min(z0, z); x1 = Math.max(x1, x); z1 = Math.max(z1, z); }
  const ox = x0 - E, oz = z0 - E;
  const W = (x1 - x0 + 1 + 2 * E) * FS, H = (z1 - z0 + 1 + 2 * E) * FS;
  const at = (i: number, j: number) => j * W + i;
  const tileOf = (i: number, j: number): [number, number] => [Math.floor(i / FS) + ox, Math.floor(j / FS) + oz];
  const posOf = (i: number, j: number): [number, number] => [(i + 0.5) / FS + ox, (j + 0.5) / FS + oz];
  // Kind: 0 dry, 1 river, 2 sea (or beach under water). Level: water surface level of river samples.
  const kind = new Uint8Array(W * H), lev = new Int8Array(W * H);
  for (let j = 0; j < H; j++)
    for (let i = 0; i < W; i++) {
      const [x, z] = tileOf(i, j);
      const t = g.tile(x, z);
      if (t === Tile.River) { kind[at(i, j)] = 1; lev[at(i, j)] = g.level(x, z); }
      else if (t === Tile.Sea || t === Tile.Dock) kind[at(i, j)] = 2;
      else if (t === Tile.Shore && g.isCoastal(x, z)) {
        // Beach under water (round river mouths the sand dips below the waterline) counts as sea.
        const [px, pz] = posOf(i, j);
        if (SEA_LEVEL - floorAt(g, px, pz) > 0.02) kind[at(i, j)] = 2;
      }
    }
  // Potential: cheapest way to open water (river samples cost 1, sea samples SEA_COST).
  const phi = new Float32Array(W * H).fill(Infinity);
  const q = heap(phi);
  for (let j = 0; j < H; j++)
    for (let i = 0; i < W; i++) {
      if (kind[at(i, j)] !== 2) continue;
      const [px, pz] = posOf(i, j);
      if (SEA_LEVEL - floorAt(g, px, pz) >= OPEN_DEPTH || i === 0 || j === 0 || i === W - 1 || j === H - 1) phi[at(i, j)] = 0;
    }
  // Only open water next to shallower water needs to start the search.
  const edge = (k: number, test: (nk: number) => boolean) => {
    const i = k % W, j = (k - i) / W;
    for (const [di, dj] of N8) {
      const ni = i + di, nj = j + dj;
      if (ni >= 0 && nj >= 0 && ni < W && nj < H && test(at(ni, nj))) return true;
    }
    return false;
  };
  for (let k = 0; k < W * H; k++) if (phi[k] === 0 && edge(k, (nk) => kind[nk] !== 0 && phi[nk] !== 0)) q.push(k);
  while (q.size) {
    const k = q.pop();
    const i = k % W, j = (k - i) / W;
    for (const [di, dj, c] of N8) {
      const ni = i + di, nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue;
      const nk = at(ni, nj), nkind = kind[nk];
      if (!nkind) continue;
      // Water only runs down a level (waterfalls), never up.
      if (nkind === 1 && kind[k] === 1 && lev[nk] < lev[k]) continue;
      const nd = phi[k] + c * (nkind === 2 ? SEA_COST : 1);
      if (nd < phi[nk]) { phi[nk] = nd; q.push(nk); }
    }
  }
  // Refine to a true (Euclidean) distance with a few fast-sweeping passes: the 8-neighbour steps
  // above leave a constant offset between parallel rows, which would tilt the whole current.
  {
    const ok = (k: number, nk: number) => kind[nk] !== 0 && !(kind[k] === 1 && kind[nk] === 1 && lev[k] < lev[nk]);
    for (let it = 0; it < 2; it++)
      for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
        for (let jj = 1; jj < H - 1; jj++)
          for (let ii = 1; ii < W - 1; ii++) {
            const i = sx > 0 ? ii : W - 1 - ii, j = sz > 0 ? jj : H - 1 - jj;
            const k = at(i, j);
            if (!kind[k] || phi[k] === 0) continue;
            const pick = (k1: number, k2: number) => Math.min(ok(k, k1) ? phi[k1] : Infinity, ok(k, k2) ? phi[k2] : Infinity);
            const a = pick(k - 1, k + 1), b = pick(k - W, k + W);
            const c = kind[k] === 2 ? SEA_COST : 1;
            let u: number;
            if (!Number.isFinite(a) && !Number.isFinite(b)) continue;
            if (Math.abs(a - b) >= c || !Number.isFinite(a) || !Number.isFinite(b)) u = Math.min(a, b) + c;
            else u = (a + b + Math.sqrt(2 * c * c - (a - b) * (a - b))) / 2;
            if (u < phi[k]) phi[k] = u;
          }
      }
  }
  // Distance from the river out into the sea (for the plume), and from each river sample to its bank.
  const plume = new Float32Array(W * H).fill(Infinity);
  const bank = new Float32Array(W * H).fill(Infinity);
  {
    const qp = heap(plume), qb = heap(bank);
    for (let k = 0; k < W * H; k++) {
      if (kind[k] === 1 && lev[k] === 0) { plume[k] = 0; if (edge(k, (nk) => kind[nk] === 2)) qp.push(k); }
      if (kind[k] === 0) { bank[k] = 0; if (edge(k, (nk) => kind[nk] === 1)) qb.push(k); }
    }
    while (qp.size) {
      const k = qp.pop();
      if (plume[k] > PLUME * FS) continue;
      const i = k % W, j = (k - i) / W;
      for (const [di, dj, c] of N8) {
        const ni = i + di, nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= W || nj >= H || kind[at(ni, nj)] !== 2) continue;
        const nd = plume[k] + c;
        if (nd < plume[at(ni, nj)]) { plume[at(ni, nj)] = nd; qp.push(at(ni, nj)); }
      }
    }
    while (qb.size) {
      const k = qb.pop();
      if (bank[k] > 2 * FS) continue;
      const i = k % W, j = (k - i) / W;
      for (const [di, dj, c] of N8) {
        const ni = i + di, nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue;
        const nk = at(ni, nj);
        // River samples measure to dry ground or a different level (a cliff); the sea isn't a bank.
        if (kind[nk] !== 1) continue;
        const nd = bank[k] + c;
        if (nd < bank[nk]) { bank[nk] = nd; qb.push(nk); }
      }
    }
    for (let k = 0; k < W * H; k++) if (kind[k] === 1) for (const [di, dj] of N8) {
      const i = k % W, j = (k - i) / W, nk = at(i + di, j + dj);
      if (kind[nk] === 1 && lev[nk] !== lev[k]) bank[k] = Math.min(bank[k], 0.5);
    }
  }
  const inField = (k: number) => kind[k] === 1 || (kind[k] === 2 && plume[k] <= PLUME * FS);
  // Flow direction: down the potential, among samples on the same surface.
  const fx = new Float32Array(W * H), fz = new Float32Array(W * H);
  const surf = (k: number) => (kind[k] === 1 ? lev[k] : 0);
  const same = (k: number, nk: number) => kind[nk] !== 0 && Number.isFinite(phi[nk]) && surf(nk) === surf(k);
  for (let j = 1; j < H - 1; j++)
    for (let i = 1; i < W - 1; i++) {
      const k = at(i, j);
      if (!inField(k) || !Number.isFinite(phi[k])) continue;
      // Down the potential; in the sea it also spreads out away from the river mouth.
      const grad = (pot: Float32Array, seaOnly: boolean): [number, number] => {
        let gx = 0, gz = 0;
        for (const [di, dj, c] of N8) {
          const nk = at(i + di, j + dj);
          if (!same(k, nk) || (seaOnly && kind[nk] !== 2) || !Number.isFinite(pot[nk])) continue;
          const d = (pot[nk] - pot[k]) / (c * c);
          gx += d * di;
          gz += d * dj;
        }
        const l = Math.hypot(gx, gz);
        return l > 1e-6 ? [gx / l, gz / l] : [0, 0];
      };
      let [gx, gz] = grad(phi, false);
      gx = -gx; gz = -gz;
      if (kind[k] === 2) {
        const [px, pz] = grad(plume, true);
        gx += px * 0.7;
        gz += pz * 0.7;
      }
      const l = Math.hypot(gx, gz);
      if (l > 1e-6) { fx[k] = gx / l; fz[k] = gz / l; }
    }
  // Smooth the field so it bends round corners and across the width as one current.
  for (let it = 0; it < 4; it++) {
    const ax = fx.slice(), az = fz.slice();
    for (let j = 1; j < H - 1; j++)
      for (let i = 1; i < W - 1; i++) {
        const k = at(i, j);
        if (!inField(k)) continue;
        let sx = ax[k] * 2, sz = az[k] * 2;
        for (const [di, dj] of N8) {
          const nk = at(i + di, j + dj);
          if (!inField(nk) || !same(k, nk)) continue;
          sx += ax[nk];
          sz += az[nk];
        }
        const l = Math.hypot(sx, sz);
        if (l > 1e-6) { fx[k] = sx / l; fz[k] = sz / l; }
      }
  }
  // Strength: fainter on one-tile streams, softer at the banks, fading out into the sea.
  const halfW = new Float32Array(W * H);
  for (let j = 0; j < H; j++)
    for (let i = 0; i < W; i++) {
      const k = at(i, j);
      if (kind[k] !== 1) continue;
      let m = 0;
      for (let dj = -FS; dj <= FS; dj++)
        for (let di = -FS; di <= FS; di++) {
          const ni = i + di, nj = j + dj;
          if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue;
          const nk = at(ni, nj);
          if (kind[nk] === 1 && lev[nk] === lev[k] && bank[nk] > m && di * di + dj * dj <= FS * FS * 1.6) m = bank[nk];
        }
      halfW[k] = m / FS;
    }
  // Openness: how much of the water around a sea-level river sample is sea. Where the river
  // reaches open water it fades into the plume rather than running on as a band.
  const open = new Float32Array(W * H);
  {
    const R = Math.round(FS * 1.5);
    for (let j = R; j < H - R; j++)
      for (let i = R; i < W - R; i++) {
        const k = at(i, j);
        if (kind[k] !== 1 || lev[k] !== 0) continue;
        let sea = 0, wet = 0;
        for (let dj = -R; dj <= R; dj += 2)
          for (let di = -R; di <= R; di += 2) {
            if (di * di + dj * dj > R * R) continue;
            const nk = at(i + di, j + dj);
            if (kind[nk] === 2) sea++;
            if (kind[nk]) wet++;
          }
        open[k] = wet ? sea / wet : 0;
      }
  }
  const PLUME_A = 0.45;
  const strength = (k: number) => {
    if (kind[k] === 1) {
      const wide = 0.45 + 0.45 * sstep(0.55, 1.05, halfW[k]);
      const a = wide * (0.35 + 0.65 * sstep(0, 0.4, bank[k] / FS));
      return a + (PLUME_A - a) * sstep(0.15, 0.6, open[k]);
    }
    if (kind[k] === 2 && plume[k] <= PLUME * FS) {
      const t = 1 - plume[k] / (PLUME * FS);
      return PLUME_A * t * t;
    }
    return 0;
  };

  // Each tile streams one way: the field's average direction over the tile, snapped to
  // one of 8 directions. Texture coordinates are world positions projected on that
  // direction, so neighbouring tiles that agree join up seamlessly.
  const TW = W / FS, TH = H / FS;
  const tdir = new Int8Array(TW * TH).fill(-1);
  const D8: [number, number][] = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
  for (let tj = 0; tj < TH; tj++)
    for (let ti = 0; ti < TW; ti++) {
      let sx = 0, sz = 0;
      for (let j = tj * FS; j < (tj + 1) * FS; j++)
        for (let i = ti * FS; i < (ti + 1) * FS; i++) {
          const k = at(i, j);
          if (!inField(k)) continue;
          const a = strength(k);
          sx += fx[k] * a;
          sz += fz[k] * a;
        }
      if (Math.hypot(sx, sz) < 1e-4) continue;
      tdir[tj * TW + ti] = ((Math.round(Math.atan2(sz, sx) / (Math.PI / 4)) % 8) + 8) % 8;
    }
  // Mesh: one quad per sample cell, vertices on the sample grid (so the strength fades smoothly).
  const meshes = new Map<number, { pos: number[]; col: number[]; uv: number[] }>();
  for (let j = 0; j < H - 1; j++)
    for (let i = 0; i < W - 1; i++) {
      const ks = [at(i, j), at(i, j + 1), at(i + 1, j + 1), at(i + 1, j)];
      if (!ks.every(inField)) continue;
      // One surface per quad: all river samples of one level, or sea level (sea + level-0 river).
      const lv = ks.map((k) => (kind[k] === 1 ? lev[k] : 0));
      if (lv.some((l) => l !== lv[0])) continue;
      const a = ks.map(strength);
      if (a.every((v) => v < 0.01)) continue;
      const td = tdir[Math.floor(j / FS) * TW + Math.floor(i / FS)];
      if (td < 0) continue;
      let o = meshes.get(lv[0]);
      if (!o) meshes.set(lv[0], (o = { pos: [], col: [], uv: [] }));
      const [x, z] = tileOf(i, j);
      const y = lv[0] === 0 ? 0.008 : surfaceOf(g, x, z) + 0.006;
      const l = Math.hypot(D8[td][0], D8[td][1]);
      const dx = D8[td][0] / l, dz = D8[td][1] / l;
      for (const n of [0, 1, 2, 0, 2, 3]) {
        const k = ks[n], ii = k % W, jj = (k - ii) / W;
        const [px, pz] = posOf(ii, jj);
        o.pos.push(px, y, pz);
        o.col.push(1, 1, 1, a[n]);
        o.uv.push((-px * dz + pz * dx) * 0.7, (px * dx + pz * dz) * 0.45);
      }
    }
  for (const [lv, o] of meshes) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(o.pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(o.uv, 2));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(o.col, 4));
    const m = new THREE.Mesh(geo, bend(new THREE.MeshBasicMaterial({ map: flowTexture, vertexColors: true, transparent: true, opacity: 0.32, depthWrite: false })));
    m.name = 'riverFlow';
    m.renderOrder = 2;
    if (lv === 0) {
      m.userData.baseY = SEA_LEVEL;
      m.position.y = SEA_LEVEL;
      bobbed.push(m);
    }
    group.add(m);
  }
}
