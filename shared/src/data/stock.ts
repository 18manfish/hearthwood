// What the shops sell today. Every shop has a full list (SHOP_STOCK, editable in the
// game creation tool) but only puts a few of those things out each day. The pick is
// new every morning when the shops open, the same for everyone on that island, and
// weighted by each item's tier: common things turn up often, rare ones now and then.
// Bigger shops (higher building tier) have room for more.

import { localTime } from '../env.ts';
import { hashMany, Rng } from '../rng.ts';
import { SHOP_STOCK, type BuildingType } from './buildings.ts';
import { ITEM_TIERS, ITEMS, type ItemTier } from './items.ts';

/** Shops open (and restock) at 08:00 island time. */
export const SHOP_OPEN_HOUR = 8;

/** How many different things a shop puts out each day, per shop tier (1, 2, 3). */
export const STOCK_SLOTS: Partial<Record<BuildingType, readonly number[]>> = {
  tool_store: [3, 4, 5],
  furniture_store: [6, 8, 10],
  clothing_shop: [6, 8, 10],
};

export function itemTier(id: string): ItemTier {
  const t = ITEMS[id]?.tier;
  return t === 2 || t === 3 ? t : 1;
}

/** Things on the shelves of this shop at this tier (Infinity: no limit). */
export function stockSlots(shop: BuildingType, level: number): number {
  const s = STOCK_SLOTS[shop];
  if (!s?.length) return Infinity;
  return s[Math.max(0, Math.min(s.length, Math.round(level) || 1) - 1)];
}

/** The shopping day: it starts when the shops open, not at midnight. */
export function stockDayKey(now: number, tz: string): string {
  return localTime(now - SHOP_OPEN_HOUR * 3_600_000, tz).dayKey;
}

/** Milliseconds until the next restock (the next 08:00 island time). */
export function msUntilRestock(now: number, tz: string): number {
  const lt = localTime(now, tz);
  const hours = (SHOP_OPEN_HOUR - lt.hour + 24) % 24 || 24;
  return Math.max(60_000, (hours * 60 - lt.minute) * 60_000);
}

export interface StockOptions {
  /** The shop's full list (default: SHOP_STOCK). */
  list?: readonly string[];
  /** An item's tier (default: from ITEMS). */
  tierOf?: (id: string) => ItemTier;
}

/**
 * Today's stock: `slots` items drawn from the shop's list without repeats, each
 * weighted by its tier. Listed in the shop's own order. `seed` is the island.
 * `opts` lets the game creation tool try unsaved lists and tiers.
 */
export function dailyStock(shop: BuildingType, seed: string, dayKey: string, level: number, opts: StockOptions = {}): string[] {
  const tierOf = opts.tierOf ?? itemTier;
  const all = (opts.list ?? SHOP_STOCK[shop] ?? []).filter((id) => opts.list || ITEMS[id]?.buy !== undefined);
  const n = stockSlots(shop, level);
  if (all.length <= n) return [...all];
  const rng = new Rng(hashMany('stock', seed, shop, dayKey));
  const pool = [...all];
  const picked = new Set<string>();
  while (picked.size < n && pool.length) {
    const id = rng.weighted(pool, (x) => ITEM_TIERS[tierOf(x)].weight)!;
    picked.add(id);
    pool.splice(pool.indexOf(id), 1);
  }
  return all.filter((id) => picked.has(id));
}

/** How often each item is out (0–1), estimated over `days` days on one island. */
export function stockOdds(shop: BuildingType, level: number, opts: StockOptions = {}, days = 1500): Map<string, number> {
  const seen = new Map<string, number>();
  for (let d = 0; d < days; d++) for (const id of dailyStock(shop, 'odds', `d${d}`, level, opts)) seen.set(id, (seen.get(id) ?? 0) + 1);
  for (const [id, n] of seen) seen.set(id, n / days);
  return seen;
}
