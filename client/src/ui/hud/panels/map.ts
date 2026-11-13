// 🗺️ World map panel and travelling.

import { BIOMES, SHARED_LOCATIONS, type TravelTarget } from '@hearthwood/shared';
import { net } from '../../../net.ts';
import { state } from '../../../state.ts';
import { clear, h } from '../../dom.ts';
import { BIOME_ICON, renderWorldMap } from '../../map.ts';
import type { Hud } from '../../hud.ts';

export function mapPanel(hud: Hud, b: HTMLElement) {
  const info = h('div', { class: 'card map-info' });
  const drawInfo = () => {
    clear(info);
    const sel = hud.mapSel;
    if (!sel) {
      info.append(h('h3', {}, 'Where to?'), h('p', { class: 'muted' }, '⭐ shared locations are open to all. Coloured dots are islands you may visit: 🟡 yours, 🩷 friends, ⚪ public.'));
    } else if (sel.kind === 'shared') {
      const s = SHARED_LOCATIONS.find((x) => x.id === sel.id)!;
      info.append(h('h3', {}, `⭐ ${s.name}`), h('p', {}, s.blurb), h('button', { class: 'btn', onclick: () => travelTo(hud, { kind: 'shared', id: s.id }) }, 'Travel'));
    } else {
      const i = sel.isl;
      info.append(h('h3', {}, `${BIOME_ICON[i.biome]} ${i.name}`), h('div', { class: 'muted' }, `${i.mine ? 'Your island' : `${i.owner}’s island`} · ${BIOMES[i.biome].name}${i.visitors ? ` · ${i.visitors} here now` : ''}`),
        h('button', { class: 'btn', style: 'margin-top:8px', onclick: () => travelTo(hud, i.mine ? { kind: 'home' } : { kind: 'island', id: i.id }) }, i.mine ? 'Go home' : 'Visit'));
    }
    const code = h('input', { placeholder: 'Invite code', maxlength: 12, style: 'width:120px' }) as HTMLInputElement;
    info.append(h('div', { class: 'row', style: 'margin-top:12px' }, code, h('button', { class: 'btn small', onclick: () => code.value.trim() && travelTo(hud, { kind: 'code', code: code.value.trim().toUpperCase() }) }, 'Visit by code')));
    info.append(h('button', { class: 'btn ghost small', style: 'margin-top:8px', onclick: () => travelTo(hud, { kind: 'home' }) }, '🏠 Go home'));
  };
  drawInfo();
  const wrap = h('div', { class: 'map-wrap' }, renderWorldMap({
    mode: 'travel',
    islands: state.map,
    onShared: (id) => { hud.mapSel = { kind: 'shared', id }; drawInfo(); },
    onIsland: (isl) => { hud.mapSel = { kind: 'island', isl }; drawInfo(); },
  }), info);
  b.append(wrap);
}

export function travelTo(hud: Hud, to: TravelTarget) {
  net.send({ t: 'travel', to });
  hud.close();
}
