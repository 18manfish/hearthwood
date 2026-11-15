// Footprints: everyone who walks leaves prints in snow and on sandy beaches.
// Each print is a little hollow with a rim of pushed-up snow (or sand) round it,
// lit like the ground so it reads as pressed in. Prints sit on the snow surface;
// as they age they fill back in and fade into the ground colour, then the slot
// is recycled.

import * as THREE from 'three';
import { Tile, type Grid, SEA_LEVEL } from '@hearthwood/shared';
import { bend } from './bend.ts';

const MAX = 500;
const STRIDE = 0.42;

interface Print {
  born: number;
  life: number;
  from: THREE.Color;
  to: THREE.Color;
  x: number;
  y: number;
  z: number;
  ang: number;
  /** How deep the hollow looks (snow deeper than sand). */
  depth: number;
}

/**
 * The print: a flat floor, a short wall up to a rim and a skirt back down to the
 * ground. Toe towards −z, slightly wider than the heel. Vertex colours shade the
 * floor (pressed snow is a little darker); the rim is what makes it look sunk in.
 */
function printGeometry(): THREE.BufferGeometry {
  const N = 14;
  const rings: [number, number, number][] = [[1, 0.004, 0.8], [1.3, 0.024, 1], [1.8, 0.002, 1]]; // [scale, height, shade]
  const pos: number[] = [0, 0.004, 0], col: number[] = [0.78, 0.78, 0.78], idx: number[] = [];
  for (const [s, y, c] of rings)
    for (let k = 0; k < N; k++) {
      const th = (k / N) * Math.PI * 2;
      const w = 1 + 0.18 * Math.cos(th); // wider at the toe
      pos.push(0.042 * Math.sin(th) * w * s, y, (-0.078 * Math.cos(th) + 0.006) * s);
      col.push(c, c, c);
    }
  for (let k = 0; k < N; k++) idx.push(0, 1 + ((k + 1) % N), 1 + k); // floor
  for (let r = 0; r < rings.length - 1; r++)
    for (let k = 0; k < N; k++) {
      const a = 1 + r * N + k, b = 1 + r * N + ((k + 1) % N), c = a + N, d = b + N;
      idx.push(a, b, d, a, d, c);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export class Footprints {
  readonly mesh: THREE.InstancedMesh;
  private prints: (Print | null)[] = new Array(MAX).fill(null);
  private next = 0;
  private trackers = new Map<string, { x: number; z: number; left: boolean }>();
  private hidden = new THREE.Matrix4().makeScale(0, 0, 0);
  private m4 = new THREE.Matrix4();
  private tmp = new THREE.Color();
  private q = new THREE.Quaternion();
  private up = new THREE.Vector3(0, 1, 0);
  private v = new THREE.Vector3();
  private sc = new THREE.Vector3();
  snowColor = new THREE.Color('#eef3f7');
  sandColor = new THREE.Color('#e6d6a3');

  constructor() {
    const geo = printGeometry();
    const mat = bend(new THREE.MeshStandardMaterial({ color: '#ffffff', vertexColors: true, roughness: 1, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
    this.mesh = new THREE.InstancedMesh(geo, mat, MAX);
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    for (let i = 0; i < MAX; i++) {
      this.mesh.setMatrixAt(i, this.hidden);
      this.mesh.setColorAt(i, this.snowColor);
    }
  }

  clear() {
    this.prints.fill(null);
    this.trackers.clear();
    for (let i = 0; i < MAX; i++) this.mesh.setMatrixAt(i, this.hidden);
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  forget(id: string) {
    this.trackers.delete(id);
  }

  /** Call every frame for each moving character. */
  /** `snow`: how deep the snow lies at a point (0 where there's none). */
  track(id: string, x: number, z: number, grid: Grid, snow: (x: number, z: number) => number, now: number) {
    let t = this.trackers.get(id);
    if (!t) {
      this.trackers.set(id, { x, z, left: false });
      return;
    }
    const dx = x - t.x, dz = z - t.z;
    const d = Math.hypot(dx, dz);
    if (d > 3) {
      // Teleport / respawn – don't draw a line of prints.
      t.x = x;
      t.z = z;
      return;
    }
    if (d < STRIDE) return;
    t.x = x;
    t.z = z;
    t.left = !t.left;
    const tx = Math.floor(x), tz = Math.floor(z);
    const tile = grid.tile(tx, tz);
    const onSand = tile === Tile.Shore && grid.surfaceY(x, z) > SEA_LEVEL + 0.01; // not under water
    const lift = snow(x, z);
    const onSnow = lift > 0.03 && (tile === Tile.Ground || tile === Tile.Ramp) && grid.path(tx, tz) === 0;
    if (!onSand && !onSnow) return;
    const ang = Math.atan2(dx, dz);
    // Offset sideways for left/right feet.
    const side = (t.left ? 1 : -1) * 0.085;
    const px = x + Math.cos(ang) * side, pz = z - Math.sin(ang) * side;
    const y = grid.surfaceY(px, pz) + (onSnow ? snow(px, pz) : 0);
    const i = this.next;
    this.next = (this.next + 1) % MAX;
    const base = onSnow ? this.snowColor : this.sandColor;
    const from = onSnow ? new THREE.Color('#dbe4ee') : base.clone().multiplyScalar(0.92);
    this.prints[i] = { born: now, life: onSnow ? 60 : 25, from, to: base.clone(), x: px, y, z: pz, ang: ang + Math.PI, depth: onSnow ? 1 : 0.55 };
    this.place(i, 1);
    this.mesh.setColorAt(i, from);
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  /** Put print `i` in place; `fill` 1 = freshly pressed, 0 = filled back in. */
  private place(i: number, fill: number) {
    const p = this.prints[i]!;
    this.q.setFromAxisAngle(this.up, p.ang); // toe points along the walking direction
    this.m4.compose(this.v.set(p.x, p.y, p.z), this.q, this.sc.set(1, Math.max(0.05, p.depth * fill), 1));
    this.mesh.setMatrixAt(i, this.m4);
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  /** Fade prints back into the ground and recycle expired ones. */
  update(now: number) {
    let changed = false;
    for (let i = 0; i < MAX; i++) {
      const p = this.prints[i];
      if (!p) continue;
      const k = (now - p.born) / p.life;
      if (k >= 1) {
        this.prints[i] = null;
        this.mesh.setMatrixAt(i, this.hidden);
        this.mesh.instanceMatrix.needsUpdate = true;
        continue;
      }
      // Stay crisp for a while, then melt / blow away.
      const f = Math.max(0, (k - 0.35) / 0.65);
      this.tmp.copy(p.from).lerp(p.to, f * f);
      this.mesh.setColorAt(i, this.tmp);
      if (f > 0) this.place(i, 1 - f * f); // the hollow fills back in
      changed = true;
    }
    if (changed && this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}
