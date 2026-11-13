// 🔨 Crafting panel: recipes at hand, the workbench and other stations.

import { BUILDINGS, ITEMS, type RecipeDef, RECIPES } from '@hearthwood/shared';
import { h } from '../../dom.ts';
import { have, ingLabel } from '../common.ts';
import type { Hud } from '../../hud.ts';

export function craftPanel(hud: Hud, b: HTMLElement, stations: RecipeDef['station'][]) {
  const recipes = RECIPES.filter((r) => stations.includes(r.station));
  const grid = h('div', { class: 'grid' });
  for (const r of recipes) {
    const out = ITEMS[r.output];
    const ings = r.ingredients.map(ingLabel);
    const owned = out.stack === 1 && have(r.output) > 0;
    const ok = ings.every((i) => i.have >= i.need) && !owned;
    const stationName = r.station === 'hand' ? 'by hand' : `at ${BUILDINGS[r.station].name}`;
    grid.append(h('div', { class: `tile${ok ? '' : ' locked'}` },
      h('div', { class: 'row' }, h('span', { class: 'ico' }, out.icon), h('div', {}, h('div', { class: 'nm' }, `${out.name}${r.qty > 1 ? ` ×${r.qty}` : ''}`), h('div', { class: 'muted' }, stationName))),
      h('div', { class: 'col', style: 'gap:2px' }, ings.map((i) => h('div', { class: 'muted', style: i.have >= i.need ? '' : 'color:#b84358' }, `${i.label} ${i.have}/${i.need}`))),
      h('button', { class: 'btn small', disabled: !ok, onclick: () => hud.act({ k: 'craft', recipe: r.id }) }, owned ? 'Owned' : 'Make')));
  }
  b.append(grid);
}
