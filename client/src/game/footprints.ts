// Footprints: everyone who walks leaves prints in fresh snow (in winter) and
// on sandy beaches. Prints are instanced decals whose colour fades back into
// the ground colour, then the slot is recycled.

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
}

export class Footprints {
  readonly mesh: THREE.InstancedMesh;
  private prints: (Print | null)[] = new Array(MAX).fill(null);
  private next = 0;
  private trackers = new Map<string, { x: number; z: number; left: boolean }>();
  private hidden = new THREE.Matrix4().makeScale(0, 0, 0);
  private m4 = new THREE.Matrix4();
  private tmp = new THREE.Color();
  snowColor = new THREE.Color('#eef3f7');
  sandColor = new THREE.Color('#e6d6a3');

  constructor() {
    // A soft oval print (slightly wider at the toe).
    const shape = new THREE.Shape();
    shape.moveTo(0, -0.075);
    shape.bezierCurveTo(0.045, -0.075, 0.05, 0.02, 0.04, 0.06);
    shape.bezierCurveTo(0.03, 0.09, -0.03, 0.09, -0.04, 0.06);
    shape.bezierCurveTo(-0.05, 0.02, -0.045, -0.075, 0, -0.075);
    const geo = new THREE.ShapeGeometry(shape, 4).rotateX(-Math.PI / 2);
    const mat = bend(new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
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
  track(id: string, x: number, z: number, grid: Grid, snowy: boolean, now: number) {
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
    const onSnow = snowy && (tile === Tile.Ground || tile === Tile.Ramp) && grid.path(tx, tz) === 0;
    if (!onSand && !onSnow) return;
    const ang = Math.atan2(dx, dz);
    // Offset sideways for left/right feet.
    const side = (t.left ? 1 : -1) * 0.085;
    const px = x + Math.cos(ang) * side, pz = z - Math.sin(ang) * side;
    const y = grid.surfaceY(px, pz) + 0.012;
    const i = this.next;
    this.next = (this.next + 1) % MAX;
    this.m4.makeRotationY(ang + Math.PI); // toe points along the walking direction
    this.m4.setPosition(px, y, pz);
    this.mesh.setMatrixAt(i, this.m4);
    const base = onSnow ? this.snowColor : this.sandColor;
    const from = onSnow ? new THREE.Color('#b4c2d0') : base.clone().multiplyScalar(0.8);
    this.prints[i] = { born: now, life: onSnow ? 60 : 25, from, to: base.clone() };
    this.mesh.setColorAt(i, from);
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
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
      changed = true;
    }
    if (changed && this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}
