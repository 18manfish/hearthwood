// Lamps, campfires and the lighthouse.
//
// Every real light in a scene makes every lit pixel more expensive, and adding or
// removing one makes three.js rebuild the shaders of every material (a visible
// hitch). So models don't carry lights of their own: they carry a `Glow` – a marker
// that says "a light of this colour and strength belongs here" – and the world keeps a
// small fixed pool of point lights that it hands to the glows nearest the player.
// However many lanterns an island has, at most POOL lights are ever lit.

import * as THREE from 'three';

/** Where a model wants light (see the top of the file). Used like a PointLight. */
export class Glow extends THREE.Object3D {
  readonly isGlow = true;
  readonly color: THREE.Color;

  constructor(color: string, public intensity = 1, public distance = 0, public decay = 2) {
    super();
    this.color = new THREE.Color(color);
  }
}

/** The glows of a model (collected once, when it is built). */
export function glowsOf(root: THREE.Object3D): Glow[] {
  const out: Glow[] = [];
  root.traverse((o: THREE.Object3D) => {
    if ((o as Glow).isGlow) out.push(o as Glow);
  });
  return out;
}

const POOL = 4;
const pos = new THREE.Vector3();

export class LightPool {
  private readonly lights: THREE.PointLight[] = [];
  private readonly nearest: { glow: Glow | null; d: number }[] = [];
  private shown = -1;

  constructor(parent: THREE.Object3D) {
    for (let i = 0; i < POOL; i++) {
      const l = new THREE.PointLight('#ffffff', 0, 5, 1.5);
      l.visible = false;
      parent.add(l);
      this.lights.push(l);
      this.nearest.push({ glow: null, d: 0 });
    }
    this.nearest.push({ glow: null, d: 0 }); // one more: the first glow that gets no light
  }

  /**
   * Once per frame: light the glows nearest (x, z). `total` is how many glows the room
   * has: that many pool lights (at most POOL) stay switched on, so the number of lights
   * the shaders are built for only changes when a light source is placed or removed.
   */
  update(groups: Iterable<Glow[]>, total: number, x: number, z: number) {
    const near = this.nearest;
    for (const n of near) {
      n.glow = null;
      n.d = Infinity;
    }
    for (const glows of groups) {
      for (const glow of glows) {
        if (glow.intensity <= 0) continue;
        const e = glow.matrixWorld.elements;
        const d = Math.hypot(e[12] - x, e[14] - z);
        // insertion into the short sorted list
        let i = near.length - 1;
        if (d >= near[i].d) continue;
        const slot = near[i];
        while (i > 0 && near[i - 1].d > d) {
          near[i] = near[i - 1];
          i--;
        }
        near[i] = slot;
        slot.glow = glow;
        slot.d = d;
      }
    }
    // A light fades out as it becomes the furthest that still gets one, so handing
    // it on to a nearer glow never shows as a pop.
    const cut = near[POOL].glow ? near[POOL].d : Infinity;
    const want = Math.min(POOL, total);
    for (let i = 0; i < POOL; i++) {
      const l = this.lights[i];
      const glow = near[i].glow;
      l.visible = i < want;
      if (!glow) {
        l.intensity = 0;
        continue;
      }
      const fade = cut === Infinity ? 1 : Math.min(1, Math.max(0, (cut - near[i].d) / 3));
      l.position.copy(pos.setFromMatrixPosition(glow.matrixWorld));
      l.color.copy(glow.color);
      l.intensity = glow.intensity * fade;
      l.distance = glow.distance;
      l.decay = glow.decay;
    }
    this.shown = want;
  }

  /** Lights currently switched on (for the stats view). */
  get active() {
    return Math.max(0, this.shown);
  }
}
