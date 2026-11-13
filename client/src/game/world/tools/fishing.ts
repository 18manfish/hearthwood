// Casting the fishing line: the bobber.

import { CLIFF } from '@hearthwood/shared';
import { WATER_Y } from '../common.ts';
import type { World } from '../../World.ts';

export function startCast(self: World, x: number, z: number) {
  self.cast = { id: null, x, z, bite: false, window: 0, at: performance.now() };
  self.bobber.position.set(x + 0.5, WATER_Y + 0.03 + (self.grid?.level(x, z) ?? 0) * CLIFF, z + 0.5);
  self.bobber.visible = true;
  if (self.me) self.me.swing = 1;
}

export function endCast(self: World) {
  self.cast = null;
  self.bobber.visible = false;
}
