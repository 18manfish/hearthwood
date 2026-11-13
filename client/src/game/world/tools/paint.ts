// Painting paths and terraforming: the ghost tile under the cursor, what is allowed
// where, and sending the paint strokes.

import * as THREE from 'three';
import { autoRampDir, CLIFF, distToTile, isRampOp, PATH_REACH, PATHS, TERRA_INFO, TERRA_REACH, terraformError, type TerraOp } from '@hearthwood/shared';
import { bendDrop } from '../../bend.ts';
import { mat, part } from '../../models.ts';
import { groundY } from '../entities/players.ts';
import { facingTile } from '../targeting.ts';
import { cancelGhost } from './ghost.ts';
import type { World } from '../../World.ts';

export function startPaint(self: World, type: number) {
  cancelGhost(self);
  stopPaint(self);
  const group = new THREE.Group();
  const box = part('box', mat(type ? PATHS[type - 1].color : '#ff6b6b', { opacity: 0.55 }), 1, 0.04, 1, 0.5, 0.03, 0.5, false);
  box.name = 'box';
  group.add(box);
  self.scene.add(group);
  self.paint = { type, dir: -1, group, tx: 0, tz: 0, ok: false, down: false, last: '' };
}

/** Terraforming uses the same click-and-drag tile cursor as path painting. */
export function startTerra(self: World, op: TerraOp) {
  startPaint(self, 0);
  const p = self.paint!;
  p.terra = op;
  p.type = -1;
}

export function paintColor(self: World, ok: boolean) {
  const p = self.paint!;
  if (!ok) return '#9e9e9e';
  if (p.terra) return TERRA_INFO[p.terra].color;
  return p.type ? PATHS[p.type - 1].color : '#ff6b6b';
}

/** Uphill direction for a ramp: away from the player if that fits. */
export function rampDir(self: World, tx: number, tz: number) {
  if (!self.grid || !self.me) return -1;
  const dx = tx + 0.5 - self.me.x, dz = tz + 0.5 - self.me.z;
  const prefer = Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? 1 : 3) : dz > 0 ? 2 : 0;
  return autoRampDir(self.grid, tx, tz, prefer);
}

export function stopPaint(self: World) {
  if (self.paint) self.scene.remove(self.paint.group);
  self.paint = null;
}

/** Paint the tile in front of the player (keyboard painting with E). */
export function paintFacing(self: World) {
  if (!self.paint || !self.me) return;
  const f = facingTile(self);
  self.paint.tx = f.x;
  self.paint.tz = f.z;
  self.paint.ok = paintOk(self, f.x, f.z);
  self.paint.last = '';
  paintHere(self);
}

export function paintOk(self: World, tx: number, tz: number) {
  if (!self.grid || !self.me) return false;
  const op = self.paint!.terra;
  if (op) {
    if (distToTile(self.me.x, self.me.z, tx, tz) > TERRA_REACH) return false;
    self.paint!.dir = isRampOp(op) ? (self.grid.ramp(tx, tz) >= 0 ? self.grid.ramp(tx, tz) : rampDir(self, tx, tz)) : -1;
    return terraformError(self.grid, op, tx, tz, self.paint!.dir) === null;
  }
  if (distToTile(self.me.x, self.me.z, tx, tz) > PATH_REACH) return false;
  return self.paint!.type ? self.grid.canPave(tx, tz) && self.grid.path(tx, tz) !== self.paint!.type : self.grid.path(tx, tz) > 0;
}

export function paintHere(self: World) {
  const p = self.paint;
  if (!p || !p.ok) return;
  const key = `${p.tx},${p.tz}`;
  if (key === p.last) return;
  p.last = key;
  if (p.terra) self.onTerra(p.tx, p.tz, p.terra, p.dir);
  else self.onPaint(p.tx, p.tz, p.type);
}

/**
 * Point on the ground under the mouse. The world bend lowers distant ground
 * by k·Δz², so refine the hit a few times against that curved surface.
 */
export function pickGround(self: World): THREE.Vector3 | null {
  if (!self.me) return null;
  self.raycaster.setFromCamera(self.mouse, self.camera);
  const base = groundY(self, self.me.x, self.me.z);
  const hit = new THREE.Vector3();
  self.groundPlane.constant = -base;
  if (!self.raycaster.ray.intersectPlane(self.groundPlane, hit)) return null;
  for (let i = 0; i < 3 && self.room?.kind !== 'interior'; i++) {
    self.groundPlane.constant = -(base - bendDrop(hit.z));
    if (!self.raycaster.ray.intersectPlane(self.groundPlane, hit)) return null;
  }
  return hit;
}

export function updatePaintGhost(self: World) {
  const p = self.paint;
  if (!p || !self.grid || !self.me) return;
  if (self.padAim) {
    const f = facingTile(self);
    p.tx = f.x;
    p.tz = f.z;
  } else {
    const hit = pickGround(self);
    if (!hit) return;
    p.tx = Math.floor(hit.x);
    p.tz = Math.floor(hit.z);
  }
  p.ok = paintOk(self, p.tx, p.tz);
  p.group.position.set(p.tx, self.grid.surfaceY(p.tx + 0.5, p.tz + 0.5), p.tz);
  const box = p.group.getObjectByName('box') as THREE.Mesh;
  box.visible = self.grid.inBounds(p.tx, p.tz);
  box.material = mat(paintColor(self, p.ok), { opacity: 0.55 });
  // Raising previews the new block; everything else is a flat marker.
  const tall = p.terra === 'raise' && p.ok;
  box.scale.y = tall ? CLIFF : 0.04;
  box.position.y = tall ? CLIFF / 2 : 0.03;
}
