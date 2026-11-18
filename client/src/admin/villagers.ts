// Admin tool: one villager on one island (friendships, house, moving out).

import { ITEMS, FRIENDSHIP_MAX, friendshipLevel, villagerDef, type Building, SPECIES_ICON } from '@hearthwood/shared';
import { h, clear } from '../ui/dom.ts';
import { type IslandView, islandPage } from './islandEditor.ts';
import { ago, call, field, input, select, shell, toast } from './ui.ts';

export function villagerChip(islandId: string, vid: string) {
  const def = villagerDef(vid);
  return h('a', { class: 'vchip', href: `#villager/${islandId}/${vid}`, title: 'Open this villager’s admin page', onclick: (e: Event) => e.stopPropagation() },
    h('span', { class: 'vdot', style: `background:${def?.color ?? '#ccc'}` }), def?.name ?? vid);
}

interface VillagerAdminView {
  island: { id: string; name: string; biome: string; loaded: boolean };
  owner: { id: string; name: string } | null;
  villager: { defId: string; houseId: string; movedInAt: number; friendship: Record<string, { pts: number; talkDay?: string; giftDay?: string; level?: number }> };
  live: { x: number; z: number; home: boolean } | null;
  houses: { id: string; x: number; z: number; villagerId: string | null }[];
  friends: { id: string; name: string | null; username: string | null; online: boolean; pts: number; talkDay?: string; giftDay?: string; level?: number }[];
  others: string[];
}

export async function villagerPage(islandId: string, vid: string) {
  const r = await call<VillagerAdminView>('GET', `/api/admin/islands/${islandId}/villagers/${vid}`);
  if (!r) return islandPage(islandId);
  const def = villagerDef(vid);
  const vr = r.villager;
  const house = r.houses.find((b) => b.id === vr.houseId);
  const left = h('div', { class: 'col', style: 'gap:16px' });
  const right = h('div', { class: 'col', style: 'gap:16px' });
  shell('islands', h('div', { class: 'col', style: 'gap:12px' },
    h('div', { class: 'row' },
      h('a', { class: 'btn ghost small', href: `#island/${r.island.id}` }, `← ${r.island.name}`),
      h('span', { class: 'vface big', style: `background:${def?.color ?? '#ccc'};border-color:${def?.accent ?? '#fff'}` }, SPECIES_ICON[def?.species ?? ''] ?? '🐾'),
      h('h2', { style: 'margin:0' }, def?.name ?? vid),
      def ? h('span', { class: 'muted' }, `“${def.catchphrase}” · ${vid}`) : null,
      r.others.length ? h('span', { style: 'flex:1' }) : null,
      r.others.length ? h('div', { class: 'chips' }, h('span', { class: 'muted small' }, 'Neighbours:'), r.others.map((o) => villagerChip(r.island.id, o))) : null),
    h('div', { class: 'split' }, left, right)));

  // Profile (from game data – edit it in the game creation tool).
  const tag = (t: string) => h('span', { class: 'pill' }, t);
  if (def) left.append(h('div', { class: 'box' }, h('h3', {}, '🪪 Profile'),
    h('div', { class: 'form' },
      field('Species', h('span', {}, `${SPECIES_ICON[def.species] ?? ''} ${def.species}`)),
      field('Personality', h('span', {}, def.personality)),
      field('Birthday', h('span', {}, new Date(`2000-${def.birthday}T12:00`).toLocaleDateString(undefined, { month: 'long', day: 'numeric' }))),
      field('Loves', h('div', { class: 'chips' }, def.loves.map((i) => tag(`${ITEMS[i]?.icon ?? '❓'} ${ITEMS[i]?.name ?? i}`)))),
      field('Likes', h('div', { class: 'chips' }, def.likes.map(tag))),
      field('Dislikes', h('div', { class: 'chips' }, def.dislikes.map(tag))),
      field('Colours', h('div', { class: 'row' }, h('span', { class: 'vdot big', style: `background:${def.color}` }), h('span', { class: 'vdot big', style: `background:${def.accent}` }))),
      field('Moved in', h('span', {}, `${new Date(vr.movedInAt).toLocaleDateString()} (${ago(vr.movedInAt)})`)))));

  // Friendship with each player.
  const rows = r.friends.map((f) => ({ ...f, input: input(f.pts, { type: 'number', min: 0, max: FRIENDSHIP_MAX, style: 'width:80px' }), removed: false }));
  const fbox = h('div', { class: 'box' });
  const drawFriends = () => {
    clear(fbox);
    fbox.append(h('h3', {}, `💛 Friendship (${rows.filter((x) => !x.removed).length})`));
    if (!rows.length) fbox.append(h('p', { class: 'muted' }, 'No player has talked to them yet.'));
    else fbox.append(h('div', { class: 'scroll' }, h('table', { class: 'data' },
      h('tr', {}, ['', 'Player', 'Points', 'Level', 'Today', ''].map((t) => h('th', {}, t))),
      rows.filter((x) => !x.removed).map((f) => {
        const lvl = h('span', {}, friendshipLevel(Number(f.input.value) || 0).name);
        f.input.oninput = () => (lvl.textContent = friendshipLevel(Number(f.input.value) || 0).name);
        return h('tr', {},
          h('td', {}, f.online ? '🟢' : '⚪'),
          h('td', {}, f.name ? h('a', { href: `#player/${f.id}` }, f.name) : h('span', { class: 'muted' }, `${f.id} (deleted)`), f.username ? h('div', { class: 'muted small' }, f.username) : null),
          h('td', {}, f.input), h('td', {}, lvl),
          h('td', { class: 'muted small' }, [f.talkDay ? `talked ${f.talkDay}` : null, f.giftDay ? `gift ${f.giftDay}` : null].filter(Boolean).join(' · ') || '–'),
          h('td', {}, h('button', { class: 'btn ghost small', title: 'Forget this player', onclick: () => { f.removed = true; drawFriends(); } }, '✕')));
      }))));
    fbox.append(h('div', { class: 'row', style: 'margin-top:10px' },
      h('button', { class: 'btn', onclick: async () => {
        const friendship: VillagerAdminView['villager']['friendship'] = {};
        for (const f of rows) if (!f.removed) friendship[f.id] = { ...vr.friendship[f.id], pts: Math.max(0, Math.min(FRIENDSHIP_MAX, Math.round(Number(f.input.value) || 0))) };
        if (await saveVillager(r.island.id, vid, (x) => { x.friendship = friendship; })) { toast('Friendship saved'); villagerPage(islandId, vid); }
      } }, 'Save friendship'),
      h('span', { class: 'muted small' }, `0–${FRIENDSHIP_MAX} points`)));
  };
  drawFriends();
  left.append(fbox);

  // Where they are right now.
  right.append(h('div', { class: 'box' }, h('h3', {}, '🧭 Status'),
    h('div', { class: 'col' },
      h('div', {}, '🏝️ ', h('a', { href: `#island/${r.island.id}` }, r.island.name), r.owner ? h('span', { class: 'muted' }, ' · owner ', h('a', { href: `#player/${r.owner.id}` }, r.owner.name)) : null),
      h('div', {}, !r.island.loaded ? '💤 The island isn’t loaded – nobody is there right now.' : !r.live ? 'Not spawned yet.' : r.live.home ? '🏠 At home' : `🚶 Out and about at ${Math.floor(r.live.x)},${Math.floor(r.live.z)}`),
      house ? h('div', {}, `🏠 House ${house.id} at ${house.x},${house.z} `, h('a', { href: `#island/${r.island.id}/${house.id}` }, 'show on map ›')) : h('div', { class: 'errors' }, `Their house (${vr.houseId}) is missing.`))));

  // Housing.
  const free = r.houses.filter((b) => !b.villagerId || b.villagerId === vid);
  const houseSel = select(free.map((b) => [b.id, `${b.id} at ${b.x},${b.z}${b.id === vr.houseId ? ' (current)' : ''}`]), vr.houseId);
  right.append(h('div', { class: 'box' }, h('h3', {}, '🏡 Housing'),
    h('div', { class: 'row' }, houseSel, h('button', { class: 'btn small', disabled: free.length < 2, onclick: async () => {
      if (houseSel.value === vr.houseId) return;
      const to = houseSel.value;
      if (await saveVillager(r.island.id, vid, (x, bs) => {
        for (const b of bs) if (b.id === x.houseId && b.villagerId === vid) b.villagerId = undefined;
        const nb = bs.find((b) => b.id === to);
        if (nb) nb.villagerId = vid;
        x.houseId = to;
      })) { toast('Moved house'); villagerPage(islandId, vid); }
    } }, 'Move to this house')),
    free.length < 2 ? h('div', { class: 'muted help' }, 'There’s no empty villager house on this island.') : null,
    h('hr'),
    h('button', { class: 'btn warn small', onclick: async () => {
      if (!confirm(`Move ${def?.name ?? vid} off ${r.island.name}? Their friendships here are lost.`)) return;
      if (await saveVillager(r.island.id, vid, null)) { toast('Moved out'); location.hash = `island/${r.island.id}`; }
    } }, '📦 Move out')));
}

/** Change one villager (null = move them out) on top of the island's current state. */
async function saveVillager(islandId: string, vid: string, change: ((v: IslandView['record']['villagers'][number], buildings: Building[]) => void) | null) {
  const cur = await call<IslandView>('GET', `/api/admin/islands/${islandId}`);
  if (!cur) return false;
  const villagers = cur.record.villagers;
  const buildings = cur.record.buildings;
  const v = villagers.find((x) => x.defId === vid);
  if (!v) return toast('That villager no longer lives here.', false), false;
  if (change) change(v, buildings);
  else {
    villagers.splice(villagers.indexOf(v), 1);
    for (const b of buildings) if (b.villagerId === vid) b.villagerId = undefined;
  }
  return !!(await call('PATCH', `/api/admin/islands/${islandId}`, { villagers, buildings }));
}
