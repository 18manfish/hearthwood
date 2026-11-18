// Admin tool: the island editor – a map to paint terrain, paths, objects and
// buildings on, with the island's details, villagers and dangerous actions beside it.

import {
  BIOMES, BUILDINGS, ITEMS, ITEM_LIST, PATHS, TREES, Tile, decodeTiles, encodeTiles, villagerDef, type Building, type BuildingType, type TreeSpecies, type WorldObject,
} from '@hearthwood/shared';
import { h, clear } from '../ui/dom.ts';
import { drawMap, mapLegend, TILE_NAMES } from './islandMap.ts';
import { dangerBox, detailsBox, selectionBox, villagersBox } from './islandPanels.ts';
import { call, select, shell, toast, guardUnsaved } from './ui.ts';

export interface IslandView {
  record: {
    id: string; name: string; biome: string; seed: number; access: string; inviteCode: string; foundedDayKey: string; ownerId: string; size?: number;
    map: { x: number; y: number }; objects: WorldObject[]; buildings: Building[]; villagers: { defId: string; houseId: string; movedInAt: number; friendship: Record<string, unknown> }[];
    terrain?: unknown;
  };
  owner: { id: string; name: string; username: string | null } | null;
  size: number; tiles: string; levels: string; ramps: string; paths: string; spawn: { x: number; z: number }; loaded: boolean;
  players: { id: string; name: string; x: number; z: number }[];
  villagers: { id: string; x: number; z: number; home: boolean }[];
  birds: WorldObject[];
}


/** Load an island from the server into the editor (back to the list if it is gone). */
export async function islandPage(id: string, focus?: string) {
  const v = await call<IslandView>('GET', `/api/admin/islands/${id}`);
  if (v) islandEditor(v, focus);
  else location.hash = 'islands';
}

/** The editor's state, as its map and side panels see it. */
export interface Editor {
  /** The island as the server sent it. */
  readonly v: IslandView;
  readonly rec: IslandView['record'];
  readonly size: number;
  readonly biome: (typeof BIOMES)[keyof typeof BIOMES] | undefined;
  /** Colour of plain ground in this biome. */
  readonly ground: string;
  /** Working copy – sent to the server on save. */
  readonly d: { tiles: Uint8Array; levels: Uint8Array; ramps: Uint8Array; paths: Uint8Array; objects: WorldObject[]; buildings: Building[]; villagers: IslandView['record']['villagers'] };
  /** Which parts of the working copy differ from the server's. */
  readonly dirty: Set<'terrain' | 'paths' | 'objects' | 'buildings' | 'villagers'>;
  sel: { kind: 'object'; o: WorldObject } | { kind: 'building'; b: Building } | null;
  /** Pixels per tile on the map. */
  cell: number;
  draw(): void;
  drawSide(): void;
  /** Start over with a fresh copy from the server (after a save). */
  reopen(island: IslandView): void;
}

function islandEditor(v: IslandView, focus?: string) {
  const rec = v.record;
  const size = v.size;
  const biome = BIOMES[rec.biome as keyof typeof BIOMES];
  const ground = biome?.ground.default ?? biome?.ground.summer ?? '#79b84c';
  const d = {
    tiles: decodeTiles(v.tiles), levels: decodeTiles(v.levels), ramps: decodeTiles(v.ramps), paths: decodeTiles(v.paths),
    objects: structuredClone(rec.objects), buildings: structuredClone(rec.buildings), villagers: structuredClone(rec.villagers),
  };
  const dirty: Editor['dirty'] = new Set();
  const focusB = focus ? d.buildings.find((b) => b.id === focus) : undefined;
  const ed: Editor = {
    v, rec, size, biome, ground, d, dirty,
    sel: focusB ? { kind: 'building', b: focusB } : null,
    cell: Math.max(6, Math.floor(760 / size)),
    draw, drawSide, reopen: (island) => islandEditor(island),
  };
  let tool: 'select' | 'terrain' | 'path' | 'object' | 'building' | 'erase' | 'move' = 'select';
  let nid = 1;
  const newId = (p: string) => {
    let id: string;
    do id = `${p}${Date.now() % 100000}${nid++}`; while (d.objects.some((o) => o.id === id) || d.buildings.some((b) => b.id === id));
    return id;
  };

  const canvas = h('canvas') as HTMLCanvasElement;
  const tip = h('div', { class: 'maptip', style: 'display:none' });
  const mapWrap = h('div', { class: 'mapwrap' }, canvas, tip);
  const side = h('div', { class: 'col', style: 'gap:16px' });
  const saveBtn = h('button', { class: 'btn', onclick: () => save() }, '💾 Save island') as HTMLButtonElement;
  const status = h('span', { class: 'muted' });
  const toolbar = h('div', { class: 'toolbar' });
  const opts = h('div', { class: 'toolbar' });

  shell('islands', h('div', { class: 'col', style: 'gap:12px' },
    h('div', { class: 'row' }, h('a', { class: 'btn ghost small', href: '#islands' }, '← All islands'),
      h('h2', { style: 'margin:0' }, `🏝️ ${rec.name}`),
      h('span', { class: 'muted' }, `${rec.id} · ${biome?.name ?? rec.biome} · ${size}×${size} · owner `),
      v.owner ? h('a', { href: `#player/${v.owner.id}` }, v.owner.name) : '?',
      v.loaded ? h('span', { class: 'pill ok' }, `live · ${v.players.length} here`) : h('span', { class: 'pill' }, 'not loaded'),
      h('span', { style: 'flex:1' }), status, saveBtn),
    h('div', { class: 'split' }, h('div', { class: 'box' }, toolbar, opts, mapWrap, mapLegend(ed)), side)));

  // ── Drawing ──────────────────────────────────────────────────────────────
  const idx = (x: number, z: number) => z * size + x;
  function draw() {
    drawMap(canvas, ed, draw);
    status.textContent = dirty.size ? `Unsaved: ${[...dirty].join(', ')}` : 'No unsaved changes';
    saveBtn.disabled = !dirty.size;
  }

  // ── Hit testing ──────────────────────────────────────────────────────────
  const tileAtEvent = (e: MouseEvent) => {
    const r = canvas.getBoundingClientRect();
    const x = Math.floor(((e.clientX - r.left) / r.width) * size);
    const z = Math.floor(((e.clientY - r.top) / r.height) * size);
    return x >= 0 && z >= 0 && x < size && z < size ? { x, z } : null;
  };
  const buildingAt = (x: number, z: number) => d.buildings.find((b) => x >= b.x && x < b.x + b.w && z >= b.z && z < b.z + b.h);
  const objectAt = (x: number, z: number) => d.objects.find((o) => o.x === x && o.z === z);

  // ── Tools ────────────────────────────────────────────────────────────────
  const brushTile = select(TILE_NAMES.map(([t, n]) => [String(t), n]), String(Tile.Ground));
  const brushLevel = select([['0', 'Level 0'], ['1', 'Level 1'], ['2', 'Level 2'], ['3', 'Level 3']], '0');
  const brushDir = select([['0', 'Ramp up ↑ north'], ['1', 'Ramp up → east'], ['2', 'Ramp up ↓ south'], ['3', 'Ramp up ← west']], '0');
  const brushPath = select([['0', 'No path (eraser)'], ...PATHS.map((p) => [String(p.id), p.name] as [string, string])], '1');
  const objKind = select(['tree', 'rock', 'bush', 'flower', 'mushroom', 'stump', 'furniture'].map((k) => [k, k]), 'tree');
  const objSpecies = select((Object.keys(TREES) as TreeSpecies[]).map((t) => [t, TREES[t].name]), biome?.trees[0]?.species ?? 'oak');
  const objItem = select(ITEM_LIST.filter((i) => i.category === 'furniture').map((i) => [i.id, `${i.icon} ${i.name}`]), 'bench');
  const bldType = select((Object.keys(BUILDINGS) as BuildingType[]).filter((t) => !BUILDINGS[t].fixed).map((t) => [t, `${BUILDINGS[t].icon} ${BUILDINGS[t].name}`]), 'campfire');

  const drawToolbar = () => {
    clear(toolbar);
    const tb = (t: typeof tool, label: string, title: string) => h('button', { class: `btn small${tool === t ? ' on' : ' ghost'}`, title, onclick: () => { tool = t; drawToolbar(); } }, label);
    toolbar.append(
      tb('select', '👆 Select', 'Click a building or object to edit it'),
      tb('move', '✋ Move', 'Click where the selected thing should go'),
      tb('terrain', '⛰️ Terrain', 'Paint tiles and cliff levels'),
      tb('path', '🛤️ Paths', 'Paint paths'),
      tb('object', '🌳 Add object', 'Click to place'),
      tb('building', '🏠 Add building', 'Click to place (top-left corner)'),
      tb('erase', '🧽 Erase', 'Remove objects / buildings you click'),
      h('span', { style: 'flex:1' }),
      h('button', { class: 'btn ghost small', onclick: () => { ed.cell = Math.max(4, ed.cell - 2); draw(); } }, '−'),
      h('button', { class: 'btn ghost small', onclick: () => { ed.cell = Math.min(30, ed.cell + 2); draw(); } }, '+'),
      h('button', { class: 'btn ghost small', title: 'Reload from the server (drops unsaved changes)', onclick: () => islandPage(rec.id) }, '↻'));
    clear(opts);
    if (tool === 'terrain') opts.append(brushTile, brushLevel, brushDir, h('span', { class: 'muted' }, 'Ramps need the tile above (in the arrow direction) one level higher.'));
    if (tool === 'path') opts.append(brushPath);
    if (tool === 'object') opts.append(objKind, objSpecies, objItem, h('span', { class: 'muted' }, 'Species is used for trees, item for furniture.'));
    if (tool === 'building') opts.append(bldType, h('span', { class: 'muted' }, 'Placed finished. Footprint is not checked – keep it on flat ground.'));
    if (tool === 'move') opts.append(h('span', { class: 'muted' }, ed.sel ? 'Click the new spot.' : 'Select something first.'));
  };

  function applyAt(x: number, z: number, drag: boolean) {
    const i = idx(x, z);
    switch (tool) {
      case 'select': {
        if (drag) return;
        const b = buildingAt(x, z);
        const o = objectAt(x, z);
        ed.sel = o ? { kind: 'object', o } : b ? { kind: 'building', b } : null;
        drawSide();
        break;
      }
      case 'move': {
        if (drag || !ed.sel) return;
        if (ed.sel.kind === 'object') { ed.sel.o.x = x; ed.sel.o.z = z; dirty.add('objects'); } else { ed.sel.b.x = x; ed.sel.b.z = z; dirty.add('buildings'); }
        drawSide();
        break;
      }
      case 'terrain': {
        const t = Number(brushTile.value);
        d.tiles[i] = t;
        d.levels[i] = t === Tile.Sea || t === Tile.Shore || t === Tile.Dock ? 0 : Number(brushLevel.value);
        d.ramps[i] = t === Tile.Ramp ? Number(brushDir.value) + 1 : 0;
        if (t !== Tile.Ground && t !== Tile.Ramp) d.paths[i] = 0;
        dirty.add('terrain');
        break;
      }
      case 'path':
        d.paths[i] = Number(brushPath.value);
        dirty.add('paths');
        break;
      case 'object': {
        if (drag || objectAt(x, z)) return;
        const kind = objKind.value as WorldObject['kind'];
        const o: WorldObject = { id: newId('a'), kind, x, z };
        if (kind === 'tree') Object.assign(o, { species: objSpecies.value, stage: 2, hits: 0, fruit: 0 });
        if (kind === 'rock') o.hits = 0;
        if (kind === 'bush') o.ripe = true;
        if (kind === 'furniture') Object.assign(o, { item: objItem.value, rot: 0 });
        d.objects.push(o);
        dirty.add('objects');
        ed.sel = { kind: 'object', o };
        drawSide();
        break;
      }
      case 'building': {
        if (drag) return;
        const t = bldType.value as BuildingType;
        const def = BUILDINGS[t];
        const b: Building = { id: newId('b'), type: t, x, z, w: def.w, h: def.h, completeAt: 0 };
        d.buildings.push(b);
        dirty.add('buildings');
        ed.sel = { kind: 'building', b };
        drawSide();
        break;
      }
      case 'erase': {
        const o = objectAt(x, z);
        if (o) { d.objects.splice(d.objects.indexOf(o), 1); dirty.add('objects'); break; }
        const b = buildingAt(x, z);
        if (b && b.type !== 'dock' && !drag) { d.buildings.splice(d.buildings.indexOf(b), 1); dirty.add('buildings'); }
        break;
      }
    }
    draw();
  }

  let down = false;
  let last = '';
  canvas.addEventListener('mousedown', (e) => {
    const t = tileAtEvent(e);
    if (!t) return;
    down = true;
    window.addEventListener('mouseup', () => (down = false), { once: true });
    last = `${t.x},${t.z}`;
    applyAt(t.x, t.z, false);
  });
  canvas.addEventListener('mouseleave', () => (tip.style.display = 'none'));
  canvas.addEventListener('mousemove', (e) => {
    const t = tileAtEvent(e);
    if (!t) return;
    const i = idx(t.x, t.z);
    const b = buildingAt(t.x, t.z), o = objectAt(t.x, t.z);
    const pl = v.players.find((p) => Math.floor(p.x) === t.x && Math.floor(p.z) === t.z);
    tip.textContent = `${t.x},${t.z} · ${TILE_NAMES.find(([k]) => k === d.tiles[i])?.[1] ?? d.tiles[i]} · level ${d.levels[i]}${d.paths[i] ? ` · ${PATHS[d.paths[i] - 1]?.name}` : ''}`
      + (b ? ` · ${BUILDINGS[b.type]?.name}${b.villagerId ? ` (${villagerDef(b.villagerId)?.name})` : ''}` : '')
      + (o ? ` · ${o.kind}${o.species ? ` ${o.species}` : ''}${o.item ? ` ${ITEMS[o.item]?.name ?? o.item}` : ''}` : '')
      + (pl ? ` · 👤 ${pl.name}` : '');
    const wr = mapWrap.getBoundingClientRect();
    tip.style.display = '';
    tip.style.left = `${e.clientX - wr.left + mapWrap.scrollLeft + 14}px`;
    tip.style.top = `${e.clientY - wr.top + mapWrap.scrollTop + 14}px`;
    const key = `${t.x},${t.z}`;
    if (down && key !== last && ['terrain', 'path', 'erase'].includes(tool)) {
      last = key;
      applyAt(t.x, t.z, true);
    }
  });

  // ── Side panel ───────────────────────────────────────────────────────────
  function drawSide() {
    clear(side);
    side.append(villagersBox(ed), detailsBox(ed), selectionBox(ed), dangerBox(ed));
    drawToolbar();
  }

  async function save() {
    const patch: Record<string, unknown> = {};
    if (dirty.has('terrain')) patch.terrain = { tiles: encodeTiles(d.tiles), levels: encodeTiles(d.levels), ramps: encodeTiles(d.ramps) };
    if (dirty.has('paths') || dirty.has('terrain')) patch.paths = encodeTiles(d.paths);
    if (dirty.has('objects')) patch.objects = d.objects;
    if (dirty.has('buildings')) patch.buildings = d.buildings;
    if (dirty.has('villagers')) patch.villagers = d.villagers;
    saveBtn.disabled = true;
    const r = await call<{ island: IslandView }>('PATCH', `/api/admin/islands/${rec.id}`, patch);
    if (r) {
      toast('Island saved – players on it see the changes right away');
      islandEditor(r.island);
    } else saveBtn.disabled = false;
  }

  window.onbeforeunload = () => (dirty.size ? 'Unsaved changes' : undefined);
  guardUnsaved(() => dirty.size > 0);
  drawSide();
  draw();
  if (focusB) requestAnimationFrame(() => {
    mapWrap.scrollTo({ left: (focusB.x + focusB.w / 2) * ed.cell - mapWrap.clientWidth / 2, top: (focusB.z + focusB.h / 2) * ed.cell - mapWrap.clientHeight / 2 });
  });
}
