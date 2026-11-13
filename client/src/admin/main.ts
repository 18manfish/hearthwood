// Admin tool: look after every player and island. Talks to /api/admin/* with
// the admin's login token; every change is validated and audited by the server.

import '../style.css';
import '../tools.css';
import {
  BIOMES, BIOME_IDS, BUILDINGS, DEFAULT_HOTBAR, DIRS, HOTBAR_INFO, HOTBAR_SIZE, HOTBAR_TOOLS, ITEMS, ITEM_LIST, PATHS, PERMITS, TREES, Tile, VILLAGERS,
  decodeTiles, encodeTiles, villagerDef,
  type Building, type BuildingType, type TreeSpecies, type WorldObject,
} from '@hearthwood/shared';
import { api, clearToken, health, loadGameData, logout, token } from '../auth.ts';
import { showLogin } from '../ui/login.ts';
import { newsCard, type NewsItem } from '../ui/start.ts';
import { h, clear } from '../ui/dom.ts';

const app = document.getElementById('app')!;
let me: { id: string; username: string | null; name: string; admin: boolean; dev: boolean };

// ── Small helpers ────────────────────────────────────────────────────────────
const toastBox = h('div', { class: 'toastbox' });
function toast(text: string, ok = true) {
  const t = h('div', { class: ok ? 'okmsg' : 'errors' }, text);
  toastBox.append(t);
  setTimeout(() => t.remove(), ok ? 2500 : 6000);
}
async function call<T = Record<string, unknown>>(method: string, path: string, body?: unknown): Promise<T | null> {
  try {
    return await api<T>(method, path, body);
  } catch (e) {
    toast((e as Error).message, false);
    return null;
  }
}
const ago = (t: number) => {
  const s = Math.round((Date.now() - t) / 1000);
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} d ago`;
};
const field = (label: string, input: HTMLElement, help?: string) => [h('label', {}, label), input, help ? h('div', { class: 'muted help' }, help) : null];
const input = (value: string | number, attrs: Record<string, unknown> = {}) => h('input', { value: String(value ?? ''), ...attrs }) as HTMLInputElement;
const select = (options: [string, string][], value: string, attrs: Record<string, unknown> = {}) =>
  h('select', attrs, options.map(([v, l]) => h('option', { value: v, selected: v === value }, l))) as HTMLSelectElement;
const textarea = (value: unknown, rows = 6) => h('textarea', { rows }, JSON.stringify(value, null, 1)) as HTMLTextAreaElement;
const parseJson = (t: HTMLTextAreaElement, what: string) => {
  try {
    return JSON.parse(t.value);
  } catch {
    throw new Error(`${what}: invalid JSON`);
  }
};

// ── Shell ────────────────────────────────────────────────────────────────────
function shell(active: string, body: HTMLElement) {
  clear(app);
  const nav = (hash: string, label: string) => h('a', { class: `btn small${active === hash ? ' on' : ' ghost'}`, href: `#${hash}` }, label);
  app.append(
    h('div', { class: 'tb' },
      h('span', { class: 'brand' }, '🛡️ Hearthwood Admin'),
      nav('players', '👥 Players'), nav('islands', '🏝️ Islands'), nav('news', '📰 News'), nav('audit', '📜 Audit log'),
      h('span', { class: 'sp' }),
      me.dev ? h('a', { class: 'btn ghost small', href: '/editor.html' }, '🛠️ Game creation tool') : null,
      h('a', { class: 'btn ghost small', href: '/' }, '🎮 Game'),
      h('span', { class: 'muted' }, `👤 ${me.username ?? me.name}`),
      h('button', { class: 'btn ghost small', onclick: async () => { await logout(); location.reload(); } }, 'Log out')),
    h('div', { class: 'wrap' }, body),
    toastBox,
  );
}

async function route() {
  const [page, id] = location.hash.replace(/^#/, '').split('/');
  if (page === 'player' && id) return playerPage(id);
  if (page === 'islands') return islandsPage();
  if (page === 'island' && id) return islandPage(id);
  if (page === 'audit') return auditPage();
  if (page === 'news') return newsPage(id ? Number(id) : null);
  return playersPage();
}

// ── Players ──────────────────────────────────────────────────────────────────
interface PlayerSummary {
  id: string; username: string | null; name: string; role: string; banned: boolean; online: boolean; coins: number;
  island: { id: string; name: string; biome: string } | null; createdAt: number; lastSeen: number; room: string | null;
}

async function playersPage(q = '') {
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
        h('td', {}, p.username ?? h('span', { class: 'muted' }, 'guest')),
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

async function playerPage(id: string) {
  const r = await call<{ player: Record<string, unknown> & { id: string }; summary: PlayerSummary }>('GET', `/api/admin/players/${id}`);
  if (!r) return playersPage();
  const p = r.player as unknown as {
    id: string; username?: string; name: string; role?: string; banned?: { reason: string; until?: number; by?: string }; coins: number; inv: Record<string, number>;
    permits?: string[]; hotbar?: (string | null)[]; album?: unknown; look: Record<string, string>; gender: string; hat: string | null; chapterRewarded: number;
    mail: unknown[]; homeIslandId: string | null; code: string; createdAt: number; lastSeen: number; friends: string[]; hasPassword: boolean;
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
  const home = input(p.homeIslandId ?? '', { placeholder: 'island id' });
  const looks = Object.fromEntries(['skin', 'hairColor', 'eyes', 'shirt', 'pants', 'shoes'].map((k) => [k, input(p.look[k], { type: 'color' })]));
  const hair = input(p.look.hair);
  const permits = PERMITS.map((pm) => [pm.id, h('input', { type: 'checkbox', checked: !!p.permits?.includes(pm.id) }) as HTMLInputElement] as const);
  left.append(h('div', { class: 'box' }, h('h3', {}, '👤 Profile'),
    h('div', { class: 'form' },
      field('Name', name), field('Username', username, p.hasPassword ? 'Has a password' : 'No password yet'), field('Role', role), field('Coins', coins),
      field('Gender', gender), field('Hat', hat), field('Look', h('div', { class: 'row' }, hair, Object.entries(looks).map(([k, el]) => h('span', { title: k }, el)))),
      field('Permits', h('div', { class: 'row' }, permits.map(([pid, cb]) => h('label', { class: 'row', style: 'gap:4px' }, cb, PERMITS.find((x) => x.id === pid)!.name)))),
      field('Chapter reward paid', chapter), field('Home island', home)),
    h('div', { class: 'row', style: 'margin-top:12px' }, h('button', { class: 'btn', onclick: async () => {
      const patch: Record<string, unknown> = {
        name: name.value, coins: Number(coins.value), gender: gender.value, hat: hat.value || null, chapterRewarded: Number(chapter.value),
        look: { hair: hair.value, ...Object.fromEntries(Object.entries(looks).map(([k, el]) => [k, el.value])) },
        permits: permits.filter(([, cb]) => cb.checked).map(([pid]) => pid),
        homeIslandId: home.value || null,
      };
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
    h('div', { class: 'row', style: 'margin-top:6px' }, h('button', { class: 'btn ghost small', onclick: async () => { if (await call('POST', `/api/admin/players/${p.id}/logout-all`)) toast('All sessions ended'); } }, 'Log out everywhere')),
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

// ── Islands ──────────────────────────────────────────────────────────────────
async function islandsPage() {
  const body = h('div', { class: 'box' });
  shell('islands', body);
  const search = input('', { placeholder: 'Search island, owner or id…', style: 'width:300px' });
  const table = h('div', { class: 'scroll' });
  const load = async () => {
    const r = await call<{ total: number; islands: { id: string; name: string; biome: string; owner: { id: string; name: string }; access: string; size: number; buildings: number; villagers: number; loaded: boolean; visitors: number; createdAt: number }[] }>('GET', `/api/admin/islands?q=${encodeURIComponent(search.value)}`);
    if (!r) return;
    clear(table);
    table.append(h('table', { class: 'data' },
      h('tr', {}, ['Island', 'Owner', 'Biome', 'Size', 'Access', 'Buildings', 'Villagers', 'Now'].map((t) => h('th', {}, t))),
      r.islands.map((i) => h('tr', { class: 'click', onclick: () => (location.hash = `island/${i.id}`) },
        h('td', {}, h('b', {}, i.name), h('div', { class: 'muted' }, i.id)),
        h('td', {}, h('a', { href: `#player/${i.owner.id}`, onclick: (e: Event) => e.stopPropagation() }, i.owner.name)),
        h('td', {}, BIOMES[i.biome as keyof typeof BIOMES]?.name ?? i.biome), h('td', {}, `${i.size}×${i.size}`), h('td', {}, i.access),
        h('td', {}, String(i.buildings)), h('td', {}, String(i.villagers)),
        h('td', { class: 'muted' }, i.loaded ? `loaded · ${i.visitors} here` : '')))));
  };
  search.oninput = () => load();
  body.append(h('div', { class: 'row', style: 'margin-bottom:10px' }, search, h('button', { class: 'btn small ghost', onclick: load }, '↻ Refresh')), table);
  await load();
}

interface IslandView {
  record: {
    id: string; name: string; biome: string; seed: number; access: string; inviteCode: string; foundedDayKey: string; ownerId: string; size?: number;
    map: { x: number; y: number }; objects: WorldObject[]; buildings: Building[]; villagers: { defId: string; houseId: string; movedInAt: number; friendship: Record<string, unknown> }[];
    terrain?: unknown;
  };
  owner: { id: string; name: string; username: string | null } | null;
  size: number; tiles: string; levels: string; ramps: string; paths: string; spawn: { x: number; z: number }; loaded: boolean;
  players: { id: string; name: string; x: number; z: number }[];
  villagers: { id: string; x: number; z: number; home: boolean }[];
  birds: WorldObject[];
}

const TILE_NAMES: [number, string][] = [[Tile.Sea, 'Sea'], [Tile.Shore, 'Beach'], [Tile.Ground, 'Ground'], [Tile.Pond, 'Pond'], [Tile.River, 'River'], [Tile.Dock, 'Dock'], [Tile.Ramp, 'Ramp']];
const OBJ_COLORS: Record<string, string> = { tree: '#2f7d32', stump: '#7a5230', rock: '#8d8f93', bush: '#4f8f3a', mushroom: '#d84315', flower: '#ec6fa0', furniture: '#a0703f', decor: '#a0703f' };

async function islandPage(id: string) {
  const v = await call<IslandView>('GET', `/api/admin/islands/${id}`);
  if (!v) return islandsPage();
  islandEditor(v);
}

function islandEditor(v: IslandView) {
  const rec = v.record;
  const size = v.size;
  const biome = BIOMES[rec.biome as keyof typeof BIOMES];
  const ground = biome?.ground.default ?? biome?.ground.summer ?? '#79b84c';
  // Working copy – sent to the server on save.
  const d = {
    tiles: decodeTiles(v.tiles), levels: decodeTiles(v.levels), ramps: decodeTiles(v.ramps), paths: decodeTiles(v.paths),
    objects: structuredClone(rec.objects), buildings: structuredClone(rec.buildings), villagers: structuredClone(rec.villagers),
  };
  const dirty = new Set<'terrain' | 'paths' | 'objects' | 'buildings' | 'villagers'>();
  let sel: { kind: 'object'; o: WorldObject } | { kind: 'building'; b: Building } | null = null;
  let tool: 'select' | 'terrain' | 'path' | 'object' | 'building' | 'erase' | 'move' = 'select';
  let cell = Math.max(6, Math.floor(760 / size));
  let nid = 1;
  const newId = (p: string) => {
    let id: string;
    do id = `${p}${Date.now() % 100000}${nid++}`; while (d.objects.some((o) => o.id === id) || d.buildings.some((b) => b.id === id));
    return id;
  };

  const canvas = h('canvas') as HTMLCanvasElement;
  const tip = h('div', { class: 'maptip', style: 'display:none' });
  const mapWrap = h('div', { class: 'mapwrap' }, canvas, tip);
  const side = h('div', { class: 'col', style: 'gap:16px' });
  const saveBtn = h('button', { class: 'btn', onclick: () => save() }, '💾 Save island') as HTMLButtonElement;
  const status = h('span', { class: 'muted' });
  const toolbar = h('div', { class: 'toolbar' });
  const opts = h('div', { class: 'toolbar' });

  shell('islands', h('div', { class: 'col', style: 'gap:12px' },
    h('div', { class: 'row' }, h('a', { class: 'btn ghost small', href: '#islands' }, '← All islands'),
      h('h2', { style: 'margin:0' }, `🏝️ ${rec.name}`),
      h('span', { class: 'muted' }, `${rec.id} · ${biome?.name ?? rec.biome} · ${size}×${size} · owner `),
      v.owner ? h('a', { href: `#player/${v.owner.id}` }, v.owner.name) : '?',
      v.loaded ? h('span', { class: 'pill ok' }, `live · ${v.players.length} here`) : h('span', { class: 'pill' }, 'not loaded'),
      h('span', { style: 'flex:1' }), status, saveBtn),
    h('div', { class: 'split' }, h('div', { class: 'box' }, toolbar, opts, mapWrap, legend()), side)));

  // ── Drawing ──────────────────────────────────────────────────────────────
  const idx = (x: number, z: number) => z * size + x;
  const shade = (hex: string, k: number) => {
    const n = parseInt(hex.slice(1), 16);
    const f = (c: number) => Math.max(0, Math.min(255, Math.round(c * k)));
    return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
  };
  function tileColor(i: number) {
    const t = d.tiles[i] as Tile;
    const L = d.levels[i];
    switch (t) {
      case Tile.Sea: return '#4fb7d8';
      case Tile.Shore: return biome?.shore ?? '#f3e2b3';
      case Tile.Pond: return shade('#3f9cc4', 0.9 + L * 0.12);
      case Tile.River: return shade('#2f8fd0', 0.9 + L * 0.12);
      case Tile.Dock: return '#b98a5a';
      case Tile.Ramp: return shade(ground, 0.85 + L * 0.12);
      case Tile.Floor: return '#c9b27a';
      case Tile.Wall: return '#6d5a45';
      default: return shade(ground, 0.82 + L * 0.14);
    }
  }
  function draw() {
    canvas.width = size * cell;
    canvas.height = size * cell;
    const g = canvas.getContext('2d')!;
    for (let z = 0; z < size; z++)
      for (let x = 0; x < size; x++) {
        const i = idx(x, z);
        g.fillStyle = tileColor(i);
        g.fillRect(x * cell, z * cell, cell, cell);
        const p = d.paths[i];
        if (p) {
          g.fillStyle = PATHS[p - 1]?.color ?? '#999';
          g.fillRect(x * cell + cell * 0.15, z * cell + cell * 0.15, cell * 0.7, cell * 0.7);
        }
        // Cliff edges: dark line where the level drops.
        const L = d.levels[i];
        g.fillStyle = 'rgba(60,40,20,0.55)';
        if (z + 1 < size && d.levels[idx(x, z + 1)] < L && d.tiles[idx(x, z + 1)] !== Tile.Ramp) g.fillRect(x * cell, (z + 1) * cell - 2, cell, 2);
        if (x + 1 < size && d.levels[idx(x + 1, z)] < L && d.tiles[idx(x + 1, z)] !== Tile.Ramp) g.fillRect((x + 1) * cell - 2, z * cell, 2, cell);
        if (z > 0 && d.levels[idx(x, z - 1)] < L && d.tiles[idx(x, z - 1)] !== Tile.Ramp) g.fillRect(x * cell, z * cell, cell, 2);
        if (x > 0 && d.levels[idx(x - 1, z)] < L && d.tiles[idx(x - 1, z)] !== Tile.Ramp) g.fillRect(x * cell, z * cell, 2, cell);
        // Ramp arrows (uphill).
        const r = d.ramps[i];
        if (r) {
          const [dx, dz] = DIRS[(r - 1) & 3];
          const cx = x * cell + cell / 2, cz = z * cell + cell / 2;
          g.strokeStyle = '#3b2f25';
          g.lineWidth = Math.max(1, cell / 8);
          g.beginPath();
          g.moveTo(cx - dx * cell * 0.3, cz - dz * cell * 0.3);
          g.lineTo(cx + dx * cell * 0.3, cz + dz * cell * 0.3);
          g.stroke();
        }
      }
    g.font = `${Math.max(9, cell)}px system-ui`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (const b of d.buildings) {
      const def = BUILDINGS[b.type];
      const isSel = sel?.kind === 'building' && sel.b === b;
      g.fillStyle = def?.color ?? '#d9b48f';
      g.globalAlpha = b.completeAt > Date.now() ? 0.5 : 0.92;
      g.fillRect(b.x * cell + 1, b.z * cell + 1, b.w * cell - 2, b.h * cell - 2);
      g.globalAlpha = 1;
      g.strokeStyle = isSel ? '#ff3b30' : '#3b2f25';
      g.lineWidth = isSel ? 3 : 1;
      g.strokeRect(b.x * cell + 1, b.z * cell + 1, b.w * cell - 2, b.h * cell - 2);
      g.fillText(def?.icon ?? '🏠', (b.x + b.w / 2) * cell, (b.z + b.h / 2) * cell);
    }
    for (const o of d.objects) {
      const isSel = sel?.kind === 'object' && sel.o === o;
      const cx = (o.x + 0.5) * cell, cz = (o.z + 0.5) * cell;
      g.fillStyle = OBJ_COLORS[o.kind] ?? '#555';
      g.beginPath();
      g.arc(cx, cz, cell * (o.kind === 'tree' ? 0.42 : 0.3) * (o.kind === 'tree' && (o.stage ?? 2) < 2 ? 0.6 : 1), 0, Math.PI * 2);
      g.fill();
      if (isSel) {
        g.strokeStyle = '#ff3b30';
        g.lineWidth = 3;
        g.stroke();
      }
    }
    for (const b of v.birds) {
      g.fillStyle = '#ffd166';
      g.fillRect((b.x + 0.35) * cell, (b.z + 0.35) * cell, cell * 0.3, cell * 0.3);
    }
    for (const vl of v.villagers) {
      if (vl.home) continue;
      g.fillText('🐾', vl.x * cell, vl.z * cell);
    }
    g.font = `bold ${Math.max(10, cell)}px system-ui`;
    for (const pl of v.players) {
      g.fillStyle = '#e8607a';
      g.beginPath();
      g.arc(pl.x * cell, pl.z * cell, Math.max(4, cell * 0.45), 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#fff';
      g.strokeStyle = '#3b2f25';
      g.lineWidth = 3;
      g.strokeText(pl.name, pl.x * cell, pl.z * cell - cell);
      g.fillText(pl.name, pl.x * cell, pl.z * cell - cell);
    }
    g.fillText('⚓', (v.spawn.x) * cell, (v.spawn.z) * cell);
    status.textContent = dirty.size ? `Unsaved: ${[...dirty].join(', ')}` : 'No unsaved changes';
    saveBtn.disabled = !dirty.size;
  }

  function legend() {
    return h('div', { class: 'legend' },
      [['Sea', '#4fb7d8'], ['Beach', biome?.shore ?? '#f3e2b3'], ['Ground (lighter = higher)', ground], ['Pond', '#3f9cc4'], ['River', '#2f8fd0'], ['Dock', '#b98a5a'],
        ['Tree', OBJ_COLORS.tree], ['Rock', OBJ_COLORS.rock], ['Bush', OBJ_COLORS.bush], ['Flower', OBJ_COLORS.flower], ['Furniture', OBJ_COLORS.furniture], ['Bird', '#ffd166'], ['Player', '#e8607a']]
        .map(([n, c]) => h('span', { style: `--c:${c}` }, n)),
      h('span', { class: 'muted' }, 'Dark edges = cliffs, lines on ramps point uphill, 🐾 villager, ⚓ arrival'));
  }

  // ── Hit testing ──────────────────────────────────────────────────────────
  const tileAtEvent = (e: MouseEvent) => {
    const r = canvas.getBoundingClientRect();
    const x = Math.floor(((e.clientX - r.left) / r.width) * size);
    const z = Math.floor(((e.clientY - r.top) / r.height) * size);
    return x >= 0 && z >= 0 && x < size && z < size ? { x, z } : null;
  };
  const buildingAt = (x: number, z: number) => d.buildings.find((b) => x >= b.x && x < b.x + b.w && z >= b.z && z < b.z + b.h);
  const objectAt = (x: number, z: number) => d.objects.find((o) => o.x === x && o.z === z);

  // ── Tools ────────────────────────────────────────────────────────────────
  const brushTile = select(TILE_NAMES.map(([t, n]) => [String(t), n]), String(Tile.Ground));
  const brushLevel = select([['0', 'Level 0'], ['1', 'Level 1'], ['2', 'Level 2'], ['3', 'Level 3']], '0');
  const brushDir = select([['0', 'Ramp up ↑ north'], ['1', 'Ramp up → east'], ['2', 'Ramp up ↓ south'], ['3', 'Ramp up ← west']], '0');
  const brushPath = select([['0', 'No path (eraser)'], ...PATHS.map((p) => [String(p.id), p.name] as [string, string])], '1');
  const objKind = select(['tree', 'rock', 'bush', 'flower', 'mushroom', 'stump', 'furniture'].map((k) => [k, k]), 'tree');
  const objSpecies = select((Object.keys(TREES) as TreeSpecies[]).map((t) => [t, TREES[t].name]), biome?.trees[0]?.species ?? 'oak');
  const objItem = select(ITEM_LIST.filter((i) => i.category === 'furniture').map((i) => [i.id, `${i.icon} ${i.name}`]), 'bench');
  const bldType = select((Object.keys(BUILDINGS) as BuildingType[]).filter((t) => !BUILDINGS[t].fixed).map((t) => [t, `${BUILDINGS[t].icon} ${BUILDINGS[t].name}`]), 'campfire');

  const drawToolbar = () => {
    clear(toolbar);
    const tb = (t: typeof tool, label: string, title: string) => h('button', { class: `btn small${tool === t ? ' on' : ' ghost'}`, title, onclick: () => { tool = t; drawToolbar(); } }, label);
    toolbar.append(
      tb('select', '👆 Select', 'Click a building or object to edit it'),
      tb('move', '✋ Move', 'Click where the selected thing should go'),
      tb('terrain', '⛰️ Terrain', 'Paint tiles and cliff levels'),
      tb('path', '🛤️ Paths', 'Paint paths'),
      tb('object', '🌳 Add object', 'Click to place'),
      tb('building', '🏠 Add building', 'Click to place (top-left corner)'),
      tb('erase', '🧽 Erase', 'Remove objects / buildings you click'),
      h('span', { style: 'flex:1' }),
      h('button', { class: 'btn ghost small', onclick: () => { cell = Math.max(4, cell - 2); draw(); } }, '−'),
      h('button', { class: 'btn ghost small', onclick: () => { cell = Math.min(30, cell + 2); draw(); } }, '+'),
      h('button', { class: 'btn ghost small', title: 'Reload from the server (drops unsaved changes)', onclick: () => islandPage(rec.id) }, '↻'));
    clear(opts);
    if (tool === 'terrain') opts.append(brushTile, brushLevel, brushDir, h('span', { class: 'muted' }, 'Ramps need the tile above (in the arrow direction) one level higher.'));
    if (tool === 'path') opts.append(brushPath);
    if (tool === 'object') opts.append(objKind, objSpecies, objItem, h('span', { class: 'muted' }, 'Species is used for trees, item for furniture.'));
    if (tool === 'building') opts.append(bldType, h('span', { class: 'muted' }, 'Placed finished. Footprint is not checked – keep it on flat ground.'));
    if (tool === 'move') opts.append(h('span', { class: 'muted' }, sel ? 'Click the new spot.' : 'Select something first.'));
  };

  function applyAt(x: number, z: number, drag: boolean) {
    const i = idx(x, z);
    switch (tool) {
      case 'select': {
        if (drag) return;
        const b = buildingAt(x, z);
        const o = objectAt(x, z);
        sel = o ? { kind: 'object', o } : b ? { kind: 'building', b } : null;
        drawSide();
        break;
      }
      case 'move': {
        if (drag || !sel) return;
        if (sel.kind === 'object') { sel.o.x = x; sel.o.z = z; dirty.add('objects'); } else { sel.b.x = x; sel.b.z = z; dirty.add('buildings'); }
        drawSide();
        break;
      }
      case 'terrain': {
        const t = Number(brushTile.value);
        d.tiles[i] = t;
        d.levels[i] = t === Tile.Sea || t === Tile.Shore || t === Tile.Dock ? 0 : Number(brushLevel.value);
        d.ramps[i] = t === Tile.Ramp ? Number(brushDir.value) + 1 : 0;
        if (t !== Tile.Ground && t !== Tile.Ramp) d.paths[i] = 0;
        dirty.add('terrain');
        break;
      }
      case 'path':
        d.paths[i] = Number(brushPath.value);
        dirty.add('paths');
        break;
      case 'object': {
        if (drag || objectAt(x, z)) return;
        const kind = objKind.value as WorldObject['kind'];
        const o: WorldObject = { id: newId('a'), kind, x, z };
        if (kind === 'tree') Object.assign(o, { species: objSpecies.value, stage: 2, hits: 0, fruit: 0 });
        if (kind === 'rock') o.hits = 0;
        if (kind === 'bush') o.ripe = true;
        if (kind === 'furniture') Object.assign(o, { item: objItem.value, rot: 0 });
        d.objects.push(o);
        dirty.add('objects');
        sel = { kind: 'object', o };
        drawSide();
        break;
      }
      case 'building': {
        if (drag) return;
        const t = bldType.value as BuildingType;
        const def = BUILDINGS[t];
        const b: Building = { id: newId('b'), type: t, x, z, w: def.w, h: def.h, completeAt: 0 };
        d.buildings.push(b);
        dirty.add('buildings');
        sel = { kind: 'building', b };
        drawSide();
        break;
      }
      case 'erase': {
        const o = objectAt(x, z);
        if (o) { d.objects.splice(d.objects.indexOf(o), 1); dirty.add('objects'); break; }
        const b = buildingAt(x, z);
        if (b && b.type !== 'dock' && !drag) { d.buildings.splice(d.buildings.indexOf(b), 1); dirty.add('buildings'); }
        break;
      }
    }
    draw();
  }

  let down = false;
  let last = '';
  canvas.addEventListener('mousedown', (e) => {
    const t = tileAtEvent(e);
    if (!t) return;
    down = true;
    last = `${t.x},${t.z}`;
    applyAt(t.x, t.z, false);
  });
  window.addEventListener('mouseup', () => (down = false));
  canvas.addEventListener('mouseleave', () => (tip.style.display = 'none'));
  canvas.addEventListener('mousemove', (e) => {
    const t = tileAtEvent(e);
    if (!t) return;
    const i = idx(t.x, t.z);
    const b = buildingAt(t.x, t.z), o = objectAt(t.x, t.z);
    const pl = v.players.find((p) => Math.floor(p.x) === t.x && Math.floor(p.z) === t.z);
    tip.textContent = `${t.x},${t.z} · ${TILE_NAMES.find(([k]) => k === d.tiles[i])?.[1] ?? d.tiles[i]} · level ${d.levels[i]}${d.paths[i] ? ` · ${PATHS[d.paths[i] - 1]?.name}` : ''}`
      + (b ? ` · ${BUILDINGS[b.type]?.name}${b.villagerId ? ` (${villagerDef(b.villagerId)?.name})` : ''}` : '')
      + (o ? ` · ${o.kind}${o.species ? ` ${o.species}` : ''}${o.item ? ` ${ITEMS[o.item]?.name ?? o.item}` : ''}` : '')
      + (pl ? ` · 👤 ${pl.name}` : '');
    const wr = mapWrap.getBoundingClientRect();
    tip.style.display = '';
    tip.style.left = `${e.clientX - wr.left + mapWrap.scrollLeft + 14}px`;
    tip.style.top = `${e.clientY - wr.top + mapWrap.scrollTop + 14}px`;
    const key = `${t.x},${t.z}`;
    if (down && key !== last && ['terrain', 'path', 'erase'].includes(tool)) {
      last = key;
      applyAt(t.x, t.z, true);
    }
  });

  // ── Side panel ───────────────────────────────────────────────────────────
  function drawSide() {
    clear(side);
    side.append(detailsBox(), selectionBox(), villagersBox(), dangerBox());
    drawToolbar();
  }

  function detailsBox() {
    const name = input(rec.name, { maxlength: 20 });
    const access = select([['private', '🔒 Nobody'], ['friends', '💌 Friends'], ['invite', '🎟️ Friends + code'], ['public', '🌍 Everyone']], rec.access);
    const code = input(rec.inviteCode, { maxlength: 12 });
    const biomeSel = select(BIOME_IDS.map((b) => [b, BIOMES[b].name]), rec.biome);
    const seed = input(rec.seed, { type: 'number' });
    const founded = input(rec.foundedDayKey, { type: 'date' });
    const mx = input(rec.map.x, { type: 'number', min: 0, max: 1000 }), my = input(rec.map.y, { type: 'number', min: 0, max: 560 });
    return h('div', { class: 'box' }, h('h3', {}, '📋 Details'),
      h('div', { class: 'form' },
        field('Name', name), field('Visitors', access), field('Invite code', code), field('Biome', biomeSel, 'Changes colours, trees, fish & weather'),
        field('Seed', seed, 'The generated base terrain – use “Regenerate” to rebuild from it'), field('Founded', founded, 'Moves the island’s day count'),
        field('World map', h('div', { class: 'row' }, mx, my))),
      h('div', { class: 'row', style: 'margin-top:10px' }, h('button', { class: 'btn small', onclick: async () => {
        const patch: Record<string, unknown> = { name: name.value, access: access.value, biome: biomeSel.value, seed: Number(seed.value), foundedDayKey: founded.value, map: { x: Number(mx.value), y: Number(my.value) } };
        if (code.value.toUpperCase() !== rec.inviteCode) patch.inviteCode = code.value;
        const r = await call<{ island: IslandView }>('PATCH', `/api/admin/islands/${rec.id}`, patch);
        if (r) { toast('Details saved'); islandEditor(r.island); }
      } }, 'Save details')));
  }

  function selectionBox() {
    const box = h('div', { class: 'box' }, h('h3', {}, '🔎 Selection'));
    if (!sel) return box.append(h('p', { class: 'muted' }, 'Pick the 👆 Select tool and click a building or object on the map.')), box;
    if (sel.kind === 'object') {
      const o = sel.o;
      const json = textarea(o, 8);
      box.append(h('div', { class: 'muted' }, `${o.kind} at ${o.x},${o.z}`), json,
        h('div', { class: 'row', style: 'margin-top:8px' },
          h('button', { class: 'btn small', onclick: () => {
            try {
              const next = parseJson(json, 'Object');
              Object.assign(o, next);
              dirty.add('objects');
              draw();
              toast('Applied – remember to save the island');
            } catch (e) { toast((e as Error).message, false); }
          } }, 'Apply'),
          h('button', { class: 'btn warn small', onclick: () => { d.objects.splice(d.objects.indexOf(o), 1); sel = null; dirty.add('objects'); drawSide(); draw(); } }, 'Delete')));
    } else {
      const b = sel.b;
      const def = BUILDINGS[b.type];
      const x = input(b.x, { type: 'number' }), z = input(b.z, { type: 'number' });
      const done = h('input', { type: 'checkbox', checked: b.completeAt <= Date.now() }) as HTMLInputElement;
      const vill = select([['', '– none –'], ...VILLAGERS.map((vd) => [vd.id, `${vd.name} (${vd.species})`] as [string, string])], b.villagerId ?? '');
      box.append(h('div', {}, h('b', {}, `${def.icon} ${def.name}`), h('span', { class: 'muted' }, ` · ${b.id} · ${b.w}×${b.h}`)),
        h('div', { class: 'form', style: 'margin-top:8px' }, field('Position', h('div', { class: 'row' }, x, z)), field('Finished', done),
          b.type === 'villager_house' ? field('Villager', vill, 'Also add / remove them under Villagers') : null),
        h('div', { class: 'row', style: 'margin-top:8px' },
          h('button', { class: 'btn small', onclick: () => {
            b.x = Number(x.value);
            b.z = Number(z.value);
            b.completeAt = done.checked ? Math.min(b.completeAt, 0) : Math.max(b.completeAt, Date.now() + 3600_000);
            if (b.type === 'villager_house') b.villagerId = vill.value || undefined;
            dirty.add('buildings');
            draw();
            toast('Applied – remember to save the island');
          } }, 'Apply'),
          b.type !== 'dock' ? h('button', { class: 'btn warn small', onclick: () => { d.buildings.splice(d.buildings.indexOf(b), 1); sel = null; dirty.add('buildings'); drawSide(); draw(); } }, 'Delete') : null));
    }
    return box;
  }

  function villagersBox() {
    const box = h('div', { class: 'box' }, h('h3', {}, `🦊 Villagers (${d.villagers.length})`));
    for (const vr of d.villagers) {
      const def = villagerDef(vr.defId);
      const fr = textarea(vr.friendship, 3);
      box.append(h('div', { class: 'col', style: 'border-top:1px solid var(--line);padding-top:8px;margin-top:8px' },
        h('div', { class: 'row' }, h('b', {}, `${def?.name ?? vr.defId}`), h('span', { class: 'muted' }, `${def?.species ?? ''} · house ${vr.houseId}`), h('span', { style: 'flex:1' }),
          h('button', { class: 'btn ghost small', onclick: () => {
            d.villagers.splice(d.villagers.indexOf(vr), 1);
            const house = d.buildings.find((b) => b.id === vr.houseId);
            if (house) { house.villagerId = undefined; dirty.add('buildings'); }
            dirty.add('villagers');
            drawSide();
            draw();
          } }, 'Move out')),
        h('div', { class: 'muted' }, 'Friendship per player id: { pts, talkDay, giftDay }'), fr,
        h('button', { class: 'btn ghost small', onclick: () => { try { vr.friendship = parseJson(fr, 'Friendship'); dirty.add('villagers'); draw(); } catch (e) { toast((e as Error).message, false); } } }, 'Apply friendship')));
    }
    const freeHouses = d.buildings.filter((b) => b.type === 'villager_house' && !d.villagers.some((x) => x.houseId === b.id));
    const who = select(VILLAGERS.filter((vd) => !d.villagers.some((x) => x.defId === vd.id)).map((vd) => [vd.id, `${vd.name} (${vd.species})`]), '');
    const house = select(freeHouses.map((b) => [b.id, `${b.id} at ${b.x},${b.z}`]), '');
    box.append(h('div', { class: 'row', style: 'margin-top:10px' }, who, house, h('button', { class: 'btn small', disabled: !freeHouses.length, onclick: () => {
      if (!who.value || !house.value) return;
      d.villagers.push({ defId: who.value, houseId: house.value, movedInAt: Date.now(), friendship: {} });
      const b = d.buildings.find((x) => x.id === house.value);
      if (b) b.villagerId = who.value;
      dirty.add('villagers');
      dirty.add('buildings');
      drawSide();
      draw();
    } }, 'Move in')));
    if (!freeHouses.length) box.append(h('div', { class: 'muted' }, 'Add a villager house (🏠 Add building) to move someone in.'));
    return box;
  }

  function dangerBox() {
    return h('div', { class: 'box' }, h('h3', {}, '⚠️ Danger zone'),
      h('div', { class: 'col' },
        h('button', { class: 'btn ghost small', onclick: async () => {
          if (!confirm('Reset all terraforming to the generated terrain?')) return;
          const r = await call<{ island: IslandView }>('PATCH', `/api/admin/islands/${rec.id}`, { terrain: null });
          if (r) { toast('Terrain reset'); islandEditor(r.island); }
        } }, 'Reset terraforming'),
        h('button', { class: 'btn ghost small', onclick: async () => {
          const r = await call<{ island: IslandView }>('PATCH', `/api/admin/islands/${rec.id}`, { clearRespawns: true });
          if (r) toast('Pending respawns cleared');
        } }, 'Clear pending respawns'),
        h('button', { class: 'btn warn small', onclick: async () => {
          if (!confirm('Regenerate the island from its seed? All buildings, villagers, furniture and terraforming are removed.')) return;
          const r = await call<{ island: IslandView }>('PATCH', `/api/admin/islands/${rec.id}`, { regenerate: true });
          if (r) { toast('Island regenerated'); islandEditor(r.island); }
        } }, 'Regenerate island')));
  }

  async function save() {
    const patch: Record<string, unknown> = {};
    if (dirty.has('terrain')) patch.terrain = { tiles: encodeTiles(d.tiles), levels: encodeTiles(d.levels), ramps: encodeTiles(d.ramps) };
    if (dirty.has('paths') || dirty.has('terrain')) patch.paths = encodeTiles(d.paths);
    if (dirty.has('objects')) patch.objects = d.objects;
    if (dirty.has('buildings')) patch.buildings = d.buildings;
    if (dirty.has('villagers')) patch.villagers = d.villagers;
    saveBtn.disabled = true;
    const r = await call<{ island: IslandView }>('PATCH', `/api/admin/islands/${rec.id}`, patch);
    if (r) {
      toast('Island saved – players on it see the changes right away');
      islandEditor(r.island);
    } else saveBtn.disabled = false;
  }

  window.onbeforeunload = () => (dirty.size ? 'Unsaved changes' : undefined);
  drawSide();
  draw();
}

// ── News boxes on the start screen ──────────────────────────────────────────
async function newsPage(editId: number | null) {
  const r = await call<{ news: NewsItem[] }>('GET', '/api/admin/news');
  if (!r) return;
  const list = h('div', { class: 'box col' });
  const editor = h('div', { class: 'col', style: 'gap:16px' });
  shell('news', h('div', { class: 'split' }, list, editor));
  list.append(h('div', { class: 'row' }, h('h3', { style: 'margin:0' }, '📰 Start-screen news'), h('span', { style: 'flex:1' }),
    h('a', { class: 'btn small', href: '#news/0' }, '+ New box')),
    h('p', { class: 'muted' }, 'Shown on the start screen, pinned boxes first, then newest first. Drafts (unpublished) are only visible here.'),
    h('table', { class: 'data' }, h('tr', {}, ['', 'Title', 'Date', ''].map((t) => h('th', {}, t))),
      r.news.map((n) => h('tr', { class: `click${n.id === editId ? ' sel' : ''}`, onclick: () => (location.hash = `news/${n.id}`) },
        h('td', { style: 'font-size:22px' }, n.icon), h('td', {}, h('b', {}, n.title), n.pinned ? h('span', { class: 'pill', style: 'margin-left:6px' }, '📌') : null, n.published ? null : h('span', { class: 'pill no', style: 'margin-left:6px' }, 'draft')),
        h('td', { class: 'muted' }, new Date(n.created).toLocaleDateString()), h('td', { class: 'muted' }, n.author ?? '')))));
  if (editId === null) return void editor.append(h('div', { class: 'box' }, h('p', { class: 'muted' }, 'Pick a news box, or create a new one.')));
  const n: NewsItem = r.news.find((x) => x.id === editId) ?? { id: 0, title: '', body: '', icon: '📰', created: Date.now(), updated: Date.now(), author: null, pinned: false, published: true };
  const title = input(n.title, { maxlength: 120 });
  const icon = input(n.icon, { maxlength: 16, style: 'width:70px' });
  const body = h('textarea', { rows: 10, style: 'font-family:inherit;font-size:14px' }, n.body) as HTMLTextAreaElement;
  const pinned = h('input', { type: 'checkbox', checked: n.pinned }) as HTMLInputElement;
  const published = h('input', { type: 'checkbox', checked: n.published }) as HTMLInputElement;
  const preview = h('div');
  const draw = () => {
    clear(preview);
    preview.append(newsCard({ ...n, title: title.value || 'Untitled', icon: icon.value || '📰', body: body.value, pinned: pinned.checked }));
  };
  for (const el of [title, icon, body, pinned]) el.addEventListener('input', draw);
  draw();
  editor.append(h('div', { class: 'box' }, h('h3', {}, n.id ? 'Edit news box' : 'New news box'),
    h('div', { class: 'form' }, field('Icon', icon, 'An emoji'), field('Title', title), field('Text', body, 'Blank line = new paragraph · **bold**'),
      field('Pinned', pinned, 'Stays at the top'), field('Published', published, 'Untick to keep it as a draft')),
    h('div', { class: 'row', style: 'margin-top:10px' },
      h('button', { class: 'btn', onclick: async () => {
        const payload = { title: title.value, icon: icon.value, body: body.value, pinned: pinned.checked, published: published.checked };
        const res = await call<{ id: number }>(n.id ? 'PUT' : 'POST', n.id ? `/api/admin/news/${n.id}` : '/api/admin/news', payload);
        if (res) { toast('Saved'); location.hash = `news/${res.id}`; newsPage(res.id); }
      } }, '💾 Save'),
      n.id ? h('button', { class: 'btn warn small', onclick: async () => {
        if (!confirm('Delete this news box?')) return;
        if (await call('DELETE', `/api/admin/news/${n.id}`)) { toast('Deleted'); location.hash = 'news'; }
      } }, 'Delete') : null)),
    h('div', { class: 'box' }, h('h3', {}, '👁️ Preview'), preview));
}

// ── Audit log ────────────────────────────────────────────────────────────────
async function auditPage() {
  const body = h('div', { class: 'box' });
  shell('audit', body);
  const r = await call<{ entries: { id: number; at: number; actor: string; action: string; target: string; detail: string }[] }>('GET', '/api/admin/audit?limit=300');
  if (!r) return;
  body.append(h('div', { class: 'scroll' }, h('table', { class: 'data' },
    h('tr', {}, ['When', 'Who', 'What', 'Target', 'Details'].map((t) => h('th', {}, t))),
    r.entries.map((e) => h('tr', {},
      h('td', { class: 'muted' }, new Date(e.at).toLocaleString()), h('td', {}, e.actor), h('td', {}, e.action),
      h('td', {}, e.target.startsWith('p_') ? h('a', { href: `#player/${e.target}` }, e.target) : e.target.startsWith('i_') ? h('a', { href: `#island/${e.target}` }, e.target) : e.target),
      h('td', { class: 'muted', style: 'max-width:420px;overflow:hidden;text-overflow:ellipsis' }, e.detail))))));
}

// ── Boot ─────────────────────────────────────────────────────────────────────
async function start() {
  const info = await health();
  await loadGameData().catch(() => null);
  for (;;) {
    if (!token()) await showLogin(app, { health: info, message: 'Log in with an admin account.' });
    try {
      me = await api('GET', '/api/me');
      break;
    } catch {
      clearToken();
    }
  }
  if (!me.admin) {
    clear(app);
    app.append(h('div', { class: 'screen' }, h('div', { class: 'card col', style: 'max-width:420px;text-align:center' },
      h('h2', {}, '🛡️ Admins only'), h('p', {}, `You're logged in as ${me.username ?? me.name}, which isn't an admin account.`),
      h('p', { class: 'muted' }, 'Ask an admin to give you the admin role, or start the server with ADMIN_USERS=yourname.'),
      h('button', { class: 'btn', onclick: async () => { await logout(); location.reload(); } }, 'Log in as someone else'))));
    return;
  }
  window.addEventListener('hashchange', () => route());
  route();
}
start();
