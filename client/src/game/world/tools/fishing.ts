// Casting the fishing line: the float on the water and the line to the rod tip.

import * as THREE from 'three';
import { CLIFF } from '@hearthwood/shared';
import { layLine } from '../../models/fishing.ts';
import { WATER_Y } from '../common.ts';
import type { World } from '../../World.ts';

export function startCast(self: World, x: number, z: number) {
  self.cast = { id: null, x, z, bite: false, window: 0, at: performance.now() };
  self.bobber.position.set(x + 0.5, WATER_Y + (self.grid?.level(x, z) ?? 0) * CLIFF, z + 0.5);
  self.bobber.rotation.set(0, Math.random() * Math.PI * 2, 0);
  self.bobber.visible = true;
  if (self.me) self.me.swing = 1;
}

export function endCast(self: World) {
  self.cast = null;
  self.bobber.visible = false;
  self.fishLine.visible = false;
}

const tip = new THREE.Vector3();
const knot = new THREE.Vector3();

/** Every frame while fishing: the float bobs (and dips on a bite), the line follows the rod tip. */
export function updateFishing(self: World, t: number) {
  const c = self.cast;
  if (!c) {
    self.fishLine.visible = false;
    return;
  }
  const water = WATER_Y + (self.grid?.level(c.x, c.z) ?? 0) * CLIFF;
  const float = self.bobber.getObjectByName('float')!;
  const ripple = self.bobber.getObjectByName('ripple')!;
  // The float rides on the water; on a bite it is pulled under in jerks and tips over.
  const dip = c.bite ? -0.075 + Math.sin(t * 30) * 0.03 : 0.004 + Math.sin(t * 2.6) * 0.012;
  self.bobber.position.y = water;
  float.position.y = dip;
  float.rotation.x = c.bite ? 0.35 + Math.sin(t * 24) * 0.25 : Math.sin(t * 1.9) * 0.08;
  float.rotation.z = c.bite ? Math.sin(t * 17) * 0.2 : Math.cos(t * 1.4) * 0.06;
  // A ring spreads out on the water (faster while a fish is biting).
  const k = (t * (c.bite ? 1.6 : 0.5)) % 1;
  const r = 0.07 + k * (c.bite ? 0.25 : 0.14);
  ripple.position.y = 0.002;
  ripple.scale.set(r, r, 0.04);
  ((ripple as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = 0.45 * (1 - k);
  // The line: rod tip to the eyelet on the antenna, slack while waiting, taut on a bite.
  const rod = self.me?.rig.tool.getObjectByName('rodTip');
  if (!rod) {
    self.fishLine.visible = false;
    return;
  }
  rod.getWorldPosition(tip);
  self.bobber.getObjectByName('lineAttach')!.getWorldPosition(knot);
  const span = tip.distanceTo(knot);
  layLine(self.fishLine, tip, knot, c.bite ? span * 0.01 : span * 0.12, c.bite ? 0.01 : 0, t);
  self.fishLine.visible = true;
}
