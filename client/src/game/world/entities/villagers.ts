// Villagers walking about (interpolated from the server) and birds hopping.

import { villagerDef, type VillagerView } from '@hearthwood/shared';
import { makeVillager } from '../../characters.ts';
import { makeLabel, swing } from './players.ts';
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
    m = { rig, label, x: v.x, z: v.z, r: v.r, tx: v.x, tz: v.z, tr: v.r, speed: 0, swing: 0, home: v.home, houseId: v.houseId };
    self.villagers.set(v.id, m);
  }
  m.tx = v.x;
  m.tz = v.z;
  m.tr = v.r;
  m.home = v.home;
  m.rig.root.visible = !v.home;
}

export function villagerPos(self: World, id: string) {
  const v = self.villagers.get(id);
  return v ? { x: v.x, z: v.z, home: v.home } : null;
}

export function animateBirds(self: World, t: number) {
  for (const [id, mesh] of self.objMeshes) {
    if (!mesh.userData.bird) continue;
    const ph = (id.charCodeAt(id.length - 1) % 9) * 0.7;
    const body = mesh.getObjectByName('body');
    const head = mesh.getObjectByName('head');
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
      self.flying.splice(i, 1);
      continue;
    }
    f.mesh.position.x += Math.sin(f.dir) * 0.08;
    f.mesh.position.z += Math.cos(f.dir) * 0.08;
    f.mesh.position.y += 0.06 + k * 0.04;
    f.mesh.rotation.y = f.dir;
    const flap = Math.sin(t * 40) * 0.9;
    const l = f.mesh.getObjectByName('wingL'), r = f.mesh.getObjectByName('wingR');
    if (l) l.rotation.z = flap;
    if (r) r.rotation.z = -flap;
  }
}
