// Everything drawn on top of the terrain for water, one layer per file:
//   water/raised.ts     ponds and rivers up on the cliffs (sea-level water is the world's sea plane)
//   water/depthTint.ts  shallow water stays clear, deep water darkens
//   water/flow.ts       river flow drifting gently towards the sea
//   water/surf.ts       waves rolling in and breaking along the beaches
//   water/falls.ts      waterfalls: a curved sheet, foam and spray
// The group's userData.tick(t, bob) animates it every frame.

import * as THREE from 'three';
import type { Grid } from '@hearthwood/shared';
import type { WaterLayer } from './water/common.ts';
import { addDepthTint } from './water/depthTint.ts';
import { addWaterfalls } from './water/falls.ts';
import { addRiverFlow } from './water/flow.ts';
import { addRaisedWater } from './water/raised.ts';
import { addSurf } from './water/surf.ts';
import { fallTexture, flowTexture } from './water/textures.ts';

export { findWaterfalls, type Waterfall } from './water/falls.ts';
export { fallTexture, flowTexture } from './water/textures.ts';

/**
 * All water over the terrain. `color` is the biome's water colour; the world's
 * sea plane should be drawn in `seaColor(color)` underneath.
 */
export function buildWater(g: Grid, color: string, pad = 12): THREE.Group {
  const group = new THREE.Group();
  group.name = 'water';
  const layer: WaterLayer = { group, bobbed: [] };
  addRaisedWater(g, color, layer);
  addDepthTint(g, color, pad, layer);
  addRiverFlow(g, layer);
  addSurf(g, layer);
  const spray = addWaterfalls(g, layer);
  group.userData.tick = (t: number, bob: number) => {
    for (const o of layer.bobbed) o.position.y = (o.userData.baseY as number) + bob;
    flowTexture.offset.y = -t * 0.22; // gentle drift downstream
    fallTexture.offset.y = (t * 1.6) % 1;
    spray(t);
  };
  return group;
}

/** The sea plane's colour: the biome water colour, deeper. */
export function seaColor(color: string) {
  return `#${new THREE.Color(color).lerp(new THREE.Color('#0b4a6e'), 0.2).getHexString()}`;
}
