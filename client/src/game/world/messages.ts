// Server messages that change the world view (rooms, objects, players, villagers, environment).

import { applyTerrain, type PlayerView, type ServerMessage } from '@hearthwood/shared';
import { state } from '../../state.ts';
import { addPlayer, removeMover } from './entities/players.ts';
import { showCatch } from './entities/sealife.ts';
import { upsertVillager } from './entities/villagers.ts';
import { upsertBuildingMesh, upsertObjectMesh } from './room/objects.ts';
import { scheduleFoliage, schedulePaths, scheduleTerrain } from './room/terrainLayer.ts';
import { refreshVisuals } from './scene/environment.ts';
import { endCast } from './tools/fishing.ts';
import { cancelGhost } from './tools/ghost.ts';
import type { World } from '../World.ts';

export function handle(self: World, m: ServerMessage) {
  if (!self.room) return;
  switch (m.t) {
    case 'board':
      if (self.room) self.room.board = m.posts;
      for (const b of self.buildings.values()) if (b.type === 'billboard') upsertBuildingMesh(self, b);
      break;
    case 'terrain':
      applyTerrain(self.grid!, m.l);
      scheduleTerrain(self);
      break;
    case 'paths':
      for (const [x, z, t] of m.l) self.grid!.paths[z * self.grid!.size + x] = t;
      schedulePaths(self);
      scheduleFoliage(self);
      break;
    case 'oAdd':
      scheduleFoliage(self);
      for (const o of m.o) {
        const prev = self.objects.get(o.id);
        if (prev) self.grid!.removeObject(prev);
        self.objects.set(o.id, o);
        self.grid!.addObject(o);
        upsertObjectMesh(self, o);
      }
      break;
    case 'oDel':
      scheduleFoliage(self);
      for (const id of m.ids) {
        const prev = self.objects.get(id);
        if (prev) self.grid!.removeObject(prev);
        self.objects.delete(id);
        const mesh = self.objMeshes.get(id);
        if (mesh && m.fx === 'fly') self.flying.push({ mesh, t0: self.clock.elapsedTime, dir: Math.random() * Math.PI * 2 });
        else if (mesh) self.world.remove(mesh);
        self.objMeshes.delete(id);
      }
      break;
    case 'bAdd':
      scheduleFoliage(self);
      for (const b of m.b) {
        if (self.ghost?.type === 'build' && self.ghost.moving === b.id) cancelGhost(self); // our move went through
        const prev = self.buildings.get(b.id);
        if (prev) self.grid!.removeBuilding(prev);
        self.buildings.set(b.id, b);
        self.grid!.addBuilding(b);
        upsertBuildingMesh(self, b);
      }
      break;
    case 'bDel':
      scheduleFoliage(self);
      for (const id of m.ids) {
        const prev = self.buildings.get(id);
        if (prev) self.grid!.removeBuilding(prev);
        self.buildings.delete(id);
        const mesh = self.bldMeshes.get(id);
        if (mesh) self.world.remove(mesh);
        self.bldMeshes.delete(id);
      }
      break;
    case 'pAdd':
      addPlayer(self, m.p);
      break;
    case 'pDel': {
      self.footprints.forget(m.id);
      const p = self.players.get(m.id);
      if (p) removeMover(self, p);
      self.players.delete(m.id);
      break;
    }
    case 'pLook': {
      const p = self.players.get(m.id);
      if (!p) break;
      const view = { ...self.room.players.find((x) => x.id === m.id), id: m.id, look: m.look, hat: m.hat } as PlayerView;
      const prevName = p.label.element.textContent ?? '';
      const gender = state.self?.id === m.id ? state.self.gender : (self.room.players.find((x) => x.id === m.id)?.gender ?? 'boy');
      const fresh = addPlayer(self, { ...view, name: prevName, gender, x: p.x, z: p.z, r: p.r });
      fresh.tx = p.tx;
      fresh.tz = p.tz;
      break;
    }
    case 'ps':
      for (const [id, x, z, r] of m.l) {
        if (id === state.self?.id) continue; // we predict ourselves
        const p = self.players.get(id);
        if (p) { p.tx = x; p.tz = z; p.tr = r; }
      }
      break;
    case 'vs':
      for (const [id, x, z, r, home] of m.l) {
        const v = self.villagers.get(id);
        if (!v) continue;
        v.tx = x; v.tz = z; v.tr = r; v.home = home === 1;
        v.rig.root.visible = !v.home;
        if (v.home) { v.x = x; v.z = z; }
      }
      break;
    case 'vAdd':
      for (const v of m.v) upsertVillager(self, v);
      break;
    case 'corr':
      if (self.me) {
        self.me.x = self.me.tx = m.x;
        self.me.z = self.me.tz = m.z;
        self.lastSent.x = m.x;
        self.lastSent.z = m.z;
      }
      break;
    case 'bite':
      if (self.cast && self.cast.id === m.castId) {
        self.cast.bite = true;
        self.cast.window = m.window;
        self.cast.at = performance.now();
      }
      break;
    case 'fish':
      if (self.cast?.id === m.castId) endCast(self);
      if (m.ok && m.item) showCatch(self, m.item);
      break;
    case 'env':
      refreshVisuals(self);
      break;
  }
}
