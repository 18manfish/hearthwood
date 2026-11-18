// Admin tool: the player list and the page that edits one player.

import { BIOMES, DEFAULT_HOTBAR, HOTBAR_INFO, HOTBAR_SIZE, HOTBAR_TOOLS, ITEMS, ITEM_LIST, PERMITS, BIRTHDAY_MIN, DEFAULT_BIRTHDAY } from '@hearthwood/shared';
import { h, clear } from '../ui/dom.ts';
import { ago, call, field, input, parseJson, select, shell, textarea, toast } from './ui.ts';

export interface PlayerSummary {
  id: string; username: string | null; email?: string | null; name: string; role: string; banned: boolean; online: boolean; coins: number;
  island: { id: string; name: string; biome: string } | null; createdAt: number; lastSeen: number; room: string | null;
}

export async function playersPage(q = '') {
  const body = h('div', { class: 'box' });
  shell('players', body);
  const search = input(q, { placeholder: 'Search name, username, id or friend code…', style: 'width:340px' });
  const table = h('div', { class: 'scroll' });
  const load = async () => {
    const r = await call<{ total: number; players: PlayerSummary[] }>('GET', `/api/admin/players?q=${encodeURIComponent(search.value)}`);
    if (!r) return;
    clear(table);
    table.append(h('table', { class: 'data' },
      h('tr', {}, ['', 'Name', 'Username', 'Role', 'Coins', 'Island', 'Where', 'Last seen'].map((t) => h('th', {}, t))),
      r.players.map((p) => h('tr', { class: 'click', onclick: () => (location.hash = `player/${p.id}`) },
        h('td', {}, p.online ? '🟢' : '⚪'),
        h('td', {}, h('b', {}, p.name), p.banned ? h('span', { class: 'pill no', style: 'margin-left:6px' }, 'banned') : null),
        h('td', {}, p.username ?? h('span', { class: 'muted' }, 'guest'), p.email ? h('div', { class: 'muted' }, p.email) : null),
        h('td', {}, p.role === 'admin' ? h('span', { class: 'pill ok' }, 'admin') : 'player'),
        h('td', {}, String(p.coins)),
        h('td', {}, p.island ? h('a', { href: `#island/${p.island.id}`, onclick: (e: Event) => e.stopPropagation() }, `${p.island.name}`) : '–'),
        h('td', { class: 'muted' }, p.room ?? ''),
        h('td', { class: 'muted' }, p.online ? 'online' : ago(p.lastSeen))))));
    count.textContent = `${r.players.length} of ${r.total} players`;
  };
  const count = h('span', { class: 'muted' });
  let timer: ReturnType<typeof setTimeout>;
  search.oninput = () => { clearTimeout(timer); timer = setTimeout(load, 250); };
  body.append(h('div', { class: 'row', style: 'margin-bottom:10px' }, search, h('button', { class: 'btn small ghost', onclick: load }, '↻ Refresh'), count), table);
  await load();
}

export async function playerPage(id: string) {
  const r = await call<{ player: Record<string, unknown> & { id: string }; summary: PlayerSummary }>('GET', `/api/admin/players/${id}`);
  if (!r) return playersPage();
  const p = r.player as unknown as {
    id: string; username?: string; name: string; role?: string; banned?: { reason: string; until?: number; by?: string }; coins: number; inv: Record<string, number>;
    permits?: string[]; hotbar?: (string | null)[]; album?: unknown; look: Record<string, string>; gender: string; hat: string | null; chapterRewarded: number;
    mail: unknown[]; homeIslandId: string | null; birthday?: string; email?: string; emailPending?: { email: string; sentAt: number } | null; code: string; createdAt: number; lastSeen: number; friends: string[]; hasPassword: boolean;
  };
  const s = r.summary;
  const left = h('div', { class: 'col', style: 'gap:16px' });
  const right = h('div', { class: 'col', style: 'gap:16px' });
  shell('players', h('div', { class: 'col', style: 'gap:12px' },
    h('div', { class: 'row' }, h('a', { class: 'btn ghost small', href: '#players' }, '← All players'),
      h('h2', { style: 'margin:0' }, `${s.online ? '🟢' : '⚪'} ${p.name}`), h('span', { class: 'muted' }, `${p.id} · friend code ${p.code} · joined ${new Date(p.createdAt).toLocaleDateString()}`)),
    h('div', { class: 'split' }, left, right)));

  // Profile.
  const name = input(p.name, { maxlength: 16 });
  const username = input(p.username ?? '', { maxlength: 20, placeholder: 'guest (none)' });
  const role = select([['player', 'Player'], ['admin', 'Admin']], p.role ?? 'player');
  const coins = input(p.coins, { type: 'number', min: 0 });
  const gender = select([['boy', 'Boy'], ['girl', 'Girl']], p.gender);
  const hat = select([['', '– none –'], ...ITEM_LIST.filter((i) => i.wear === 'hat').map((i) => [i.id, `${i.icon} ${i.name}`] as [string, string])], p.hat ?? '');
  const chapter = input(p.chapterRewarded, { type: 'number', min: 0 });
  const birthday = input(p.birthday ?? '', { type: 'date', min: BIRTHDAY_MIN });
  const email = input(p.email ?? '', { type: 'email', maxlength: 254, placeholder: p.username ? 'none yet – asked for at next login' : 'guest (none)' });
  const home = input(p.homeIslandId ?? '', { placeholder: 'island id' });
  const looks = Object.fromEntries(['skin', 'hairColor', 'eyes', 'shirt', 'pants', 'shoes'].map((k) => [k, input(p.look[k], { type: 'color' })]));
  const hair = input(p.look.hair);
  const permits = PERMITS.map((pm) => [pm.id, h('input', { type: 'checkbox', checked: !!p.permits?.includes(pm.id) }) as HTMLInputElement] as const);
  left.append(h('div', { class: 'box' }, h('h3', {}, '👤 Profile'),
    h('div', { class: 'form' },
      field('Name', name), field('Username', username, p.hasPassword ? 'Has a password' : 'No password yet'), field('Role', role), field('Coins', coins),
      field('Gender', gender), field('Hat', hat), field('Look', h('div', { class: 'row' }, hair, Object.entries(looks).map(([k, el]) => h('span', { title: k }, el)))),
      field('Permits', h('div', { class: 'row' }, permits.map(([pid, cb]) => h('label', { class: 'row', style: 'gap:4px' }, cb, PERMITS.find((x) => x.id === pid)!.name)))),
      field('Email', email, p.email ? '✅ Confirmed. Changing it here counts as confirmed; empty asks the player again at their next login.'
        : p.emailPending ? `Waiting for the code sent to ${p.emailPending.email} (${ago(p.emailPending.sentAt)})` : p.username ? 'Not confirmed yet – the player is asked for one before playing.' : undefined),
      field('Birthday', birthday, p.birthday === DEFAULT_BIRTHDAY ? 'The default – this character was made before birthdays were asked for' : undefined),
      field('Chapter reward paid', chapter), field('Home island', home)),
    h('div', { class: 'row', style: 'margin-top:12px' }, h('button', { class: 'btn', onclick: async () => {
      const patch: Record<string, unknown> = {
        name: name.value, coins: Number(coins.value), gender: gender.value, hat: hat.value || null, chapterRewarded: Number(chapter.value),
        look: { hair: hair.value, ...Object.fromEntries(Object.entries(looks).map(([k, el]) => [k, el.value])) },
        permits: permits.filter(([, cb]) => cb.checked).map(([pid]) => pid),
        homeIslandId: home.value || null,
      };
      if (birthday.value && birthday.value !== p.birthday) patch.birthday = birthday.value;
      if (email.value.trim() !== (p.email ?? '')) patch.email = email.value.trim() || null;
      if (username.value && username.value !== (p.username ?? '')) patch.username = username.value;
      if (role.value !== (p.role ?? 'player')) patch.role = role.value;
      if (await call('PATCH', `/api/admin/players/${p.id}`, patch)) { toast('Profile saved'); playerPage(id); }
    } }, 'Save profile'))));

  // Inventory.
  const inv = { ...p.inv };
  const invBox = h('div', { class: 'kv' });
  const drawInv = () => {
    clear(invBox);
    for (const [iid, n] of Object.entries(inv).sort()) {
      const q = input(n, { type: 'number', min: 0, oninput: () => (inv[iid] = Number(q.value)) });
      invBox.append(h('span', {}, `${ITEMS[iid]?.icon ?? '❓'} ${ITEMS[iid]?.name ?? iid}`), q, h('button', { class: 'btn ghost small', onclick: () => { delete inv[iid]; drawInv(); } }, '✕'));
    }
  };
  drawInv();
  const addItem = select(ITEM_LIST.map((i) => [i.id, `${i.icon} ${i.name}`]), ITEM_LIST[0].id);
  left.append(h('div', { class: 'box' }, h('h3', {}, '🎒 Inventory'), invBox,
    h('div', { class: 'row', style: 'margin-top:8px' }, addItem, h('button', { class: 'btn ghost small', onclick: () => { inv[addItem.value] = (inv[addItem.value] ?? 0) + 1; drawInv(); } }, '+ Add'),
      h('span', { class: 'sp', style: 'flex:1' }),
      h('button', { class: 'btn', onclick: async () => { if (await call('PATCH', `/api/admin/players/${p.id}`, { inv })) toast('Inventory saved'); } }, 'Save inventory'))));

  // Hotbar.
  const hb = Array.from({ length: HOTBAR_SIZE }, (_, i) => select([['', '–'], ...HOTBAR_TOOLS.map((t) => [t, `${HOTBAR_INFO[t].icon} ${HOTBAR_INFO[t].name}`] as [string, string])], (p.hotbar ?? DEFAULT_HOTBAR)[i] ?? ''));
  left.append(h('div', { class: 'box' }, h('h3', {}, '🧰 Hotbar'), h('div', { class: 'row' }, hb.map((s, i) => h('label', { class: 'col', style: 'gap:2px' }, h('span', { class: 'muted' }, String((i + 1) % 10)), s))),
    h('div', { class: 'row', style: 'margin-top:8px' }, h('button', { class: 'btn', onclick: async () => {
      if (await call('PATCH', `/api/admin/players/${p.id}`, { hotbar: hb.map((s) => s.value || null) })) toast('Hotbar saved');
    } }, 'Save hotbar'))));

  // Album & mail (raw).
  const album = textarea(p.album ?? { fish: {}, birds: {} }, 8);
  const mail = textarea(p.mail, 6);
  left.append(h('div', { class: 'box' }, h('h3', {}, '📖 Album & 📬 mail (JSON)'),
    h('div', { class: 'muted' }, 'Album: { fish: { id: { n, first, biome } }, birds: { … } }'), album,
    h('div', { class: 'muted', style: 'margin-top:8px' }, 'Mail: a list of letters'), mail,
    h('div', { class: 'row', style: 'margin-top:8px' }, h('button', { class: 'btn', onclick: async () => {
      try {
        if (await call('PATCH', `/api/admin/players/${p.id}`, { album: parseJson(album, 'Album'), mail: parseJson(mail, 'Mail') })) toast('Saved');
      } catch (e) { toast((e as Error).message, false); }
    } }, 'Save album & mail'))));

  // Moderation.
  const reason = input(p.banned?.reason ?? '', { placeholder: 'Reason' });
  const until = input(p.banned?.until ? new Date(p.banned.until).toISOString().slice(0, 16) : '', { type: 'datetime-local' });
  const pw = input('', { type: 'password', placeholder: 'New password (8+ characters)' });
  const kickMsg = input('', { placeholder: 'Message (optional)' });
  right.append(h('div', { class: 'box' }, h('h3', {}, '🧭 Status'),
    h('div', { class: 'col' },
      h('div', {}, s.online ? `Online in ${s.room}` : `Last seen ${ago(p.lastSeen)}`),
      s.island ? h('div', {}, '🏝️ ', h('a', { href: `#island/${s.island.id}` }, `${s.island.name} (${BIOMES[s.island.biome as keyof typeof BIOMES]?.name ?? s.island.biome})`)) : h('div', { class: 'muted' }, 'No island yet'),
      h('div', { class: 'muted' }, `${p.friends.length} friends`))));
  right.append(h('div', { class: 'box' }, h('h3', {}, '🎁 Gifts'),
    h('p', { class: 'muted', style: 'margin-top:0' }, `Send ${p.name} a letter with items and coins – it lands in their mailbox.`),
    h('a', { class: 'btn small', href: `#gifts/send/${p.id}` }, '✉️ Send a gift')));
  right.append(h('div', { class: 'box' }, h('h3', {}, '🔨 Moderation'),
    p.banned ? h('div', { class: 'errors', style: 'margin-bottom:8px' }, `Banned by ${p.banned.by ?? '?'}: ${p.banned.reason || '(no reason)'}${p.banned.until ? ` – until ${new Date(p.banned.until).toLocaleString()}` : ''}`) : null,
    h('div', { class: 'form' }, field('Ban reason', reason), field('Until', until, 'Empty = permanent')),
    h('div', { class: 'row', style: 'margin-top:8px' },
      h('button', { class: 'btn warn small', onclick: async () => {
        if (await call('PATCH', `/api/admin/players/${p.id}`, { banned: { reason: reason.value, until: until.value ? new Date(until.value).getTime() : undefined } })) { toast('Banned'); playerPage(id); }
      } }, p.banned ? 'Update ban' : 'Ban'),
      p.banned ? h('button', { class: 'btn small', onclick: async () => { if (await call('PATCH', `/api/admin/players/${p.id}`, { banned: null })) { toast('Unbanned'); playerPage(id); } } }, 'Unban') : null),
    h('hr'),
    h('div', { class: 'row' }, kickMsg, h('button', { class: 'btn ghost small', onclick: async () => {
      const r2 = await call<{ ok: boolean }>('POST', `/api/admin/players/${p.id}/kick`, { message: kickMsg.value });
      if (r2) toast(r2.ok ? 'Kicked' : 'Not online');
    } }, 'Kick')),
    h('div', { class: 'row', style: 'margin-top:6px' }, h('button', { class: 'btn ghost small', onclick: async () => { if (await call('POST', `/api/admin/players/${p.id}/logout-all`)) toast('All sessions ended'); } }, 'Log out everywhere'),
      h('button', { class: 'btn ghost small', title: 'They redo their looks at the next login (island and progress stay)', onclick: async () => { if (confirm(`Make ${p.name} redo their character?`) && (await call('PATCH', `/api/admin/players/${p.id}`, { recreate: true }))) toast('They’ll redo their character at the next login'); } }, 'Redo character')),
    h('hr'),
    h('div', { class: 'row' }, pw, h('button', { class: 'btn ghost small', onclick: async () => {
      if (await call('PATCH', `/api/admin/players/${p.id}`, { password: pw.value })) { pw.value = ''; toast('Password changed – the player was logged out'); }
    } }, 'Set password')),
    h('hr'),
    h('button', { class: 'btn warn small', onclick: async () => {
      if (!confirm(`Delete ${p.name} and their island for good?`)) return;
      if (await call('DELETE', `/api/admin/players/${p.id}`)) { toast('Deleted'); location.hash = 'players'; }
    } }, '🗑️ Delete player & island')));
}
