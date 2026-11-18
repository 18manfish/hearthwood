// Game creation tool: the 3D preview next to the form – the model a row would
// give in the game, built from the unsaved edit.

import * as THREE from 'three';
import {
  BIRD_BY_ID, BUILDINGS, ITEMS, Grid, Tile, HAIR_STYLES, PATHS, tiersOf, villagerDefaultOutfit,
  type Building, type BuildingType, type GameTable, type Gender, type Look, type Outfit, type PathDef, type VillagerDef,
} from '@hearthwood/shared';
import { disposeTree } from '../game/gpu.ts';
import { h } from '../ui/dom.ts';
import { birdModel, buildingModel, furnitureModel } from '../game/models.ts';
import { caughtFishModel } from '../game/models/fish.ts';
import { buildPaths } from '../game/paths.ts';
import { makeVillager, animateRig, type Rig } from '../game/characters.ts';
import { advance, dress, makePlayerModel, makeVillagerModel, play, PLAYER_SLOTS, type VillagerModel } from '../game/villagerModels.ts';
import { btn } from './controls.ts';

type Row = Record<string, unknown>;

class Preview3D {
  readonly el = h('div', { class: 'preview3d' });
  /** Buttons under the preview (animations, tiers, …), set per row. */
  readonly controls = h('div', { class: 'pv-controls' });
  /** A Blender model (villager / player) whose clips play in the preview. */
  vm: VillagerModel | null = null;
  /** Bumped on every show so a model that finishes loading late is dropped. */
  seq = 0;
  private renderer: THREE.WebGLRenderer | null = null;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(32, 4 / 3, 0.05, 80);
  private obj: THREE.Object3D | null = null;
  private rig: Rig | null = null;
  constructor() {
    try {
      this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
      this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
      this.el.appendChild(this.renderer.domElement);
    } catch {
      this.el.append(h('div', { class: 'muted', style: 'padding:20px' }, 'No WebGL – preview unavailable.'));
    }
    this.scene.add(new THREE.HemisphereLight('#ffffff', '#88aa66', 1.6));
    const d = new THREE.DirectionalLight('#fff4dc', 1.8);
    d.position.set(2, 4, 3);
    this.scene.add(d);
    const clock = new THREE.Clock();
    let fw = 0, fh = 0;
    this.renderer?.setAnimationLoop(() => {
      if (!this.renderer || !this.el.isConnected) return;
      const w = this.el.clientWidth, hh = this.el.clientHeight;
      if (w && hh && (w !== fw || hh !== fh)) {
        fw = w;
        fh = hh;
        this.renderer.setSize(w, hh, false);
        this.camera.aspect = w / hh;
        this.camera.updateProjectionMatrix();
      }
      const dt = clock.getDelta();
      if (this.obj) this.obj.rotation.y += dt * 0.6;
      if (this.rig) animateRig(this.rig, dt, 0, 0);
      if (this.vm) {
        advance(this.vm, dt);
        const cur = this.vm.current;
        if (cur && !cur.isRunning() && this.vm.currentName !== 'idle') play(this.vm, 'idle', 0.3); // one-shots go back to idle
      }
      this.renderer.render(this.scene, this.camera);
    });
  }
  show(o: THREE.Object3D | null, rig: Rig | null = null, fit = 1.4, vm: VillagerModel | null = null) {
    if (this.obj) {
      this.scene.remove(this.obj);
      disposeTree(this.obj);
    }
    this.obj = o;
    this.rig = rig;
    this.vm = vm;
    if (!o) return;
    const holder = new THREE.Group();
    holder.add(o);
    this.obj = holder;
    this.scene.add(holder);
    const box = new THREE.Box3().setFromObject(o);
    const size = box.getSize(new THREE.Vector3());
    const c = box.getCenter(new THREE.Vector3());
    o.position.sub(new THREE.Vector3(c.x, box.min.y, c.z));
    const r = Math.max(size.x, size.y, size.z, 0.3) * fit;
    this.camera.position.set(0, size.y * 0.6 + r * 0.45, r * 1.9);
    this.camera.lookAt(0, size.y * 0.45, 0);
  }
}

/** The one preview of the tool: its canvas and the buttons under it. */
export const preview = new Preview3D();

/** The game's own tables, which the model builders read, as plain maps so an unsaved row can stand in. */
const tables = {
  items: ITEMS as Record<string, unknown>,
  birds: BIRD_BY_ID as Record<string, unknown>,
  buildings: BUILDINGS as Record<string, unknown>,
  paths: PATHS as unknown as Record<string, unknown>,
};

/** Run `fn` with `row` standing in for its entry in a shared table (so models use the unsaved edit). */
function withRow<T>(map: Record<string, unknown>, key: string, row: unknown, fn: () => T): T {
  const had = key in map, prev = map[key];
  map[key] = row;
  try {
    return fn();
  } finally {
    if (had) map[key] = prev;
    else delete map[key];
  }
}

/** Clips worth trying in the preview (the rest are transitions). */
const PREVIEW_CLIPS: [string, string][] = [
  ['idle', 'Idle'], ['walk', 'Walk'], ['run', 'Run'], ['chase', 'Chase'], ['sit_chair', 'Sit'], ['sit_ground', 'Sit (ground)'],
  ['laugh', 'Laugh'], ['surprised', 'Surprised'], ['gift', 'Gift'], ['sad', 'Sad'], ['umbrella_hold', 'Umbrella'],
];
const PLAYER_CLIPS: [string, string][] = [['idle', 'Idle'], ['walk', 'Walk'], ['run', 'Run'], ['chop', 'Chop'], ['dig', 'Dig'], ['cast', 'Cast'], ['pickup', 'Pick up']];

function clipButtons(vm: VillagerModel, clips: [string, string][]) {
  const row = h('div', { class: 'pv-row' }, h('span', { class: 'muted' }, 'Animation'));
  const draw = (cur: string) => {
    row.replaceChildren(h('span', { class: 'muted' }, 'Animation'),
      ...clips.filter(([c]) => vm.actions.has(c)).map(([c, label]) => btn(label, c === cur, () => { play(vm, c, 0.25); draw(c); })));
  };
  draw('idle');
  return row;
}

// What the preview last showed for kinds of rows that have a choice to make.
let previewGender: Gender = 'girl';
const levelPick: Record<string, number> = {};
let villagerHouseFor = '';

function previewLook(gender: Gender): Look {
  return { skin: '#f1c27d', hair: HAIR_STYLES[gender][0], hairColor: '#5a3a1e', eyes: '#2b1d14', shirt: '#f4f1ea', pants: '#34495e', shoes: '#8d6e63' } as Look;
}

/** A little 7×7 lawn with a ring and a cross of this path, so joins, ends and corners show. */
function pathPatch(r: PathDef): THREE.Object3D {
  const n = 7;
  const tiles = new Uint8Array(n * n).fill(Tile.Ground);
  const paths = new Uint8Array(n * n);
  const lay = (x: number, z: number) => (paths[z * n + x] = r.id);
  for (let i = 1; i < 6; i++) { lay(i, 1); lay(i, 5); lay(1, i); lay(5, i); lay(3, i); }
  lay(3, 0); lay(6, 3); lay(5, 3); lay(4, 3);
  const grid = new Grid(n, tiles, undefined, undefined, paths);
  const g = new THREE.Group();
  const lawn = new THREE.Mesh(new THREE.BoxGeometry(n, 0.2, n), new THREE.MeshStandardMaterial({ color: '#7fb85a', roughness: 1 }));
  lawn.position.set(n / 2, (grid.surfaceY(n / 2, n / 2) || 0) - 0.1, n / 2);
  g.add(lawn);
  g.add(withRow(tables.paths, String(r.id - 1), r, () => buildPaths(grid)));
  g.position.set(-n / 2, 0, -n / 2);
  const holder = new THREE.Group();
  holder.add(g);
  return holder;
}

/** What a builder gets: the row, a way to tell it has been overtaken, and a way to build again after a choice. */
interface Job {
  r: Row;
  /** False once another row is shown (models load in the background). */
  current(): boolean;
  again(): void;
  villagers: VillagerDef[];
}

function villagerPreview({ r, current }: Job) {
  const def = r as unknown as VillagerDef;
  // The simple box villager right away, the Blender model (dressed) once it has loaded.
  const rig = makeVillager(def);
  preview.show(rig.root, rig, 1.3);
  void makeVillagerModel(def).then((vm) => {
    if (!vm || !current()) return;
    dress(vm, (def.outfit as Outfit | undefined) ?? villagerDefaultOutfit(def.id));
    preview.show(vm.root, null, 1.3, vm);
    preview.controls.replaceChildren(clipButtons(vm, PREVIEW_CLIPS));
  });
}

function itemPreview({ r, current, again }: Job) {
  const id = r.id as string;
  if (r.category === 'furniture') return preview.show(withRow(tables.items, id, r, () => furnitureModel(id, 0)));
  preview.show(null);
  if (!r.wear) return;
  // Clothes: on the player model (boy or girl), wearing nothing else.
  const gender = previewGender;
  void makePlayerModel(gender, previewLook(gender)).then((vm) => {
    if (!vm || !current()) return;
    withRow(tables.items, id, r, () => dress(vm, { [r.wear as string]: id } as Outfit, PLAYER_SLOTS));
    preview.show(vm.root, null, 1.25, vm);
    preview.controls.replaceChildren(
      h('div', { class: 'pv-row' }, h('span', { class: 'muted' }, 'Worn by'),
        (['girl', 'boy'] as Gender[]).map((g) => btn(g === 'girl' ? 'Girl' : 'Boy', g === gender, () => { previewGender = g; again(); }))),
      clipButtons(vm, PLAYER_CLIPS));
  });
}

function buildingPreview({ r, again, villagers }: Job) {
  const type = r.type as BuildingType;
  const tiers = tiersOf(type);
  const level = Math.min(levelPick[type] ?? 1, Math.max(1, tiers.length));
  const b: Building = { id: `preview_${type}`, type, x: 0, z: 0, w: r.w as number, h: r.h as number, completeAt: 0, level };
  if (type === 'villager_house' && villagerHouseFor) b.villagerId = villagerHouseFor;
  preview.show(withRow(tables.buildings, type, r, () => buildingModel(b, Date.now())), null, 1.2);
  if (tiers.length) {
    preview.controls.append(h('div', { class: 'pv-row' }, h('span', { class: 'muted' }, 'Tier'),
      tiers.map((tier, i) => btn(`${tier.icon} ${tier.name}`, i + 1 === level, () => { levelPick[type] = i + 1; again(); }, tier.description))));
    const tier = tiers[level - 1];
    if (tier) preview.controls.append(h('div', { class: 'muted pv-note' }, tier.description));
  }
  if (type === 'villager_house') {
    const sel = h('select', { onchange: () => { villagerHouseFor = sel.value; again(); } },
      h('option', { value: '' }, 'No one yet (random style)'),
      villagers.map((v) => h('option', { value: v.id, selected: v.id === villagerHouseFor }, v.name))) as HTMLSelectElement;
    preview.controls.append(h('div', { class: 'pv-row' }, h('span', { class: 'muted' }, 'Home of'), sel));
  }
}

/** How each table's rows are shown; tables without an entry have nothing to show. */
const BUILDERS: Partial<Record<GameTable, (job: Job) => void>> = {
  villagers: villagerPreview,
  items: itemPreview,
  buildings: buildingPreview,
  birds: ({ r }) => preview.show(withRow(tables.birds, r.id as string, r, () => birdModel(r.id as string, 0)), null, 1.6),
  // The kit model when there is one (new fish show their emoji).
  fish: ({ r }) => preview.show(withRow(tables.items, r.id as string, { ...ITEMS[r.id as string], ...r, category: 'fish' }, () => caughtFishModel(r.id as string)), null, 1.6),
  paths: ({ r }) => preview.show(pathPatch(r as unknown as PathDef), null, 0.75),
};

/** Build a model from an (unsaved) row so the preview matches the edit. `villagers`: who could live in a house. */
export function previewRow(t: GameTable, r: Row, villagers: VillagerDef[]) {
  const seq = ++preview.seq;
  preview.controls.replaceChildren();
  const build = BUILDERS[t];
  try {
    if (build) return build({ r, villagers, current: () => seq === preview.seq, again: () => previewRow(t, r, villagers) });
  } catch (e) {
    console.warn('preview failed', e);
  }
  preview.show(null);
}
