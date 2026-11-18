// The ground layers of a room: terrain mesh (with docks, stairs, water), paths and
// foliage, rebuilt (debounced) when the terrain changes; the debug grid overlay.

import * as THREE from 'three';
import { bend } from '../../bend.ts';
import { disposeAll } from '../../gpu.ts';
import { mergeStatic } from '../../merge.ts';
import { buildFoliage, disposeFoliage } from '../../foliage.ts';
import { buildPaths, disposePaths } from '../../paths.ts';
import { buildPuddles, disposePuddles } from '../../puddles.ts';
import { buildDocks, buildTerrainMesh, invalidateTerrainCache, waterColor } from '../../terrain.ts';
import { buildDockModels, buildStairs } from '../../tileAssets.ts';
import { buildWater, seaColor } from '../../water.ts';
import { currentVisual } from '../scene/environment.ts';
import { anySnow } from '../../groundLook.ts';
import { upsertObjectMesh } from './objects.ts';
import type { World } from '../../World.ts';

export function buildTerrain(self: World) {
  if (!self.room || !self.grid) return;
  if (self.terrain) {
    self.world.remove(self.terrain);
    disposeAll(self.terrain); // with its water, docks and stairs
  }
  const v = currentVisual(self);
  const m = buildTerrainMesh(self.grid, { biome: self.room.biome, season: v.season, vs: v.vs, snowy: v.snowy, interior: self.room.interior, theme: self.room.theme }, v.look);
  // Boardwalks, piers and stairs ride along with the terrain mesh; they are put
  // together from one model per tile, so each set is baked into a few meshes.
  const docks = buildDockModels(self.grid);
  if (docks) mergeStatic(docks);
  m.add(docks ?? buildDocks(self.grid));
  const stairs = buildStairs(self.grid);
  mergeStatic(stairs);
  m.add(stairs);
  self.waterFx = self.room.kind !== 'interior' ? buildWater(self.grid, waterColor(self.room.biome)) : null; // depth, rivers, waterfalls, surf
  if (self.waterFx) m.add(self.waterFx);
  self.terrain = m;
  self.world.add(m);
  (self.water.material as THREE.MeshStandardMaterial).color.set(seaColor(waterColor(self.room.biome)));
}

/** Terraforming: rebuild the terrain mesh (and what sits on it) once a burst of edits settles. */
export function scheduleTerrain(self: World) {
  if (self.terrainTimer) clearTimeout(self.terrainTimer);
  self.terrainTimer = setTimeout(() => {
    self.terrainTimer = null;
    if (self.grid) invalidateTerrainCache(self.grid);
    buildTerrain(self);
    rebuildPaths(self, false);
    rebuildFoliage(self);
    for (const o of self.objects.values()) upsertObjectMesh(self, o);
    if (self.gridOverlay) toggleGridOverlay(self, true);
  }, 70);
}

/** `snow`: also re-lay the snow layer round the paths (not needed when the terrain was just rebuilt). */
export function rebuildPaths(self: World, snow = true) {
  if (!self.grid) return;
  if (self.pathLayer) {
    self.world.remove(self.pathLayer);
    disposePaths(self.pathLayer);
  }
  self.pathLayer = buildPaths(self.grid);
  self.world.add(self.pathLayer);
  rebuildPuddles(self); // puddles keep off paths
  if (snow && anySnow(currentVisual(self).look)) buildTerrain(self); // the snow layer is cleared off paths
}

export function schedulePaths(self: World) {
  if (self.pathTimer) return;
  self.pathTimer = setTimeout(() => {
    self.pathTimer = null;
    rebuildPaths(self);
  }, 60);
}

export function rebuildFoliage(self: World) {
  if (!self.grid || !self.room) return;
  if (self.foliage) {
    self.world.remove(self.foliage);
    disposeFoliage(self.foliage);
    self.foliage = null;
  }
  if (self.room.kind === 'interior') return;
  self.foliage = buildFoliage(self.grid, self.room.biome, currentVisual(self).look, self.objects.values());
  self.world.add(self.foliage);
  rebuildPuddles(self); // puddles keep clear of what grows and stands on the ground
}

/** Rain puddles on the open ground (see puddles.ts); they fill and dry with the weather. */
export function rebuildPuddles(self: World) {
  if (self.puddles) {
    self.world.remove(self.puddles);
    disposePuddles(self.puddles);
    self.puddles = null;
  }
  if (!self.grid || !self.room || self.room.kind === 'interior') return;
  self.puddles = buildPuddles(self.grid, self.room.id);
  if (self.puddles) self.world.add(self.puddles);
}

/** Debounced: many world changes can arrive in a burst. */
export function scheduleFoliage(self: World, ms = 400) {
  if (self.foliageTimer) clearTimeout(self.foliageTimer);
  self.foliageTimer = setTimeout(() => rebuildFoliage(self), ms);
}

export function toggleGridOverlay(self: World, on: boolean) {
  if (self.gridOverlay) {
    self.scene.remove(self.gridOverlay);
    self.gridOverlay = null;
  }
  if (!on || !self.grid) return;
  const g = new THREE.Group();
  const geo = new THREE.PlaneGeometry(0.9, 0.9);
  geo.rotateX(-Math.PI / 2);
  const mats = {
    blocked: bend(new THREE.MeshBasicMaterial({ color: '#ff3b3b', transparent: true, opacity: 0.45, depthWrite: false })),
    reserved: bend(new THREE.MeshBasicMaterial({ color: '#ffd23b', transparent: true, opacity: 0.45, depthWrite: false })),
    ramp: bend(new THREE.MeshBasicMaterial({ color: '#3b8bff', transparent: true, opacity: 0.45, depthWrite: false })),
  };
  for (let z = 0; z < self.grid.size; z++)
    for (let x = 0; x < self.grid.size; x++) {
      const i = z * self.grid.size + x;
      const kind = self.grid.ramp(x, z) >= 0 ? 'ramp' : self.grid.blocked[i] ? 'blocked' : self.grid.reserved[i] ? 'reserved' : null;
      if (!kind) continue;
      const m = new THREE.Mesh(geo, mats[kind]);
      m.position.set(x + 0.5, self.grid.surfaceY(x + 0.5, z + 0.5) + 0.03, z + 0.5);
      g.add(m);
    }
  self.gridOverlay = g;
  self.scene.add(g);
}
