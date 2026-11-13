// Placement ghosts for building, moving buildings and placing furniture.

import * as THREE from 'three';
import { type Building, BUILDINGS, type BuildingType, distToTile, furniturePlaceError, objectTiles, placeError } from '@hearthwood/shared';
import { furnitureModel, mat, part } from '../../models.ts';
import { facing, facingTile } from '../targeting.ts';
import { pickGround, stopPaint } from './paint.ts';
import type { World } from '../../World.ts';

export function startBuildGhost(self: World, type: BuildingType) {
  cancelGhost(self);
  stopPaint(self);
  const def = BUILDINGS[type];
  const group = new THREE.Group();
  const box = part('box', mat('#7fe07f', { opacity: 0.45 }), def.w, 0.6, def.h, def.w / 2, 0.3, def.h / 2, false);
  box.name = 'box';
  group.add(box);
  self.scene.add(group);
  self.ghost = { group, type: 'build', building: type, tx: 0, tz: 0, ok: false };
}

/** Pick a building up to move it: its footprint is freed while you choose the new spot. */
export function startMoveGhost(self: World, b: Building) {
  startBuildGhost(self, b.type);
  const g = self.ghost as { moving?: string };
  g.moving = b.id;
  self.grid?.removeBuilding(b);
  const mesh = self.bldMeshes.get(b.id);
  if (mesh) mesh.visible = false;
}

/** Put a building that was being moved back (in the grid and on screen). */
export function endMove(self: World) {
  const id = self.ghost?.type === 'build' ? self.ghost.moving : undefined;
  if (!id) return;
  const b = self.buildings.get(id);
  if (b) self.grid?.addBuilding(b);
  const mesh = self.bldMeshes.get(id);
  if (mesh) mesh.visible = true;
  (self.ghost as { moving?: string }).moving = undefined;
}

export function startPlaceGhost(self: World, item: string) {
  cancelGhost(self);
  stopPaint(self);
  const group = new THREE.Group();
  const f = furnitureModel(item, 0);
  f.position.set(0.5, 0, 0.5);
  f.name = 'model';
  group.add(f);
  const box = part('box', mat('#7fe07f', { opacity: 0.35 }), 1, 0.05, 1, 0.5, 0.03, 0.5, false);
  box.name = 'box';
  group.add(box);
  // Second tile of long furniture (beds).
  const box2 = part('box', mat('#7fe07f', { opacity: 0.35 }), 1, 0.05, 1, 0.5, 0.03, 0.5, false);
  box2.name = 'box2';
  box2.visible = false;
  group.add(box2);
  self.scene.add(group);
  self.ghost = { group, type: 'place', item, rot: 0, tx: 0, tz: 0, ok: false };
}

export function rotateGhost(self: World) {
  if (self.ghost?.type !== 'place') return;
  self.ghost.rot = (self.ghost.rot + 1) % 4;
  const m = self.ghost.group.getObjectByName('model');
  if (m) m.rotation.y = (self.ghost.rot * Math.PI) / 2;
}

export function cancelGhost(self: World) {
  endMove(self);
  if (self.ghost) self.scene.remove(self.ghost.group);
  self.ghost = null;
}

export function updateGhost(self: World) {
  const g = self.ghost;
  if (!g || !self.grid || !self.me) return;
  let tx: number, tz: number, w = 1, h = 1;
  if (g.type === 'build') {
    const def = BUILDINGS[g.building];
    w = def.w;
    h = def.h;
    if (self.padAim) {
      // Controller: put the footprint just in front of the player.
      const { fx, fz } = facing(self);
      const ahead = 1.2 + Math.max(w, h) / 2;
      tx = Math.floor(self.me.x + fx * ahead - w / 2 + 0.5);
      tz = Math.floor(self.me.z + fz * ahead - h / 2 + 0.5);
    } else {
      const hit = pickGround(self);
      if (!hit) return;
      tx = Math.floor(hit.x - w / 2 + 0.5);
      tz = Math.floor(hit.z - h / 2 + 0.5);
    }
  } else {
    const f = facingTile(self);
    tx = f.x;
    tz = f.z;
  }
  g.tx = tx;
  g.tz = tz;
  const cx = tx + w / 2, cz = tz + h / 2;
  const inRange = g.type === 'build' ? Math.hypot(self.me.x - cx, self.me.z - cz) <= 6 : distToTile(self.me.x, self.me.z, tx, tz) <= 2.4;
  const me = self.me;
  const inside = (x: number, z: number, ww: number, hh: number) => me.x > x - 0.3 && me.x < x + ww + 0.3 && me.z > z - 0.3 && me.z < z + hh + 0.3;
  const tiles = g.type === 'place' ? objectTiles({ kind: 'furniture', item: g.item, x: tx, z: tz, rot: g.rot }) : [];
  const meInside = g.type === 'build' ? inside(tx, tz, w, h) : tiles.some(([x, z]) => inside(x, z, 1, 1));
  g.ok = (g.type === 'build' ? placeError(self.grid, g.building, tx, tz) === null : furniturePlaceError(self.grid, g.item, tx, tz, g.rot) === null) && inRange && !meInside;
  g.group.position.set(tx, self.grid.surfaceY(tx + 0.5, tz + 0.5), tz);
  const look = mat(g.ok ? '#7fe07f' : '#ff6b6b', { opacity: 0.45 });
  const box = g.group.getObjectByName('box') as THREE.Mesh;
  box.material = look;
  const box2 = g.group.getObjectByName('box2') as THREE.Mesh | undefined;
  if (box2) {
    box2.visible = tiles.length > 1;
    if (tiles.length > 1) box2.position.set(tiles[1][0] - tx + 0.5, 0.03, tiles[1][1] - tz + 0.5);
    box2.material = look;
  }
}
