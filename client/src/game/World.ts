// The 3D island view: rendering, local prediction, interpolation of other
// players and villagers, day/night lighting and weather.

import * as THREE from 'three';
import { CSS2DRenderer, CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import {
  BIOMES, BUILDINGS, ITEMS, Grid, Tile, TREES, CLIFF, ENTERABLE, daylight, decodeTiles, distToTile, isWaterTile, nearBuilding,
  slideMove, sunPosition, villagerDef, visualSeason, hashString, baseHeight, wrapAngle, PATHS, PATH_REACH,
  TERRA_INFO, TERRA_REACH, applyTerrain, autoRampDir, terraformError, BIRD_BY_ID, type TerraOp, type HotbarTool,
  type Building, type EnvView, type PlayerView, type RoomView, type ServerMessage, type VillagerView, type WorldObject, type BuildingType, type Weather, type Season,
} from '@hearthwood/shared';
import { bend, bendDrop, bendFocusZ, bendStrength } from './bend.ts';
import { buildDocks, buildTerrainMesh, waterColor } from './terrain.ts';
import { buildPaths, disposePaths, setPathSnow } from './paths.ts';
import { buildFoliage, disposeFoliage } from './foliage.ts';
import { Footprints } from './footprints.ts';
import { windTime } from './bend.ts';
import { animateRig, makePlayer, makeVillager, setHat, setTool, type Rig } from './characters.ts';
import type { VillagerDef, BuildingType as BT } from '@hearthwood/shared';

/** Who works the counter in each kind of building. */
function shopkeeper(role?: BT): VillagerDef {
  const base = { id: 'keeper', catchphrase: '', likes: [], loves: [], dislikes: [], birthday: '01-01', personality: 'cheerful' as const };
  switch (role) {
    case 'town_hall': return { ...base, name: 'Clerk', species: 'owl', color: '#8c6a4a', accent: '#efe0c4' };
    case 'tool_store': return { ...base, name: 'Smith', species: 'bear', color: '#8a5a3c', accent: '#d9b48f' };
    case 'furniture_store': return { ...base, name: 'Carpenter', species: 'squirrel', color: '#c46a2b', accent: '#f3d3a2' };
    case 'clothing_shop': return { ...base, name: 'Tailor', species: 'rabbit', color: '#f2efe8', accent: '#f6b6c4' };
    case 'restaurant': return { ...base, name: 'Chef', species: 'cat', color: '#e07b39', accent: '#fff1e2' };
    case 'travel_agent': return { ...base, name: 'Agent', species: 'penguin', color: '#2c3e50', accent: '#ffffff' };
    default: return { ...base, name: 'Keeper', species: 'dog', color: '#d9a35b', accent: '#fff3dc' };
  }
}
import { buildingModel, furnitureModel, mat, objectModel, part } from './models.ts';
import { net } from '../net.ts';
import { state, watch } from '../state.ts';

export const PLAYER_SPEED = 4.2;

export type Tool = HotbarTool;

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
  /** Analog movement from a controller (x right, z down the screen), magnitude 0..1. */
  analog = { x: 0, z: 0, run: false };
  /** True while the controller is the active input: placement aims in front of the player. */
  padAim = false;
  target: Target | null = null;
  private lastSent = { x: 0, z: 0, r: 0, at: 0 };
  private camDist = 13;
  private seasonKey = '';
  private clock = new THREE.Clock();
  private bobber: THREE.Mesh;
  cast: { id: string | null; x: number; z: number; bite: boolean; window: number; at: number } | null = null;
  ghost: { group: THREE.Group; type: 'build'; building: BuildingType; tx: number; tz: number; ok: boolean; moving?: string } | { group: THREE.Group; type: 'place'; item: string; rot: number; tx: number; tz: number; ok: boolean } | null = null;
  /** Path painting: type 1..5, or 0 for the eraser. */
  paint: { type: number; terra?: TerraOp; dir: number; group: THREE.Group; tx: number; tz: number; ok: boolean; down: boolean; last: string } | null = null;
  onPaint: (x: number, z: number, type: number) => void = () => {};
  onTerra: (x: number, z: number, op: TerraOp, dir: number) => void = () => {};
  private terrainTimer: ReturnType<typeof setTimeout> | null = null;
  private pathLayer: THREE.Group | null = null;
  private foliage: THREE.Group | null = null;
  private foliageTimer: ReturnType<typeof setTimeout> | null = null;
  private pathTimer: ReturnType<typeof setTimeout> | null = null;
  readonly footprints = new Footprints();
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

    // Northern lights: curtains of light hung in the sky band above the
    // curved horizon. They live in camera space (always in view, behind the
    // land) and ripple slowly.
    this.aurora = new THREE.Group();
    const curtainTex = auroraTexture();
    const tints = ['#5dffa8', '#3cf0c0', '#9d7dff'];
    for (let i = 0; i < 3; i++) {
      const g = new THREE.PlaneGeometry(420, 70, 90, 1);
      const tex = curtainTex.clone();
      tex.needsUpdate = true;
      const m = new THREE.MeshBasicMaterial({ map: tex, color: tints[i], transparent: true, opacity: 0, side: THREE.DoubleSide, fog: false, depthWrite: false, blending: THREE.AdditiveBlending });
      const mesh = new THREE.Mesh(g, m);
      mesh.position.set(-30 + i * 40, 30 + i * 12, -220 - i * 25);
      mesh.renderOrder = -10;
      mesh.frustumCulled = false;
      mesh.userData.base = Float32Array.from((g.attributes.position as THREE.BufferAttribute).array as Float32Array);
      this.aurora.add(mesh);
    }
    this.camera.add(this.aurora);
    this.scene.add(this.camera);

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
      if (Math.abs(e.movementX) + Math.abs(e.movementY) > 2) this.padAim = false;
      if (this.paint?.down) {
        this.updatePaintGhost();
        this.paintHere();
      }
    });
    container.addEventListener('pointerdown', (e) => {
      if (!this.paint || e.button !== 0) return;
      this.paint.down = true;
      this.paint.last = '';
      this.updatePaintGhost();
      this.paintHere();
    });
    window.addEventListener('pointerup', () => {
      if (this.paint) this.paint.down = false;
    });
    container.addEventListener('click', () => {
      if (this.ghost) this.onGhostClick();
    });
    this.scene.add(this.footprints.mesh);
    this.renderer.setAnimationLoop(() => this.frame());
    // Raise / lower the mailbox flag when mail arrives or is taken.
    watch(['mail'], () => {
      for (const b of this.buildings.values()) if (b.type === 'mailbox') this.upsertBuildingMesh(b);
    });
  }

  zoom(delta: number) {
    this.camDist = Math.max(8, Math.min(24, this.camDist + delta));
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
    this.grid = new Grid(room.size, decodeTiles(room.tiles), decodeTiles(room.levels), decodeTiles(room.ramps), decodeTiles(room.paths));
    for (const o of room.objects) this.objects.set(o.id, o);
    for (const b of room.buildings) this.buildings.set(b.id, b);
    this.grid.rebuild(this.objects.values(), this.buildings.values());
    this.seasonKey = '';
    this.footprints.clear();
    this.footprints.sandColor.set(BIOMES[room.biome].shore);
    this.refreshVisuals(true);
    this.rebuildPaths();
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
    this.camDist = room.kind === 'interior' ? Math.max(8, room.size + 1) : Math.max(this.camDist, 11);
    this.water.visible = room.kind !== 'interior';
    if (debug.grid) this.toggleGridOverlay(true);
    this.cast = null;
    this.bobber.visible = false;
    this.cancelGhost();
    this.stopPaint();
  }

  private clearRoom() {
    for (const f of this.flying) this.world.remove(f.mesh);
    this.flying = [];
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
    if (this.pathLayer) {
      this.world.remove(this.pathLayer);
      disposePaths(this.pathLayer);
      this.pathLayer = null;
    }
    if (this.foliage) {
      this.world.remove(this.foliage);
      disposeFoliage(this.foliage);
      this.foliage = null;
    }
  }

  // ── Paths & foliage ─────────────────────────────────────────────────────
  private rebuildPaths() {
    if (!this.grid) return;
    if (this.pathLayer) {
      this.world.remove(this.pathLayer);
      disposePaths(this.pathLayer);
    }
    this.pathLayer = buildPaths(this.grid);
    this.world.add(this.pathLayer);
    setPathSnow(this.visual().snowy);
  }

  private rebuildFoliage() {
    if (!this.grid || !this.room) return;
    if (this.foliage) {
      this.world.remove(this.foliage);
      disposeFoliage(this.foliage);
      this.foliage = null;
    }
    if (this.room.kind === 'interior') return;
    const v = this.visual();
    this.foliage = buildFoliage(this.grid, this.room.biome, v.season, v.vs, v.snowy, this.objects.values());
    this.world.add(this.foliage);
  }

  /** Debounced: many world changes can arrive in a burst. */
  private scheduleFoliage(ms = 400) {
    if (this.foliageTimer) clearTimeout(this.foliageTimer);
    this.foliageTimer = setTimeout(() => this.rebuildFoliage(), ms);
  }

  /** Terraforming: rebuild the terrain mesh (and what sits on it) once a burst of edits settles. */
  private scheduleTerrain() {
    if (this.terrainTimer) clearTimeout(this.terrainTimer);
    this.terrainTimer = setTimeout(() => {
      this.terrainTimer = null;
      this.buildTerrain();
      this.rebuildPaths();
      this.rebuildFoliage();
      for (const o of this.objects.values()) this.upsertObjectMesh(o);
      if (this.gridOverlay) this.toggleGridOverlay(true);
    }, 70);
  }

  private schedulePaths() {
    if (this.pathTimer) return;
    this.pathTimer = setTimeout(() => {
      this.pathTimer = null;
      this.rebuildPaths();
    }, 60);
  }

  startPaint(type: number) {
    this.cancelGhost();
    this.stopPaint();
    const group = new THREE.Group();
    const box = part('box', mat(type ? PATHS[type - 1].color : '#ff6b6b', { opacity: 0.55 }), 1, 0.04, 1, 0.5, 0.03, 0.5, false);
    box.name = 'box';
    group.add(box);
    this.scene.add(group);
    this.paint = { type, dir: -1, group, tx: 0, tz: 0, ok: false, down: false, last: '' };
  }

  /** Terraforming uses the same click-and-drag tile cursor as path painting. */
  startTerra(op: TerraOp) {
    this.startPaint(0);
    const p = this.paint!;
    p.terra = op;
    p.type = -1;
  }

  private paintColor(ok: boolean) {
    const p = this.paint!;
    if (!ok) return '#9e9e9e';
    if (p.terra) return TERRA_INFO[p.terra].color;
    return p.type ? PATHS[p.type - 1].color : '#ff6b6b';
  }

  /** Uphill direction for a ramp: away from the player if that fits. */
  private rampDir(tx: number, tz: number) {
    if (!this.grid || !this.me) return -1;
    const dx = tx + 0.5 - this.me.x, dz = tz + 0.5 - this.me.z;
    const prefer = Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? 1 : 3) : dz > 0 ? 2 : 0;
    return autoRampDir(this.grid, tx, tz, prefer);
  }

  stopPaint() {
    if (this.paint) this.scene.remove(this.paint.group);
    this.paint = null;
  }

  /** Paint the tile in front of the player (keyboard painting with E). */
  paintFacing() {
    if (!this.paint || !this.me) return;
    const f = this.facingTile();
    this.paint.tx = f.x;
    this.paint.tz = f.z;
    this.paint.ok = this.paintOk(f.x, f.z);
    this.paint.last = '';
    this.paintHere();
  }

  private paintOk(tx: number, tz: number) {
    if (!this.grid || !this.me) return false;
    const op = this.paint!.terra;
    if (op) {
      if (distToTile(this.me.x, this.me.z, tx, tz) > TERRA_REACH) return false;
      this.paint!.dir = op === 'ramp' ? this.rampDir(tx, tz) : -1;
      return terraformError(this.grid, op, tx, tz, this.paint!.dir) === null;
    }
    if (distToTile(this.me.x, this.me.z, tx, tz) > PATH_REACH) return false;
    return this.paint!.type ? this.grid.canPave(tx, tz) && this.grid.path(tx, tz) !== this.paint!.type : this.grid.path(tx, tz) > 0;
  }

  private paintHere() {
    const p = this.paint;
    if (!p || !p.ok) return;
    const key = `${p.tx},${p.tz}`;
    if (key === p.last) return;
    p.last = key;
    if (p.terra) this.onTerra(p.tx, p.tz, p.terra, p.dir);
    else this.onPaint(p.tx, p.tz, p.type);
  }

  /**
   * Point on the ground under the mouse. The world bend lowers distant ground
   * by k·Δz², so refine the hit a few times against that curved surface.
   */
  private pickGround(): THREE.Vector3 | null {
    if (!this.me) return null;
    this.raycaster.setFromCamera(this.mouse, this.camera);
    const base = this.groundY(this.me.x, this.me.z);
    const hit = new THREE.Vector3();
    this.groundPlane.constant = -base;
    if (!this.raycaster.ray.intersectPlane(this.groundPlane, hit)) return null;
    for (let i = 0; i < 3 && this.room?.kind !== 'interior'; i++) {
      this.groundPlane.constant = -(base - bendDrop(hit.z));
      if (!this.raycaster.ray.intersectPlane(this.groundPlane, hit)) return null;
    }
    return hit;
  }

  private updatePaintGhost() {
    const p = this.paint;
    if (!p || !this.grid || !this.me) return;
    if (this.padAim) {
      const f = this.facingTile();
      p.tx = f.x;
      p.tz = f.z;
    } else {
      const hit = this.pickGround();
      if (!hit) return;
      p.tx = Math.floor(hit.x);
      p.tz = Math.floor(hit.z);
    }
    p.ok = this.paintOk(p.tx, p.tz);
    p.group.position.set(p.tx, this.grid.surfaceY(p.tx + 0.5, p.tz + 0.5), p.tz);
    const box = p.group.getObjectByName('box') as THREE.Mesh;
    box.visible = this.grid.inBounds(p.tx, p.tz);
    box.material = mat(this.paintColor(p.ok), { opacity: 0.55 });
    // Raising previews the new block; everything else is a flat marker.
    const tall = p.terra === 'raise' && p.ok;
    box.scale.y = tall ? CLIFF : 0.04;
    box.position.y = tall ? CLIFF / 2 : 0.03;
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
    const weather = debug.weather ?? env?.weather;
    const snowy = this.room?.kind !== 'interior' && ((vs === 'winter' && this.room != null && ['temperate', 'boreal'].includes(BIOMES[this.room.biome].seasonModel)) || weather === 'snow');
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
    this.rebuildFoliage();
    setPathSnow(v.snowy);
  }

  private buildTerrain() {
    if (!this.room || !this.grid) return;
    if (this.terrain) {
      this.world.remove(this.terrain);
      this.terrain.geometry.dispose();
    }
    const m = buildTerrainMesh(this.grid, { biome: this.room.biome, ...this.visual(), interior: this.room.interior, theme: this.room.theme });
    m.add(buildDocks(this.grid)); // boardwalks & piers ride along with the terrain mesh
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
    // Wall-mounted decor sits on the wall tile but is placed from floor level.
    const wallDecor = o.kind === 'decor' && o.item?.startsWith('w_');
    mesh.position.set(o.x + 0.5, wallDecor ? baseHeight(Tile.Floor) : this.grid!.surfaceY(o.x + 0.5, o.z + 0.5), o.z + 0.5);
    mesh.traverse((c: THREE.Object3D) => (c.userData.objId = o.id));
    this.world.add(mesh);
    this.objMeshes.set(o.id, mesh);
  }

  upsertBuildingMesh(b: Building) {
    const prev = this.bldMeshes.get(b.id);
    if (prev) this.world.remove(prev);
    const flagUp = b.type === 'mailbox' && this.room?.ownerId === state.self?.id && state.mail.length > 0;
    const notes = b.type === 'billboard' ? state.room?.board?.length ?? 0 : 0;
    const mesh = buildingModel(b, net.serverNow(), this.room?.interior === 'tent' ? 'tent' : 'cabin', { flagUp, notes });
    const y = b.type === 'dock' ? 0 : this.room?.kind === 'interior' ? baseHeight(Tile.Floor) : baseHeight(Tile.Ground) + (this.grid?.level(b.x, b.z) ?? 0) * CLIFF;
    mesh.position.set(b.x + b.w / 2, y, b.z + b.h / 2);
    mesh.userData.done = b.completeAt <= net.serverNow();
    // Someone to serve you behind every counter.
    if (b.type === 'counter') {
      const keeper = makeVillager(shopkeeper(b.role));
      keeper.root.position.set(0, 0, -0.85);
      keeper.root.name = 'keeper';
      mesh.add(keeper.root);
      mesh.userData.keeper = keeper;
    }
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
      case 'board':
        if (this.room) this.room.board = m.posts;
        for (const b of this.buildings.values()) if (b.type === 'billboard') this.upsertBuildingMesh(b);
        break;
      case 'terrain':
        applyTerrain(this.grid!, m.l);
        this.scheduleTerrain();
        break;
      case 'paths':
        for (const [x, z, t] of m.l) this.grid!.paths[z * this.grid!.size + x] = t;
        this.schedulePaths();
        this.scheduleFoliage();
        break;
      case 'oAdd':
        this.scheduleFoliage();
        for (const o of m.o) {
          const prev = this.objects.get(o.id);
          if (prev) this.grid!.removeObject(prev);
          this.objects.set(o.id, o);
          this.grid!.addObject(o);
          this.upsertObjectMesh(o);
        }
        break;
      case 'oDel':
        this.scheduleFoliage();
        for (const id of m.ids) {
          const prev = this.objects.get(id);
          if (prev) this.grid!.removeObject(prev);
          this.objects.delete(id);
          const mesh = this.objMeshes.get(id);
          if (mesh && m.fx === 'fly') this.flying.push({ mesh, t0: this.clock.elapsedTime, dir: Math.random() * Math.PI * 2 });
          else if (mesh) this.world.remove(mesh);
          this.objMeshes.delete(id);
        }
        break;
      case 'bAdd':
        this.scheduleFoliage();
        for (const b of m.b) {
          if (this.ghost?.type === 'build' && this.ghost.moving === b.id) this.cancelGhost(); // our move went through
          const prev = this.buildings.get(b.id);
          if (prev) this.grid!.removeBuilding(prev);
          this.buildings.set(b.id, b);
          this.grid!.addBuilding(b);
          this.upsertBuildingMesh(b);
        }
        break;
      case 'bDel':
        this.scheduleFoliage();
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
        this.footprints.forget(m.id);
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
    this.stopPaint();
    const def = BUILDINGS[type];
    const group = new THREE.Group();
    const box = part('box', mat('#7fe07f', { opacity: 0.45 }), def.w, 0.6, def.h, def.w / 2, 0.3, def.h / 2, false);
    box.name = 'box';
    group.add(box);
    this.scene.add(group);
    this.ghost = { group, type: 'build', building: type, tx: 0, tz: 0, ok: false };
  }

  /** Pick a building up to move it: its footprint is freed while you choose the new spot. */
  startMoveGhost(b: Building) {
    this.startBuildGhost(b.type);
    const g = this.ghost as { moving?: string };
    g.moving = b.id;
    this.grid?.removeBuilding(b);
    const mesh = this.bldMeshes.get(b.id);
    if (mesh) mesh.visible = false;
  }

  /** Put a building that was being moved back (in the grid and on screen). */
  private endMove() {
    const id = this.ghost?.type === 'build' ? this.ghost.moving : undefined;
    if (!id) return;
    const b = this.buildings.get(id);
    if (b) this.grid?.addBuilding(b);
    const mesh = this.bldMeshes.get(id);
    if (mesh) mesh.visible = true;
    (this.ghost as { moving?: string }).moving = undefined;
  }

  startPlaceGhost(item: string) {
    this.cancelGhost();
    this.stopPaint();
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
    this.endMove();
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
      if (this.padAim) {
        // Controller: put the footprint just in front of the player.
        const { fx, fz } = this.facing();
        const ahead = 1.2 + Math.max(w, h) / 2;
        tx = Math.floor(this.me.x + fx * ahead - w / 2 + 0.5);
        tz = Math.floor(this.me.z + fz * ahead - h / 2 + 0.5);
      } else {
        const hit = this.pickGround();
        if (!hit) return;
        tx = Math.floor(hit.x - w / 2 + 0.5);
        tz = Math.floor(hit.z - h / 2 + 0.5);
      }
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
      if (BUILDINGS[b.type].decor || !nearBuilding(b, px, pz, 1.7)) continue;
      const done = b.completeAt <= net.serverNow();
      const def = BUILDINGS[b.type];
      const label = !done ? `${def.name} (under construction)`
        : b.type === 'dock' ? (this.room.kind === 'tour' ? 'Sail home' : 'Travel')
        : b.type === 'villager_house' && b.villagerId ? `Visit ${villagerDef(b.villagerId)?.name ?? 'their'}’s house`
        : ENTERABLE.includes(b.type) ? `Enter ${def.name}`
        : b.type === 'counter' ? (b.role === 'town_hall' ? 'Talk to the mayor’s desk' : b.role === 'restaurant' ? 'Use the kitchen' : b.role === 'travel_agent' ? 'Plan a trip' : 'Ring the bell')
        : b.type === 'exit' ? 'Go outside'
        : b.type === 'bed' ? 'Rest'
        : b.type === 'chest' ? 'Open storage chest'
        : b.type === 'mailbox' ? (this.room.kind === 'shared' ? 'Send a letter' : this.room.ownerId === state.self?.id ? `Check mailbox${state.mail.length ? ` (${state.mail.length})` : ''}` : `Leave ${this.room.ownerName ?? 'them'} a letter`)
        : b.type === 'billboard' ? `Read the billboard${this.room.board?.length ? ` (${this.room.board.length})` : ''}`
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
      case 'decor': return null;
      case 'bird': {
        const name = BIRD_BY_ID[o.bird ?? '']?.name ?? 'bird';
        const net = state.inv.bird_net || state.inv.silk_net;
        return this.tool === 'net' && net ? `Catch ${name}` : net ? `${name} (select the net)` : `${name} (craft a bird net)`;
      }
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
    // Footprints for everyone walking around outside.
    windTime.value = t;
    if (this.grid && this.room?.kind !== 'interior') {
      const snowy = this.visual().snowy;
      for (const [id, p] of this.players) this.footprints.track(id, p.x, p.z, this.grid, snowy, t);
      for (const [id, v] of this.villagers) if (!v.home) this.footprints.track(`v:${id}`, v.x, v.z, this.grid, snowy, t);
    }
    this.footprints.update(t);
    if (this.me) {
      const tgt = this.computeTarget();
      const changed = (tgt?.label ?? null) !== (this.target?.label ?? null) || (tgt && this.target && tgt.kind !== this.target.kind);
      this.target = tgt;
      if (changed) this.onTarget(tgt);
    }
    this.updateGhost();
    if (this.paint && (!this.paint.down || this.padAim)) this.updatePaintGhost();
    if (this.paint?.down && this.padAim) this.paintHere(); // hold A and walk to paint a trail
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
    // Outdoors the camera sits lower (~36°) so the rolling-log horizon and a
    // band of sky show at the top; indoors it looks more steeply down.
    const inside = this.room?.kind === 'interior';
    const desired = inside
      ? new THREE.Vector3(fx, fy + this.camDist * 0.85, fz + this.camDist * 0.78)
      : new THREE.Vector3(fx, fy + this.camDist * 0.66, fz + this.camDist * 0.92);
    this.camera.position.lerp(desired, 1 - Math.exp(-dt * 6));
    this.camera.lookAt(target.x, target.y, target.z - (inside ? 0.5 : 1.5));
    this.sun.target.position.set(fx, 0, fz);
    this.moon.target.position.set(fx, 0, fz);
    this.stars.position.copy(this.camera.position);
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
    let amount = 1;
    let running = k.has('ShiftLeft') || k.has('ShiftRight');
    const am = Math.hypot(this.analog.x, this.analog.z);
    if (am > 0 && !dx && !dz) {
      dx = this.analog.x;
      dz = this.analog.z;
      amount = Math.max(0.35, Math.min(1, am));
      running = this.analog.run;
    }
    const len = Math.hypot(dx, dz);
    if (this.cast && len > 0) {
      this.endCast(); // walking away cancels fishing
    }
    if (len > 0) {
      dx /= len; dz /= len;
      const run = (running ? 1 : 0.62) * amount;
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

  /** Birds that took off: they flap up and away, then disappear. */
  private flying: { mesh: THREE.Object3D; t0: number; dir: number }[] = [];

  private animateBirds(t: number) {
    for (const [id, mesh] of this.objMeshes) {
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
    for (let i = this.flying.length - 1; i >= 0; i--) {
      const f = this.flying[i];
      const k = this.clock.elapsedTime - f.t0;
      if (k > 1.6) {
        this.world.remove(f.mesh);
        this.flying.splice(i, 1);
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

  private animateProps(t: number) {
    this.animateBirds(t);
    const night = 1 - this.day;
    for (const mesh of this.bldMeshes.values()) {
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
        if (l) l.intensity = 1.6 + Math.sin(t * 11) * 0.3 + (1 - this.day) * 2.5;
      }
    }
    // Moored boats bob on the swell.
    for (const [id, mesh] of this.objMeshes) {
      const boat = mesh.getObjectByName('boat');
      if (!boat) continue;
      const ph = (id.charCodeAt(id.length - 1) % 7) * 0.9;
      boat.position.y = Math.sin(t * 1.3 + ph) * 0.03;
      boat.rotation.z = Math.sin(t * 1.1 + ph) * 0.04;
      boat.rotation.x = Math.sin(t * 0.8 + ph) * 0.025;
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
    const auroraOn = env.aurora ? Math.max(0, clearNight - 0.15) / 0.85 : 0;
    this.aurora.visible = auroraOn > 0.01;
    for (const [i, a] of this.aurora.children.entries()) {
      const mesh = a as THREE.Mesh;
      const mm = mesh.material as THREE.MeshBasicMaterial;
      // Slow pulsing brightness, drifting curtains and rippling folds.
      mm.opacity = auroraOn * (0.55 + Math.sin(t * 0.35 + i * 2.1) * 0.25 + Math.sin(t * 1.3 + i) * 0.08);
      if (mm.map) mm.map.offset.x = (t * 0.004 * (i + 1)) % 1;
      if (!this.aurora.visible) continue;
      const pos = mesh.geometry.attributes.position as THREE.BufferAttribute;
      const base = mesh.userData.base as Float32Array;
      for (let v = 0; v < pos.count; v++) {
        const x = base[v * 3], y = base[v * 3 + 1];
        const top = y > 0 ? 1 : 0;
        pos.setZ(v, Math.sin(x * 0.012 + t * 0.25 + i) * 28 + Math.sin(x * 0.035 - t * 0.6 + i * 3) * 9);
        pos.setY(v, y + top * Math.sin(x * 0.02 + t * 0.4 + i) * 10);
      }
      pos.needsUpdate = true;
    }
    // A faint green glow on the land under a strong aurora.
    if (auroraOn > 0) this.hemi.color.lerp(new THREE.Color('#7dffb2'), auroraOn * 0.35);

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

/** Vertical curtain texture: bright hem fading upwards, with fine rays. */
function auroraTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 128, 0, 0);
  grad.addColorStop(0, 'rgba(255,255,255,0)');
  grad.addColorStop(0.08, 'rgba(255,255,255,0.95)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.45)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 512, 128);
  // Rays: vertical streaks of varying strength.
  g.globalCompositeOperation = 'destination-in';
  for (let x = 0; x < 512; x += 2) {
    const a = 0.25 + 0.75 * Math.pow(Math.abs(Math.sin(x * 0.07) * Math.sin(x * 0.013 + 1.3)), 0.6);
    g.fillStyle = `rgba(0,0,0,${a})`;
    g.fillRect(x, 0, 2, 128);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

export { setHat };
