// Life in the water: fish shadows (fishing spots) wandering around their tile
// and crowding round a bobber, schools of small fish out in the open sea, and
// the fish you hold up when you catch one.

import * as THREE from 'three';
import { isWaterTile, Tile } from '@hearthwood/shared';
import { kitClip, kitModel } from '../../assets/kit.ts';
import { caughtFishModel, SHADOW_COLOR, SHADOW_SWIM, swimShadow } from '../../models/fish.ts';
import { mat } from '../../models/primitives.ts';
import { WATER_Y } from '../common.ts';
import type { World } from '../../World.ts';

interface School {
  mesh: THREE.Object3D;
  mixer: THREE.AnimationMixer;
}

interface Held {
  mesh: THREE.Object3D;
  t0: number;
}

const schools = new WeakMap<World, School[]>();
const held = new WeakMap<World, Held[]>();

/** Schools of small fish out in the deep sea around the island (none indoors). */
export function addSealife(self: World) {
  clearSealife(self);
  if (!self.grid || !self.room || self.room.kind === 'interior') return;
  const clip = kitClip('school_swim');
  if (!clip) return;
  const g = self.grid;
  const spots: [number, number][] = [];
  // Deep sea: open water with no land within 4 tiles, inside the island's square or just off it.
  for (let z = -6; z < g.size + 6; z += 3)
    for (let x = -6; x < g.size + 6; x += 3) {
      let open = true;
      for (let dz = -4; dz <= 4 && open; dz++) for (let dx = -4; dx <= 4 && open; dx++) {
        const t = g.inBounds(x + dx, z + dz) ? g.tile(x + dx, z + dz) : Tile.Sea;
        if (t !== Tile.Sea) open = false;
      }
      if (open) spots.push([x, z]);
    }
  if (!spots.length) return;
  const list: School[] = [];
  const n = Math.min(3, Math.max(1, Math.round(spots.length / 40)));
  for (let i = 0; i < n; i++) {
    const [x, z] = spots[Math.floor(((i + 0.5) / n) * spots.length)];
    const mesh = kitModel('fish_school', () => mat(SHADOW_COLOR));
    if (!mesh) return;
    mesh.traverse((c: THREE.Object3D) => {
      c.castShadow = false;
      c.receiveShadow = false;
    });
    mesh.position.set(x + 0.5, WATER_Y - 0.3, z + 0.5);
    mesh.rotation.y = i * 2.1;
    const mixer = new THREE.AnimationMixer(mesh);
    const action = mixer.clipAction(clip);
    action.play();
    mixer.setTime(i * 3.3); // not all in step
    self.world.add(mesh);
    list.push({ mesh, mixer });
  }
  schools.set(self, list);
}

export function clearSealife(self: World) {
  for (const s of schools.get(self) ?? []) self.world.remove(s.mesh);
  schools.delete(self);
  for (const h of held.get(self) ?? []) self.world.remove(h.mesh);
  held.delete(self);
}

/** Hold the fish you just caught up over your head for a moment. */
export function showCatch(self: World, item: string) {
  if (!self.me || !self.grid) return;
  const mesh = caughtFishModel(item);
  mesh.position.set(self.me.x, self.grid.surfaceY(self.me.x, self.me.z) + 2.1, self.me.z);
  self.world.add(mesh);
  const list = held.get(self) ?? [];
  list.push({ mesh, t0: self.clock.elapsedTime });
  held.set(self, list);
}

const tmp = new THREE.Vector3();

/** Every frame: shadows swim (and gather at a bobber), schools loop, caught fish fade out. */
export function animateSealife(self: World, t: number, dt: number) {
  const cast = self.cast;
  for (const mesh of self.objMeshes.values()) {
    const f = mesh.userData.fish as { size: keyof typeof SHADOW_SWIM; phase: number } | undefined;
    if (!f) continue;
    const swimmer = mesh.getObjectByName('swimmer');
    if (!swimmer) continue;
    const spec = SHADOW_SWIM[f.size];
    // Bobber close by: swim up to it and nose at it.
    const bx = cast ? cast.x + 0.5 - mesh.position.x : 0, bz = cast ? cast.z + 0.5 - mesh.position.z : 0;
    const drawn = !!cast && Math.hypot(bx, bz) < 1.6;
    let tx: number, tz: number, speed = 1;
    if (drawn) {
      const d = Math.hypot(bx, bz) || 1;
      const stop = 0.12 + spec.length * 0.5;
      tx = bx - (bx / d) * stop;
      tz = bz - (bz / d) * stop;
      speed = cast!.bite ? 2.6 : 0.7;
      if (cast!.bite) {
        tx += Math.sin(t * 40) * 0.03;
        tz += Math.cos(t * 37) * 0.03;
      }
    } else {
      // Lazy figure-of-eight around the spot.
      const w = 0.35 / (0.6 + spec.length);
      const a = t * w + f.phase;
      tx = Math.sin(a) * spec.roam;
      tz = Math.sin(a * 2) * spec.roam * 0.5;
    }
    const k = 1 - Math.exp(-dt * (drawn ? 2.5 : 4));
    const px = swimmer.position.x, pz = swimmer.position.z;
    swimmer.position.x += (tx - px) * k;
    swimmer.position.z += (tz - pz) * k;
    const vx = swimmer.position.x - px, vz = swimmer.position.z - pz;
    if (Math.hypot(vx, vz) > 1e-4) {
      const heading = Math.atan2(vx, vz);
      let dh = heading - swimmer.rotation.y;
      dh = Math.atan2(Math.sin(dh), Math.cos(dh));
      swimmer.rotation.y += dh * Math.min(1, dt * 5);
    } else if (drawn) {
      swimmer.rotation.y = Math.atan2(bx - swimmer.position.x, bz - swimmer.position.z);
    }
    swimShadow(mesh, t, speed);
    // Don't swim onto land: shadows on narrow rivers stay near the middle.
    if (self.grid) {
      tmp.set(mesh.position.x + swimmer.position.x, 0, mesh.position.z + swimmer.position.z);
      if (!isWaterTile(self.grid.tile(Math.floor(tmp.x), Math.floor(tmp.z)))) swimmer.position.multiplyScalar(0.9);
    }
  }
  for (const s of schools.get(self) ?? []) s.mixer.update(dt);
  const list = held.get(self);
  if (list) {
    for (let i = list.length - 1; i >= 0; i--) {
      const h = list[i];
      const k = t - h.t0;
      if (self.me && self.grid) h.mesh.position.set(self.me.x, self.grid.surfaceY(self.me.x, self.me.z) + 2.1 + Math.min(0.2, k * 0.4), self.me.z);
      h.mesh.rotation.y = Math.sin(k * 2) * 0.3;
      if (k > 2.6) {
        self.world.remove(h.mesh);
        list.splice(i, 1);
      }
    }
  }
}
