// Admin tool: the island list and loading one island into the editor.

import { BIOMES } from '@hearthwood/shared';
import { h, clear } from '../ui/dom.ts';
import { call, input, shell } from './ui.ts';
import { villagerChip } from './villagers.ts';

export async function islandsPage() {
  const body = h('div', { class: 'box' });
  shell('islands', body);
  const search = input('', { placeholder: 'Search island, owner or id…', style: 'width:300px' });
  const table = h('div', { class: 'scroll' });
  const load = async () => {
    const r = await call<{ total: number; islands: { id: string; name: string; biome: string; owner: { id: string; name: string }; access: string; size: number; buildings: number; villagers: number; villagerIds?: string[]; loaded: boolean; visitors: number; createdAt: number }[] }>('GET', `/api/admin/islands?q=${encodeURIComponent(search.value)}`);
    if (!r) return;
    clear(table);
    table.append(h('table', { class: 'data' },
      h('tr', {}, ['Island', 'Owner', 'Biome', 'Size', 'Access', 'Buildings', 'Villagers', 'Now'].map((t) => h('th', {}, t))),
      r.islands.map((i) => h('tr', { class: 'click', onclick: () => (location.hash = `island/${i.id}`) },
        h('td', {}, h('b', {}, i.name), h('div', { class: 'muted' }, i.id)),
        h('td', {}, h('a', { href: `#player/${i.owner.id}`, onclick: (e: Event) => e.stopPropagation() }, i.owner.name)),
        h('td', {}, BIOMES[i.biome as keyof typeof BIOMES]?.name ?? i.biome), h('td', {}, `${i.size}×${i.size}`), h('td', {}, i.access),
        h('td', {}, String(i.buildings)),
        h('td', { style: 'max-width:340px' }, i.villagerIds?.length
          ? h('div', { class: 'chips' }, i.villagerIds.map((vid) => villagerChip(i.id, vid)))
          : h('span', { class: 'muted' }, String(i.villagers))),
        h('td', { class: 'muted' }, i.loaded ? `loaded · ${i.visitors} here` : '')))));
  };
  search.oninput = () => load();
  body.append(h('div', { class: 'row', style: 'margin-bottom:10px' }, search, h('button', { class: 'btn small ghost', onclick: load }, '↻ Refresh')), table);
  await load();
}
