// What the player is facing and what pressing "use" would do there.

import { atDoor, BUILDINGS, ENTERABLE, isWaterTile, nearBuilding, Tile, villagerDef, type WorldObject } from '@hearthwood/shared';
import { net } from '../../net.ts';
import { state } from '../../state.ts';
import { Target } from './common.ts';
import { objectLabel } from './room/objects.ts';
import type { World } from '../World.ts';

/** How far a line reaches (the server allows 4.5 tiles to the tile). */
const CAST_REACH = 4.2;

export function facing(self: World) {
  const r = self.me?.r ?? 0;
  return { fx: Math.sin(r), fz: Math.cos(r) };
}

export function facingTile(self: World) {
  const { fx, fz } = facing(self);
  return { x: Math.floor(self.me!.x + fx * 0.9), z: Math.floor(self.me!.z + fz * 0.9) };
}

export function computeTarget(self: World): Target | null {
  if (!self.me || !self.grid || !self.room) return null;
  if (self.cast) return { kind: 'reel', label: self.cast.bite ? '❗ Reel in!' : 'Reel in (wait for a bite…)' };
  const { fx, fz } = facing(self);
  const px = self.me.x, pz = self.me.z;
  let best: Target | null = null;
  let bestScore = Infinity;
  const consider = (t: Target, dx: number, dz: number, maxD: number) => {
    const d = Math.hypot(dx, dz);
    if (d > maxD) return;
    const dot = d > 0.01 ? (dx * fx + dz * fz) / d : 1;
    if (dot < -0.2) return;
    const score = d - dot * 0.8;
    if (score < bestScore) { bestScore = score; best = t; }
  };
  const owner = self.room.canHarvest;
  for (const o of self.objects.values()) {
    const dx = o.x + 0.5 - px, dz = o.z + 0.5 - pz;
    if (Math.abs(dx) > 2.5 || Math.abs(dz) > 2.5) continue;
    const label = objectLabel(self, o, owner);
    if (label) consider({ kind: 'object', o, label }, dx, dz, 1.85);
  }
  for (const [id, v] of self.villagers) {
    if (v.home) continue;
    const def = villagerDef(id)!;
    consider({ kind: 'villager', id, label: `Talk to ${def.name}` }, v.x - px, v.z - pz, 2.2);
  }
  for (const b of self.buildings.values()) {
    if (BUILDINGS[b.type].decor || !nearBuilding(b, px, pz, 1.7)) continue;
    const done = b.completeAt <= net.serverNow();
    const def = BUILDINGS[b.type];
    const label = !done ? `${def.name} (under construction)`
      : b.type === 'dock' ? (self.room.kind === 'tour' ? 'Sail home' : 'Travel')
      : b.type === 'villager_house' && b.villagerId ? `Visit ${villagerDef(b.villagerId)?.name ?? 'their'}’s house`
      : ENTERABLE.includes(b.type) ? `Enter ${def.name}`
      : b.type === 'counter' ? (b.role === 'town_hall' ? 'Talk to the mayor’s desk' : b.role === 'restaurant' ? 'Use the kitchen' : b.role === 'travel_agent' ? 'Plan a trip' : 'Ring the bell')
      : b.type === 'exit' ? 'Go outside'
      : b.type === 'bed' ? 'Rest'
      : b.type === 'chest' ? 'Open storage chest'
      : b.type === 'mailbox' ? (self.room.kind === 'shared' ? 'Send a letter' : self.room.ownerId === state.self?.id ? `Check mailbox${state.mail.length ? ` (${state.mail.length})` : ''}` : `Leave ${self.room.ownerName ?? 'them'} a letter`)
      : b.type === 'billboard' ? `Read the billboard${self.room.board?.length ? ` (${self.room.board.length})` : ''}`
      : `Use ${def.name}`;
    // You only go in through the door: enterable buildings are a target only from in front of it.
    if (done && ENTERABLE.includes(b.type)) {
      if (atDoor(b, px, pz)) consider({ kind: 'building', b, label }, b.x + b.w / 2 - px, b.z + b.h - pz, 1.6);
      continue;
    }
    const cx = Math.max(b.x, Math.min(px, b.x + b.w)), cz = Math.max(b.z, Math.min(pz, b.z + b.h));
    consider({ kind: 'building', b, label }, cx - px, cz - pz, 1.8);
  }
  if (best) return best;
  // Water in front → fishing.
  if ((state.inv.fishing_rod || state.inv.pro_rod)) {
    // Fish only bite at a fish shadow: aim at the nearest one in front of you.
    let spot: WorldObject | null = null;
    let sd = Infinity;
    for (const o of self.objects.values()) {
      if (o.kind !== 'fish') continue;
      const dx = o.x + 0.5 - px, dz = o.z + 0.5 - pz, d = Math.hypot(dx, dz);
      if (d < 0.3 || d > CAST_REACH || (dx * fx + dz * fz) / d < 0.55) continue;
      if (d < sd) { sd = d; spot = o; }
    }
    if (spot) return { kind: 'water', x: spot.x, z: spot.z, label: `Cast at the ${spot.size ?? 'medium'} fish shadow` };
    for (const d of [1.2, 2, 2.8]) {
      const tx = Math.floor(px + fx * d), tz = Math.floor(pz + fz * d);
      if (isWaterTile(self.grid.tile(tx, tz)) && self.grid.tile(tx, tz) !== Tile.Dock) return { kind: 'water', x: tx, z: tz, label: 'No fish here – look for a shadow in the water', empty: true };
    }
  }
  if (self.tool === 'sapling' && self.room.canBuild && (state.inv.sapling ?? 0) > 0) {
    const f = facingTile(self);
    if (self.grid.canPlace(f.x, f.z)) return { kind: 'plant', x: f.x, z: f.z, label: 'Plant sapling' };
  }
  return null;
}
