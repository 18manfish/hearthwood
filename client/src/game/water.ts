// Everything drawn on top of the terrain for water, one layer per file:
//   water/raised.ts     ponds and rivers up on the cliffs (sea-level water is the world's sea plane)
//   water/waves.ts      the sea's waves and depth colour (on the sea plane), and waveY()
//   water/flow.ts       river flow drifting gently towards the sea
//   water/surf.ts       waves rolling in and breaking along the beaches
//   water/falls.ts      waterfalls: a curved sheet, foam and spray
// The group's userData.tick(t, bob) animates it every frame.

import * as THREE from 'three';
import type { Grid } from '@hearthwood/shared';
import type { WaterLayer } from './water/common.ts';
import { addWaterfalls } from './water/falls.ts';
import { addRiverFlow } from './water/flow.ts';
import { addRaisedWater } from './water/raised.ts';
import { addSurf } from './water/surf.ts';
import { setWaveDepth } from './water/waves.ts';
import { fallTexture, flowTexture } from './water/textures.ts';

export { findWaterfalls, type Waterfall } from './water/falls.ts';
export { updateSeaState, waveY } from './water/waves.ts';
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
  setWaveDepth(g, pad, color); // depth colour and wave strength, drawn by the sea plane itself
  addRiverFlow(g, layer);
  addSurf(g, layer);
  const surfs = group.children.filter((c: THREE.Object3D) => c.name === 'surf').map((c: THREE.Object3D) => c.userData.surfTime as { value: number });
  const spray = addWaterfalls(g, layer);
  group.userData.tick = (t: number, bob: number) => {
    for (const o of layer.bobbed) o.position.y = (o.userData.baseY as number) + bob;
    flowTexture.offset.y = -t * 0.22; // gentle drift downstream
    for (const u of surfs) u.value = t;
    fallTexture.offset.y = (t * 1.6) % 1;
    spray(t);
  };
  return group;
}

/** The sea plane's colour: the biome water colour, deeper. */
export function seaColor(color: string) {
  return `#${new THREE.Color(color).lerp(new THREE.Color('#0b4a6e'), 0.2).getHexString()}`;
}
