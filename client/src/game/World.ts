// The 3D island view: rendering, local prediction, interpolation of other
// players and villagers, day/night lighting and weather.

import * as THREE from 'three';
import { CSS2DRenderer, CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import {
  BIOMES, BUILDINGS, ITEMS, Grid, Tile, TREES, CLIFF, ENTERABLE, daylight, decodeTiles, distToTile, isWaterTile, nearBuilding,
  slideMove, sunPosition, villagerDef, visualSeason, hashString, baseHeight, wrapAngle,
  type Building, type EnvView, type PlayerView, type RoomView, type ServerMessage, type VillagerView, type WorldObject, type BuildingType, type Weather, type Season,
} from '@hearthwood/shared';
import { bend, bendDrop, bendFocusZ, bendStrength } from './bend.ts';
import { buildTerrainMesh, waterColor } from './terrain.ts';
import { animateRig, makePlayer, makeVillager, setHat, setTool, type Rig } from './characters.ts';
import { buildingModel, furnitureModel, mat, objectModel, part } from './models.ts';
import { net } from '../net.ts';
import { state } from '../state.ts';

export const PLAYER_SPEED = 4.2;

export type Tool = 'hand' | 'axe' | 'shovel' | 'rod' | 'sapling';

export type Target =
  | { kind: 'object'; o: WorldObject; label: string }
  | { kind: 'villager'; id: string; label: string }
  | { kind: 'building'; b: Building; label: string }
  | { kind: 'water'; x: number; z: number; label: string }
  | { kind: 'plant'; x: number; z: number; label: string }
  | { kind: 'reel'; label: string };

interface Mover {
  rig: Rig;
  label: CSS2DObject;
  x: number;
  z: number;
  r: number;
  tx: number;
  tz: number;
  tr: number;
  speed: number;
  swing: number;
}

const WATER_Y = -0.12;

/** Client-only debug switches (see the F3 debug menu). */
export const debug = {
  bend: 0.0085,
  timeOffsetH: 0, // shift the sun (visual only)
  weather: null as Weather | null, // visual override
  season: null as Season | null, // visual override
  shadows: true,
  labels: true,
  grid: false,
  fps: 0,
};

export class World {
  readonly renderer: THREE.WebGLRenderer;
  readonly labels: CSS2DRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(38, 1, 0.1, 400);
  private sun = new THREE.DirectionalLight('#fff4dc', 2);
  private moon = new THREE.DirectionalLight('#9db7ff', 0.3);
  private hemi = new THREE.HemisphereLight('#d8f0ff', '#6b8f4a', 0.6);
  private stars: THREE.Points;
  private aurora: THREE.Group;
  private water: THREE.Mesh;
  private terrain: THREE.Mesh | null = null;
  private world = new THREE.Group();
  private objMeshes = new Map<string, THREE.Object3D>();
  private bldMeshes = new Map<string, THREE.Object3D>();
  readonly players = new Map<string, Mover>();
  private villagers = new Map<string, Mover & { home: boolean; houseId: string }>();
  private rain: THREE.Points;
  private rainVel: Float32Array;
  private flash = 0;

  room: RoomView | null = null;
  grid: Grid | null = null;
  objects = new Map<string, WorldObject>();
  buildings = new Map<string, Building>();
  me: Mover | null = null;
  tool: Tool = 'hand';
  keys = new Set<string>();
  target: Target | null = null;
  private lastSent = { x: 0, z: 0, r: 0, at: 0 };
  private camDist = 13;
  private seasonKey = '';
  private clock = new THREE.Clock();
  private bobber: THREE.Mesh;
  cast: { id: string | null; x: number; z: number; bite: boolean; window: number; at: number } | null = null;
  ghost: { group: THREE.Group; type: 'build'; building: BuildingType; tx: number; tz: number; ok: boolean } | { group: THREE.Group; type: 'place'; item: string; rot: number; tx: number; tz: number; ok: boolean } | null = null;
  private mouse = new THREE.Vector2(-9, -9);
  private raycaster = new THREE.Raycaster();
  private groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.12);

  onTarget: (t: Target | null) => void = () => {};
  onGhostClick: () => void = () => {};

  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);
    this.labels = new CSS2DRenderer();
    this.labels.domElement.style.position = 'absolute';
    this.labels.domElement.style.inset = '0';
    this.labels.domElement.style.pointerEvents = 'none';
    container.appendChild(this.labels.domElement);

    this.scene.background = new THREE.Color('#8fd3f4');
    this.scene.fog = new THREE.Fog('#8fd3f4', 40, 120);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -22; sc.right = 22; sc.top = 22; sc.bottom = -22; sc.near = 1; sc.far = 90;
    // Bias + normal offset keep surfaces from shadowing themselves ("shadow acne" stripes).
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.03;
    this.scene.add(this.sun, this.sun.target, this.moon, this.moon.target, this.hemi, this.world);

    // Ocean.
    // Finely subdivided so it can follow the world bend; it travels with the player.
    const wg = new THREE.PlaneGeometry(220, 220, 110, 110);
    wg.rotateX(-Math.PI / 2);
    this.water = new THREE.Mesh(wg, bend(new THREE.MeshStandardMaterial({ color: '#4fb7d8', transparent: true, opacity: 0.82, roughness: 0.25, metalness: 0.05 })));
    this.water.position.y = WATER_Y;
    this.water.receiveShadow = true;
    this.scene.add(this.water);

    // Stars.
    const sp = new Float32Array(900 * 3);
    for (let i = 0; i < 900; i++) {
      const th = Math.random() * Math.PI * 2;
      const ph = Math.acos(Math.random() * 0.9);
      sp[i * 3] = Math.sin(ph) * Math.cos(th) * 150;
      sp[i * 3 + 1] = Math.cos(ph) * 150;
      sp[i * 3 + 2] = Math.sin(ph) * Math.sin(th) * 150;
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: '#ffffff', size: 1.2, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false }));
    this.scene.add(this.stars);

    // Aurora ribbons.
    this.aurora = new THREE.Group();
    for (let i = 0; i < 3; i++) {
      const g = new THREE.PlaneGeometry(160, 26, 40, 1);
      const pos = g.attributes.position as THREE.BufferAttribute;
      for (let v = 0; v < pos.count; v++) pos.setZ(v, Math.sin(pos.getX(v) * 0.06 + i) * 10);
      const m = new THREE.MeshBasicMaterial({ color: i === 1 ? '#7dffb2' : '#3cf0a0', transparent: true, opacity: 0, side: THREE.DoubleSide, fog: false, depthWrite: false, blending: THREE.AdditiveBlending });
      const mesh = new THREE.Mesh(g, m);
      mesh.position.set(0, 55 + i * 6, -110 - i * 8);
      mesh.rotation.x = -0.25;
      this.aurora.add(mesh);
    }
    this.scene.add(this.aurora);

    // Weather particles.
    const N = 1600;
    const rp = new Float32Array(N * 3);
    this.rainVel = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      rp[i * 3] = (Math.random() - 0.5) * 40;
      rp[i * 3 + 1] = Math.random() * 20;
      rp[i * 3 + 2] = (Math.random() - 0.5) * 40;
      this.rainVel[i] = 0.7 + Math.random() * 0.6;
    }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.BufferAttribute(rp, 3));
    this.rain = new THREE.Points(rg, bend(new THREE.PointsMaterial({ color: '#cfe8ff', size: 0.08, transparent: true, opacity: 0.8, depthWrite: false })));
    this.rain.visible = false;
    this.rain.frustumCulled = false;
    this.scene.add(this.rain);

    this.bobber = part('sphere', mat('#e53935'), 0.1, 0.1, 0.1, 0, 0, 0, false);
    this.bobber.visible = false;
    this.scene.add(this.bobber);

    this.resize();
    window.addEventListener('resize', () => this.resize());
    container.addEventListener('wheel', (e) => {
      this.camDist = Math.max(8, Math.min(24, this.camDist + Math.sign(e.deltaY) * 1.2));
    }, { passive: true });
    container.addEventListener('pointermove', (e) => {
      const r = this.renderer.domElement.getBoundingClientRect();
      this.mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    });
    container.addEventListener('click', () => {
      if (this.ghost) this.onGhostClick();
    });
    this.renderer.setAnimationLoop(() => this.frame());
  }

  resize() {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h);
    this.labels.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ── Room lifecycle ──────────────────────────────────────────────────────
  load(room: RoomView) {
    this.clearRoom();
    this.room = room;
    this.grid = new Grid(room.size, decodeTiles(room.tiles), decodeTiles(room.levels), decodeTiles(room.ramps));
    for (const o of room.objects) this.objects.set(o.id, o);
    for (const b of room.buildings) this.buildings.set(b.id, b);
    this.grid.rebuild(this.objects.values(), this.buildings.values());
    this.seasonKey = '';
    this.refreshVisuals(true);
    for (const b of room.buildings) this.upsertBuildingMesh(b);
    for (const p of room.players) this.addPlayer(p);
    for (const v of room.villagers) this.upsertVillager(v);
    const myId = state.self?.id;
    this.me = myId ? this.players.get(myId) ?? null : null;
    if (this.me) {
      // The server tells us where we are (e.g. in front of a door after leaving a house).
      const mine = room.players.find((p) => p.id === myId);
      this.me.x = this.me.tx = mine?.x ?? room.spawn.x;
      this.me.z = this.me.tz = mine?.z ?? room.spawn.z;
      this.me.r = this.me.tr = mine?.r ?? Math.PI;
      this.lastSent = { x: this.me.x, z: this.me.z, r: this.me.r, at: 0 };
      this.camera.position.set(this.me.x, 12, this.me.z + 11);
    }
    this.camDist = room.kind === 'interior' ? 9 : Math.max(this.camDist, 11);
    this.water.visible = room.kind !== 'interior';
    if (debug.grid) this.toggleGridOverlay(true);
    this.cast = null;
    this.bobber.visible = false;
    this.cancelGhost();
  }

  private clearRoom() {
    for (const m of this.objMeshes.values()) this.world.remove(m);
    for (const m of this.bldMeshes.values()) this.world.remove(m);
    for (const p of this.players.values()) this.removeMover(p);
    for (const v of this.villagers.values()) this.removeMover(v);
    this.objMeshes.clear();
    this.bldMeshes.clear();
    this.players.clear();
    this.villagers.clear();
    this.objects.clear();
    this.buildings.clear();
    if (this.terrain) {
      this.world.remove(this.terrain);
      this.terrain.geometry.dispose();
      this.terrain = null;
    }
  }

  private removeMover(m: Mover) {
    m.label.element.remove();
    m.rig.root.removeFromParent();
  }

  private env(): EnvView | null {
    return state.env;
  }

  private visual() {
    const env = this.env();
    const season = debug.season ?? env?.season ?? 'summer';
    const vs = visualSeason(season);
    const snowy = (vs === 'winter' && this.room != null && ['temperate', 'boreal'].includes(BIOMES[this.room.biome].seasonModel)) || env?.weather === 'snow';
    return { season, vs, snowy };
  }

  /** Rebuild terrain + vegetation when the season (or snow cover) changes. */
  refreshVisuals(force = false) {
    if (!this.room) return;
    const v = this.visual();
    const key = `${v.season}|${v.snowy}`;
    if (!force && key === this.seasonKey) return;
    this.seasonKey = key;
    this.buildTerrain();
    for (const o of this.objects.values()) this.upsertObjectMesh(o);
  }

  private buildTerrain() {
    if (!this.room || !this.grid) return;
    if (this.terrain) {
      this.world.remove(this.terrain);
      this.terrain.geometry.dispose();
    }
    const m = buildTerrainMesh(this.grid, { biome: this.room.biome, ...this.visual(), interior: this.room.interior });
    this.terrain = m;
    this.world.add(m);
    (this.water.material as THREE.MeshStandardMaterial).color.set(waterColor(this.room.biome));
  }

  /** Debug overlay: red = blocked, yellow = reserved (ramp landings), blue = ramps. */
  private gridOverlay: THREE.Group | null = null;
  toggleGridOverlay(on: boolean) {
    if (this.gridOverlay) {
      this.scene.remove(this.gridOverlay);
      this.gridOverlay = null;
    }
    if (!on || !this.grid) return;
    const g = new THREE.Group();
    const geo = new THREE.PlaneGeometry(0.9, 0.9);
    geo.rotateX(-Math.PI / 2);
    const mats = {
      blocked: bend(new THREE.MeshBasicMaterial({ color: '#ff3b3b', transparent: true, opacity: 0.45, depthWrite: false })),
      reserved: bend(new THREE.MeshBasicMaterial({ color: '#ffd23b', transparent: true, opacity: 0.45, depthWrite: false })),
      ramp: bend(new THREE.MeshBasicMaterial({ color: '#3b8bff', transparent: true, opacity: 0.45, depthWrite: false })),
    };
    for (let z = 0; z < this.grid.size; z++)
      for (let x = 0; x < this.grid.size; x++) {
        const i = z * this.grid.size + x;
        const kind = this.grid.ramp(x, z) >= 0 ? 'ramp' : this.grid.blocked[i] ? 'blocked' : this.grid.reserved[i] ? 'reserved' : null;
        if (!kind) continue;
        const m = new THREE.Mesh(geo, mats[kind]);
        m.position.set(x + 0.5, this.grid.surfaceY(x + 0.5, z + 0.5) + 0.03, z + 0.5);
        g.add(m);
      }
    this.gridOverlay = g;
    this.scene.add(g);
  }

  // ── Objects / buildings ─────────────────────────────────────────────────
  upsertObjectMesh(o: WorldObject) {
    const prev = this.objMeshes.get(o.id);
    if (prev) this.world.remove(prev);
    if (!this.room) return;
    const def = BIOMES[this.room.biome];
    const { season, vs, snowy } = this.visual();
    const mesh = objectModel(o, season, vs, snowy, def.bushColor, def.bushItem);
    mesh.position.set(o.x + 0.5, this.grid!.surfaceY(o.x + 0.5, o.z + 0.5), o.z + 0.5);
    mesh.traverse((c: THREE.Object3D) => (c.userData.objId = o.id));
    this.world.add(mesh);
    this.objMeshes.set(o.id, mesh);
  }

  upsertBuildingMesh(b: Building) {
    const prev = this.bldMeshes.get(b.id);
    if (prev) this.world.remove(prev);
    const mesh = buildingModel(b, net.serverNow(), this.room?.interior ?? 'cabin');
    const y = b.type === 'dock' ? 0 : this.room?.kind === 'interior' ? baseHeight(Tile.Floor) : baseHeight(Tile.Ground) + (this.grid?.level(b.x, b.z) ?? 0) * CLIFF;
    mesh.position.set(b.x + b.w / 2, y, b.z + b.h / 2);
    mesh.userData.done = b.completeAt <= net.serverNow();
    this.world.add(mesh);
    this.bldMeshes.set(b.id, mesh);
  }

  // ── Characters ──────────────────────────────────────────────────────────
  private makeLabel(text: string, cls = '') {
    const div = document.createElement('div');
    div.className = `label3d ${cls}`;
    div.textContent = text;
    return new CSS2DObject(div);
  }

  addPlayer(p: PlayerView) {
    const existing = this.players.get(p.id);
    if (existing) this.removeMover(existing);
    const rig = makePlayer(p.gender, p.look, p.hat);
    const label = this.makeLabel(p.name);
    label.position.set(0, 1.55, 0);
    rig.root.add(label);
    rig.root.traverse((c: THREE.Object3D) => (c.castShadow = true));
    this.world.add(rig.root);
    const m: Mover = { rig, label, x: p.x, z: p.z, r: p.r, tx: p.x, tz: p.z, tr: p.r, speed: 0, swing: 0 };
    this.players.set(p.id, m);
    if (p.id === state.self?.id) this.me = m;
    return m;
  }

  upsertVillager(v: VillagerView) {
    const def = villagerDef(v.id);
    if (!def) return;
    let m = this.villagers.get(v.id);
    if (!m) {
      const rig = makeVillager(def);
      const label = this.makeLabel(def.name, 'vill');
      label.position.set(0, 1.55, 0);
      rig.root.add(label);
      this.world.add(rig.root);
      m = { rig, label, x: v.x, z: v.z, r: v.r, tx: v.x, tz: v.z, tr: v.r, speed: 0, swing: 0, home: v.home, houseId: v.houseId };
      this.villagers.set(v.id, m);
    }
    m.tx = v.x;
    m.tz = v.z;
    m.tr = v.r;
    m.home = v.home;
    m.rig.root.visible = !v.home;
  }

  villagerPos(id: string) {
    const v = this.villagers.get(id);
    return v ? { x: v.x, z: v.z, home: v.home } : null;
  }

  /** Show a speech bubble above a villager for a few seconds. */
  say(id: string, text: string) {
    const v = this.villagers.get(id);
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

  // ── Server messages ─────────────────────────────────────────────────────
  handle(m: ServerMessage) {
    if (!this.room) return;
    switch (m.t) {
      case 'oAdd':
        for (const o of m.o) {
          const prev = this.objects.get(o.id);
          if (prev) this.grid!.removeObject(prev);
          this.objects.set(o.id, o);
          this.grid!.addObject(o);
          this.upsertObjectMesh(o);
        }
        break;
      case 'oDel':
        for (const id of m.ids) {
          const prev = this.objects.get(id);
          if (prev) this.grid!.removeObject(prev);
          this.objects.delete(id);
          const mesh = this.objMeshes.get(id);
          if (mesh) this.world.remove(mesh);
          this.objMeshes.delete(id);
        }
        break;
      case 'bAdd':
        for (const b of m.b) {
          const prev = this.buildings.get(b.id);
          if (prev) this.grid!.removeBuilding(prev);
          this.buildings.set(b.id, b);
          this.grid!.addBuilding(b);
          this.upsertBuildingMesh(b);
        }
        break;
      case 'bDel':
        for (const id of m.ids) {
          const prev = this.buildings.get(id);
          if (prev) this.grid!.removeBuilding(prev);
          this.buildings.delete(id);
          const mesh = this.bldMeshes.get(id);
          if (mesh) this.world.remove(mesh);
          this.bldMeshes.delete(id);
        }
        break;
      case 'pAdd':
        this.addPlayer(m.p);
        break;
      case 'pDel': {
        const p = this.players.get(m.id);
        if (p) this.removeMover(p);
        this.players.delete(m.id);
        break;
      }
      case 'pLook': {
        const p = this.players.get(m.id);
        if (!p) break;
        const view = { ...this.room.players.find((x) => x.id === m.id), id: m.id, look: m.look, hat: m.hat } as PlayerView;
        const prevName = p.label.element.textContent ?? '';
        const gender = state.self?.id === m.id ? state.self.gender : (this.room.players.find((x) => x.id === m.id)?.gender ?? 'boy');
        const fresh = this.addPlayer({ ...view, name: prevName, gender, x: p.x, z: p.z, r: p.r });
        fresh.tx = p.tx;
        fresh.tz = p.tz;
        break;
      }
      case 'ps':
        for (const [id, x, z, r] of m.l) {
          if (id === state.self?.id) continue; // we predict ourselves
          const p = this.players.get(id);
          if (p) { p.tx = x; p.tz = z; p.tr = r; }
        }
        break;
      case 'vs':
        for (const [id, x, z, r, home] of m.l) {
          const v = this.villagers.get(id);
          if (!v) continue;
          v.tx = x; v.tz = z; v.tr = r; v.home = home === 1;
          v.rig.root.visible = !v.home;
          if (v.home) { v.x = x; v.z = z; }
        }
        break;
      case 'vAdd':
        for (const v of m.v) this.upsertVillager(v);
        break;
      case 'corr':
        if (this.me) {
          this.me.x = this.me.tx = m.x;
          this.me.z = this.me.tz = m.z;
          this.lastSent.x = m.x;
          this.lastSent.z = m.z;
        }
        break;
      case 'bite':
        if (this.cast && this.cast.id === m.castId) {
          this.cast.bite = true;
          this.cast.window = m.window;
          this.cast.at = performance.now();
        }
        break;
      case 'fish':
        if (this.cast?.id === m.castId) this.endCast();
        break;
      case 'env':
        this.refreshVisuals();
        break;
    }
  }

  // ── Fishing ─────────────────────────────────────────────────────────────
  startCast(x: number, z: number) {
    this.cast = { id: null, x, z, bite: false, window: 0, at: performance.now() };
    this.bobber.position.set(x + 0.5, WATER_Y + 0.03, z + 0.5);
    this.bobber.visible = true;
    if (this.me) this.me.swing = 1;
  }
  endCast() {
    this.cast = null;
    this.bobber.visible = false;
  }

  // ── Ghost placement ─────────────────────────────────────────────────────
  startBuildGhost(type: BuildingType) {
    this.cancelGhost();
    const def = BUILDINGS[type];
    const group = new THREE.Group();
    const box = part('box', mat('#7fe07f', { opacity: 0.45 }), def.w, 0.6, def.h, def.w / 2, 0.3, def.h / 2, false);
    box.name = 'box';
    group.add(box);
    this.scene.add(group);
    this.ghost = { group, type: 'build', building: type, tx: 0, tz: 0, ok: false };
  }

  startPlaceGhost(item: string) {
    this.cancelGhost();
    const group = new THREE.Group();
    const f = furnitureModel(item, 0);
    f.position.set(0.5, 0, 0.5);
    f.name = 'model';
    group.add(f);
    const box = part('box', mat('#7fe07f', { opacity: 0.35 }), 1, 0.05, 1, 0.5, 0.03, 0.5, false);
    box.name = 'box';
    group.add(box);
    this.scene.add(group);
    this.ghost = { group, type: 'place', item, rot: 0, tx: 0, tz: 0, ok: false };
  }

  rotateGhost() {
    if (this.ghost?.type !== 'place') return;
    this.ghost.rot = (this.ghost.rot + 1) % 4;
    const m = this.ghost.group.getObjectByName('model');
    if (m) m.rotation.y = (this.ghost.rot * Math.PI) / 2;
  }

  cancelGhost() {
    if (this.ghost) this.scene.remove(this.ghost.group);
    this.ghost = null;
  }

  private updateGhost() {
    const g = this.ghost;
    if (!g || !this.grid || !this.me) return;
    let tx: number, tz: number, w = 1, h = 1;
    if (g.type === 'build') {
      const def = BUILDINGS[g.building];
      w = def.w;
      h = def.h;
      this.raycaster.setFromCamera(this.mouse, this.camera);
      this.groundPlane.constant = -this.groundY(this.me.x, this.me.z);
      const hit = new THREE.Vector3();
      if (!this.raycaster.ray.intersectPlane(this.groundPlane, hit)) return;
      tx = Math.floor(hit.x - w / 2 + 0.5);
      tz = Math.floor(hit.z - h / 2 + 0.5);
    } else {
      const f = this.facingTile();
      tx = f.x;
      tz = f.z;
    }
    g.tx = tx;
    g.tz = tz;
    const cx = tx + w / 2, cz = tz + h / 2;
    const inRange = g.type === 'build' ? Math.hypot(this.me.x - cx, this.me.z - cz) <= 6 : distToTile(this.me.x, this.me.z, tx, tz) <= 2.4;
    const meInside = this.me.x > tx - 0.3 && this.me.x < tx + w + 0.3 && this.me.z > tz - 0.3 && this.me.z < tz + h + 0.3;
    g.ok = this.grid.canPlace(tx, tz, w, h) && inRange && !meInside;
    g.group.position.set(tx, this.grid.surfaceY(tx + 0.5, tz + 0.5), tz);
    const box = g.group.getObjectByName('box') as THREE.Mesh;
    box.material = mat(g.ok ? '#7fe07f' : '#ff6b6b', { opacity: 0.45 });
  }

  // ── Targeting ───────────────────────────────────────────────────────────
  private facing() {
    const r = this.me?.r ?? 0;
    return { fx: Math.sin(r), fz: Math.cos(r) };
  }

  facingTile() {
    const { fx, fz } = this.facing();
    return { x: Math.floor(this.me!.x + fx * 0.9), z: Math.floor(this.me!.z + fz * 0.9) };
  }

  private computeTarget(): Target | null {
    if (!this.me || !this.grid || !this.room) return null;
    if (this.cast) return { kind: 'reel', label: this.cast.bite ? '❗ Reel in!' : 'Reel in (wait for a bite…)' };
    const { fx, fz } = this.facing();
    const px = this.me.x, pz = this.me.z;
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
    const owner = this.room.canHarvest;
    for (const o of this.objects.values()) {
      const dx = o.x + 0.5 - px, dz = o.z + 0.5 - pz;
      if (Math.abs(dx) > 2.5 || Math.abs(dz) > 2.5) continue;
      const label = this.objectLabel(o, owner);
      if (label) consider({ kind: 'object', o, label }, dx, dz, 1.85);
    }
    for (const [id, v] of this.villagers) {
      if (v.home) continue;
      const def = villagerDef(id)!;
      consider({ kind: 'villager', id, label: `Talk to ${def.name}` }, v.x - px, v.z - pz, 2.2);
    }
    for (const b of this.buildings.values()) {
      if (!nearBuilding(b, px, pz, 1.7)) continue;
      const done = b.completeAt <= net.serverNow();
      const def = BUILDINGS[b.type];
      const label = !done ? `${def.name} (under construction)`
        : b.type === 'dock' ? (this.room.kind === 'tour' ? 'Sail home' : 'Travel')
        : ENTERABLE.includes(b.type) ? `Enter ${def.name}`
        : b.type === 'exit' ? 'Go outside'
        : b.type === 'bed' ? 'Rest'
        : b.type === 'chest' ? 'Open storage chest'
        : `Use ${def.name}`;
      const cx = Math.max(b.x, Math.min(px, b.x + b.w)), cz = Math.max(b.z, Math.min(pz, b.z + b.h));
      consider({ kind: 'building', b, label }, cx - px, cz - pz, 1.8);
    }
    if (best) return best;
    // Water in front → fishing.
    if ((state.inv.fishing_rod || state.inv.pro_rod)) {
      for (const d of [1.2, 2, 2.8]) {
        const tx = Math.floor(px + fx * d), tz = Math.floor(pz + fz * d);
        if (isWaterTile(this.grid.tile(tx, tz)) && this.grid.tile(tx, tz) !== Tile.Dock) return { kind: 'water', x: tx, z: tz, label: 'Cast your line' };
      }
    }
    if (this.tool === 'sapling' && this.room.canBuild && (state.inv.sapling ?? 0) > 0) {
      const f = this.facingTile();
      if (this.grid.canPlace(f.x, f.z)) return { kind: 'plant', x: f.x, z: f.z, label: 'Plant sapling' };
    }
    return null;
  }

  private objectLabel(o: WorldObject, owner: boolean): string | null {
    switch (o.kind) {
      case 'tree': {
        const name = TREES[o.species ?? 'oak'].name;
        if ((o.stage ?? 2) < 2) return owner ? `${name} (growing)` : null;
        if (!owner) return null;
        return this.tool === 'axe' && (state.inv.stone_axe || state.inv.iron_axe) ? `Chop ${name}` : `Shake ${name}`;
      }
      case 'stump': return owner ? 'Dig up stump' : null;
      case 'rock': return owner ? 'Break rock' : null;
      case 'bush': return owner ? (o.ripe ? `Pick ${ITEMS[BIOMES[this.room!.biome].bushItem].name}` : 'Gather (nothing ripe)') : null;
      case 'mushroom': return owner ? `Pick ${o.rare ? 'Glowcap' : 'mushroom'}` : null;
      case 'flower': return owner ? 'Pick flower' : null;
      case 'furniture': return this.room!.canDecorate ? `Pick up ${ITEMS[o.item!]?.name ?? 'item'} (F)` : null;
    }
  }

  // ── Frame ───────────────────────────────────────────────────────────────
  private frameTimes: number[] = [];
  private frame() {
    const rawDt = this.clock.getDelta();
    const dt = Math.min(0.1, rawDt);
    const t = this.clock.elapsedTime;
    this.frameTimes.push(rawDt);
    if (this.frameTimes.length > 60) this.frameTimes.shift();
    debug.fps = Math.round(this.frameTimes.length / this.frameTimes.reduce((a, b) => a + b, 0.0001));
    bendStrength.value = this.room?.kind === 'interior' ? 0 : debug.bend;
    if (this.me) bendFocusZ.value = this.me.z;
    this.renderer.shadowMap.enabled = debug.shadows;
    this.refreshVisuals(); // cheap no-op unless the (debug) season or snow cover changed
    if (this.room && this.me && this.grid) this.updateLocal(dt);
    for (const p of this.players.values()) if (p !== this.me) this.interp(p, dt);
    for (const v of this.villagers.values()) this.interp(v, dt);
    if (this.me) {
      const tgt = this.computeTarget();
      const changed = (tgt?.label ?? null) !== (this.target?.label ?? null) || (tgt && this.target && tgt.kind !== this.target.kind);
      this.target = tgt;
      if (changed) this.onTarget(tgt);
    }
    this.updateGhost();
    this.updateEnvironment(dt, t);
    this.animateProps(t);
    // Fishing bobber.
    if (this.cast) {
      const bite = this.cast.bite;
      this.bobber.position.y = WATER_Y + (bite ? -0.08 + Math.sin(t * 30) * 0.04 : 0.03 + Math.sin(t * 3) * 0.02);
    }
    // Camera follow.
    const fx = this.me?.x ?? 24, fz = this.me?.z ?? 24;
    const fy = this.me ? this.groundY(this.me.x, this.me.z) : 0;
    const target = new THREE.Vector3(fx, fy + 0.5, fz);
    const desired = new THREE.Vector3(fx, fy + this.camDist * 0.85, fz + this.camDist * 0.78);
    this.camera.position.lerp(desired, 1 - Math.exp(-dt * 6));
    this.camera.lookAt(target.x, target.y, target.z - 0.5);
    this.sun.target.position.set(fx, 0, fz);
    this.moon.target.position.set(fx, 0, fz);
    this.stars.position.copy(this.camera.position);
    this.aurora.position.set(fx, 0, fz);
    this.rain.position.set(fx, fy, fz);
    this.water.position.x = Math.round(fx / 2) * 2;
    this.water.position.z = Math.round(fz / 2) * 2;
    this.labels.domElement.style.display = debug.labels ? '' : 'none';
    this.renderer.render(this.scene, this.camera);
    this.labels.render(this.scene, this.camera);
  }

  private updateLocal(dt: number) {
    const me = this.me!;
    let dx = 0, dz = 0;
    const k = this.keys;
    if (k.has('KeyW') || k.has('ArrowUp')) dz -= 1;
    if (k.has('KeyS') || k.has('ArrowDown')) dz += 1;
    if (k.has('KeyA') || k.has('ArrowLeft')) dx -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) dx += 1;
    const len = Math.hypot(dx, dz);
    if (this.cast && len > 0) {
      this.endCast(); // walking away cancels fishing
    }
    if (len > 0) {
      dx /= len; dz /= len;
      const run = k.has('ShiftLeft') || k.has('ShiftRight') ? 1 : 0.62;
      const step = PLAYER_SPEED * run * dt;
      const res = slideMove(this.grid!, me.x, me.z, dx * step, dz * step);
      me.speed = Math.hypot(res.x - me.x, res.z - me.z) / dt;
      me.x = res.x;
      me.z = res.z;
      const want = Math.atan2(dx, dz);
      let diff = want - me.r;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      me.r = wrapAngle(me.r + diff * Math.min(1, dt * 14));
    } else me.speed = 0;
    me.rig.root.position.set(me.x, this.groundY(me.x, me.z), me.z);
    me.rig.root.rotation.y = me.r;
    this.bendLabel(me);
    me.swing = Math.max(0, me.swing - dt * 2.5);
    animateRig(me.rig, dt, me.speed, me.swing);
    setTool(me.rig, this.tool === 'axe' && (state.inv.stone_axe || state.inv.iron_axe) ? 'axe' : this.tool === 'shovel' && (state.inv.shovel || state.inv.iron_shovel) ? 'shovel' : this.cast ? 'rod' : null);

    const now = performance.now();
    const moved = Math.hypot(me.x - this.lastSent.x, me.z - this.lastSent.z) > 0.01 || Math.abs(me.r - this.lastSent.r) > 0.05;
    if (moved && now - this.lastSent.at >= 100) {
      this.lastSent = { x: me.x, z: me.z, r: me.r, at: now };
      net.send({ t: 'move', seq: net.nextSeq(), x: round2(me.x), z: round2(me.z), r: round2(me.r) });
    }
  }

  groundY(x: number, z: number) {
    if (!this.grid) return 0;
    return Math.max(0, this.grid.surfaceY(x, z));
  }

  /** Labels are HTML, so the world bend is applied to them on the CPU. */
  private bendLabel(m: Mover) {
    m.label.position.y = 1.55 - (this.room?.kind === 'interior' ? 0 : bendDrop(m.z));
  }

  private interp(m: Mover, dt: number) {
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
    m.rig.root.position.set(m.x, this.groundY(m.x, m.z), m.z);
    m.rig.root.rotation.y = m.r;
    this.bendLabel(m);
    animateRig(m.rig, dt, m.speed, m.swing);
  }

  swing() {
    if (this.me) this.me.swing = 1;
  }

  private animateProps(t: number) {
    for (const mesh of this.bldMeshes.values()) {
      const flame = mesh.getObjectByName('flame');
      if (flame) {
        flame.scale.y = 0.45 + Math.sin(t * 13) * 0.06 + Math.sin(t * 7.3) * 0.04;
        const l = mesh.getObjectByName('firelight') as THREE.PointLight | undefined;
        if (l) l.intensity = 1.6 + Math.sin(t * 11) * 0.3 + (1 - this.day) * 2.5;
      }
    }
    // Buildings finishing construction while we watch.
    const now = net.serverNow();
    for (const [id, mesh] of this.bldMeshes) {
      const b = this.buildings.get(id);
      if (b && !mesh.userData.done && b.completeAt <= now) this.upsertBuildingMesh(b);
    }
  }

  // ── Day / night & weather ───────────────────────────────────────────────
  private day = 1;
  private updateEnvironment(dt: number, t: number) {
    const env0 = this.env();
    if (!env0) return;
    const env = debug.weather ? { ...env0, weather: debug.weather, intensity: 1 } : env0;
    if (this.room?.kind === 'interior') return this.interiorLighting(t);
    this.water.visible = true;
    const sp = sunPosition(net.serverNow() + debug.timeOffsetH * 3600_000, env.geo.lat, env.geo.lon);
    const d = daylight(sp.elevation);
    this.day = d;
    const el = Math.max(sp.elevation, 4) * (Math.PI / 180);
    const az = sp.azimuth * (Math.PI / 180);
    const dir = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
    const fx = this.me?.x ?? 24, fz = this.me?.z ?? 24;
    this.sun.position.set(fx + dir.x * 40, dir.y * 40, fz + dir.z * 40);
    this.sun.castShadow = true;
    this.stars.visible = true;
    this.moon.position.set(fx - dir.x * 40, Math.abs(dir.y) * 40 + 10, fz - dir.z * 40);

    const w = env.weather;
    const overcast = { clear: 0, cloudy: 0.45, rain: 0.6, storm: 0.75, snow: 0.5, fog: 0.5, sandstorm: 0.55, heatwave: 0 }[w] * env.intensity;
    const twilight = Math.max(0, 1 - Math.abs(sp.elevation) / 8);

    const dayCol = new THREE.Color(w === 'heatwave' ? '#ffe2a8' : '#8fd3f4');
    const nightCol = new THREE.Color('#0d1836');
    const duskCol = new THREE.Color('#f59e6b');
    const grey = new THREE.Color(w === 'sandstorm' ? '#d8b77a' : '#aab4bd');
    const sky = nightCol.clone().lerp(dayCol, d);
    sky.lerp(duskCol, twilight * 0.55 * (1 - overcast));
    sky.lerp(grey.clone().multiplyScalar(0.25 + d * 0.75), overcast);
    if (this.flash > 0) sky.lerp(new THREE.Color('#ffffff'), this.flash);
    (this.scene.background as THREE.Color).copy(sky);
    const fog = this.scene.fog as THREE.Fog;
    fog.color.copy(sky);
    const fogNear = w === 'fog' ? 6 : w === 'sandstorm' ? 5 : w === 'snow' || w === 'rain' || w === 'storm' ? 22 : 45;
    fog.near += (fogNear - fog.near) * dt;
    fog.far += (fogNear * 3 + 20 - fog.far) * dt;

    this.sun.intensity = d * 2.4 * (1 - overcast * 0.7) + this.flash * 3;
    this.sun.color.set(twilight > 0.3 ? '#ffc58a' : '#fff4dc');
    this.moon.intensity = (1 - d) * 0.45;
    this.hemi.intensity = 0.25 + d * 0.65;
    this.hemi.color.set(d > 0.5 ? '#d8f0ff' : '#6f84c9');
    this.renderer.toneMappingExposure = 0.85 + d * 0.25;

    // Night lights.
    mat('#bfe6ff', { emissive: '#ffd27a', ei: 0 }).emissiveIntensity = (1 - d) * 1.3;
    mat('#fff3c4', { emissive: '#ffcf6b', ei: 0.2 }).emissiveIntensity = 0.2 + (1 - d) * 2;

    // Stars & aurora.
    const clearNight = (1 - d) * (1 - overcast);
    (this.stars.material as THREE.PointsMaterial).opacity = clearNight;
    for (const [i, a] of this.aurora.children.entries()) {
      const mm = (a as THREE.Mesh).material as THREE.MeshBasicMaterial;
      mm.opacity = env.aurora ? clearNight * (0.25 + Math.sin(t * 0.4 + i) * 0.12) : 0;
      a.position.x = Math.sin(t * 0.05 + i) * 8;
    }

    // Precipitation.
    const kind = w === 'rain' || w === 'storm' ? 'rain' : w === 'snow' ? 'snow' : w === 'sandstorm' ? 'sand' : null;
    this.rain.visible = !!kind;
    if (kind) {
      const pm = this.rain.material as THREE.PointsMaterial;
      pm.color.set(kind === 'rain' ? '#cfe8ff' : kind === 'snow' ? '#ffffff' : '#e8c88a');
      pm.size = kind === 'rain' ? 0.07 : kind === 'snow' ? 0.14 : 0.1;
      const pos = this.rain.geometry.attributes.position as THREE.BufferAttribute;
      const arr = pos.array as Float32Array;
      const fall = kind === 'rain' ? 18 : kind === 'snow' ? 1.6 : 0.4;
      const drift = kind === 'sand' ? 14 : kind === 'snow' ? 0.6 : 1;
      const n = Math.floor((arr.length / 3) * (0.35 + env.intensity * 0.65));
      for (let i = 0; i < arr.length / 3; i++) {
        if (i >= n) { arr[i * 3 + 1] = -50; continue; }
        const v = this.rainVel[i];
        arr[i * 3 + 1] -= fall * v * dt;
        arr[i * 3] += (kind === 'snow' ? Math.sin(t + i) * drift : drift * v) * dt;
        if (arr[i * 3 + 1] < 0 || arr[i * 3] > 20) {
          arr[i * 3 + 1] = kind === 'sand' ? Math.random() * 4 : 18 + Math.random() * 4;
          arr[i * 3] = (Math.random() - 0.5) * 40 - (kind === 'sand' ? 10 : 0);
          arr[i * 3 + 2] = (Math.random() - 0.5) * 40;
        }
      }
      pos.needsUpdate = true;
    }
    // Lightning.
    if (w === 'storm' && Math.random() < dt * 0.15) this.flash = 1;
    this.flash = Math.max(0, this.flash - dt * 4);
    // Gentle water motion.
    this.water.position.y = WATER_Y + Math.sin(t * 0.8) * 0.015;
  }

  /** Warm, cosy, weather-free light indoors. */
  private interiorLighting(t: number) {
    const tent = this.room?.interior === 'tent';
    (this.scene.background as THREE.Color).set('#1e150e');
    const fog = this.scene.fog as THREE.Fog;
    fog.color.set('#1e150e');
    fog.near = 30;
    fog.far = 80;
    const fx = this.me?.x ?? 0, fz = this.me?.z ?? 0;
    this.sun.position.set(fx + 3, 14, fz + 6);
    this.sun.intensity = tent ? 0.9 : 1.3;
    this.sun.color.set('#ffe2b8');
    this.sun.castShadow = true;
    this.moon.intensity = 0;
    this.hemi.intensity = tent ? 0.75 + Math.sin(t * 9) * 0.03 : 0.9;
    this.hemi.color.set('#ffd9a8');
    this.renderer.toneMappingExposure = 1;
    (this.stars.material as THREE.PointsMaterial).opacity = 0;
    for (const a of this.aurora.children) ((a as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = 0;
    this.rain.visible = false;
    this.water.visible = false;
    mat('#bfe6ff', { emissive: '#ffd27a', ei: 0 }).emissiveIntensity = 0.8;
  }
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

export { setHat };
