// Paths you can lay on your island, tile by tile. Paths are flooring: they
// don't block movement and furniture can stand on them, but nothing grows or
// respawns on a path tile.

export interface PathDef {
  id: number; // 1-based, stored per tile (0 = no path)
  key: string;
  name: string;
  icon: string;
  cost: Record<string, number>;
  /** Tool needed to lay it. */
  tool?: 'shovel';
  color: string;
}

export const PATHS: PathDef[] = [
  { id: 1, key: 'dirt', name: 'Dirt Path', icon: '🟫', cost: {}, tool: 'shovel', color: '#8b6a45' },
  { id: 2, key: 'gravel', name: 'Gravel Path', icon: '⚪', cost: { stone: 1 }, color: '#b8b2a7' },
  { id: 3, key: 'stone', name: 'Stepping Stones', icon: '🪨', cost: { stone: 2 }, color: '#9a9a9a' },
  { id: 4, key: 'brick', name: 'Brick Path', icon: '🧱', cost: { clay: 2 }, color: '#b5553c' },
  { id: 5, key: 'wood', name: 'Wooden Boardwalk', icon: '🪵', cost: { wood: 2 }, color: '#a0703f' },
];

export function pathDef(id: number): PathDef | undefined {
  return PATHS[id - 1];
}

/** How far away (world units) you can paint a path tile. */
export const PATH_REACH = 7;
