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
import { resetGroundWeather, snowLiftAt } from './groundLook.ts';
import { disposePuddles } from './puddles.ts';
import { CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { BIOMES, Grid, decodeTiles, type TerraOp, type Building, type RoomView, type ServerMessage, type WorldObject, type BuildingType, type Outfit } from '@hearthwood/shared';
import { bendFocusZ, bendStrength } from './bend.ts';
import { disposePaths } from './paths.ts';
import { disposeFoliage } from './foliage.ts';
import { bentCulling, StaticBatcher } from './batching.ts';
import { Footprints } from './footprints.ts';
import { windTime } from './bend.ts';
import { state, watch } from '../state.ts';
import { pendingLoads, loadsSettled } from './assets/loads.ts';
import { debug, type RenderInfo, type Mover, type Target, type Tool } from './world/common.ts';
import { addPlayer, groundY, interp, removeMover, say, swing, updateLocal } from './world/entities/players.ts';
import { animateVillagers, upsertVillager } from './world/entities/villagers.ts';
import type { VillagerModel } from './villagerModels.ts';
import { handle } from './world/messages.ts';
import { animateProps, discard, upsertBuildingMesh } from './world/room/objects.ts';
import { disposeAll } from './gpu.ts';
import { LightPool } from './lightPool.ts';
import { pickQuality } from './quality.ts';
import { addSealife, animateSealife, clearSealife } from './world/entities/sealife.ts';
import { rebuildPaths, toggleGridOverlay } from './world/room/terrainLayer.ts';
import { refreshVisuals, updateEnvironment, currentVisual } from './world/scene/environment.ts';
import { adaptResolution, resize, watchContext, zoom } from './world/scene/viewport.ts';
import { computeTarget, facingTile } from './world/targeting.ts';
import { endCast, startCast, updateFishing } from './world/tools/fishing.ts';
import { bobberModel, fishingLineModel } from './models/fishing.ts';
import { cancelGhost, rotateGhost, startBuildGhost, startMoveGhost, startPlaceGhost, updateGhost } from './world/tools/ghost.ts';
import { paintFacing, paintHere, startPaint, startTerra, stopPaint, updatePaintGhost } from './world/tools/paint.ts';
import { createAurora, createClouds, createRain, createSea, createStars } from './world/scene/sky.ts';
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
  /** Clouds in the sky band for grey weather (scene/sky.ts, faded in by scene/environment.ts). */
  clouds: THREE.Group;
  water: THREE.Mesh;
  terrain: THREE.Mesh | null = null;
  waterFx: THREE.Group | null = null;
  world = new THREE.Group();
  objMeshes = new Map<string, THREE.Object3D>();
  /** Instanced draws for static scenery (trees, rocks, bushes…), see batching.ts. */
  readonly batcher = new StaticBatcher(this.world);
  /** The few real lights, handed to the lamps and fires nearest the player (lightPool.ts). */
  readonly lights = new LightPool(this.scene);
  readonly quality = pickQuality();
  /** The browser took the WebGL context away (it gives it back by itself): nothing can be drawn meanwhile. */
  contextLost = false;
  bldMeshes = new Map<string, THREE.Object3D>();
  readonly players = new Map<string, Mover>();
  villagers = new Map<string, Mover & { home: boolean; houseId: string; outfit?: Outfit; model?: VillagerModel }>();
  rain: THREE.Points;
  rainVel: Float32Array;
  flash = 0;
  /** The latest lightning strike: how far away it hit (km). A new object for every strike. */
  strike: { km: number } | null = null;

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
  /** No walking (behind the loading screen). */
  hold = false;
  /** Scripted walk out of a front door after arriving: from z0 to z1 over `dur` seconds. */
  stepping: { t: number; dur: number; z0: number; z1: number } | null = null;
  camDist = 13;
  seasonKey = '';
  objectLookKey = '';
  outdoorRoomId = '';
  puddles: THREE.Mesh | null = null;
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
    const q = this.quality;
    // (high-performance: laptops with two GPUs use the fast one)
    this.renderer = new THREE.WebGLRenderer({ antialias: q.antialias, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(q.maxPixelRatio, window.devicePixelRatio));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = q.softShadows ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    watchContext(this);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);
    debug.renderInfo = () => this.renderInfo();
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
    this.sun.shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize);
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
    this.clouds = createClouds();
    this.camera.add(this.clouds);
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
    this.objectLookKey = '';
    if (room.kind !== 'interior' && room.id !== this.outdoorRoomId) {
      // A different island: its ground starts from its own weather (houses keep the island's).
      this.outdoorRoomId = room.id;
      resetGroundWeather();
    }
    this.footprints.clear();
    this.footprints.sandColor.set(BIOMES[room.biome].shore);
    refreshVisuals(this, true);
    rebuildPaths(this, false);
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
    this.stepping = null;
    this.cast = null;
    this.bobber.visible = false;
    this.fishLine.visible = false;
    cancelGhost(this);
    stopPaint(this);
  }

  /**
   * Get the freshly loaded room ready to show: wait for textures and models still
   * on their way, compile the shaders, and draw a couple of frames (behind the
   * loading screen) so the first visible frame doesn't stutter.
   */
  async warmUp(step: (text: string, frac: number) => void = () => {}) {
    const room = this.room;
    if (pendingLoads() > 0) {
      step('Unpacking textures…', 0.55);
      await loadsSettled();
    }
    if (this.room !== room) return;
    step('Preparing shaders…', 0.75);
    const r = this.renderer as unknown as { compileAsync?: (s: THREE.Object3D, c: THREE.PerspectiveCamera) => Promise<unknown>; compile(s: THREE.Object3D, c: THREE.PerspectiveCamera): unknown };
    try {
      if (r.compileAsync) await r.compileAsync(this.scene, this.camera);
      else r.compile(this.scene, this.camera);
    } catch (e) {
      console.warn('shader warm-up failed', e);
    }
    step('Arriving…', 0.95);
    for (let i = 0; i < 3; i++) await new Promise((res) => requestAnimationFrame(() => res(null)));
  }

  /** You arrived by walking out of this building's front door: show the last steps. */
  stepOut(buildingId: string) {
    const b = this.buildings.get(buildingId);
    if (!this.me || !b) return;
    const z1 = this.me.z;
    this.stepping = { t: 0, dur: 0.6, z0: Math.max(b.z + b.h - 0.35, z1 - 0.8), z1 };
    this.me.z = this.stepping.z0;
    this.me.r = 0;
  }

  private clearRoom() {
    clearSealife(this);
    for (const f of this.flying) discard(this, f.mesh);
    this.flying = [];
    for (const m of this.objMeshes.values()) discard(this, m);
    this.batcher.clear();
    for (const m of this.bldMeshes.values()) discard(this, m);
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
      disposeAll(this.terrain);
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
    if (this.puddles) {
      this.world.remove(this.puddles);
      disposePuddles(this.puddles);
      this.puddles = null;
    }
  }

  // ── Paths & foliage ─────────────────────────────────────────────────────

  /** Debug overlay: red = blocked, yellow = reserved (ramp landings), blue = ramps. */
  gridOverlay: THREE.Group | null = null;

  // ── Frame ───────────────────────────────────────────────────────────────
  frameTimes: number[] = [];
  /** Where the camera is heading (kept between frames: nothing is allocated in the frame loop). */
  private readonly camGoal = new THREE.Vector3();

  /** Called every frame after the world has updated (audio hooks in here). */
  onFrame: ((dt: number) => void) | null = null;
  private frame() {
    const cpu0 = performance.now();
    resize(this); // cheap unless the window changed size (F11 doesn't always send 'resize' in time)
    const rawDt = this.clock.getDelta();
    const dt = Math.min(0.1, rawDt);
    const t = this.clock.elapsedTime;
    this.frameTimes.push(rawDt);
    if (this.frameTimes.length > 60) this.frameTimes.shift();
    let spent = 0.0001, slowest = 0;
    for (const ft of this.frameTimes) {
      spent += ft;
      if (ft > slowest) slowest = ft;
    }
    debug.fps = Math.round(this.frameTimes.length / spent);
    bendStrength.value = this.room?.kind === 'interior' ? 0 : debug.bend;
    if (this.me) bendFocusZ.value = this.me.z;
    this.renderer.shadowMap.enabled = debug.shadows;
    refreshVisuals(this); // cheap no-op unless the (debug) season or snow cover changed
    if (this.room && this.me && this.grid) updateLocal(this, dt);
    for (const p of this.players.values()) if (p !== this.me) interp(this, p, dt);
    for (const v of this.villagers.values()) interp(this, v, dt);
    animateVillagers(this, dt);
    // Footprints for everyone walking around outside.
    windTime.value = t;
    if (this.grid && this.room?.kind !== 'interior') {
      const look = currentVisual(this).look, g = this.grid;
      const snowy = (x: number, z: number) => snowLiftAt(look, g, x, z); // prints sink into the snow where it lies
      for (const [id, p] of this.players) this.footprints.track(id, p.x, p.z, g, snowy, t);
      for (const [id, v] of this.villagers) if (!v.home) this.footprints.track(`v:${id}`, v.x, v.z, g, snowy, t);
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
    animateProps(this, t, dt);
    animateSealife(this, t, dt);
    // Fishing: the float bobs, the line follows the rod tip.
    updateFishing(this, t);
    // Camera follow.
    const fx = this.me?.x ?? 24, fz = this.me?.z ?? 24;
    const fy = this.me ? groundY(this, this.me.x, this.me.z) : 0;
    // Outdoors the camera sits lower (~36°) so the rolling-log horizon and a
    // band of sky show at the top; indoors it looks more steeply down.
    const inside = this.room?.kind === 'interior';
    const desired = this.camGoal;
    if (inside) desired.set(fx, fy + this.camDist * 0.85, fz + this.camDist * 0.78);
    else desired.set(fx, fy + this.camDist * 0.66, fz + this.camDist * 0.92);
    this.camera.position.lerp(desired, 1 - Math.exp(-dt * 6));
    this.camera.lookAt(fx, fy + 0.5, fz - (inside ? 0.5 : 1.5));
    this.sun.target.position.set(fx, 0, fz);
    this.moon.target.position.set(fx, 0, fz);
    this.stars.position.copy(this.camera.position);
    this.rain.position.set(fx, fy, fz);
    // (steps of 4: a whole number of cells of every ring of the sea grid, see createSea)
    this.water.position.x = Math.round(fx / 4) * 4;
    this.water.position.z = Math.round(fz / 4) * 4;
    this.onFrame?.(dt);
    this.labels.domElement.style.display = debug.labels ? '' : 'none';
    this.batcher.flush();
    bentCulling(this.camera);
    this.lights.update(fx, fz);
    adaptResolution(this, rawDt);
    if (this.contextLost) return; // (the game goes on; the picture comes back with the context)
    this.renderer.render(this.scene, this.camera);
    this.labels.render(this.scene, this.camera);
    // Numbers for the rendering stats view.
    const r = debug.render, info = this.renderer.info.render;
    r.cpuMs = performance.now() - cpu0;
    r.frameMs = rawDt * 1000;
    r.frameMaxMs = slowest * 1000;
    r.calls = info.calls;
    r.triangles = info.triangles;
    r.lines = info.lines;
    r.points = info.points;
    r.history.push(r.frameMs);
    if (r.history.length > 120) r.history.shift();
  }

  /** Scene and GPU numbers for the rendering stats view (walks the scene: call it sparingly). */
  renderInfo(): RenderInfo {
    const mem = this.renderer.info.memory;
    let objects = 0, meshes = 0, visibleMeshes = 0, instances = 0, lights = 0;
    this.scene.traverse((o: THREE.Object3D) => {
      objects++;
      if ((o as unknown as { isLight?: boolean }).isLight) lights++;
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        meshes++;
        let vis = true;
        for (let p: THREE.Object3D | null = o; p; p = p.parent) if (!p.visible) { vis = false; break; }
        if (vis) visibleMeshes++;
        if ((o as THREE.InstancedMesh).isInstancedMesh) instances += (o as THREE.InstancedMesh).count;
      }
    });
    const size = this.renderer.getSize(new THREE.Vector2());
    return {
      geometries: mem.geometries, textures: mem.textures, programs: this.renderer.info.programs?.length ?? 0,
      objects, meshes, visibleMeshes, instances, lights, shadows: this.renderer.shadowMap.enabled,
      width: size.x, height: size.y, pixelRatio: this.renderer.getPixelRatio(), gpu: gpuName(this.renderer),
      labels: this.labels.domElement.childElementCount,
    };
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

/** The graphics card's name, as far as the browser tells it. */
function gpuName(r: THREE.WebGLRenderer): string {
  try {
    const gl = r.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    return String(name).replace(/^ANGLE \((.*)\)$/, '$1').replace(/ Direct3D.*$/, '').replace(/\s+\(0x[0-9A-Fa-f]+\)/, '');
  } catch {
    return 'unknown';
  }
}
