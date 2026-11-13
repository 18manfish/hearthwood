// The island world model, re-exported from its parts (kept so `./world.ts` imports keep working):
//   world/tiles.ts       tile types, directions, water classification, tile encoding
//   world/constants.ts   sizes and heights (cliffs, sea level, beach and sea floor)
//   world/objects.ts     world objects, buildings, the island layout record
//   world/grid.ts        collision / occupancy grid and walking heights
//   world/move.ts        sliding movement, angles, distances
//   world/placement.ts   where buildings may go
//   generate/island.ts   deterministic island generation
export * from './world/tiles.ts';
export * from './world/constants.ts';
export * from './world/objects.ts';
export * from './world/grid.ts';
export * from './world/coast.ts';
export * from './world/dock.ts';
export * from './world/heights.ts';
export * from './world/move.ts';
export * from './world/placement.ts';
export * from './generate/island.ts';
export { smoothstep } from './math.ts';
