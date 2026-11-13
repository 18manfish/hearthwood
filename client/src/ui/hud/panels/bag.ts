// 🎒 Pockets panel: inventory, wearing and placing items.

import { ITEMS } from '@hearthwood/shared';
import { state } from '../../../state.ts';
import { h } from '../../dom.ts';
import { hotbarEditor } from '../hotbar.ts';
import { writeBottle } from './mail.ts';
import type { Hud } from '../../hud.ts';

export function bagPanel(hud: Hud, b: HTMLElement, pockets = false) {
  if (pockets) {
    hotbarEditor(hud, b);
    b.append(h('div', { class: 'row', style: 'margin:8px 0 12px' }, h('button', { class: 'btn ghost small', onclick: () => hud.open('album') }, '📖 Open album (K)')), h('h3', {}, '🎒 Items'));
  }
  const items = Object.entries(state.inv).filter(([, n]) => n > 0).sort((a, c) => ITEMS[a[0]].category.localeCompare(ITEMS[c[0]].category) || a[0].localeCompare(c[0]));
  if (!items.length) return b.append(h('p', { class: 'muted' }, 'Your pockets are empty. Shake some trees!'));
  const canBuild = state.room?.canDecorate;
  b.append(h('p', { class: 'muted' }, 'Sell items at the storage chest in your tent or house, or at the town hall.'));
  const grid = h('div', { class: 'grid' });
  for (const [id, n] of items) {
    const it = ITEMS[id];
    const actions = h('div', { class: 'row' });
    if (it.placeable && canBuild) actions.append(h('button', { class: 'btn small', onclick: () => { hud.close(); hud.world.startPlaceGhost(id); hud.setPrompt(''); } }, 'Place'));
    if (id === 'message_bottle') actions.append(h('button', { class: 'btn small', onclick: () => writeBottle(hud) }, 'Write & throw'));
    if (it.wear) actions.append(h('button', { class: 'btn small', onclick: () => hud.act({ k: 'wear', item: state.self?.hat === id ? null : id }) }, state.self?.hat === id ? 'Take off' : 'Wear'));
    actions.append(h('button', { class: 'btn ghost small', title: `${it.sell} each`, onclick: () => hud.act({ k: 'sell', item: id, n: 1 }) }, `Sell ${it.sell}`));
    if (n > 1) actions.append(h('button', { class: 'btn ghost small', onclick: () => hud.act({ k: 'sell', item: id, n }) }, 'All'));
    grid.append(h('div', { class: 'tile' }, h('div', { class: 'row', style: 'justify-content:space-between' }, h('span', { class: 'ico' }, it.icon), h('b', {}, `×${n}`)), h('div', { class: 'nm' }, it.name), actions));
  }
  b.append(grid);
}
