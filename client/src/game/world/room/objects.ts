// Meshes for world objects and buildings, their hover labels, and props that move
// (swaying lamps, flags, smoke…).

import * as THREE from 'three';
import { baseHeight, BIOMES, BIRD_BY_ID, type Building, CLIFF, houseLevel, ITEMS, Tile, TREES, type WorldObject } from '@hearthwood/shared';
import { net } from '../../../net.ts';
import { state } from '../../../state.ts';
import { animateRig, makeVillager, type Rig } from '../../characters.ts';
import { buildingModel, objectModel } from '../../models.ts';
import { shopkeeper, WATER_Y } from '../common.ts';
import { SHADOW_SWIM } from '../../models/fish.ts';
import { animateBirds } from '../entities/villagers.ts';
import { currentVisual } from '../scene/environment.ts';
import type { World } from '../../World.ts';

export function upsertObjectMesh(self: World, o: WorldObject) {
  const prev = self.objMeshes.get(o.id);
  if (prev) self.world.remove(prev);
  if (!self.room) return;
  const def = BIOMES[self.room.biome];
  const { season, vs, snowy } = currentVisual(self);
  const mesh = objectModel(o, season, vs, snowy, def.bushColor, def.bushItem);
  // Wall-mounted decor sits on the wall tile but is placed from floor level.
  const wallDecor = o.kind === 'decor' && o.item?.startsWith('w_');
  const y = o.kind === 'fish' ? shadowY(self, o) : wallDecor ? baseHeight(Tile.Floor) : self.grid!.surfaceY(o.x + 0.5, o.z + 0.5);
  mesh.position.set(o.x + 0.5, y, o.z + 0.5);
  mesh.traverse((c: THREE.Object3D) => (c.userData.objId = o.id));
  self.world.add(mesh);
  self.objMeshes.set(o.id, mesh);
}

/** Fish shadows swim just under the surface – never through the bed of shallow water. */
function shadowY(self: World, o: WorldObject) {
  const surface = WATER_Y + (self.grid!.level(o.x, o.z) ?? 0) * CLIFF;
  const bed = self.grid!.surfaceY(o.x + 0.5, o.z + 0.5);
  const depth = SHADOW_SWIM[o.size ?? 'medium'].depth;
  return Math.min(surface - 0.05, Math.max(bed + depth * 0.8, surface - depth - 0.1));
}

/** Changes whenever a house looks different (new tier, scaffolding up or down). */
function houseKey(b: Building, now: number) {
  return `${houseLevel(b, now)}${b.upgrade && b.upgrade.at > now ? '+' : ''}`;
}

export function upsertBuildingMesh(self: World, b: Building) {
  const prev = self.bldMeshes.get(b.id);
  if (prev) self.world.remove(prev);
  const flagUp = b.type === 'mailbox' && self.room?.ownerId === state.self?.id && state.mail.length > 0;
  const notes = b.type === 'billboard' ? state.room?.board?.length ?? 0 : 0;
  const mesh = buildingModel(b, net.serverNow(), self.room?.interior === 'tent' ? 'tent' : 'cabin', { flagUp, notes });
  const y = b.type === 'dock' ? 0 : self.room?.kind === 'interior' ? baseHeight(Tile.Floor) : baseHeight(Tile.Ground) + (self.grid?.level(b.x, b.z) ?? 0) * CLIFF;
  mesh.position.set(b.x + b.w / 2, y, b.z + b.h / 2);
  mesh.userData.done = b.completeAt <= net.serverNow();
  if (b.type === 'cabin') mesh.userData.house = houseKey(b, net.serverNow());
  // Someone to serve you behind every counter.
  if (b.type === 'counter') {
    const keeper = makeVillager(shopkeeper(b.role));
    keeper.root.position.set(0, 0, -0.85);
    keeper.root.name = 'keeper';
    mesh.add(keeper.root);
    mesh.userData.keeper = keeper;
  }
  self.world.add(mesh);
  self.bldMeshes.set(b.id, mesh);
}

export function objectLabel(self: World, o: WorldObject, owner: boolean): string | null {
  switch (o.kind) {
    case 'tree': {
      const name = TREES[o.species ?? 'oak'].name;
      if ((o.stage ?? 2) < 2) return owner ? `${name} (growing)` : null;
      if (!owner) return null;
      return self.tool === 'axe' && (state.inv.stone_axe || state.inv.iron_axe) ? `Chop ${name}` : `Shake ${name}`;
    }
    case 'stump': return owner ? 'Dig up stump' : null;
    case 'rock': return owner ? 'Break rock' : null;
    case 'bush': return owner ? (o.ripe ? `Pick ${ITEMS[BIOMES[self.room!.biome].bushItem].name}` : 'Gather (nothing ripe)') : null;
    case 'mushroom': return owner ? `Pick ${o.rare ? 'Glowcap' : 'mushroom'}` : null;
    case 'flower': return owner ? 'Pick flower' : null;
    case 'washed':
      if (o.bottle) return self.room!.ownerId === state.self?.id ? '🍾 Open the message in a bottle' : '🍾 A message in a bottle';
      return owner ? `Pick up ${ITEMS[o.item ?? '']?.name ?? 'it'}` : null;
    case 'furniture': return self.room!.canDecorate ? `Pick up ${ITEMS[o.item!]?.name ?? 'item'} (F)` : null;
    case 'decor': return null;
    case 'fish': return null; // fished at via the water (targeting.ts)
    case 'bird': {
      const name = BIRD_BY_ID[o.bird ?? '']?.name ?? 'bird';
      const net = state.inv.bird_net || state.inv.silk_net;
      return self.tool === 'net' && net ? `Catch ${name}` : net ? `${name} (select the net)` : `${name} (craft a bird net)`;
    }
  }
}

export function animateProps(self: World, t: number) {
  animateBirds(self, t);
  const night = 1 - self.day;
  for (const mesh of self.bldMeshes.values()) {
    const beam = mesh.getObjectByName('beam');
    if (beam) {
      beam.rotation.y = t * 0.9;
      const bm = (beam.children[0] as THREE.Mesh).material as THREE.MeshBasicMaterial;
      bm.opacity = night * 0.22;
      const ll = mesh.getObjectByName('lighthouse-light') as THREE.PointLight | undefined;
      if (ll) ll.intensity = night * 6;
    }
    const keeper = mesh.userData.keeper as Rig | undefined;
    if (keeper) animateRig(keeper, 0.016, 0, 0);
    const spout = mesh.getObjectByName('spout');
    if (spout) spout.scale.y = 0.35 + Math.sin(t * 6) * 0.05;
    const flame = mesh.getObjectByName('flame');
    if (flame) {
      flame.scale.y = 0.45 + Math.sin(t * 13) * 0.06 + Math.sin(t * 7.3) * 0.04;
      const l = mesh.getObjectByName('firelight') as THREE.PointLight | undefined;
      if (l) l.intensity = 1.6 + Math.sin(t * 11) * 0.3 + (1 - self.day) * 2.5;
    }
  }
  // Hanging chairs sway a little.
  for (const [id, mesh] of self.objMeshes) {
    const swing = mesh.getObjectByName('swing');
    if (swing) swing.rotation.x = Math.sin(t * 0.9 + (id.charCodeAt(id.length - 1) % 5)) * 0.045;
  }
  // Moored boats bob on the swell.
  for (const [id, mesh] of self.objMeshes) {
    const boat = mesh.getObjectByName('boat');
    if (!boat) continue;
    const ph = (id.charCodeAt(id.length - 1) % 7) * 0.9;
    boat.position.y = Math.sin(t * 1.3 + ph) * 0.03;
    boat.rotation.z = Math.sin(t * 1.1 + ph) * 0.04;
    boat.rotation.x = Math.sin(t * 0.8 + ph) * 0.025;
  }
  // Buildings finishing construction while we watch.
  const now = net.serverNow();
  for (const [id, mesh] of self.bldMeshes) {
    const b = self.buildings.get(id);
    if (b && !mesh.userData.done && b.completeAt <= now) upsertBuildingMesh(self, b);
    else if (b?.type === 'cabin' && mesh.userData.house !== houseKey(b, now)) upsertBuildingMesh(self, b);
  }
}
