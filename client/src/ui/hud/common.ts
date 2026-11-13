// Helpers and constants the HUD and its panels share.

import { HOTBAR_INFO, type HotbarTool, type Ingredient, ITEMS } from '@hearthwood/shared';
import { state } from '../../state.ts';

export const WEATHER_ICON: Record<string, string> = { clear: '☀️', cloudy: '☁️', rain: '🌧️', storm: '⛈️', snow: '❄️', fog: '🌫️', sandstorm: '🌪️', heatwave: '🔥' };
export const SEASON_ICON: Record<string, string> = { spring: '🌸', summer: '🌻', autumn: '🍂', winter: '⛄', wet: '🌧️', dry: '🌞', hot: '🔆', cool: '🌙' };

export type PanelId = 'goals' | 'bag' | 'craft' | 'build' | 'map' | 'friends' | 'mail' | 'island' | 'debug' | 'album';

export function have(id: string) {
  return state.inv[id] ?? 0;
}

export function hasPermit(id: string) {
  return !!state.self?.permits.includes(id);
}

/** Does the player have what this hotbar tool needs? */
export function toolOwned(t: HotbarTool) {
  const info = HOTBAR_INFO[t];
  if (info.permit) return hasPermit(info.permit);
  return !info.items.length || info.items.some((id) => have(id) > 0);
}

export function tagCount(tag: string) {
  let n = 0;
  for (const [id, q] of Object.entries(state.inv)) if (ITEMS[id]?.tags.includes(tag as never) && ITEMS[id].category !== 'tool') n += q;
  return n;
}

export function ingLabel(ing: Ingredient) {
  if ('item' in ing) return { label: `${ITEMS[ing.item].icon} ${ITEMS[ing.item].name}`, have: have(ing.item), need: ing.qty };
  return { label: `any ${ing.tag}`, have: tagCount(ing.tag), need: ing.qty };
}

export function cap(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
