// The hotbar: ten slots the player fills with tools (and swaps around).

export const HOTBAR_SIZE = 10;

export const HOTBAR_TOOLS = ['hand', 'axe', 'shovel', 'rod', 'net', 'sapling', 'pick', 'spade'] as const;
export type HotbarTool = (typeof HOTBAR_TOOLS)[number];
export type Hotbar = (HotbarTool | null)[];

export const DEFAULT_HOTBAR: Hotbar = ['hand', 'axe', 'shovel', 'rod', 'net', 'sapling', 'pick', 'spade', null, null];

export const HOTBAR_INFO: Record<HotbarTool, { name: string; icon: string; items: string[]; permit?: string }> = {
  hand: { name: 'Hands', icon: '✋', items: [] },
  axe: { name: 'Axe', icon: '🪓', items: ['stone_axe', 'iron_axe'] },
  shovel: { name: 'Shovel', icon: '⛏️', items: ['shovel', 'iron_shovel'] },
  rod: { name: 'Fishing rod', icon: '🎣', items: ['fishing_rod', 'pro_rod'] },
  net: { name: 'Bird net', icon: '🥅', items: ['bird_net', 'silk_net'] },
  sapling: { name: 'Saplings', icon: '🌱', items: ['sapling'] },
  pick: { name: 'Landscaping', icon: '⛰️', items: [], permit: 'permit_cliff' },
  spade: { name: 'Waterscaping', icon: '💧', items: [], permit: 'permit_water' },
};

/** Make any client-sent hotbar safe: right length, known tools, no duplicates. */
export function normalizeHotbar(slots: unknown): Hotbar {
  const out: Hotbar = [];
  const seen = new Set<string>();
  const arr = Array.isArray(slots) ? slots : [];
  for (let i = 0; i < HOTBAR_SIZE; i++) {
    const v = arr[i];
    if (typeof v === 'string' && (HOTBAR_TOOLS as readonly string[]).includes(v) && !seen.has(v)) {
      seen.add(v);
      out.push(v as HotbarTool);
    } else out.push(null);
  }
  if (!seen.has('hand')) {
    const free = out.indexOf(null);
    out[free >= 0 ? free : 0] = 'hand';
  }
  return out;
}
