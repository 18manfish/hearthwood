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

const POOL = 4;
const pos = new THREE.Vector3();

export class LightPool {
  private readonly lights: THREE.PointLight[] = [];
  /** The glows of the models in the scene, by model. */
  private readonly glows = new Map<THREE.Object3D, Glow[]>();
  private count = 0;
  /** The glows nearest the player, nearest first; one more than there are lights (the first that goes without). */
  private readonly nearest: { glow: Glow | null; d: number }[] = [];

  constructor(parent: THREE.Object3D) {
    for (let i = 0; i < POOL; i++) {
      const l = new THREE.PointLight('#ffffff', 0, 5, 1.5);
      l.visible = false;
      parent.add(l);
      this.lights.push(l);
    }
    for (let i = 0; i <= POOL; i++) this.nearest.push({ glow: null, d: Infinity });
  }

  /** A model joins the scene: its glows (if it has any) can be lit. */
  add(model: THREE.Object3D) {
    const glows: Glow[] = [];
    model.traverse((o: THREE.Object3D) => {
      if ((o as Glow).isGlow) glows.push(o as Glow);
    });
    if (!glows.length) return;
    this.glows.set(model, glows);
    this.count += glows.length;
  }

  /** A model leaves the scene. */
  remove(model: THREE.Object3D) {
    this.count -= this.glows.get(model)?.length ?? 0;
    this.glows.delete(model);
  }

  /**
   * Once per frame: light the glows nearest (x, z). As many pool lights as the scene
   * has glows (at most POOL) stay switched on whatever their brightness, so the number
   * of lights the shaders are built for only changes when a light source is placed or
   * removed.
   */
  update(x: number, z: number) {
    const near = this.nearest;
    for (const n of near) {
      n.glow = null;
      n.d = Infinity;
    }
    for (const glows of this.glows.values()) {
      for (const glow of glows) {
        if (glow.intensity <= 0) continue;
        const e = glow.matrixWorld.elements;
        const d = Math.hypot(e[12] - x, e[14] - z);
        // Into the sorted shortlist: the furthest entry is dropped, its slot reused.
        let i = near.length - 1;
        if (d >= near[i].d) continue;
        const slot = near[i];
        for (; i > 0 && near[i - 1].d > d; i--) near[i] = near[i - 1];
        near[i] = slot;
        slot.glow = glow;
        slot.d = d;
      }
    }
    // A light fades out as its glow becomes the furthest that still gets one, so
    // handing it on to a nearer glow never shows as a pop.
    const cut = near[POOL].d;
    for (let i = 0; i < POOL; i++) {
      const l = this.lights[i];
      const { glow, d } = near[i];
      l.visible = i < this.count;
      l.intensity = 0;
      if (!glow) continue;
      l.position.copy(pos.setFromMatrixPosition(glow.matrixWorld));
      l.color.copy(glow.color);
      l.intensity = glow.intensity * Math.min(1, (cut - d) / 3);
      l.distance = glow.distance;
      l.decay = glow.decay;
    }
  }
}
