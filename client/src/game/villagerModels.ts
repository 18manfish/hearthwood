// Villager models made in Blender (art pipeline: hearthwood-art/villagers, export_all.py).
//
//   models/villagers/villager_<species>.glb  smooth part-based model per species (no images)
//   models/villagers/fur_<villager>.jpg      that villager's painted coat
//   models/villagers/fur_n_<species>.jpg     fibre normal map shared by the species
//   models/villagers/coats.json              nose and inner-ear colour per villager
//   models/villagers/villager_anims.json     21 clips as node tracks, shared by every species
//   models/villagers/villager_props.glb      umbrella (fold morph) and the wrapped gift
//   models/villagers/villager_clothes.glb    every clothing cut, tagged with the node it hangs on
//   models/villagers/cloth.jpg               the fabric atlas (tinted by the item colour)
//
// Every species has the same node names (body, head, armL/R, legL/R, earL/R, tail,
// hatSlot, the face sets), so the clips and clothes fit all of them. Until the files have
// loaded (or if they are missing) villagers keep their procedural look.

import * as THREE from 'three';
import { garmentOf, ITEMS, type Gender, type Look, type Outfit, type Species, type VillagerDef } from '@hearthwood/shared';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { bend, bentDepth } from './bend.ts';

const BASE = '/models/villagers/';
const FUR_PARTS = new Set(['head', 'earL', 'earR', 'torso', 'armL', 'armR', 'legL', 'legR', 'tail']);
/** Items whose pattern is painted into the atlas (drawn untinted, their own cut). */
const PATTERN_CUTS = new Set(['shirt_gingham', 'skirt_denim', 'jacket_denim']);

interface ClipJson { fps: number; frames: number; loop: boolean; tracks: Record<string, number[]> }
interface AnimJson { clips: Record<string, ClipJson>; props: Record<string, { parent: string; position: [number, number, number] }> }

export interface Shared {
  clips: Map<string, THREE.AnimationClip>;
  loops: Set<string>;
  props: AnimJson['props'];
  propScene: THREE.Object3D | null;
  clothes: Map<string, THREE.Mesh[]>;
  clothTex: THREE.Texture | null;
  coats: Record<string, { nose: string; inner: string }>;
}

const loader = () => new GLTFLoader();
const texLoader = new THREE.TextureLoader();

function loadGltf(url: string): Promise<THREE.Object3D | null> {
  return new Promise((resolve) => {
    loader().load(url, (g: { scene: THREE.Object3D }) => resolve(g.scene), undefined, (e: unknown) => {
      console.warn(`villager model ${url} not loaded`, e);
      resolve(null);
    });
  });
}

function loadTex(url: string, srgb = true): Promise<THREE.Texture | null> {
  return new Promise((resolve) => {
    texLoader.load(url, (t: THREE.Texture) => {
      t.flipY = false; // glTF UV convention
      if (srgb) t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 4;
      resolve(t);
    }, undefined, () => resolve(null));
  });
}

async function loadJson<T>(url: string): Promise<T | null> {
  try {
    const r = await fetch(url);
    return r.ok ? ((await r.json()) as T) : null;
  } catch {
    return null;
  }
}

/** JSON tracks → three.js clips (names as GLTFLoader sanitises them). */
export function buildClips(data: AnimJson) {
  const clips = new Map<string, THREE.AnimationClip>();
  const loops = new Set<string>();
  for (const [name, c] of Object.entries(data.clips)) {
    const times = Array.from({ length: c.frames }, (_, i) => i / c.fps);
    const tracks: THREE.KeyframeTrack[] = [];
    for (const [key, vals] of Object.entries(c.tracks)) {
      const dot = key.lastIndexOf('.');
      const node = THREE.PropertyBinding.sanitizeNodeName(key.slice(0, dot));
      const prop = key.slice(dot + 1);
      if (prop === 'quaternion') tracks.push(new THREE.QuaternionKeyframeTrack(`${node}.quaternion`, times, vals));
      else if (prop === 'position') tracks.push(new THREE.VectorKeyframeTrack(`${node}.position`, times, vals));
      else if (prop === 'scale') tracks.push(new THREE.VectorKeyframeTrack(`${node}.scale`, times, vals));
      // a two-material mesh loads as a group of two meshes: both get the morph
      else if (prop === 'morph') for (const part of ['a', 'b']) tracks.push(new THREE.NumberKeyframeTrack(`${node}_${part}.morphTargetInfluences[0]`, times, vals));
    }
    clips.set(name, new THREE.AnimationClip(name, (c.frames - 1) / c.fps, tracks));
    if (c.loop) loops.add(name);
  }
  return { clips, loops };
}

let shared: Promise<Shared | null> | null = null;

export function loadShared(): Promise<Shared | null> {
  shared ??= (async () => {
    const [anims, props, clothes, clothTex, coats] = await Promise.all([
      loadJson<AnimJson>(BASE + 'villager_anims.json'),
      loadGltf(BASE + 'villager_props.glb'),
      loadGltf(BASE + 'villager_clothes.glb'),
      loadTex(BASE + 'cloth.jpg'),
      loadJson<Shared['coats']>(BASE + 'coats.json'),
    ]);
    if (!anims) return null;
    const { clips, loops } = buildClips(anims);
    const byCut = new Map<string, THREE.Mesh[]>();
    clothes?.traverse((o: THREE.Object3D) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || !m.userData.cut) return;
      const list = byCut.get(m.userData.cut) ?? [];
      list.push(m);
      byCut.set(m.userData.cut, list);
    });
    return { clips, loops, props: anims.props, propScene: props, clothes: byCut, clothTex, coats: coats ?? {} };
  })();
  return shared;
}

interface SpeciesAsset { scene: THREE.Object3D; normal: THREE.Texture | null }
const speciesAssets = new Map<Species, Promise<SpeciesAsset | null>>();

function loadSpecies(sp: Species) {
  let p = speciesAssets.get(sp);
  if (!p) {
    p = (async () => {
      const [scene, normal] = await Promise.all([loadGltf(BASE + `villager_${sp}.glb`), loadTex(BASE + `fur_n_${sp}.jpg`, false)]);
      return scene ? { scene, normal } : null;
    })();
    speciesAssets.set(sp, p);
  }
  return p;
}

function bentClone(src: THREE.Material): THREE.Material {
  const m = (src as THREE.MeshStandardMaterial).clone();
  return bend(m);
}

function prepMesh(o: THREE.Object3D) {
  const m = o as THREE.Mesh;
  if (!m.isMesh) return;
  m.castShadow = true;
  m.customDepthMaterial = bentDepth;
}

// ── One villager ─────────────────────────────────────────────────────────

export type Mode = 'normal' | 'sit' | 'sad' | 'umbrella' | 'fish';

export interface VillagerModel {
  root: THREE.Object3D;
  mixer: THREE.AnimationMixer;
  actions: Map<string, THREE.AnimationAction>;
  current: THREE.AnimationAction | null;
  currentName: string;
  shared: Shared;
  clothes: THREE.Object3D[];
  outfitKey: string;
  // state machine
  mode: Mode;
  lock: number; // seconds left of a transition / one-shot clip
  queue: string[]; // one-shots waiting (laugh, surprised, gift)
  sadUntil: number;
  idleFor: number;
  wantSit: boolean;
  /** Smoothed ground speed and the gait it gives (with hysteresis). */
  speed: number;
  moving: boolean;
  running: boolean;
  /** Seconds the current clip takes to blend in. */
  fade: number;
}

export async function makeVillagerModel(def: VillagerDef): Promise<VillagerModel | null> {
  const [sh, sp, fur] = await Promise.all([loadShared(), loadSpecies(def.species), loadTex(BASE + `fur_${def.id}.jpg`)]);
  if (!sh || !sp) return null;
  const root = sp.scene.clone(true);
  root.name = `villager_${def.id}`;
  const furMat = bend(new THREE.MeshStandardMaterial({ map: fur, normalMap: sp.normal, roughness: 0.85, metalness: 0 }));
  if (sp.normal) furMat.normalScale.set(0.8, 0.8);
  if (def.species === 'frog') furMat.roughness = 0.45;
  const coat = sh.coats[def.id];
  const cache = new Map<THREE.Material, THREE.Material>();
  root.traverse((o: THREE.Object3D) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    prepMesh(m);
    if (FUR_PARTS.has(m.name)) {
      m.material = furMat;
      return;
    }
    const src = m.material as THREE.Material;
    let mat = cache.get(src);
    if (!mat) {
      mat = bentClone(src);
      cache.set(src, mat);
    }
    const own = coat && (m.name === 'nose' ? coat.nose : m.name.startsWith('earIn') ? coat.inner : null);
    if (own) {
      mat = bentClone(src);
      (mat as THREE.MeshStandardMaterial).color.set(own);
    }
    m.material = mat;
  });
  return animated(root, sh);
}

/** Props, mixer and actions for a freshly cloned model (villager or player). */
function animated(root: THREE.Object3D, sh: Shared): VillagerModel {
  // Props: the umbrella in the right paw, the gift in front of the body.
  if (sh.propScene) {
    for (const [name, info] of Object.entries(sh.props) as [string, AnimJson["props"][string]][]) {
      const src = sh.propScene.getObjectByName(name);
      const parent = root.getObjectByName(info.parent);
      if (!src || !parent) continue;
      const p = src.clone(true);
      p.position.set(...info.position);
      p.quaternion.identity();
      p.scale.setScalar(0); // shown by the clips that use it
      // every piece of a prop is modelled around the prop's origin
      for (const c of p.children) {
        c.position.set(0, 0, 0);
        c.quaternion.identity();
        c.scale.setScalar(1);
      }
      const canopy = p.getObjectByName('umbCanopy');
      if (canopy) {
        const parts = (canopy as THREE.Mesh).isMesh ? [canopy] : canopy.children;
        parts.forEach((c: THREE.Object3D, i: number) => (c.name = `umbCanopy_${i ? 'b' : 'a'}`));
      }
      p.traverse((o: THREE.Object3D) => {
        prepMesh(o);
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.material = bentClone(m.material as THREE.Material);
          (m.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
        }
      });
      parent.add(p);
    }
  }
  const mixer = new THREE.AnimationMixer(root);
  const actions = new Map<string, THREE.AnimationAction>();
  for (const [name, clip] of sh.clips) {
    const a = mixer.clipAction(clip);
    if (!sh.loops.has(name)) {
      a.setLoop(THREE.LoopOnce, 1);
      a.clampWhenFinished = true;
    }
    actions.set(name, a);
  }
  const vm: VillagerModel = {
    root, mixer, actions, current: null, currentName: '', shared: sh, clothes: [], outfitKey: '',
    mode: 'normal', lock: 0, queue: [], sadUntil: 0, idleFor: 0, wantSit: false, speed: 0, moving: false, running: false, fade: 0.25,
  };
  play(vm, 'idle', 0);
  return vm;
}

/** Put the outfit on (only rebuilds when it changed). */
export function dress(vm: VillagerModel, outfit: Outfit | undefined, slots: readonly (keyof Outfit)[] = ['hat', 'top', 'bottom', 'outer']) {
  const key = JSON.stringify(outfit ?? {});
  if (key === vm.outfitKey) return;
  vm.outfitKey = key;
  for (const c of vm.clothes) c.removeFromParent();
  vm.clothes = [];
  for (const slot of slots) {
    const item = outfit?.[slot];
    if (!item) continue;
    const cut = PATTERN_CUTS.has(item) ? item : garmentOf(item);
    const pieces = vm.shared.clothes.get(cut);
    if (!pieces) continue;
    const colour = ITEMS[item]?.color ?? '#ffffff';
    for (const src of pieces) {
      const parent = vm.root.getObjectByName(src.userData.attach);
      if (!parent) continue;
      const m = src.clone();
      const o = src.userData.origin as [number, number, number];
      m.position.sub(new THREE.Vector3(...o));
      if (cut === 'sun_hat') m.position.y += 0.05; // the wide floppy brim clears the eyes
      if (src.userData.tint) {
        m.material = bend(new THREE.MeshStandardMaterial({ map: vm.shared.clothTex, color: colour, roughness: item === 'jacket_rain' ? 0.45 : 0.9, side: THREE.DoubleSide }));
      } else if (PATTERN_CUTS.has(cut)) {
        m.material = bend(new THREE.MeshStandardMaterial({ map: vm.shared.clothTex, roughness: 0.9, side: THREE.DoubleSide }));
      } else {
        m.material = bentClone(src.material as THREE.Material);
      }
      prepMesh(m);
      parent.add(m);
      vm.clothes.push(m);
    }
  }
}

/** Loops whose stride lines up: switching between them keeps the step phase. */
const STRIDES = new Set(['walk', 'run', 'chase', 'walk_sad', 'umbrella_walk']);

/**
 * Make `name` the clip to blend towards. Weights are managed here (not with three's
 * fades): the current clip rises to 1 over `fade` seconds and the others shrink so all
 * weights always add up to 1, however often the choice flips. A clip that is still
 * fading out is picked up where it is, without restarting.
 */
export function play(vm: VillagerModel, name: string, fade = 0.25, timeScale = 1) {
  const a = vm.actions.get(name);
  if (!a) return 0;
  a.setEffectiveTimeScale(timeScale);
  if (vm.currentName === name) return 0;
  const prev = vm.current;
  const once = !vm.shared.loops.has(name);
  const fading = a.isScheduled() && a.getEffectiveWeight() > 0.001;
  if (!fading || once) {
    a.reset();
    a.play();
    a.setEffectiveWeight(prev ? 0 : 1);
    // keep the feet in step when changing gait
    if (prev && STRIDES.has(name) && STRIDES.has(vm.currentName)) {
      const pc = prev.getClip().duration;
      a.time = ((prev.time % pc) / pc) * a.getClip().duration;
    }
  }
  vm.fade = Math.max(0.05, fade);
  vm.current = a;
  vm.currentName = name;
  return a.getClip().duration;
}

/** Move the weights one step (see play). */
function blendWeights(vm: VillagerModel, dt: number) {
  const cur = vm.current;
  if (!cur) return;
  const wc = Math.min(1, cur.getEffectiveWeight() + dt / vm.fade);
  let others = 0;
  for (const a of vm.actions.values()) if (a !== cur && a.isScheduled()) others += a.getEffectiveWeight();
  const k = others > 0 ? (1 - wc) / others : 0;
  for (const a of vm.actions.values()) {
    if (a === cur || !a.isScheduled()) continue;
    const w = a.getEffectiveWeight() * k;
    if (w < 0.002) a.stop();
    else a.setEffectiveWeight(w);
  }
  cur.setEffectiveWeight(others > 0 ? wc : 1);
}

/** A one-shot clip that holds the state machine until it is nearly over. */
function playLocked(vm: VillagerModel, name: string) {
  const d = play(vm, name, 0.2);
  vm.lock = Math.max(0, d - 0.18);
}

const ENTER: Record<Mode, string | null> = { normal: null, sit: 'sit_ground_down', sad: 'sad_in', umbrella: 'umbrella_open', fish: 'cast' };
const EXIT: Record<Mode, string | null> = { normal: null, sit: 'sit_ground_up', sad: 'sad_out', umbrella: 'umbrella_close', fish: null };

export interface Drive {
  speed: number;
  rain: boolean;
  /** Personality decides whether a jog is a run or a playful chase, and how often they sit (villagers only). */
  def?: VillagerDef;
  now: number;
  /** Holding a cast fishing line (players). */
  fishing?: boolean;
  /** Ground speed the walk clip is made for, and where walking turns into running. */
  walkRef?: number;
  runAt?: number;
}

/**
 * Pick and blend the clips: loops for the current mode (walking, sitting, sad, under an
 * umbrella), with the transition clips in between so every change flows.
 */
export function drive(vm: VillagerModel, dt: number, d: Drive) {
  // Smooth the speed (it comes from interpolated network positions) and switch gaits
  // with some hysteresis, so a villager doesn't flicker between clips.
  const raw = d.speed > 8 ? vm.speed : Math.min(d.speed, 5); // > 8: a teleport or a frame hitch
  vm.speed += (raw - vm.speed) * (1 - Math.exp(-dt * 8));
  vm.moving = vm.moving ? vm.speed > 0.12 : vm.speed > 0.3;
  const runAt = d.runAt ?? 2.3;
  vm.running = vm.running ? vm.speed > runAt - 0.4 : vm.speed > runAt;
  const moving = vm.moving;
  vm.idleFor = moving ? 0 : vm.idleFor + dt;
  if (moving) vm.wantSit = false;
  else if (d.def && vm.idleFor > 3.5 && !vm.wantSit && vm.mode === 'normal' && !vm.queue.length) {
    // now and then they plop down for a rest (lazy ones more often)
    const p = d.def.personality === 'lazy' ? 0.5 : d.def.personality === 'sporty' ? 0.08 : 0.2;
    vm.wantSit = Math.random() < p;
    vm.idleFor = -1e9; // decide once per stop
  }
  choose(vm, dt, d);
  blendWeights(vm, dt);
  vm.mixer.update(dt);
}

function choose(vm: VillagerModel, dt: number, d: Drive) {
  const moving = vm.moving;
  if (vm.lock > 0) {
    vm.lock -= dt;
    if (vm.lock > 0) return;
  }
  const want: Mode = vm.queue.length ? 'normal' : d.fishing ? 'fish' : d.rain ? 'umbrella' : d.now < vm.sadUntil ? 'sad' : vm.wantSit ? 'sit' : 'normal';
  if (want !== vm.mode) {
    const exit = EXIT[vm.mode];
    vm.mode = want;
    if (exit) return playLocked(vm, exit);
  }
  const enter = ENTER[vm.mode];
  if (enter && !inMode(vm)) return playLocked(vm, enter);
  if (vm.mode === 'normal' && vm.queue.length) return playLocked(vm, vm.queue.shift()!);
  const sp = vm.speed;
  const wr = d.walkRef ?? 1.3;
  const chase = d.def && (d.def.personality === 'cheerful' || d.def.personality === 'sporty');
  switch (vm.mode) {
    case 'fish': play(vm, 'fish', 0.3); break;
    case 'sit': play(vm, 'sit_ground'); break;
    case 'sad': moving ? play(vm, 'walk_sad', 0.3, clamp(sp / 0.9, 0.6, 1.6)) : play(vm, 'sad', 0.3); break;
    case 'umbrella': moving ? play(vm, 'umbrella_walk', 0.25, clamp(sp / wr, 0.6, 1.8)) : play(vm, 'umbrella_hold', 0.3); break;
    default:
      if (!moving) play(vm, 'idle', 0.3);
      else if (vm.running) play(vm, chase ? 'chase' : 'run', 0.2, clamp(sp / ((d.runAt ?? 2.3) + 0.7), 0.7, 1.5));
      else play(vm, 'walk', 0.25, clamp(sp / wr, 0.5, 1.8));
  }
}

/** Already in the loops of the current mode (past its entry clip)? */
function inMode(vm: VillagerModel) {
  const n = vm.currentName;
  switch (vm.mode) {
    case 'sit': return n === 'sit_ground' || n === 'sit_ground_down';
    case 'sad': return n === 'sad' || n === 'walk_sad' || n === 'sad_in';
    case 'umbrella': return n.startsWith('umbrella_') && n !== 'umbrella_close';
    case 'fish': return n === 'fish' || n === 'cast';
    default: return true;
  }
}

function clamp(v: number, a: number, b: number) {
  return Math.max(a, Math.min(b, v));
}

/** Reactions to talk and gifts. */
export function react(vm: VillagerModel, kind: 'laugh' | 'surprised' | 'gift' | 'sad', now: number) {
  if (kind === 'sad') {
    vm.sadUntil = now + 7000;
    return;
  }
  vm.sadUntil = 0;
  vm.wantSit = false;
  if (vm.queue.length < 2) vm.queue.push(kind);
}

/** A one-shot action clip (players: chop, dig, net, pickup). */
export function act(vm: VillagerModel, clip: string) {
  if (!vm.actions.has(clip)) return;
  vm.wantSit = false;
  vm.queue = [clip];
  if (vm.mode === 'normal') vm.lock = 0; // start right away
}

// ── Players ──────────────────────────────────────────────────────────────

const playerAssets = new Map<string, Promise<THREE.Object3D | null>>();

function loadPlayer(g: 'm' | 'f') {
  let p = playerAssets.get(g);
  if (!p) {
    p = loadGltf(BASE + `player_${g}.glb`);
    playerAssets.set(g, p);
  }
  return p;
}

function shade(hex: string, f: number) {
  const c = new THREE.Color(hex);
  return c.multiplyScalar(f);
}

/** Which of the model's alternatives a look shows (eyes, brows, nose, mouth, cheeks, hair). */
export function lookVisible(name: string, look: Look): boolean | null {
  const eye = look.eyeShape ?? 'round';
  const part = name.split('_')[1];
  if (name.startsWith('eye_')) {
    const side = name.endsWith('_R') ? 'R' : 'L';
    const want = eye === 'wink' ? (side === 'R' ? 'happy' : 'round') : eye;
    return part === want;
  }
  if (name.startsWith('shine')) {
    if (eye === 'wink') return name.startsWith('shineL');
    return eye === 'round' || eye === 'wide';
  }
  if (name.startsWith('lookbrow_')) return part === (look.brows ?? 'soft');
  if (name.startsWith('nose_')) return part === (look.nose ?? 'dot');
  if (name.startsWith('mouth_')) return part === (look.mouth ?? 'smile');
  if (name.startsWith('cheek_')) return part === (look.cheeks ?? 'blush');
  if (name.startsWith('hair_')) return part === look.hair;
  return null;
}

/** The player's model in their look; clothes go on with dress(..., PLAYER_SLOTS). */
export async function makePlayerModel(gender: Gender, look: Look): Promise<VillagerModel | null> {
  const [sh, src] = await Promise.all([loadShared(), loadPlayer(gender === 'girl' ? 'f' : 'm')]);
  if (!sh || !src) return null;
  const root = src.clone(true);
  root.name = 'player';
  const colour: Record<string, THREE.Color> = {
    skin: new THREE.Color(look.skin),
    skin_in: shade(look.skin, 0.88),
    shirt: new THREE.Color(look.shirt),
    pants: new THREE.Color(look.pants),
    eye: new THREE.Color(look.eyes),
    brow: shade(look.hairColor, 0.8),
    hair: new THREE.Color(look.hairColor),
    hair_tie: new THREE.Color('#e86fae'),
    nose: shade(look.skin, 0.86),
    freckle: shade(look.skin, 0.72),
  };
  const mats = new Map<THREE.Material, THREE.Material>();
  const hide: THREE.Object3D[] = [];
  root.traverse((o: THREE.Object3D) => {
    // GLTFLoader names the meshes of a multi-material node after the node, so look at
    // the nearest named ancestor for the alternatives
    const vis = lookVisible(o.name, look);
    if (vis === false) hide.push(o);
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    prepMesh(m);
    const list = Array.isArray(m.material) ? m.material : [m.material];
    const out = list.map((src: THREE.Material) => {
      let mat = mats.get(src);
      if (!mat) {
        mat = bentClone(src);
        const c = colour[src.name.replace(/\.\d+$/, '')];
        if (c) (mat as THREE.MeshStandardMaterial).color.copy(c);
        mats.set(src, mat);
      }
      return mat;
    });
    m.material = Array.isArray(m.material) ? out : out[0];
  });
  for (const o of hide) o.visible = false;
  return animated(root, sh);
}

export const PLAYER_SLOTS = ['hat', 'top', 'bottom', 'outer', 'shoes', 'gloves'] as const;
