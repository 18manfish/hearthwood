// The 3D island view. World owns the scene, the camera, the current room and its
// meshes, and runs the frame loop; the work lives in ./world:
//   world/scene/environment.ts   light, sky, weather, camera zoom
//   world/room/terrainLayer.ts   terrain, water, paths and foliage layers
//   world/room/objects.ts        object and building meshes, moving props
//   world/entities/players.ts    players: prediction, interpolation, labels
//   world/entities/villagers.ts  villagers and birds
//   world/tools/*.ts             painting/terraforming, placement ghosts, fishing
//   world/targeting.ts           what the player is facing
//   world/messages.ts            server messages that change the view

import * as THREE from 'three';
import { CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { BIOMES, Grid, decodeTiles, type TerraOp, type Building, type RoomView, type ServerMessage, type WorldObject, type BuildingType } from '@hearthwood/shared';
import { bendFocusZ, bendStrength } from './bend.ts';
import { disposePaths } from './paths.ts';
import { disposeFoliage } from './foliage.ts';
import { Footprints } from './footprints.ts';
import { windTime } from './bend.ts';
import { state, watch } from '../state.ts';
import { debug, type Mover, type Target, type Tool } from './world/common.ts';
import { addPlayer, groundY, interp, removeMover, say, swing, updateLocal } from './world/entities/players.ts';
import { upsertVillager } from './world/entities/villagers.ts';
import { handle } from './world/messages.ts';
import { animateProps, upsertBuildingMesh } from './world/room/objects.ts';
import { addSealife, animateSealife, clearSealife } from './world/entities/sealife.ts';
import { rebuildPaths, toggleGridOverlay } from './world/room/terrainLayer.ts';
import { refreshVisuals, resize, updateEnvironment, currentVisual, zoom } from './world/scene/environment.ts';
import { computeTarget, facingTile } from './world/targeting.ts';
import { endCast, startCast, updateFishing } from './world/tools/fishing.ts';
import { bobberModel, fishingLineModel } from './models/fishing.ts';
import { cancelGhost, rotateGhost, startBuildGhost, startMoveGhost, startPlaceGhost, updateGhost } from './world/tools/ghost.ts';
import { paintFacing, paintHere, startPaint, startTerra, stopPaint, updatePaintGhost } from './world/tools/paint.ts';
import { createAurora, createRain, createSea, createStars } from './world/scene/sky.ts';
import { bindPointer } from './world/tools/pointer.ts';

export { PLAYER_SPEED, debug, type Tool, type Target } from './world/common.ts';

export class World {
  readonly renderer: THREE.WebGLRenderer;
  readonly labels: CSS2DRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(38, 1, 0.1, 400);
  sun = new THREE.DirectionalLight('#fff4dc', 2);
  moon = new THREE.DirectionalLight('#9db7ff', 0.3);
  hemi = new THREE.HemisphereLight('#d8f0ff', '#6b8f4a', 0.6);
  stars: THREE.Points;
  aurora: THREE.Group;
  water: THREE.Mesh;
  terrain: THREE.Mesh | null = null;
  waterFx: THREE.Group | null = null;
  world = new THREE.Group();
  objMeshes = new Map<string, THREE.Object3D>();
  bldMeshes = new Map<string, THREE.Object3D>();
  readonly players = new Map<string, Mover>();
  villagers = new Map<string, Mover & { home: boolean; houseId: string }>();
  rain: THREE.Points;
  rainVel: Float32Array;
  flash = 0;

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
  lastSent = { x: 0, z: 0, r: 0, at: 0 };
  camDist = 13;
  seasonKey = '';
  clock = new THREE.Clock();
  bobber: THREE.Group;
  /** The fishing line from the rod tip to the float. */
  fishLine: THREE.Line;
  cast: { id: string | null; x: number; z: number; bite: boolean; window: number; at: number } | null = null;
  ghost: { group: THREE.Group; type: 'build'; building: BuildingType; tx: number; tz: number; ok: boolean; moving?: string } | { group: THREE.Group; type: 'place'; item: string; rot: number; tx: number; tz: number; ok: boolean } | null = null;
  /** Path painting: type 1..5, or 0 for the eraser. */
  paint: { type: number; terra?: TerraOp; dir: number; group: THREE.Group; tx: number; tz: number; ok: boolean; down: boolean; last: string } | null = null;
  onPaint: (x: number, z: number, type: number) => void = () => {};
  onTerra: (x: number, z: number, op: TerraOp, dir: number) => void = () => {};
  terrainTimer: ReturnType<typeof setTimeout> | null = null;
  pathLayer: THREE.Group | null = null;
  foliage: THREE.Group | null = null;
  foliageTimer: ReturnType<typeof setTimeout> | null = null;
  pathTimer: ReturnType<typeof setTimeout> | null = null;
  readonly footprints = new Footprints();
  mouse = new THREE.Vector2(-9, -9);
  raycaster = new THREE.Raycaster();
  groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.12);

  onTarget: (t: Target | null) => void = () => {};
  onGhostClick: () => void = () => {};

  constructor(readonly container: HTMLElement) {
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
    // CSS2DRenderer gives every label its own (large) z-index to sort them by
    // distance; z-index 0 here keeps that sorting inside this layer, so names
    // never show through the HUD's menus and dialogs.
    this.labels.domElement.style.zIndex = '0';
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

    // Ocean: finely subdivided so it can follow the world bend; it travels with the player.
    this.water = createSea();
    this.scene.add(this.water);

    this.stars = createStars();
    this.scene.add(this.stars);

    this.aurora = createAurora();
    this.camera.add(this.aurora);
    this.scene.add(this.camera);

    // Weather particles.
    ({ rain: this.rain, vel: this.rainVel } = createRain());
    this.scene.add(this.rain);

    this.bobber = bobberModel();
    this.bobber.visible = false;
    this.scene.add(this.bobber);
    this.fishLine = fishingLineModel();
    this.scene.add(this.fishLine);

    resize(this);
    window.addEventListener('resize', () => resize(this));
    document.addEventListener('fullscreenchange', () => resize(this));
    bindPointer(this);
    this.scene.add(this.footprints.mesh);
    this.renderer.setAnimationLoop(() => this.frame());
    // Raise / lower the mailbox flag when mail arrives or is taken.
    watch(['mail'], () => {
      for (const b of this.buildings.values()) if (b.type === 'mailbox') upsertBuildingMesh(this, b);
    });
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
    refreshVisuals(this, true);
    rebuildPaths(this);
    for (const b of room.buildings) upsertBuildingMesh(this, b);
    for (const p of room.players) addPlayer(this, p);
    for (const v of room.villagers) upsertVillager(this, v);
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
    addSealife(this);
    if (debug.grid) toggleGridOverlay(this, true);
    this.cast = null;
    this.bobber.visible = false;
    this.fishLine.visible = false;
    cancelGhost(this);
    stopPaint(this);
  }

  private clearRoom() {
    clearSealife(this);
    for (const f of this.flying) this.world.remove(f.mesh);
    this.flying = [];
    for (const m of this.objMeshes.values()) this.world.remove(m);
    for (const m of this.bldMeshes.values()) this.world.remove(m);
    for (const p of this.players.values()) removeMover(this, p);
    for (const v of this.villagers.values()) removeMover(this, v);
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

  /** Debug overlay: red = blocked, yellow = reserved (ramp landings), blue = ramps. */
  gridOverlay: THREE.Group | null = null;

  // ── Frame ───────────────────────────────────────────────────────────────
  frameTimes: number[] = [];
  /** Called every frame after the world has updated (audio hooks in here). */
  onFrame: ((dt: number) => void) | null = null;
  private frame() {
    resize(this); // cheap unless the window changed size (F11 doesn't always send 'resize' in time)
    const rawDt = this.clock.getDelta();
    const dt = Math.min(0.1, rawDt);
    const t = this.clock.elapsedTime;
    this.frameTimes.push(rawDt);
    if (this.frameTimes.length > 60) this.frameTimes.shift();
    debug.fps = Math.round(this.frameTimes.length / this.frameTimes.reduce((a, b) => a + b, 0.0001));
    bendStrength.value = this.room?.kind === 'interior' ? 0 : debug.bend;
    if (this.me) bendFocusZ.value = this.me.z;
    this.renderer.shadowMap.enabled = debug.shadows;
    refreshVisuals(this); // cheap no-op unless the (debug) season or snow cover changed
    if (this.room && this.me && this.grid) updateLocal(this, dt);
    for (const p of this.players.values()) if (p !== this.me) interp(this, p, dt);
    for (const v of this.villagers.values()) interp(this, v, dt);
    // Footprints for everyone walking around outside.
    windTime.value = t;
    if (this.grid && this.room?.kind !== 'interior') {
      const snowy = currentVisual(this).snowy;
      for (const [id, p] of this.players) this.footprints.track(id, p.x, p.z, this.grid, snowy, t);
      for (const [id, v] of this.villagers) if (!v.home) this.footprints.track(`v:${id}`, v.x, v.z, this.grid, snowy, t);
    }
    this.footprints.update(t);
    if (this.me) {
      const tgt = computeTarget(this);
      const changed = (tgt?.label ?? null) !== (this.target?.label ?? null) || (tgt && this.target && tgt.kind !== this.target.kind);
      this.target = tgt;
      if (changed) this.onTarget(tgt);
    }
    updateGhost(this);
    if (this.paint && (!this.paint.down || this.padAim)) updatePaintGhost(this);
    if (this.paint?.down && this.padAim) paintHere(this); // hold A and walk to paint a trail
    updateEnvironment(this, dt, t);
    animateProps(this, t);
    animateSealife(this, t, dt);
    // Fishing: the float bobs, the line follows the rod tip.
    updateFishing(this, t);
    // Camera follow.
    const fx = this.me?.x ?? 24, fz = this.me?.z ?? 24;
    const fy = this.me ? groundY(this, this.me.x, this.me.z) : 0;
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
    this.onFrame?.(dt);
    this.labels.domElement.style.display = debug.labels ? '' : 'none';
    this.renderer.render(this.scene, this.camera);
    this.labels.render(this.scene, this.camera);
  }

  /** Birds that took off: they flap up and away, then disappear. */
  flying: { mesh: THREE.Object3D; t0: number; dir: number }[] = [];

  // ── Day / night & weather ───────────────────────────────────────────────
  day = 1;

  // ── API for main.ts and the HUD (the work lives in ./world) ─────────────
  zoom(delta: number) {
    return zoom(this, delta);
  }

  resize() {
    return resize(this);
  }

  startPaint(type: number) {
    return startPaint(this, type);
  }

  /** Terraforming uses the same click-and-drag tile cursor as path painting. */
  startTerra(op: TerraOp) {
    return startTerra(this, op);
  }

  stopPaint() {
    return stopPaint(this);
  }

  /** Paint the tile in front of the player (keyboard painting with E). */
  paintFacing() {
    return paintFacing(this);
  }

  /** Rebuild terrain + vegetation when the season (or snow cover) changes. */
  refreshVisuals(force = false) {
    return refreshVisuals(this, force);
  }

  toggleGridOverlay(on: boolean) {
    return toggleGridOverlay(this, on);
  }

  /** Show a speech bubble above a villager for a few seconds. */
  say(id: string, text: string) {
    return say(this, id, text);
  }

  handle(m: ServerMessage) {
    return handle(this, m);
  }

  startCast(x: number, z: number) {
    return startCast(this, x, z);
  }

  endCast() {
    return endCast(this);
  }

  startBuildGhost(type: BuildingType) {
    return startBuildGhost(this, type);
  }

  /** Pick a building up to move it: its footprint is freed while you choose the new spot. */
  startMoveGhost(b: Building) {
    return startMoveGhost(this, b);
  }

  startPlaceGhost(item: string) {
    return startPlaceGhost(this, item);
  }

  rotateGhost() {
    return rotateGhost(this);
  }

  cancelGhost() {
    return cancelGhost(this);
  }

  facingTile() {
    return facingTile(this);
  }

  groundY(x: number, z: number) {
    return groundY(this, x, z);
  }

  swing() {
    return swing(this);
  }
}
