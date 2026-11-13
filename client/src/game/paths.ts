// Path rendering: low-poly kit pieces when paths.glb is loaded (see below),
// otherwise one merged mesh per path type with a procedural texture.
// Tiles connect to same-type neighbours; open edges are inset so paths get
// soft, hand-laid borders like in Animal Crossing.

import * as THREE from 'three';
import { PATHS, hashString, type Grid } from '@hearthwood/shared';
import { kitGeometryByColor } from './assets/kit.ts';
import { bend } from './bend.ts';

const TEX = 128;

function rand(seed: string) {
  let h = hashString(seed);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507) ^ Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h >>>= 0) % 10000) / 10000;
  };
}

/** Procedural 128×128 tileable textures, drawn once with Canvas 2D. */
function makeTexture(key: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = TEX;
  const g = c.getContext('2d')!;
  const r = rand(key);
  const speckle = (n: number, colors: string[], min: number, max: number) => {
    for (let i = 0; i < n; i++) {
      g.fillStyle = colors[Math.floor(r() * colors.length)];
      const s = min + r() * (max - min);
      g.beginPath();
      g.ellipse(r() * TEX, r() * TEX, s, s * (0.6 + r() * 0.4), r() * 3, 0, Math.PI * 2);
      g.fill();
    }
  };
  switch (key) {
    case 'dirt':
      g.fillStyle = '#8b6a45';
      g.fillRect(0, 0, TEX, TEX);
      speckle(260, ['#7a5b3a', '#9a7a52', '#6f5233', '#a1835b'], 1, 4);
      break;
    case 'gravel':
      g.fillStyle = '#a7a196';
      g.fillRect(0, 0, TEX, TEX);
      speckle(520, ['#c9c4ba', '#8f897f', '#b8b2a7', '#d8d3c9', '#7d786f'], 1.5, 4.5);
      break;
    case 'stone': {
      // Irregular flat stones on earth.
      g.fillStyle = '#6f5a43';
      g.fillRect(0, 0, TEX, TEX);
      const cells = [[0.25, 0.25], [0.75, 0.28], [0.27, 0.76], [0.74, 0.74]];
      for (const [cx, cy] of cells) {
        const base = 175 + Math.floor(r() * 30);
        g.fillStyle = `rgb(${base},${base - 3},${base - 8})`;
        g.beginPath();
        const pts = 9;
        for (let i = 0; i < pts; i++) {
          const a = (i / pts) * Math.PI * 2;
          const rr = TEX * (0.19 + r() * 0.05);
          const x = cx * TEX + Math.cos(a) * rr, y = cy * TEX + Math.sin(a) * rr;
          if (i) g.lineTo(x, y);
          else g.moveTo(x, y);
        }
        g.closePath();
        g.fill();
        g.strokeStyle = 'rgba(0,0,0,0.18)';
        g.lineWidth = 3;
        g.stroke();
      }
      break;
    }
    case 'brick': {
      g.fillStyle = '#d8c8b0'; // mortar
      g.fillRect(0, 0, TEX, TEX);
      const rows = 4, bw = TEX / 2, bh = TEX / rows;
      for (let row = 0; row < rows; row++)
        for (let col = -1; col < 3; col++) {
          const x = col * bw + (row % 2 ? bw / 2 : 0);
          const shade = 160 + Math.floor(r() * 40);
          g.fillStyle = `rgb(${shade + 20},${Math.floor(shade * 0.48)},${Math.floor(shade * 0.36)})`;
          g.fillRect(x + 3, row * bh + 3, bw - 6, bh - 6);
        }
      break;
    }
    case 'wood': {
      const planks = 4, ph = TEX / planks;
      for (let i = 0; i < planks; i++) {
        const shade = 150 + Math.floor(r() * 30);
        g.fillStyle = `rgb(${shade + 10},${Math.floor(shade * 0.72)},${Math.floor(shade * 0.45)})`;
        g.fillRect(0, i * ph, TEX, ph);
        g.fillStyle = 'rgba(60,35,15,0.55)';
        g.fillRect(0, i * ph, TEX, 3);
        // grain + nails
        g.strokeStyle = 'rgba(90,55,25,0.25)';
        g.lineWidth = 1;
        for (let k = 0; k < 3; k++) {
          g.beginPath();
          const y = i * ph + 6 + r() * (ph - 10);
          g.moveTo(0, y);
          g.bezierCurveTo(TEX * 0.3, y + 3, TEX * 0.6, y - 3, TEX, y);
          g.stroke();
        }
        g.fillStyle = '#4a3a2a';
        for (const x of [8, TEX - 8]) g.fillRect(x - 1.5, i * ph + ph / 2 - 1.5, 3, 3);
      }
      break;
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

const materials = new Map<number, THREE.MeshStandardMaterial>();
function pathMaterial(id: number) {
  let m = materials.get(id);
  if (!m) {
    const def = PATHS[id - 1];
    m = bend(new THREE.MeshStandardMaterial({
      map: makeTexture(def.key), roughness: def.key === 'brick' || def.key === 'stone' ? 0.85 : 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    }));
    materials.set(id, m);
  }
  return m;
}

/** Tint paths when the ground is snowy (they peek through a light dusting). */
export function setPathSnow(snowy: boolean) {
  for (const m of materials.values()) m.color.set(snowy ? '#e7eef5' : '#ffffff');
  kitMat.color.set(snowy ? '#e7eef5' : '#ffffff');
}

// ── Kit paths (art/kit/paths.py → paths.glb) ─────────────────────────────────
// Low-poly quarter pieces in the ground's flat-shaded style: every path tile is
// four quarters, each a `full`, `edge` (one side open to the grass) or `outer`
// (rounded corner) piece, mirrored into place and laid on the terrain.

const kitMat = bend(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
const PIECE_VARIANTS = 3;
const pieceCache = new Map<string, { pos: Float32Array; col: Float32Array }>();

function kitPiece(key: string, piece: 'full' | 'edge' | 'outer', v: number) {
  const name = `path_${key}_${piece}_${v}`;
  if (!pieceCache.has(name)) {
    const parts = kitGeometryByColor(name);
    if (!parts) return null; // not loaded (yet)
    const pos: number[] = [], col: number[] = [];
    const c = new THREE.Color();
    for (const { color, geo } of parts) {
      c.set(color);
      const p = geo.attributes.position.array as Float32Array;
      for (let i = 0; i < p.length; i += 3) {
        pos.push(p[i], p[i + 1], p[i + 2]);
        col.push(c.r, c.g, c.b);
      }
    }
    pieceCache.set(name, { pos: new Float32Array(pos), col: new Float32Array(col) });
  }
  return pieceCache.get(name) ?? null;
}

/** Path layer from the kit pieces; null when they aren't loaded. */
function buildKitPaths(grid: Grid): THREE.Group | null {
  if (!kitPiece('dirt', 'full', 0)) return null;
  const size = grid.size;
  const pos: number[] = [];
  const col: number[] = [];
  const shade = new THREE.Color();
  const QUARTERS: [number, number][] = [[1, 1], [-1, 1], [-1, -1], [1, -1]];
  for (let z = 0; z < size; z++)
    for (let x = 0; x < size; x++) {
      const t = grid.path(x, z);
      if (!t) continue;
      const key = PATHS[t - 1]?.key;
      if (!key) continue;
      const same = (dx: number, dz: number) => grid.path(x + dx, z + dz) === t;
      // Where the path runs east–west, turn the whole tile so planks lie across and brick rows along it.
      const turn = (same(-1, 0) || same(1, 0)) && !(same(0, -1) || same(0, 1));
      const cx = x + 0.5, cz = z + 0.5;
      // Per-tile shade, like the ground's tiles.
      const n = ((hashString(`${x}:${z}:p`) % 1000) / 1000 - 0.5) * 0.08;
      for (const [sx, sz] of QUARTERS) {
        let openX = !same(sx, 0), openZ = !same(0, sz);
        if (turn) [openX, openZ] = [openZ, openX];
        const piece = !openX && !openZ ? 'full' : openX && openZ ? 'outer' : 'edge';
        const swap = (piece === 'edge' && openZ) !== turn;
        const v = Math.abs(hashString(`${x},${z},${sx},${sz}`)) % PIECE_VARIANTS;
        const src = kitPiece(key, piece, v);
        if (!src) continue;
        // Mirroring (and swapping) turns triangles inside out: flip their winding back.
        const flip = (sx * sz < 0) !== swap;
        for (let i = 0; i < src.pos.length; i += 9) {
          for (let k = 0; k < 3; k++) {
            const kk = flip && k > 0 ? 3 - k : k;
            let lx = src.pos[i + kk * 3], lz = src.pos[i + kk * 3 + 2];
            const ly = src.pos[i + kk * 3 + 1];
            if (swap) [lx, lz] = [lz, lx];
            const X = cx + sx * lx, Z = cz + sz * lz;
            pos.push(X, grid.surfaceY(X, Z) + 0.012 + ly, Z);
            shade.setRGB(src.col[i + kk * 3], src.col[i + kk * 3 + 1], src.col[i + kk * 3 + 2]).offsetHSL(0, 0, n);
            col.push(shade.r, shade.g, shade.b);
          }
        }
      }
    }
  const group = new THREE.Group();
  if (!pos.length) return group;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, kitMat);
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  group.add(mesh);
  return group;
}

/**
 * Build the path layer. Each tile is a quad slightly above the ground; edges
 * without a same-type neighbour are inset, outer corners get bevelled.
 */
export function buildPaths(grid: Grid): THREE.Group {
  const kit = buildKitPaths(grid);
  if (kit) return kit;
  const group = new THREE.Group();
  const byType = new Map<number, { pos: number[]; uv: number[] }>();
  const size = grid.size;
  for (let z = 0; z < size; z++)
    for (let x = 0; x < size; x++) {
      const t = grid.path(x, z);
      if (!t) continue;
      const same = (dx: number, dz: number) => grid.path(x + dx, z + dz) === t;
      const n = same(0, -1), s = same(0, 1), e = same(1, 0), w = same(-1, 0);
      const inset = t === 3 ? 0 : 0.09; // stepping stones carry their own gaps
      const x0 = x + (w ? 0 : inset), x1 = x + 1 - (e ? 0 : inset);
      const z0 = z + (n ? 0 : inset), z1 = z + 1 - (s ? 0 : inset);
      const y = grid.surfaceY(x + 0.5, z + 0.5) + 0.02;
      // Octagon-ish outline: bevel corners where both adjoining edges are open.
      const b = 0.14;
      const pts: [number, number][] = [];
      const corner = (cx: number, cz: number, open: boolean, ax: number, az: number, bx: number, bz: number) => {
        if (open) pts.push([cx + ax * b, cz + az * b], [cx + bx * b, cz + bz * b]);
        else pts.push([cx, cz]);
      };
      corner(x0, z0, !n && !w, 0, 1, 1, 0); // NW
      corner(x1, z0, !n && !e, -1, 0, 0, 1); // NE
      corner(x1, z1, !s && !e, 0, -1, -1, 0); // SE
      corner(x0, z1, !s && !w, 1, 0, 0, -1); // SW
      let buf = byType.get(t);
      if (!buf) byType.set(t, (buf = { pos: [], uv: [] }));
      // Triangle fan from the tile centre (counter-clockwise seen from above).
      const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], c = pts[(i + 1) % pts.length];
        buf.pos.push(cx, y, cz, c[0], y, c[1], a[0], y, a[1]);
        buf.uv.push(cx, -cz, c[0], -c[1], a[0], -a[1]);
      }
    }
  for (const [t, buf] of byType) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(buf.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(buf.uv, 2));
    g.computeVertexNormals();
    const mesh = new THREE.Mesh(g, pathMaterial(t));
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
}

export function disposePaths(group: THREE.Group) {
  for (const c of group.children) (c as THREE.Mesh).geometry.dispose();
}
