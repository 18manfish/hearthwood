// Gangways: where a pier's land end meets the beach, the deck carries on down onto
// dry sand in the same wide planks (each plank spans a whole tile, so the columns of
// a pier join into one continuous walkway), on two beams per column.
// Heights come from Grid.dockRamp, the same slope players walk on.

import * as THREE from 'three';
import { DIRS, Tile, type Grid } from '@hearthwood/shared';
import { part } from '../models/primitives.ts';

const PLANK = '#a57d50';
const BEAM = '#6e4f33';
const PLANKS_PER_TILE = 4; // as the deck: 0.25 per plank, a small gap between them
const PLANK_DEPTH = 0.224;
const PLANK_THICK = 0.055;

export function buildGangways(g: Grid): THREE.Group {
  const group = new THREE.Group();
  group.name = 'gangways';
  const isDock = (x: number, z: number) => g.tile(x, z) === Tile.Dock;
  for (let z = 0; z < g.size; z++)
    for (let x = 0; x < g.size; x++) {
      if (!isDock(x, z)) continue;
      for (const [dx, dz] of DIRS) {
        // (dx, dz) points out to sea; this tile is the pier's land end.
        if (!isDock(x + dx, z + dz) || !isDock(x + 2 * dx, z + 2 * dz) || isDock(x - dx, z - dz)) continue;
        if (![Tile.Shore, Tile.Ground].includes(g.tile(x - dx, z - dz))) continue;
        const r = g.dockRamp(x - dx + 0.5, z - dz + 0.5);
        if (!r) continue;
        const slope = (r.to - r.from) / r.len; // rise per tile walked towards land (negative: down)
        const stretch = Math.sqrt(1 + slope * slope);
        // Anchored at the land-facing edge of this deck tile; local +z runs down the gangway towards land.
        const col = new THREE.Group();
        col.position.set(x + 0.5 - dx * 0.5, r.from, z + 0.5 - dz * 0.5);
        col.rotation.y = Math.atan2(-dx, -dz);
        const tilt = new THREE.Group();
        tilt.rotation.x = Math.atan(-slope);
        col.add(tilt);
        for (let i = 0; i < r.len * PLANKS_PER_TILE; i++) {
          const t = ((i + 0.5) / PLANKS_PER_TILE) * stretch;
          tilt.add(part('box', PLANK, 1.0, PLANK_THICK, PLANK_DEPTH * stretch, 0, -PLANK_THICK / 2, t));
        }
        for (const off of [-0.33, 0.33]) tilt.add(part('box', BEAM, 0.1, 0.11, r.len * stretch, off, -PLANK_THICK - 0.055, (r.len * stretch) / 2));
        group.add(col);
      }
    }
  return group;
}

