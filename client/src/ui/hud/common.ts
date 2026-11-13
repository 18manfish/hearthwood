// Helpers and constants the HUD and its panels share.

import { HOTBAR_INFO, type HotbarTool, type Ingredient, ITEMS } from '@hearthwood/shared';
import { state } from '../../state.ts';
import { h } from '../dom.ts';

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

/** Fish and birds have pixel-art icons (made in Aseprite, served from /icons/<id>.png). */
const PIXEL_ICON_CATEGORIES = new Set(['fish', 'bird']);

/**
 * An item's icon: its pixel-art picture where it has one, otherwise its emoji.
 * If the picture can't be loaded (e.g. a fish added later without art) the emoji is shown instead.
 */
export function itemIcon(id: string, cls = 'ico'): HTMLElement {
  const it = ITEMS[id];
  const emoji = it?.icon ?? '❔';
  const box = h('span', { class: cls });
  if (!it || !PIXEL_ICON_CATEGORIES.has(it.category)) {
    box.textContent = emoji;
    return box;
  }
  box.classList.add('pix');
  box.append(h('img', { src: `/icons/${id}.png`, alt: it.name, title: it.name, draggable: 'false', onerror: () => { box.classList.remove('pix'); box.textContent = emoji; } }));
  return box;
}
