// Low-poly models, re-exported from their parts (admin and editor import from here):
//   models/primitives.ts  materials, shared geometries, `part`
//   models/trees.ts       trees (Blender models with a procedural fallback)
//   models/nature.ts      rocks, bushes, flowers, washed-up finds, birds
//   models/furniture.ts   furniture, decor, emoji signs
//   models/buildings.ts   buildings and bridges

export { mat, part } from './models/primitives.ts';
export { treeModel } from './models/trees.ts';
export { objectModel, birdModel } from './models/nature.ts';
export { furnitureModel, emojiSprite } from './models/furniture.ts';
export { buildingModel } from './models/buildings.ts';
