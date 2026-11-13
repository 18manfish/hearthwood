// Building blocks for the procedural models: cached bent materials, shared primitive
// geometries, and `part` (one coloured, scaled, placed primitive).

import * as THREE from 'three';
import { hashString } from '@hearthwood/shared';
import { bend, bentDepth } from '../bend.ts';

export const matCache = new Map<string, THREE.MeshStandardMaterial>();

export function mat(color: string, opts: { emissive?: string; ei?: number; opacity?: number; rough?: number } = {}) {
  const key = `${color}|${opts.emissive ?? ''}|${opts.ei ?? 0}|${opts.opacity ?? 1}|${opts.rough ?? 0.9}`;
  let m = matCache.get(key);
  if (!m) {
    m = bend(new THREE.MeshStandardMaterial({ color, roughness: opts.rough ?? 0.9, metalness: 0, flatShading: true }));
    if (opts.emissive) {
      m.emissive = new THREE.Color(opts.emissive);
      m.emissiveIntensity = opts.ei ?? 1;
    }
    if (opts.opacity !== undefined && opts.opacity < 1) {
      m.transparent = true;
      m.opacity = opts.opacity;
      m.depthWrite = false;
    }
    matCache.set(key, m);
  }
  return m;
}

// Shared geometries.
export const G = {
  box: new THREE.BoxGeometry(1, 1, 1),
  cyl: new THREE.CylinderGeometry(1, 1, 1, 8),
  cyl6: new THREE.CylinderGeometry(1, 1, 1, 6),
  cone: new THREE.ConeGeometry(1, 1, 8),
  cone4: new THREE.ConeGeometry(1, 1, 4),
  /** Gable roof: triangular prism, ridge along x, 1 wide (x), 1 deep (z), 1 tall. */
  gable: (() => {
    const sh = new THREE.Shape();
    sh.moveTo(-0.5, 0);
    sh.lineTo(0.5, 0);
    sh.lineTo(0, 1);
    sh.closePath();
    const g = new THREE.ExtrudeGeometry(sh, { depth: 1, bevelEnabled: false });
    g.translate(0, 0, -0.5);
    g.rotateY(Math.PI / 2); // ridge along x, slopes face north/south
    return g;
  })(),
  /** Square pyramid with its base edges aligned to x/z, half-width 1. */
  roof: new THREE.ConeGeometry(Math.SQRT2, 1, 4).rotateY(Math.PI / 4),
  sphere: new THREE.SphereGeometry(1, 10, 8),
  ico: new THREE.IcosahedronGeometry(1, 0),
  dodeca: new THREE.DodecahedronGeometry(1, 0),
};

export function part(geo: keyof typeof G, color: string | THREE.Material, sx: number, sy: number, sz: number, x = 0, y = 0, z = 0, shadow = true) {
  const m = new THREE.Mesh(G[geo], typeof color === 'string' ? mat(color) : color);
  m.scale.set(sx, sy, sz);
  m.position.set(x, y, z);
  m.castShadow = shadow;
  m.receiveShadow = true;
  if (shadow) m.customDepthMaterial = bentDepth;
  return m;
}

export function rand(id: string, i = 0) {
  return (hashString(`${id}:${i}`) % 1000) / 1000;
}
