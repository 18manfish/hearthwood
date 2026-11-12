import { ITEMS, maxStack, type Ingredient } from '@hearthwood/shared';
import type { PlayerRecord } from '../types.ts';

export function count(p: PlayerRecord, id: string) {
  return p.inv[id] ?? 0;
}

export function canAdd(p: PlayerRecord, id: string, n: number) {
  return count(p, id) + n <= maxStack(id);
}

/** Adds up to the stack limit; returns how many were actually added. */
export function add(p: PlayerRecord, id: string, n: number): number {
  const room = Math.max(0, maxStack(id) - count(p, id));
  const k = Math.min(room, n);
  if (k > 0) p.inv[id] = count(p, id) + k;
  return k;
}

export function remove(p: PlayerRecord, id: string, n: number): boolean {
  if (count(p, id) < n) return false;
  p.inv[id] -= n;
  if (p.inv[id] <= 0) delete p.inv[id];
  return true;
}

export function hasAll(p: PlayerRecord, cost: Record<string, number>, times = 1) {
  return Object.entries(cost).every(([id, n]) => count(p, id) >= n * times);
}

export function removeAll(p: PlayerRecord, cost: Record<string, number>, times = 1) {
  if (!hasAll(p, cost, times)) return false;
  for (const [id, n] of Object.entries(cost)) remove(p, id, n * times);
  return true;
}

/**
 * Resolve recipe ingredients (items or tags) into concrete item amounts.
 * Tag ingredients consume the least valuable matching items first.
 * Returns null if the player lacks something.
 */
export function resolveIngredients(p: PlayerRecord, ings: Ingredient[], times: number): Record<string, number> | null {
  const need: Record<string, number> = {};
  const avail = (id: string) => count(p, id) - (need[id] ?? 0);
  // Specific items first so tags don't eat them.
  for (const ing of ings) {
    if ('item' in ing) {
      need[ing.item] = (need[ing.item] ?? 0) + ing.qty * times;
      if (count(p, ing.item) < need[ing.item]) return null;
    }
  }
  for (const ing of ings) {
    if (!('tag' in ing)) continue;
    let left = ing.qty * times;
    const candidates = Object.keys(p.inv)
      .filter((id) => ITEMS[id]?.tags.includes(ing.tag) && ITEMS[id].category !== 'tool')
      .sort((a, b) => ITEMS[a].sell - ITEMS[b].sell);
    for (const id of candidates) {
      const k = Math.min(left, avail(id));
      if (k > 0) {
        need[id] = (need[id] ?? 0) + k;
        left -= k;
      }
      if (left === 0) break;
    }
    if (left > 0) return null;
  }
  return need;
}

/** Best tool power the player owns for a kind (0 = none). */
export function toolPower(p: PlayerRecord, kind: 'axe' | 'shovel' | 'rod'): number {
  let best = 0;
  for (const id of Object.keys(p.inv)) {
    const t = ITEMS[id]?.tool;
    if (t && t.kind === kind && count(p, id) > 0) best = Math.max(best, t.power);
  }
  return best;
}
