// Golden tests: fingerprints of everything a refactor must not change.
//
//   npm run test:golden          compare against tools/golden/snapshots.json
//   npm run test:golden:update   rewrite the snapshots (only when a change is intended!)
//   npm run test:golden -- generate grid     run only some groups
//
// Each check produces a JSON-able value; we store its SHA-256 (plus a short,
// human-readable summary so a diff says *what* moved). Client builders run on a
// fake three.js (fake-three.mjs) loaded through register.mjs.

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as S from '@hearthwood/shared';
import { Grid, Tile, generateIsland, type BiomeId, type IslandLayout } from '@hearthwood/shared';

const SNAP = fileURLToPath(new URL('./snapshots.json', import.meta.url));
const update = process.argv.includes('--update');
const only = process.argv.slice(2).filter((a) => !a.startsWith('--'));

const BIOMES = Object.keys(S.BIOMES) as BiomeId[];
const r5 = (v: number) => Math.round(v * 1e5) / 1e5;
const r4 = (v: number) => Math.round(v * 1e4) / 1e4;

function hashOf(v: unknown): string {
  const h = createHash('sha256');
  const feed = (x: unknown): void => {
    if (ArrayBuffer.isView(x)) {
      const a = x as unknown as ArrayLike<number>;
      const out = new Float64Array(a.length);
      for (let i = 0; i < a.length; i++) out[i] = typeof a[i] === 'number' ? r4(a[i]) : 0;
      h.update(`[${x.constructor.name}:${a.length}]`);
      h.update(Buffer.from(out.buffer));
    } else if (Array.isArray(x)) { h.update('['); x.forEach(feed); h.update(']'); }
    else if (x && typeof x === 'object') { h.update('{'); for (const k of Object.keys(x).sort()) { h.update(k + ':'); feed((x as Record<string, unknown>)[k]); } h.update('}'); }
    else h.update(JSON.stringify(typeof x === 'number' ? r5(x) : x) ?? 'u');
  };
  feed(v);
  return h.digest('hex').slice(0, 24);
}

type Snap = Record<string, { hash: string; info?: string }>;
const results: Snap = {};
function record(name: string, value: unknown, info?: string) {
  results[name] = { hash: hashOf(value), ...(info ? { info } : {}) };
}
const want = (group: string) => !only.length || only.includes(group);

// ---------------------------------------------------------------- shared
const layouts = new Map<string, IslandLayout>();
function layout(seed: number, biome: BiomeId, opts: S.GenOptions = { elevation: true, size: 72 }) {
  const key = `${seed}/${biome}/${JSON.stringify(opts)}`;
  if (!layouts.has(key)) layouts.set(key, generateIsland(seed, biome, opts));
  return layouts.get(key)!;
}
const gridOf = (L: IslandLayout) => new Grid(L.size, L.tiles.slice(), L.levels?.slice(), L.ramps?.slice());

function layoutValue(L: IslandLayout) {
  return {
    size: L.size, tiles: L.tiles, levels: L.levels, ramps: L.ramps, paths: L.paths, beach: L.beachBand, spawn: L.spawn,
    objects: L.objects.map((o) => [o.id, o.kind, o.x, o.z, o.species ?? o.item ?? '', o.stage ?? -1, o.rot ?? 0]),
    buildings: L.buildings.map((b) => [b.id, b.type, b.x, b.z, b.w, b.h]),
  };
}
const count = (a: Uint8Array | undefined, v: number) => (a ? a.reduce((n, x) => n + (x === v ? 1 : 0), 0) : 0);

if (want('generate')) {
  for (const seed of [1, 7, 42, 99, 12345])
    for (const b of BIOMES) {
      const L = layout(seed, b);
      record(`generate/${b}/${seed}`, layoutValue(L), `sea ${count(L.tiles, Tile.Sea)} shore ${count(L.tiles, Tile.Shore)} river ${count(L.tiles, Tile.River)} objs ${L.objects.length}`);
    }
  for (const seed of [7, 42]) {
    record(`generate/legacy48/${seed}`, layoutValue(layout(seed, 'grassland', { size: 48 })));
    record(`generate/shared/${seed}`, layoutValue(layout(seed, 'grassland', { variant: 'shared', elevation: false, size: 72 })));
    record(`generate/tour/${seed}`, layoutValue(layout(seed, 'tropical', { variant: 'tour', elevation: true, size: 72 })));
  }
  record('generate/harbor', layoutValue(S.generateHarbor()));
  for (const type of Object.keys(S.BUILDINGS) as S.BuildingType[])
    for (const v of [undefined, S.VILLAGERS[0]]) {
      const spec = S.interiorSpecFor(type, `b_${type}`, v);
      if (!spec) continue;
      const I = S.generateInterior(spec);
      record(`generate/interior/${type}/${v ? 'v' : '-'}`, { ...layoutValue(I as unknown as IslandLayout), rest: Object.keys(I).sort() });
    }
}

const GRID_SEEDS = [7, 42];
if (want('grid')) {
  for (const seed of GRID_SEEDS)
    for (const b of BIOMES) {
      const L = layout(seed, b);
      const g = gridOf(L);
      for (const bl of L.buildings) g.addBuilding(bl);
      for (const o of L.objects) g.addObject(o);
      const pad = 10, N = 4;
      const surf: number[] = [], coast: number[] = [], tile: number[] = [];
      for (let z = -pad * N; z < (g.size + pad) * N; z++)
        for (let x = -pad * N; x < (g.size + pad) * N; x++) {
          const px = (x + 0.5) / N, pz = (z + 0.5) / N;
          surf.push(r5(g.surfaceY(px, pz)));
          const tx = Math.floor(px), tz = Math.floor(pz);
          if (g.isCoastal(tx, tz)) coast.push(r5(g.coastY(px, pz, g.tile(tx, tz))));
        }
      for (let z = -2; z < g.size + 2; z++)
        for (let x = -2; x < g.size + 2; x++)
          tile.push(+g.walkableTile(x, z), +g.wadeableTile(x, z), g.walkLevel(x, z), +g.isCoastal(x, z), ...g.cornerHeights(x, z).map(r5), +g.canPave(x, z), +g.canSpawn(x, z), +g.canPlace(x, z, 2, 2));
      const dock = L.buildings.find((bb) => bb.type === 'dock');
      const ramp: unknown[] = [];
      if (dock)
        for (let z = dock.z - 5; z <= dock.z + 4; z += 0.25)
          for (let x = dock.x - 1; x <= dock.x + 3; x += 0.25) ramp.push(g.dockRamp(x, z));
      record(`grid/${b}/${seed}/surface`, surf);
      record(`grid/${b}/${seed}/coast`, coast);
      record(`grid/${b}/${seed}/tiles`, tile);
      record(`grid/${b}/${seed}/dock`, ramp);
    }
}

if (want('movement')) {
  for (const seed of GRID_SEEDS) {
    const L = layout(seed, 'grassland');
    const g = gridOf(L);
    for (const bl of L.buildings) g.addBuilding(bl);
    for (const o of L.objects) g.addObject(o);
    const rng = new S.Rng(seed);
    const out: unknown[] = [];
    for (let i = 0; i < 3000; i++) {
      const fx = rng.next() * g.size, fz = rng.next() * g.size;
      const tx = fx + (rng.next() - 0.5) * 0.6, tz = fz + (rng.next() - 0.5) * 0.6;
      out.push(+g.canMove(fx, fz, tx, tz), +g.canMove(fx, fz, tx, tz, 0.22, false), +g.stepOk(Math.floor(fx), Math.floor(fz), Math.floor(tx), Math.floor(tz)));
      const sm = S.slideMove(g, fx, fz, tx - fx, tz - fz);
      out.push(r5(sm.x), r5(sm.z));
    }
    record(`movement/${seed}`, out);
    const place: unknown[] = [];
    for (const type of Object.keys(S.BUILDINGS) as S.BuildingType[])
      for (let i = 0; i < 40; i++) {
        const x = Math.floor(rng.next() * g.size), z = Math.floor(rng.next() * g.size);
        place.push(S.placeError(g, type, x, z));
      }
    record(`movement/${seed}/placement`, place);
  }
}

if (want('terraform')) {
  for (const seed of GRID_SEEDS) {
    const L = layout(seed, 'grassland');
    const g = gridOf(L);
    for (const bl of L.buildings) g.addBuilding(bl);
    const rng = new S.Rng(seed * 7 + 1);
    const log: unknown[] = [];
    for (let i = 0; i < 1500; i++) {
      const op = S.TERRA_OPS[Math.floor(rng.next() * S.TERRA_OPS.length)];
      const x = Math.floor(rng.next() * g.size), z = Math.floor(rng.next() * g.size);
      const err = S.terraformError(g, op, x, z);
      log.push(op, x, z, err);
      if (!err) log.push(S.applyTerrainAndWater(g, S.terraformChanges(g, op, x, z)));
    }
    record(`terraform/${seed}`, { log, tiles: g.tiles, levels: g.levels, ramps: g.ramps }, `ok ${log.filter((v) => v === null).length}`);
  }
}

if (want('env')) {
  const out: unknown[] = [];
  const geos: S.GeoInfo[] = [{ lat: 47.4, lon: 8.5, tz: 'Europe/Zurich' }, { lat: -33.9, lon: 151.2, tz: 'Australia/Sydney' }, { lat: 35.7, lon: 139.7, tz: 'Asia/Tokyo' }];
  for (const b of BIOMES)
    for (const geo of geos)
      for (let i = 0; i < 24; i++) out.push(S.computeEnvironment(Date.UTC(2026, i % 12, 1 + i, (i * 5) % 24, 17), b, geo, `isl_${b}`));
  record('env', out);
}

if (want('data')) {
  record('data/tables', { items: S.ITEMS, trees: S.TREES, biomes: S.BIOMES, buildings: S.BUILDINGS, recipes: S.RECIPES, villagers: S.VILLAGERS });
  const fl: unknown[] = [];
  for (let p = 0; p < 2000; p += 37) fl.push(S.friendshipLevel(p));
  record('data/friendship', fl);
}

// ---------------------------------------------------------------- client geometry
async function clientGoldens() {
  const terrain = await import('../../client/src/game/terrain.ts');
  const water = await import('../../client/src/game/water.ts');
  const tiles = await import('../../client/src/game/tileAssets.ts');
  const trees = await import('../../client/src/game/treeAssets.ts');
  const models = await import('../../client/src/game/models.ts');
  const paths = await import('../../client/src/game/paths.ts');
  await tiles.loadTileset();
  await trees.loadTreeAssets();
  if (!tiles.hasTileset()) throw new Error('tileset.glb did not load in the golden harness');

  type O = { name: string; position: { x: number; y: number; z: number }; rotation: { x: number; y: number; z: number }; scale: { x: number; y: number; z: number }; visible: boolean; children: O[]; geometry?: { type?: string; parameters?: unknown; attributes?: Record<string, { array: ArrayLike<number> }>; index?: { array: ArrayLike<number> } | null }; material?: { color?: { r: number; g: number; b: number }; opacity?: number; transparent?: boolean; map?: unknown } | { color?: { r: number; g: number; b: number } }[]; renderOrder?: number; userData?: Record<string, unknown>; count?: number; matrices?: unknown[] };
  const graph = (o: O): unknown => {
    const m = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    return [
      o.name, [o.position.x, o.position.y, o.position.z].map(r5), [o.rotation.x, o.rotation.y, o.rotation.z].map(r5), [o.scale.x, o.scale.y, o.scale.z].map(r5), o.visible, o.renderOrder ?? 0,
      o.geometry ? [o.geometry.type ?? 'buf', o.geometry.parameters ?? null, Object.fromEntries(Object.entries(o.geometry.attributes ?? {}).map(([k, a]) => [k, hashOf(a.array)])), o.geometry.index ? hashOf(o.geometry.index.array) : null] : null,
      m.map((mm) => (mm?.color ? [r4(mm.color.r), r4(mm.color.g), r4(mm.color.b), (mm as { opacity?: number }).opacity ?? 1] : null)),
      o.count ?? null, o.matrices ? hashOf(o.matrices) : null,
      o.children.map(graph),
    ];
  };

  for (const seed of GRID_SEEDS)
    for (const b of ['grassland', 'tropical', 'nordic'] as BiomeId[]) {
      const L = layout(seed, b);
      const g = gridOf(L);
      for (const bl of L.buildings) g.addBuilding(bl);
      for (const o of L.objects) g.addObject(o);
      // A few ramps get stairs so those placements are covered too.
      let n = 0;
      for (let i = 0; i < g.tiles.length && n < 6; i++) if (g.ramps[i]) { g.ramps[i] = ((g.ramps[i] - 1) & 3) + 1 + 4 * (n % 4); n++; }
      for (const season of [['summer', 'summer', false], ['winter', 'winter', true]] as const) {
        const m = terrain.buildTerrainMesh(g, { biome: b, season: season[0] as S.Season, vs: season[1], snowy: season[2] }) as unknown as O;
        const pos = m.geometry!.attributes!.position.array, col = m.geometry!.attributes!.color.array;
        record(`client/terrain/${b}/${seed}/${season[0]}`, { pos: hashOf(pos), col: hashOf(col) }, `tris ${pos.length / 9}`);
        // Structural checks (assertions, not snapshots).
        if (season[0] === 'summer' && b === 'grassland') checkTerrain(g, pos as Float32Array, `${b}/${seed}`);
      }
      const w = water.buildWater(g, terrain.waterColor(b)) as unknown as O & { userData: { tick: (t: number, bob: number) => void } };
      w.userData.tick(1.3, 0.01);
      record(`client/water/${b}/${seed}`, graph(w), w.children.map((c) => `${c.name || '-'}:${(c.geometry?.attributes?.position?.array.length ?? 0) / 3}`).join(' '));
      record(`client/falls/${b}/${seed}`, water.findWaterfalls(g));
      record(`client/stairs/${b}/${seed}`, graph(tiles.buildStairs(g) as unknown as O));
      const docks = tiles.buildDockModels(g) as unknown as O | null;
      record(`client/docks/${b}/${seed}`, docks ? graph(docks) : null);
      record(`client/paths/${b}/${seed}`, graph(paths.buildPaths(g) as unknown as O));
    }

  // Models: every object of one island in two seasons, every building and furniture item.
  const L = layout(7, 'tropical');
  const L2 = layout(7, 'nordic');
  for (const [vs, snowy] of [['summer', false], ['autumn', false], ['winter', true]] as const) {
    const objs = [...L.objects, ...L2.objects].map((o) => graph(models.objectModel(o, vs as S.Season, vs, snowy) as unknown as O));
    record(`client/models/objects/${vs}`, objs, `${objs.length} objects`);
  }
  const blds: unknown[] = [];
  for (const type of Object.keys(S.BUILDINGS) as S.BuildingType[])
    for (const style of ['tent', 'cabin'] as const)
      blds.push(graph(models.buildingModel({ id: 'b', type, x: 0, z: 0, w: S.BUILDINGS[type].w, h: S.BUILDINGS[type].h, completeAt: 0 } as S.Building, 1, style) as unknown as O));
  record('client/models/buildings', blds);
  const furn: unknown[] = [];
  for (const [id, it] of Object.entries(S.ITEMS)) if ((it as { tags?: string[] }).tags?.includes('furniture') || (it as { furniture?: unknown }).furniture) furn.push(id, graph(models.furnitureModel(id, 1) as unknown as O));
  record('client/models/furniture', furn, `${furn.length / 2} items`);
  const birds: unknown[] = [];
  for (const id of Object.keys(S.BIRDS)) birds.push(graph(models.birdModel(id, 0.5) as unknown as O));
  record('client/models/birds', birds);
}

const fails: string[] = [];
function checkTerrain(g: Grid, pos: Float32Array, label: string) {
  const cell = new Map<string, number[]>();
  for (let i = 0; i < pos.length; i += 9) {
    const xs = [pos[i], pos[i + 3], pos[i + 6]], zs = [pos[i + 2], pos[i + 5], pos[i + 8]];
    for (let gx = Math.floor(Math.min(...xs)); gx <= Math.floor(Math.max(...xs)); gx++)
      for (let gz = Math.floor(Math.min(...zs)); gz <= Math.floor(Math.max(...zs)); gz++) {
        const k = gx + ',' + gz;
        if (!cell.has(k)) cell.set(k, []);
        cell.get(k)!.push(i);
      }
  }
  const top = (px: number, pz: number) => {
    let best = -Infinity;
    for (const i of cell.get(Math.floor(px) + ',' + Math.floor(pz)) ?? []) {
      const [ax, ay, az, bx, by, bz, cx, cy, cz] = pos.subarray(i, i + 9);
      const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
      if (Math.abs(d) < 1e-12) continue;
      const l1 = ((bz - cz) * (px - cx) + (cx - bx) * (pz - cz)) / d, l2 = ((cz - az) * (px - cx) + (ax - cx) * (pz - cz)) / d, l3 = 1 - l1 - l2;
      if (l1 >= -1e-6 && l2 >= -1e-6 && l3 >= -1e-6) best = Math.max(best, l1 * ay + l2 * by + l3 * cy);
    }
    return best;
  };
  let holes = 0;
  const N = 16;
  for (let z = -2 * N; z < (g.size + 2) * N; z++)
    for (let x = -2 * N; x < (g.size + 2) * N; x++) if (top((x + 0.37) / N, (z + 0.41) / N) === -Infinity) holes++;
  if (holes) fails.push(`terrain ${label}: ${holes} holes`);
}

if (want('client')) await clientGoldens();

// ---------------------------------------------------------------- compare
const old: Snap = existsSync(SNAP) ? JSON.parse(readFileSync(SNAP, 'utf8')) : {};
let changed = 0, added = 0;
for (const [k, v] of Object.entries(results)) {
  if (!old[k]) { added++; if (!update) fails.push(`${k}: no snapshot (run test:golden:update)`); continue; }
  if (old[k].hash !== v.hash) { changed++; fails.push(`${k}: changed${old[k].info || v.info ? ` (was: ${old[k].info ?? '-'} | now: ${v.info ?? '-'})` : ''}`); }
}
if (update) {
  const merged = only.length ? { ...old, ...results } : results;
  writeFileSync(SNAP, JSON.stringify(Object.fromEntries(Object.entries(merged).sort(([a], [b]) => a.localeCompare(b))), null, 1) + '\n');
  console.log(`golden: wrote ${Object.keys(results).length} snapshots (${changed} changed, ${added} new)`);
  const structural = fails.filter((f) => !f.includes(': changed') && !f.includes('no snapshot'));
  if (structural.length) { console.log(structural.join('\n')); process.exit(1); }
} else if (fails.length) {
  console.log(`golden: ${fails.length} problem(s) out of ${Object.keys(results).length} checks`);
  console.log(fails.slice(0, 60).map((f) => '  ✘ ' + f).join('\n'));
  process.exit(1);
} else console.log(`golden: all ${Object.keys(results).length} checks match`);
