// Permits sold at the Town Hall counter. They unlock island-shaping tools.

import type { TerraOp } from '../terraform.ts';

export type PermitId = 'permit_cliff' | 'permit_water';

export interface PermitDef {
  id: PermitId;
  name: string;
  icon: string;
  price: number;
  desc: string;
  ops: TerraOp[];
}

export const PERMITS: PermitDef[] = [
  { id: 'permit_cliff', name: 'Cliff Construction Permit', icon: '⛰️', price: 2000, desc: 'Raise and lower cliffs, build ramps and stairs, and remove them.', ops: ['raise', 'lower', 'ramp', 'stairs_stone', 'stairs_wood', 'stairs_log', 'unramp'] },
  { id: 'permit_water', name: 'Waterscaping Permit', icon: '💧', price: 1500, desc: 'Dig ponds and fill water back in.', ops: ['water', 'land'] },
];

export const PERMIT_BY_ID = {} as Record<PermitId, PermitDef>;
export function rebuildPermits() {
  for (const p of PERMITS) PERMIT_BY_ID[p.id] = p;
}
rebuildPermits();

export function isPermit(id: unknown): id is PermitId {
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(PERMIT_BY_ID, id);
}

export function permitFor(op: TerraOp): PermitDef {
  return PERMITS.find((p) => p.ops.includes(op))!;
}

/** What it costs to move a building somewhere else on the island. */
export function relocationCost(w: number, h: number) {
  return Math.max(100, 60 * w * h);
}
