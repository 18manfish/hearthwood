// Harbor Town Square – a hand-designed shared location: colourful houses on
// terraced cliffs, stairs, a brick plaza with a fountain, market stalls, a
// billboard and a mailbox, a bay ringed by a boardwalk, a pier with the
// travel dock, a lighthouse, rowboats, lanterns, barrels and crates.
// Deterministic, so every server builds the same town.

import { BUILDINGS, type BuildingType } from './data/buildings.ts';
import type { TreeSpecies } from './data/biomes.ts';
import { fbm2D, hashString, Rng } from './rng.ts';
import {
  DIRS, Grid, LEGACY_ISLAND_SIZE, Tile, connectPlateaus, smoothLevels, tileAt,
  type Building, type IslandLayout, type WorldObject,
} from './world.ts';

export function generateHarbor(): IslandLayout {
  const size = LEGACY_ISLAND_SIZE; // hand-designed layout
  const seed = hashString('harbor-town-v1');
  const rng = new Rng(seed);
  const tiles = new Uint8Array(size * size);
  const levels = new Uint8Array(size * size);
  const ramps = new Uint8Array(size * size);
  const paths = new Uint8Array(size * size);
  const c = size / 2;
  const idx = (x: number, z: number) => z * size + x;
  const inB = (x: number, z: number) => x >= 0 && z >= 0 && x < size && z < size;
  const get = (x: number, z: number) => tileAt(tiles, size, x, z);
  const set = (x: number, z: number, t: Tile) => inB(x, z) && (tiles[idx(x, z)] = t);
  const disc = (cx: number, cz: number, r: number, fn: (x: number, z: number) => void) => {
    for (let z = Math.floor(cz - r); z <= cz + r; z++)
      for (let x = Math.floor(cx - r); x <= cx + r; x++) {
        const dx = x + 0.5 - cx, dz = z + 0.5 - cz;
        if (inB(x, z) && dx * dx + dz * dz <= r * r) fn(x, z);
      }
  };

  // ── Land ──────────────────────────────────────────────────────────────────
  for (let z = 0; z < size; z++)
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5 - c) / c, dz = (z + 0.5 - c) / (c * 1.05);
      const v = Math.sqrt(dx * dx + dz * dz) + (fbm2D(seed, x / 8, z / 8, 3) - 0.5) * 0.22;
      tiles[idx(x, z)] = v < 0.8 ? Tile.Ground : v < 0.88 ? Tile.Shore : Tile.Sea;
    }
  // The bay: a sandy crescent around a sheltered harbour, open to the south.
  const bayX = 24, bayZ = 39, bayR = 7.5;
  disc(bayX, bayZ, bayR + 1.6, (x, z) => get(x, z) !== Tile.Sea && set(x, z, Tile.Shore));
  disc(bayX, bayZ, bayR, (x, z) => set(x, z, Tile.Sea));
  // A lily pond on the west side of the plaza.
  disc(11, 29, 2.3, (x, z) => set(x, z, Tile.Pond));

  // ── Terraces (cliff levels) ───────────────────────────────────────────────
  const plaza = { x0: 14, x1: 34, z0: 21, z1: 30 };
  const inPlaza = (x: number, z: number, m = 0) => x >= plaza.x0 - m && x <= plaza.x1 + m && z >= plaza.z0 - m && z <= plaza.z1 + m;
  for (let z = 0; z < size; z++)
    for (let x = 0; x < size; x++) {
      if (get(x, z) !== Tile.Ground || inPlaza(x, z, 1)) continue;
      const n = (fbm2D(seed + 9, x / 7, z / 7, 2) - 0.5) * 6;
      let L = 0;
      if (z + n < 20) L = 1;
      if (z + n < 11.5 && Math.abs(x - 25) + n < 14) L = 2;
      levels[idx(x, z)] = L;
    }
  smoothLevels(size, tiles, levels);

  // Grand stairs from the plaza up through both terraces, two tiles wide.
  const stairs = (x: number, fromLevel: number) => {
    // Find the cliff edge going north in this column.
    for (let z = size - 2; z > 1; z--) {
      if (levels[idx(x, z)] === fromLevel && levels[idx(x, z - 1)] === fromLevel + 1 && get(x, z) === Tile.Ground && get(x, z + 1) === Tile.Ground && levels[idx(x, z + 1)] === fromLevel) {
        for (const sx of [x, x + 1]) {
          if (get(sx, z) !== Tile.Ground || levels[idx(sx, z)] !== fromLevel || levels[idx(sx, z - 1)] !== fromLevel + 1) return;
        }
        for (const sx of [x, x + 1]) {
          tiles[idx(sx, z)] = Tile.Ramp;
          ramps[idx(sx, z)] = 1; // uphill = north
        }
        return;
      }
    }
  };
  stairs(23, 0);
  stairs(16, 1);
  stairs(31, 1);

  // ── Boardwalk & pier (walkable decking over water) ────────────────────────
  for (let z = 0; z < size; z++)
    for (let x = 0; x < size; x++) {
      if (get(x, z) !== Tile.Sea) continue;
      const d = Math.hypot(x + 0.5 - bayX, z + 0.5 - bayZ);
      if (d > bayR - 1.3 && d <= bayR && DIRS.some(([dx, dz]) => get(x + dx, z + dz) === Tile.Shore)) set(x, z, Tile.Dock);
    }
  // Long central pier out to sea, and an east jetty for the rowboats.
  let pierTop = bayZ - Math.floor(bayR);
  while (pierTop < size && get(23, pierTop) !== Tile.Sea && get(23, pierTop) !== Tile.Dock) pierTop++;
  for (let z = pierTop; z < size - 1; z++) for (const x of [23, 24]) set(x, z, Tile.Dock);
  for (let x = 25; x <= 29; x++) set(x, 37, Tile.Dock);
  const dockZ = size - 4;
  const buildings: Building[] = [{ id: 'b_dock', type: 'dock', x: 23, z: dockZ, w: 2, h: 3, completeAt: 0 }];
  for (let dz = 0; dz < 3; dz++) for (const x of [23, 24]) set(x, dockZ + dz, Tile.Dock);

  // Pave the plaza: brick square, gravel avenue to the stairs, dirt lanes on the terraces.
  for (let z = plaza.z0; z <= plaza.z1; z++)
    for (let x = plaza.x0; x <= plaza.x1; x++) if (get(x, z) === Tile.Ground && !levels[idx(x, z)]) paths[idx(x, z)] = 4;
  for (let z = plaza.z0 - 4; z < plaza.z0; z++) for (const x of [23, 24]) if (get(x, z) === Tile.Ground && !levels[idx(x, z)]) paths[idx(x, z)] = 2;

  connectPlateaus(seed, size, tiles, levels, ramps, { x: 24, z: plaza.z1 + 0.5 });
  const grid = new Grid(size, tiles, levels, ramps, paths);

  // ── Set pieces ────────────────────────────────────────────────────────────
  let bid = 1;
  const addBuilding = (type: BuildingType, x: number, z: number): boolean => {
    const def = BUILDINGS[type];
    if (!grid.canPlace(x, z, def.w, def.h)) return false;
    const b: Building = { id: `b_h${bid++}`, type, x, z, w: def.w, h: def.h, completeAt: 0 };
    buildings.push(b);
    grid.addBuilding(b);
    return true;
  };
  addBuilding('fountain', 23, 25);
  addBuilding('billboard', 17, 22);
  addBuilding('mailbox', 20, 22);
  addBuilding('stall', 27, 22);
  addBuilding('stall', 30, 22);
  addBuilding('stall', 15, 27);
  addBuilding('stall', 31, 27);
  // Lighthouse on the east headland of the bay.
  outer: for (let r = 0; r < 9; r++)
    for (let dz = -r; dz <= r; dz++)
      for (let dx = -r; dx <= r; dx++) if (addBuilding('lighthouse', 34 + dx, 38 + dz)) break outer;

  // Houses line the terrace edges, doors facing the sea – like a hillside village.
  const shackSpots: [number, number][] = [];
  for (let z = 2; z < 22; z++)
    for (let x = 2; x < size - 3; x++) {
      const L = levels[idx(x, z)];
      if (L < 1) continue;
      // Footprint on one level, walkable ground in front of the door.
      if (!grid.canPlace(x, z, 2, 2) || !grid.walkableTile(x, z + 2) || !grid.walkableTile(x + 1, z + 2)) continue;
      if (levels[idx(x, z + 2)] !== L || levels[idx(x + 1, z + 2)] !== L) continue;
      // Prefer spots near the terrace's front edge so they overlook the town.
      const edge = levels[idx(x, z + 4)] < L || levels[idx(x + 1, z + 4)] < L || levels[idx(x, z + 3)] < L;
      if (edge) shackSpots.push([x, z]);
    }
  rng.shuffle(shackSpots);
  let houses = 0;
  for (const [x, z] of shackSpots) {
    if (houses >= 11) break;
    // Keep a little gap between houses.
    let crowded = false;
    for (const b of buildings) if (b.type === 'shack' && Math.abs(b.x - x) < 4 && Math.abs(b.z - z) < 3) crowded = true;
    if (!crowded && addBuilding('shack', x, z)) houses++;
  }

  // ── Props ─────────────────────────────────────────────────────────────────
  const objects: WorldObject[] = [];
  let oid = 1;
  const free = (x: number, z: number, tile: Tile[] = [Tile.Ground, Tile.Shore]) =>
    inB(x, z) && tile.includes(get(x, z)) && !grid.occupied[idx(x, z)] && !grid.reserved[idx(x, z)] && grid.ramp(x, z) < 0;
  const put = (o: Omit<WorldObject, 'id'>, tile?: Tile[]) => {
    if (!free(o.x, o.z, tile)) return false;
    const obj = { id: `h${oid++}`, ...o } as WorldObject;
    objects.push(obj);
    grid.addObject(obj);
    return true;
  };
  const furn = (item: string, x: number, z: number, rot = 0, tile?: Tile[]) => put({ kind: 'furniture', x, z, item, rot }, tile);
  const tree = (species: TreeSpecies, x: number, z: number) => put({ kind: 'tree', x, z, species, stage: 2, hits: 0, fruit: species === 'palm' ? 2 : 0 }, [Tile.Ground, Tile.Shore]);

  // Lanterns and benches along the beach above the boardwalk.
  let k = 0;
  for (let z = 26; z < size; z++)
    for (let x = 0; x < size; x++) {
      if (get(x, z) !== Tile.Shore || !DIRS.some(([dx, dz]) => get(x + dx, z + dz) === Tile.Dock)) continue;
      if (Math.abs(x - 23.5) < 2) continue; // keep the pier entrance open
      if (k++ % 4 === 0) furn('lamp', x, z);
      else if (k % 4 === 2 && rng.chance(0.6)) furn('bench', x, z, 0);
    }
  // Rowboats moored in the bay.
  const boats: [number, number, number][] = [[20, 37, 1], [27, 39, 1], [21, 41, 3], [26, 35, 0], [29, 38, 0]];
  for (const [x, z, rot] of boats) furn('rowboat', x, z, rot, [Tile.Sea]);
  // Market clutter around the stalls and the pier head.
  for (const b of buildings) {
    if (b.type === 'stall') {
      furn(rng.chance(0.5) ? 'barrel' : 'crate', b.x - 1, b.z);
      furn('crate', b.x + b.w, b.z);
    }
    if (b.type === 'shack') {
      if (rng.chance(0.6)) furn('flower_pot', b.x + b.w, b.z + 1);
      if (rng.chance(0.4)) furn('barrel', b.x - 1, b.z + 1);
    }
  }
  for (const [x, z] of [[21, pierTop - 1], [26, pierTop - 1], [25, pierTop - 2]] as [number, number][]) furn(rng.chance(0.5) ? 'barrel' : 'crate', x, z);
  furn('signpost', 26, plaza.z1);
  furn('picnic_table', 19, 27);
  furn('picnic_table', 28, 27);
  for (const [x, z] of [[plaza.x0, plaza.z0], [plaza.x1, plaza.z0], [plaza.x0, plaza.z1], [plaza.x1, plaza.z1]] as [number, number][]) furn('lamp', x, z);

  // Palms along the coast, leafy trees and bushes up on the terraces.
  for (let i = 0; i < 400 && objects.filter((o) => o.kind === 'tree').length < 34; i++) {
    const x = rng.int(1, size - 2), z = rng.int(1, size - 2);
    const t = get(x, z);
    if (inPlaza(x, z, 1)) continue;
    if (t === Tile.Shore && rng.chance(0.5)) tree('palm', x, z);
    else if (t === Tile.Ground && levels[idx(x, z)] >= 1 && rng.chance(0.35)) tree(rng.pick(['oak', 'apple', 'palm', 'cherry'] as TreeSpecies[]), x, z);
    else if (t === Tile.Ground && rng.chance(0.15)) put({ kind: 'bush', x, z, ripe: true });
  }
  for (let i = 0; i < 14; i++) {
    const x = rng.int(1, size - 2), z = rng.int(1, size - 2);
    if (get(x, z) === Tile.Ground && !inPlaza(x, z)) put({ kind: 'flower', x, z });
  }

  return { size, tiles, levels, ramps, paths, objects, buildings, spawn: { x: 24, z: plaza.z1 + 0.6 } };
}
