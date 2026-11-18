// Players: rigs and name labels, interpolation of others, local movement prediction,
// wading ripples, tool swings and speech bubbles.

import * as THREE from 'three';
import { type PlayerView, SEA_LEVEL, slideMove, wrapAngle } from '@hearthwood/shared';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { net } from '../../../net.ts';
import { state } from '../../../state.ts';
import { bendDrop } from '../../bend.ts';
import { disposeTree } from '../../gpu.ts';
import { animateRig, setTool } from '../../characters.ts';
import { makePlayer } from '../../player.ts';
import { act, drive } from '../../villagerModels.ts';
import type { Rig } from '../../characters.ts';
import { mat } from '../../models.ts';
import { Mover, PLAYER_SPEED, round2 } from '../common.ts';
import { endCast } from '../tools/fishing.ts';
import type { World } from '../../World.ts';

export function makeLabel(self: World, text: string, cls = '') {
  const div = document.createElement('div');
  div.className = `label3d ${cls}`;
  div.textContent = text;
  return new CSS2DObject(div);
}

export function addPlayer(self: World, p: PlayerView) {
  const existing = self.players.get(p.id);
  if (existing) removeMover(self, existing);
  const rig = makePlayer(p.gender, p.look, p.outfit ?? p.hat);
  const label = makeLabel(self, p.name);
  label.position.set(0, 1.55, 0);
  rig.root.add(label);
  rig.root.traverse((c: THREE.Object3D) => (c.castShadow = true));
  self.world.add(rig.root);
  const m: Mover = { rig, label, x: p.x, z: p.z, r: p.r, tx: p.x, tz: p.z, tr: p.r, speed: 0, swing: 0 };
  self.players.set(p.id, m);
  if (p.id === state.self?.id) self.me = m;
  return m;
}

export function removeMover(self: World, m: Mover) {
  m.label.element.remove();
  m.rig.root.removeFromParent();
  disposeTree(m.rig.root); // the model's own materials and its merged skin
}

export function interp(self: World, m: Mover, dt: number) {
  const a = 1 - Math.exp(-dt * 10);
  const px = m.x, pz = m.z;
  m.x += (m.tx - m.x) * a;
  m.z += (m.tz - m.z) * a;
  if (Math.hypot(m.tx - m.x, m.tz - m.z) > 6) { m.x = m.tx; m.z = m.tz; }
  let diff = m.tr - m.r;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  m.r = wrapAngle(m.r + diff * a);
  m.speed = Math.hypot(m.x - px, m.z - pz) / Math.max(dt, 0.001);
  m.swing = Math.max(0, m.swing - dt * 2.5);
  m.rig.root.position.set(m.x, groundY(self, m.x, m.z), m.z);
  m.rig.root.rotation.y = m.r;
  wadeRipple(self, m.rig.root, m.speed);
  bendLabel(self, m);
  if (!m.rig.model) animateRig(m.rig, dt, m.speed, m.swing); // (the box rig, until the model has loaded)
  driveModel(m.rig, dt, m.speed, m.swing, false);
}

/** Blender players: walk / run with the speed, a clip per tool action, fishing. */
function driveModel(rig: Rig, dt: number, speed: number, swing: number, fishing: boolean, net = false) {
  const vm = rig.model;
  if (!vm) return;
  if (swing > (rig.lastSwing ?? 0) + 0.2) {
    const kind = rig.tool.userData.kind as string | undefined;
    act(vm, kind === 'axe' ? 'chop' : kind === 'shovel' ? 'dig' : net ? 'net' : 'pickup');
  }
  rig.lastSwing = swing;
  // the rod is modelled for a hanging arm; the fishing pose holds the arm out in front
  rig.tool.rotation.x = String(rig.tool.userData.kind ?? '').startsWith('rod') ? 0.85 : 0;
  drive(vm, dt, { speed, rain: false, now: Date.now(), fishing, walkRef: 2.6, runAt: 3.3, walkClip: 'pwalk', runClip: 'prun' });
}

const NO_KEYS: ReadonlySet<string> = new Set<string>();

export function updateLocal(self: World, dt: number) {
  const me = self.me!;
  let dx = 0, dz = 0;
  const k = self.hold || self.stepping ? NO_KEYS : self.keys;
  if (self.stepping) {
    // Walking out of the front door: scripted, and nothing is sent until we're on the doorstep.
    const st = self.stepping;
    if (!self.hold) st.t = Math.min(st.dur, st.t + dt); // waits behind the loading screen
    const z = st.z0 + (st.z1 - st.z0) * (st.t / st.dur);
    me.speed = Math.abs(z - me.z) / Math.max(dt, 0.001);
    me.z = z;
    me.r = 0;
    if (st.t >= st.dur) self.stepping = null;
    me.rig.root.position.set(me.x, groundY(self, me.x, me.z), me.z);
    me.rig.root.rotation.y = me.r;
    bendLabel(self, me);
    if (!me.rig.model) animateRig(me.rig, dt, me.speed, 0);
    driveModel(me.rig, dt, me.speed, 0, false);
    return;
  }
  if (k.has('KeyW') || k.has('ArrowUp')) dz -= 1;
  if (k.has('KeyS') || k.has('ArrowDown')) dz += 1;
  if (k.has('KeyA') || k.has('ArrowLeft')) dx -= 1;
  if (k.has('KeyD') || k.has('ArrowRight')) dx += 1;
  let amount = 1;
  let running = k.has('ShiftLeft') || k.has('ShiftRight');
  const am = Math.hypot(self.analog.x, self.analog.z);
  if (am > 0 && !dx && !dz && !self.hold) {
    dx = self.analog.x;
    dz = self.analog.z;
    amount = Math.max(0.35, Math.min(1, am));
    running = self.analog.run;
  }
  const len = Math.hypot(dx, dz);
  if (self.cast && len > 0) {
    endCast(self); // walking away cancels fishing
  }
  if (len > 0) {
    dx /= len; dz /= len;
    const run = (running ? 1 : 0.62) * amount;
    const step = PLAYER_SPEED * run * dt;
    const res = slideMove(self.grid!, me.x, me.z, dx * step, dz * step);
    // (dt can be 0 with a coarse browser clock: keep the last speed then, never 0/0)
    if (dt > 0) me.speed = Math.hypot(res.x - me.x, res.z - me.z) / dt;
    me.x = res.x;
    me.z = res.z;
    const want = Math.atan2(dx, dz);
    let diff = want - me.r;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    me.r = wrapAngle(me.r + diff * Math.min(1, dt * 14));
  } else me.speed = 0;
  me.rig.root.position.set(me.x, groundY(self, me.x, me.z), me.z);
  me.rig.root.rotation.y = me.r;
  wadeRipple(self, me.rig.root, me.speed);
  bendLabel(self, me);
  me.swing = Math.max(0, me.swing - dt * 2.5);
  if (!me.rig.model) animateRig(me.rig, dt, me.speed, me.swing);
  driveModel(me.rig, dt, me.speed, me.swing, !!self.cast, self.tool === 'net');
  setTool(me.rig, self.tool === 'axe' && (state.inv.stone_axe || state.inv.iron_axe) ? 'axe' : self.tool === 'shovel' && (state.inv.shovel || state.inv.iron_shovel) ? 'shovel' : self.cast ? (state.inv.pro_rod ? 'rod_pro' : 'rod') : null);

  const now = performance.now();
  const moved = Math.hypot(me.x - self.lastSent.x, me.z - self.lastSent.z) > 0.01 || Math.abs(me.r - self.lastSent.r) > 0.05;
  if (moved && now - self.lastSent.at >= 100) {
    self.lastSent = { x: me.x, z: me.z, r: me.r, at: now };
    net.send({ t: 'move', seq: net.nextSeq(), x: round2(me.x), z: round2(me.z), r: round2(me.r) });
  }
}

/** A ring of foam where a wading character meets the sea surface. */
const WADE_RING = new THREE.RingGeometry(0.24, 0.34, 20).rotateX(-Math.PI / 2);

export function wadeRipple(self: World, root: THREE.Object3D, speed: number) {
  let ring = root.userData.wade as THREE.Mesh | undefined;
  const depth = SEA_LEVEL - root.position.y;
  if (depth < 0.03 || self.room?.kind === 'interior') {
    if (ring) ring.visible = false;
    return;
  }
  if (!ring) {
    ring = new THREE.Mesh(WADE_RING, mat('#ffffff', { opacity: 0.6 }));
    ring.name = 'wade';
    root.userData.wade = ring;
    root.add(ring);
  }
  ring.visible = true;
  ring.position.y = depth + 0.01;
  const s = 1 + Math.min(1, speed / 3) * 0.35 + Math.sin(performance.now() / 260) * 0.06;
  ring.scale.set(s, 1, s);
}

export function swing(self: World) {
  if (self.me) self.me.swing = 1;
}

/** Show a speech bubble above a villager for a few seconds. */
export function say(self: World, id: string, text: string) {
  const v = self.villagers.get(id);
  if (!v) return;
  const div = document.createElement('div');
  div.className = 'bubble';
  div.textContent = text;
  const o = new CSS2DObject(div);
  o.position.set(0, 2.0, 0);
  v.rig.root.add(o);
  setTimeout(() => {
    o.element.remove();
    o.removeFromParent();
  }, 4000);
}

/** Labels are HTML, so the world bend is applied to them on the CPU. */
export function bendLabel(self: World, m: Mover) {
  m.label.position.y = 1.55 - (self.room?.kind === 'interior' ? 0 : bendDrop(m.z));
}

export function groundY(self: World, x: number, z: number) {
  if (!self.grid) return 0;
  return self.grid.surfaceY(x, z); // can dip below 0: beaches and wading
}
