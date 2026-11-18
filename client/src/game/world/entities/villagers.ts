// Villagers walking about (interpolated from the server) and birds hopping.

import type * as THREE from 'three';
import { type TalkView, villagerDef, type VillagerView } from '@hearthwood/shared';
import { disposeTree } from '../../gpu.ts';
import { makeVillager } from '../../characters.ts';
import { dress, drive, makeVillagerModel, react, type VillagerModel } from '../../villagerModels.ts';
import { currentEnv } from '../scene/environment.ts';
import { debug } from '../common.ts';
import { makeLabel } from './players.ts';
import type { World } from '../../World.ts';

export function upsertVillager(self: World, v: VillagerView) {
  const def = villagerDef(v.id);
  if (!def) return;
  let m = self.villagers.get(v.id);
  if (!m) {
    const rig = makeVillager(def);
    const label = makeLabel(self, def.name, 'vill');
    label.position.set(0, 1.55, 0);
    rig.root.add(label);
    self.world.add(rig.root);
    m = { rig, label, x: v.x, z: v.z, r: v.r, tx: v.x, tz: v.z, tr: v.r, speed: 0, swing: 0, home: v.home, houseId: v.houseId, outfit: v.outfit };
    self.villagers.set(v.id, m);
    // Swap in the Blender model once it has loaded (the box villager stays as fallback).
    const mover = m;
    void makeVillagerModel(def).then((vm) => {
      if (!vm || self.villagers.get(def.id) !== mover) return;
      for (const c of [...mover.rig.root.children]) if (c !== mover.label && !(c as { isCSS2DObject?: boolean }).isCSS2DObject && c.name !== 'wade') mover.rig.root.remove(c);
      mover.rig.root.add(vm.root);
      mover.model = vm;
      dress(vm, mover.outfit);
    });
  }
  m.outfit = v.outfit;
  if (m.model) dress(m.model, v.outfit);
  m.tx = v.x;
  m.tz = v.z;
  m.tr = v.r;
  m.home = v.home;
  m.rig.root.visible = !v.home;
}

/** Blender villagers: pick their clips from how they move, the weather and what just happened. */
export function animateVillagers(self: World, dt: number) {
  const env = currentEnv(self);
  const indoors = self.room?.kind === 'interior';
  const weather = debug.weather ?? env?.weather;
  const rain = !indoors && (weather === 'rain' || weather === 'storm');
  const now = Date.now();
  for (const [id, v] of self.villagers) {
    if (!v.model || v.home) continue;
    const def = villagerDef(id);
    if (def) drive(v.model, dt, { speed: v.speed, rain, def, now });
  }
}

/** A villager reacts to what the player said or gave. */
export function villagerReact(self: World, t: TalkView) {
  const vm = self.villagers.get(t.vid)?.model;
  if (!vm) return;
  const now = Date.now();
  if (t.reaction === 'dislike') react(vm, 'sad', now);
  else if (t.reaction === 'love' || t.reaction === 'like') react(vm, 'laugh', now);
  else if (t.first) react(vm, 'surprised', now);
  if (t.gave) react(vm, 'gift', now);
}

interface BirdParts { body?: THREE.Object3D; head?: THREE.Object3D; wingL?: THREE.Object3D; wingR?: THREE.Object3D }

/** A bird's moving parts, looked up once per bird (not by name every frame). */
function birdParts(mesh: THREE.Object3D): BirdParts {
  let p = mesh.userData.birdParts as BirdParts | undefined;
  if (!p) {
    p = { body: mesh.getObjectByName('body'), head: mesh.getObjectByName('head'), wingL: mesh.getObjectByName('wingL'), wingR: mesh.getObjectByName('wingR') };
    mesh.userData.birdParts = p;
  }
  return p;
}

export function animateBirds(self: World, t: number, dt: number) {
  for (const [id, mesh] of self.objMeshes) {
    if (!mesh.userData.bird) continue;
    const ph = (id.charCodeAt(id.length - 1) % 9) * 0.7;
    const { body, head } = birdParts(mesh);
    if (!body) continue;
    // Little hops every few seconds, pecking in between.
    const cyc = (t * 0.6 + ph) % 3;
    body.position.y = cyc < 0.35 ? Math.sin((cyc / 0.35) * Math.PI) * 0.08 : 0;
    body.rotation.x = cyc > 1.4 && cyc < 1.8 ? Math.sin(((cyc - 1.4) / 0.4) * Math.PI) * 0.5 : 0;
    if (head) head.rotation.y = Math.sin(t * 0.9 + ph) * 0.6;
  }
  for (let i = self.flying.length - 1; i >= 0; i--) {
    const f = self.flying[i];
    const k = self.clock.elapsedTime - f.t0;
    if (k > 1.6) {
      self.world.remove(f.mesh);
      disposeTree(f.mesh);
      self.flying.splice(i, 1);
      continue;
    }
    // (speeds per second: the same flight at any frame rate)
    f.mesh.position.x += Math.sin(f.dir) * 4.8 * dt;
    f.mesh.position.z += Math.cos(f.dir) * 4.8 * dt;
    f.mesh.position.y += (3.6 + k * 2.4) * dt;
    f.mesh.rotation.y = f.dir;
    const flap = Math.sin(t * 40) * 0.9;
    const { wingL, wingR } = birdParts(f.mesh);
    if (wingL) wingL.rotation.z = flap;
    if (wingR) wingR.rotation.z = -flap;
  }
}
