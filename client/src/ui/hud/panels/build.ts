// 🏗️ Build panel: buildings, paths, terraforming and moving houses.

import { BUILDABLE, BUILDINGS, type BuildingType, ITEMS, PATHS, PERMIT_BY_ID, relocationCost, TERRA_INFO, TERRA_OPS, TERRA_PERMIT, VILLAGER_HOUSE_MONTH_ONE_LIMIT, VILLAGER_HOUSE_MONTH_TWO_MIN_DAY } from '@hearthwood/shared';
import { net } from '../../../net.ts';
import { state } from '../../../state.ts';
import { h } from '../../dom.ts';
import { hasPermit, have } from '../common.ts';
import { selectTool } from '../hotbar.ts';
import type { Hud } from '../../hud.ts';

export function buildPanel(hud: Hud, b: HTMLElement) {
  const room = state.room;
  if (!room?.canBuild) return b.append(h('p', {}, 'You can only build on your own island.'));
  const now = net.serverNow();
  const blds = [...hud.world.buildings.values()];
  const done = (t: BuildingType) => blds.filter((x) => x.type === t && x.completeAt <= now).length;
  const total = (t: BuildingType) => blds.filter((x) => x.type === t).length;
  const day = state.env?.islandDay ?? 1;
  // Paths – painted tile by tile.
  const pathGrid = h('div', { class: 'grid' });
  for (const p of PATHS) {
    const afford = Object.entries(p.cost).every(([id, n]) => have(id) >= n) && (!p.tool || have('shovel') + have('iron_shovel') > 0);
    const costText = Object.keys(p.cost).length ? Object.entries(p.cost).map(([id, n]) => `${ITEMS[id].icon} ${n}`).join(' ') + ' per tile' : 'free · needs a shovel';
    pathGrid.append(h('div', { class: `tile${afford ? '' : ' locked'}` },
      h('div', { class: 'row' }, h('span', { class: 'path-swatch', style: `background:${p.color}` }), h('div', {}, h('div', { class: 'nm' }, p.name), h('div', { class: 'muted' }, costText))),
      h('button', { class: 'btn small', disabled: !afford, onclick: () => { hud.close(); hud.world.startPaint(p.id); hud.setPrompt(''); } }, 'Lay path')));
  }
  pathGrid.append(h('div', { class: 'tile' },
    h('div', { class: 'row' }, h('span', { class: 'ico' }, '🧽'), h('div', {}, h('div', { class: 'nm' }, 'Remove paths'), h('div', { class: 'muted' }, 'Materials are refunded'))),
    h('button', { class: 'btn ghost small', onclick: () => { hud.close(); hud.world.startPaint(0); hud.setPrompt(''); } }, 'Eraser')));
  // Terraforming – needs the tools and a Town Hall.
  const terraGrid = h('div', { class: 'grid' });
  for (const op of TERRA_OPS) {
    const info = TERRA_INFO[op];
    const permit = PERMIT_BY_ID[TERRA_PERMIT[op]];
    const lock = hasPermit(permit.id) || room.role !== 'owner' ? null : `Needs the ${permit.name} (Town Hall)`;
    terraGrid.append(h('div', { class: `tile${lock ? ' locked' : ''}` },
      h('div', { class: 'row' }, h('span', { class: 'ico' }, info.icon), h('div', {}, h('div', { class: 'nm' }, info.name), h('div', { class: 'muted' }, lock ?? info.hint))),
      h('button', { class: 'btn small', disabled: !!lock, onclick: () => {
        hud.close();
        const tool = permit.id === 'permit_cliff' ? 'pick' : 'spade';
        hud.terraOp[tool] = op;
        selectTool(hud, tool);
      } }, 'Use')));
  }
  // Moving buildings.
  const moveGrid = h('div', { class: 'grid' });
  for (const bl of blds) {
    const d = BUILDINGS[bl.type];
    if (d.fixed || bl.type === 'dock') continue;
    if (bl.ownerId && bl.ownerId !== state.self?.id && room.role !== 'owner') continue; // someone else's home
    const cost = relocationCost(bl.w, bl.h);
    const afford = state.coins >= cost;
    moveGrid.append(h('div', { class: `tile${afford ? '' : ' locked'}` },
      h('div', { class: 'row' }, h('span', { class: 'ico' }, d.icon), h('div', {}, h('div', { class: 'nm' }, d.name), h('div', { class: 'muted' }, `🪙 ${cost} to move`))),
      h('button', { class: 'btn small', disabled: !afford, onclick: () => { hud.close(); hud.world.startMoveGhost(bl); hud.setPrompt(''); } }, 'Move')));
  }
  b.append(h('h3', {}, '🛤️ Paths'), pathGrid, h('h3', { style: 'margin-top:14px' }, '⛰️ Terraforming'), terraGrid);
  if (moveGrid.childElementCount) b.append(h('h3', { style: 'margin-top:14px' }, '🚚 Move a building'), h('p', { class: 'muted' }, 'Pick it up, then click its new spot (walk close first). Villagers and furniture inside move along.'), moveGrid);
  b.append(h('h3', { style: 'margin-top:14px' }, '🏗️ Buildings'));

  const grid = h('div', { class: 'grid' });
  for (const t of BUILDABLE) {
    const d = BUILDINGS[t];
    let lock: string | null = null;
    const missing = d.requires.filter((r) => done(r) < 1);
    let max = d.max;
    if (t === 'villager_house' && day < VILLAGER_HOUSE_MONTH_TWO_MIN_DAY && !state.dev) max = VILLAGER_HOUSE_MONTH_ONE_LIMIT;
    if (missing.length) lock = `Needs ${missing.map((m) => BUILDINGS[m].name).join(', ')}`;
    else if (!state.dev && day < d.minDay) lock = `Unlocks on day ${d.minDay}`;
    else if (total(t) >= max) lock = total(t) >= d.max ? 'Built' : `More on day ${VILLAGER_HOUSE_MONTH_TWO_MIN_DAY}`;
    const afford = Object.entries(d.cost).every(([id, n]) => have(id) >= n);
    grid.append(h('div', { class: `tile${lock ? ' locked' : ''}` },
      h('div', { class: 'row' }, h('span', { class: 'ico' }, d.icon), h('div', {}, h('div', { class: 'nm' }, d.name), h('div', { class: 'muted' }, `${d.w}×${d.h}${d.buildMinutes ? ` · ${d.buildMinutes >= 60 ? d.buildMinutes / 60 + 'h' : d.buildMinutes + 'm'} build` : ''}${d.max > 1 ? ` · ${total(t)}/${d.max}` : ''}`))),
      h('div', { class: 'muted' }, d.description),
      h('div', { class: 'col', style: 'gap:2px' }, Object.entries(d.cost).map(([id, n]) => h('div', { class: 'muted', style: have(id) >= n ? '' : 'color:#b84358' }, `${ITEMS[id].icon} ${ITEMS[id].name} ${have(id)}/${n}`))),
      lock ? h('span', { class: 'pill' }, lock) : h('button', { class: 'btn small', disabled: !afford, onclick: () => { hud.close(); hud.world.startBuildGhost(t); hud.setPrompt(''); } }, afford ? 'Choose spot' : 'Need materials')));
  }
  b.append(grid);
}
