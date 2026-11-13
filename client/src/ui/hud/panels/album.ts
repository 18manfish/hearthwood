// 📖 Album panel: fish and birds caught, by water and biome.

import { BIRDS, FISH } from '@hearthwood/shared';
import { state } from '../../../state.ts';
import { h } from '../../dom.ts';
import { BIOME_ICON } from '../../map.ts';
import { itemIcon, SEASON_ICON } from '../common.ts';
import type { Hud } from '../../hud.ts';

export function albumPanel(hud: Hud, b: HTMLElement) {
  const a = state.album;
  const fishN = FISH.filter((f) => a.fish[f.id]).length;
  const birdN = BIRDS.filter((x) => a.birds[x.id]).length;
  const tab = (id: 'fish' | 'birds', label: string) =>
    h('button', { class: `btn small${hud.albumTab === id ? '' : ' ghost'}`, onclick: () => { hud.albumTab = id; hud.panelRefresh?.(); } }, label);
  b.append(h('div', { class: 'row', style: 'margin-bottom:10px' }, tab('fish', `🐟 Fish ${fishN}/${FISH.length}`), tab('birds', `🐦 Birds ${birdN}/${BIRDS.length}`)));
  const hours = (hr?: [number, number]) => (hr ? `${String(hr[0]).padStart(2, '0')}:00–${String(hr[1]).padStart(2, '0')}:00` : 'all day');
  const when = (s?: string[]) => (s ? s.map((x) => SEASON_ICON[x] ?? '').join('') + ' ' + s.join(', ') : 'all year');
  const grid = h('div', { class: 'grid album' });
  const entries = hud.albumTab === 'fish'
    ? FISH.map((f) => ({ id: f.id, name: f.name, icon: f.icon, sell: f.sell, e: a.fish[f.id], hint: `${f.water === 'sea' ? '🌊 Sea' : f.water === 'river' ? '🏞️ Rivers' : '🪷 Ponds'} · ${hours(f.hours)} · ${when(f.seasons)}` }))
    : BIRDS.map((x) => ({ id: x.id, name: x.name, icon: x.icon, sell: x.sell, e: a.birds[x.id], hint: `${x.biomes.map((bi) => BIOME_ICON[bi]).join('')} ${x.perch === 'shore' ? '· on beaches ' : ''}· ${hours(x.hours)} · ${when(x.seasons)}` }));
  for (const en of entries) {
    const got = !!en.e;
    grid.append(h('div', { class: `tile${got ? '' : ' unknown'}` },
      h('div', { class: 'row', style: 'justify-content:space-between' }, got ? itemIcon(en.id) : h('span', { class: 'ico' }, '❔'), got ? h('b', {}, `×${en.e!.n}`) : null),
      h('div', { class: 'nm' }, got ? en.name : '???'),
      h('div', { class: 'muted' }, got ? `First caught ${new Date(en.e!.first).toLocaleDateString()} ${BIOME_ICON[en.e!.biome as keyof typeof BIOME_ICON] ?? ''} · sells for ${en.sell}` : en.hint)));
  }
  b.append(grid);
  const total = fishN + birdN, all = FISH.length + BIRDS.length;
  b.append(h('p', { class: 'muted', style: 'margin-top:10px' }, total === all ? '🏆 Album complete – amazing!' : `${total}/${all} discovered. Uncaught entries show where and when to look.`));
}
