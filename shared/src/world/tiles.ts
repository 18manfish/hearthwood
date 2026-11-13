// Tile types, directions and tile-array helpers (water classification, encoding).


export enum Tile {
  Sea = 0,
  Shore = 1,
  Ground = 2,
  Pond = 3,
  Dock = 4,
  Ramp = 5,
  Floor = 6,
  Wall = 7,
  /** Flowing fresh water connected to the sea (a pond has no connection). */
  River = 8,
}

/** Ramp directions point uphill: 0 = north (−z), 1 = east (+x), 2 = south (+z), 3 = west (−x). */
export const DIRS: readonly [number, number][] = [[0, -1], [1, 0], [0, 1], [-1, 0]];

export function tileAt(tiles: Uint8Array, size: number, x: number, z: number): Tile {
  if (x < 0 || z < 0 || x >= size || z >= size) return Tile.Sea;
  return tiles[z * size + x] as Tile;
}

export function isWaterTile(t: Tile): boolean {
  return t === Tile.Sea || t === Tile.Pond || t === Tile.River;
}

/** Fresh inland water (ponds and rivers). */
export function isFreshWater(t: Tile): boolean {
  return t === Tile.Pond || t === Tile.River;
}

/** Which kind of water a tile is, for fishing. */
export function waterKind(t: Tile): 'sea' | 'river' | 'pond' | null {
  return t === Tile.Sea ? 'sea' : t === Tile.River ? 'river' : t === Tile.Pond ? 'pond' : null;
}

/**
 * Fresh water connected to the sea is a river, everything else a pond.
 * Returns the indices whose tile type changed.
 */
export function classifyWater(size: number, tiles: Uint8Array): number[] {
  const seen = new Uint8Array(size * size);
  const q: number[] = [];
  for (let i = 0; i < size * size; i++) if (tiles[i] === Tile.Sea) { seen[i] = 1; q.push(i); }
  while (q.length) {
    const i = q.pop()!;
    const x = i % size, z = Math.floor(i / size);
    for (const [dx, dz] of DIRS) {
      const nx = x + dx, nz = z + dz;
      if (nx < 0 || nz < 0 || nx >= size || nz >= size) continue;
      const j = nz * size + nx;
      if (seen[j] || (tiles[j] !== Tile.Pond && tiles[j] !== Tile.River)) continue;
      seen[j] = 1;
      q.push(j);
    }
  }
  const changed: number[] = [];
  for (let i = 0; i < size * size; i++) {
    const t = tiles[i];
    if (t !== Tile.Pond && t !== Tile.River) continue;
    const want = seen[i] ? Tile.River : Tile.Pond;
    if (t !== want) {
      tiles[i] = want;
      changed.push(i);
    }
  }
  return changed;
}

export function encodeTiles(tiles: Uint8Array): string {
  let s = '';
  for (let i = 0; i < tiles.length; i++) s += tiles[i];
  return s;
}

export function decodeTiles(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) - 48;
  return out;
}
