// Game creation tool (dev mode only): edit items, fish, birds, recipes, shop
// stock, buildings, villagers, permits and paths. Changes are validated by the
// server, stored in its database and pushed to every client.

import '../style.css';
import '../tools.css';
import {
  BUILDINGS, ITEMS, TABLE_INFO, GAME_TABLES, validateGameData, speakerMatches, ITEM_TIERS, SHOP_OPEN_HOUR, STOCK_SLOTS, dailyStock, stockDayKey, stockOdds, stockSlots, type ItemTier, type StockOptions, type DialogueRule, type FieldHint, type GameData, type GameTable, type VillagerDef, type BuildingType, SPECIES_ICON,
} from '@hearthwood/shared';
import { structuredField, type ItemSource } from './fields.ts';
import { btn, chips } from './controls.ts';
import { dialogueEditor, dialogueSummary, type DialogueHost } from './dialogue.ts';
import { preview, previewRow } from './preview.ts';
import { api, clearToken, health, logout, token } from '../auth.ts';
import { showLogin } from '../ui/login.ts';
import { h, clear } from '../ui/dom.ts';
import { watchEmojis } from '../ui/emoji.ts';
import { loadKitAssets } from '../game/assets/kit.ts';
import { loadHouseAssets } from '../game/houseAssets.ts';

const app = document.getElementById('app')!;
type Row = Record<string, unknown>;

let current: GameData;
let defaults: GameData;
let overridden = new Set<string>();
/** Working copies (unsaved edits) per table. */
const work: Partial<Record<GameTable, Row[]>> = {};
let table: GameTable = 'items';
let rowKey: string | null = null;
let filter = '';
const dirty = new Set<GameTable>();

const toastBox = h('div', { class: 'toastbox' });
function toast(text: string, ok = true) {
  const t = h('div', { class: ok ? 'okmsg' : 'errors' }, text);
  toastBox.append(t);
  setTimeout(() => t.remove(), ok ? 2500 : 9000);
}

// ── Rows: every table is shown as a list of rows with a key ─────────────────
function keyOf(t: GameTable, r: Row) {
  return String(r[TABLE_INFO[t].key]);
}

function rowsFrom(t: GameTable, data: GameData): Row[] {
  const v = data[t] as unknown;
  if (t === 'shopStock') return Object.entries(v as Record<string, string[]>).map(([shop, items]) => ({ shop, items }));
  if (t === 'buildings') return Object.values(v as Record<string, Row>).map((b) => structuredClone(b));
  return structuredClone(v as Row[]);
}

function dataFrom(t: GameTable, rows: Row[]): unknown {
  if (t === 'shopStock') return Object.fromEntries(rows.map((r) => [r.shop as string, r.items as string[]]));
  if (t === 'buildings') return Object.fromEntries(rows.map((r) => [r.type as string, r]));
  return rows;
}

const rows = (t: GameTable) => (work[t] ??= rowsFrom(t, current));
const defaultRow = (t: GameTable, key: string) => rowsFrom(t, defaults).find((r) => keyOf(t, r) === key);

/** The whole data set with the working copy of every table. */
function workingData(): GameData {
  const d = structuredClone(current);
  for (const t of GAME_TABLES) if (work[t]) (d as unknown as Record<string, unknown>)[t] = dataFrom(t, work[t]!);
  return d;
}

// ── Form generation from the field hints ────────────────────────────────────
type Getter = () => unknown;

const hourOpts = Array.from({ length: 25 }, (_, i) => i);

const itemSrc: ItemSource = { items: () => rows('items'), fish: () => rows('fish'), birds: () => rows('birds') };

function fieldEditor(f: FieldHint, value: unknown, locked: boolean): { el: HTMLElement; get: Getter } {
  const dis = locked ? { disabled: true } : {};
  const structured = structuredField(f, value, itemSrc, locked);
  if (structured) return structured;
  switch (f.type) {
    case 'number': {
      const i = h('input', { type: 'number', step: 'any', value: value === undefined ? '' : String(value), ...dis }) as HTMLInputElement;
      return { el: i, get: () => (i.value === '' ? undefined : Number(i.value)) };
    }
    case 'boolean': {
      const i = h('input', { type: 'checkbox', checked: !!value, ...dis }) as HTMLInputElement;
      return { el: h('label', { class: 'switch' }, i, h('span', {}, 'Yes')), get: () => (i.checked ? true : undefined) };
    }
    case 'color': {
      const txt = h('input', { value: String(value ?? ''), placeholder: '#rrggbb', ...dis }) as HTMLInputElement;
      const pick = h('input', { type: 'color', value: /^#[0-9a-f]{6}$/i.test(String(value)) ? String(value) : '#888888', ...dis }) as HTMLInputElement;
      pick.oninput = () => { txt.value = pick.value; txt.dispatchEvent(new Event('input', { bubbles: true })); };
      txt.oninput = () => { if (/^#[0-9a-f]{6}$/i.test(txt.value)) pick.value = txt.value; };
      return { el: h('div', { class: 'colorin' }, pick, txt), get: () => txt.value || undefined };
    }
    case 'colors': {
      const list = Array.isArray(value) ? (value as string[]) : [];
      const parts = (f.parts ?? list.map((_, i) => `#${i + 1}`)).map((label, i) => {
        const ed = fieldEditor({ key: label, type: 'color' }, list[i], locked);
        return { label, ...ed };
      });
      return {
        el: h('div', { class: 'colors' }, parts.map((p) => h('div', { class: 'colorpart' }, h('span', {}, p.label), p.el))),
        get: () => {
          const out = parts.map((p) => p.get() as string | undefined);
          return out.every((x) => x === undefined) ? undefined : out.map((x) => x ?? '');
        },
      };
    }
    case 'tier': {
      const cur = value === 2 || value === 3 ? value : 1;
      const sel = h('select', dis, ([1, 2, 3] as ItemTier[]).map((t) =>
        h('option', { value: String(t), selected: t === cur }, `${t} · ${ITEM_TIERS[t].name} (weight ${ITEM_TIERS[t].weight})`))) as HTMLSelectElement;
      return { el: sel, get: () => (sel.value === '1' ? undefined : Number(sel.value)) };
    }
    case 'outfit': {
      // One picker per slot, listing the clothing items for that slot (from the working items table).
      const cur = (value ?? {}) as Record<string, string>;
      const items = rows('items');
      const picks = (f.options ?? []).map((slot) => {
        const wearable = items.filter((it) => it.wear === slot);
        const sel = h('select', dis, h('option', { value: '' }, '– nothing –'),
          wearable.map((it) => h('option', { value: String(it.id), selected: it.id === cur[slot] }, `${it.icon ?? ''} ${it.name ?? it.id}`))) as HTMLSelectElement;
        return { slot, sel };
      });
      return {
        el: h('div', { class: 'outfit-pick' }, picks.map((p) => h('label', { class: 'colorpart' }, h('span', {}, p.slot), p.sel))),
        get: () => {
          const out: Record<string, string> = {};
          for (const p of picks) if (p.sel.value) out[p.slot] = p.sel.value;
          return Object.keys(out).length ? out : undefined;
        },
      };
    }
    case 'hours': {
      const cur = Array.isArray(value) ? (value as number[]) : [];
      const mk = (v: number | undefined) => h('select', dis, h('option', { value: '' }, '–'), hourOpts.map((n) => h('option', { value: String(n), selected: n === v }, `${String(n).padStart(2, '0')}:00`))) as HTMLSelectElement;
      const a = mk(cur[0]), b = mk(cur[1]);
      return {
        el: h('div', { class: 'row', style: 'flex-wrap:nowrap' }, h('span', { class: 'muted' }, 'from'), a, h('span', { class: 'muted' }, 'until'), b),
        get: () => {
          if (a.value === '' && b.value === '') return undefined;
          if (a.value === '' || b.value === '') throw new Error(`${f.key}: pick both hours (or neither for all day)`);
          return [Number(a.value), Number(b.value)];
        },
      };
    }
    case 'enum': {
      const s = h('select', dis, f.required ? null : h('option', { value: '' }, '–'), (f.options ?? []).map((o) => h('option', { value: o, selected: o === value }, o))) as HTMLSelectElement;
      return { el: s, get: () => s.value || undefined };
    }
    case 'tags': {
      const wasList = Array.isArray(value);
      let sel = wasList ? (value as string[]) : [];
      const el = chips((f.options ?? []).map((o) => ({ value: o, label: o })), sel, (s) => { sel = s; el.dispatchEvent(new Event('input', { bubbles: true })); });
      if (locked) el.classList.add('locked');
      return { el, get: () => (sel.length || wasList || f.required ? sel : undefined) };
    }
    case 'text': {
      const t = h('textarea', { rows: 3, class: 'prose', ...dis }, String(value ?? '')) as HTMLTextAreaElement;
      return { el: t, get: () => (t.value === '' ? undefined : t.value) };
    }
    default: {
      const i = h('input', { value: String(value ?? ''), ...dis }) as HTMLInputElement;
      return { el: i, get: () => (i.value === '' ? undefined : i.value) };
    }
  }
}

const WIDE_FIELDS = new Set<FieldHint['type']>(['tags', 'text', 'colors', 'outfit', 'items', 'cost', 'ingredients', 'buildings']);

// ── Un-applied edits in the editor panel ────────────────────────────────────
/** Draft of the row being edited with the purpose-built (dialogue) editor. */
let draft: { table: GameTable; key: string; row: Row } | null = null;
/** The open editor has changes that weren't applied yet. */
let unapplied = false;

function leaveEditor(): boolean {
  if (unapplied && !confirm('Discard the changes you haven’t applied?')) return false;
  unapplied = false;
  draft = null;
  return true;
}

function openRow(t: GameTable, key: string | null) {
  if ((t !== table || key !== rowKey) && !leaveEditor()) return;
  if (t !== table) filter = '';
  table = t;
  rowKey = key;
  render();
}

// ── Layout ──────────────────────────────────────────────────────────────────
const villagerList = () => rows('villagers') as unknown as VillagerDef[];
const dlgHost: DialogueHost = {
  villagers: villagerList,
  rules: () => (rows('dialogue') as unknown as DialogueRule[]).map((r) => (draft?.table === 'dialogue' && r.id === draft.key ? (draft.row as unknown as DialogueRule) : r)),
};

function rowIcon(t: GameTable, r: Row, k: string): string {
  if (t === 'shopStock') return BUILDINGS[k as BuildingType]?.icon ?? '🏪';
  if (t === 'recipes') return ITEMS[r.output as string]?.icon ?? '🛠️';
  if (t === 'villagers') return SPECIES_ICON[r.species as string] ?? '🙂';
  if (t === 'dialogue') return r.disabled ? '🔇' : '💬';
  return String(r.icon ?? '');
}

function rowName(t: GameTable, r: Row, k: string): string {
  if (t === 'recipes') return String(ITEMS[r.output as string]?.name ?? r.output);
  if (t === 'shopStock') return BUILDINGS[k as BuildingType]?.name ?? k;
  if (t === 'dialogue') return String(r.note || k);
  return String(r.name ?? k);
}

function render() {
  const scrollY = window.scrollY;
  clear(app);
  const info = TABLE_INFO[table];
  const side = h('div', { class: 'box side' }, h('h3', {}, 'Tables'),
    GAME_TABLES.map((t) => h('button', { class: `tbl${t === table ? ' on' : ''}`, onclick: () => openRow(t, null) },
      h('span', {}, `${TABLE_INFO[t].icon} ${TABLE_INFO[t].label}`),
      h('span', {}, dirty.has(t) ? h('span', { class: 'badge-mod', title: 'Unsaved changes' }, '●') : overridden.has(t) ? h('span', { class: 'pill', title: 'Differs from the built-in data' }, 'custom') : null))),
    h('hr'),
    h('div', { class: 'col' },
      h('button', { class: 'btn ghost small', onclick: exportAll }, '⬇️ Export all (JSON)'),
      h('label', { class: 'btn ghost small', style: 'text-align:center' }, '⬆️ Import JSON…', h('input', { type: 'file', accept: '.json,application/json', style: 'display:none', onchange: importFile })),
      h('p', { class: 'muted' }, 'Built-in rows can be edited but not deleted. Changes apply to the running server and are stored in its database. Players need to reload to see them.')));

  const list = rows(table);
  const search = h('input', { placeholder: `Filter ${info.label.toLowerCase()}…`, value: filter, style: 'width:100%', oninput: () => { filter = search.value; drawList(); } }) as HTMLInputElement;
  const listBox = h('div', { class: 'scroll listscroll' });
  const drawList = () => {
    clear(listBox);
    const f = filter.toLowerCase();
    const shown = list.filter((r) => !f || JSON.stringify(r).toLowerCase().includes(f));
    if (!shown.length) listBox.append(h('div', { class: 'empty' }, 'Nothing matches.'));
    listBox.append(h('div', { class: 'rows' },
      shown.map((r) => {
        const k = keyOf(table, r);
        const isDefault = !!defaultRow(table, k);
        const changed = isDefault && JSON.stringify(defaultRow(table, k)) !== JSON.stringify(r);
        return h('button', { class: `rowbtn${k === rowKey ? ' sel' : ''}${r.disabled ? ' off' : ''}`, onclick: () => openRow(table, k) },
          h('span', { class: 'ri' }, rowIcon(table, r, k)),
          h('span', { class: 'rt' },
            h('span', { class: 'rn' }, h('span', { class: 'rnt' }, rowName(table, r, k)), !isDefault ? h('span', { class: 'pill ok' }, 'new') : changed ? h('span', { class: 'pill' }, 'edited') : null),
            h('span', { class: 'rs' }, table === 'dialogue' ? dialogueSummary(r as unknown as DialogueRule, villagerList()) : `${k} · ${summaryOf(table, r)}`)));
      })));
    listBox.querySelector('.sel')?.scrollIntoView({ block: 'nearest' });
  };
  const middle = h('div', { class: 'box col listpanel' },
    h('div', { class: 'row' }, h('h3', { style: 'margin:0' }, `${info.icon} ${info.label}`), h('span', { class: 'muted' }, `${list.length}`), h('span', { style: 'flex:1' }),
      info.canAdd ? h('button', { class: 'btn small', onclick: addRow }, '+ New') : null),
    search, listBox,
    h('div', { class: 'row', style: 'margin-top:4px' },
      h('button', { class: 'btn small', disabled: !dirty.has(table), onclick: saveTable }, `💾 Save ${info.label}`),
      h('button', { class: 'btn ghost small', disabled: !dirty.has(table), onclick: () => { if (!leaveEditor()) return; delete work[table]; dirty.delete(table); render(); } }, 'Discard'),
      h('span', { style: 'flex:1' }),
      h('button', { class: 'btn warn small', disabled: !overridden.has(table), title: 'Reset to built-in', onclick: resetTable }, '↺ Built-in')));

  app.append(
    h('div', { class: 'tb' }, h('span', { class: 'brand' }, '🛠️ Game creation tool'), h('span', { class: 'pill' }, 'dev mode'), h('span', { class: 'sp' }),
      h('a', { class: 'btn ghost small', href: '/admin.html' }, '🛡️ Admin tool'), h('a', { class: 'btn ghost small', href: '/' }, '🎮 Game'),
      h('button', { class: 'btn ghost small', onclick: async () => { await logout(); location.reload(); } }, 'Log out')),
    h('div', { class: 'wrap wide' }, h('div', { class: 'edgrid' }, side, middle, rowEditor())),
    toastBox,
  );
  drawList();
  window.scrollTo(0, scrollY);
}

function summaryOf(t: GameTable, r: Row, k = keyOf(t, r)): string {
  switch (t) {
    case 'items': return `${r.category} · sell ${r.sell}${r.buy !== undefined ? ` · buy ${r.buy}` : ''}${r.tier === 2 || r.tier === 3 ? ` · ${ITEM_TIERS[r.tier as ItemTier].name.toLowerCase()}` : ''}`;
    case 'shopStock': return `${stockSlotsText(k as BuildingType)} a day · ${(r.items as string[]).map((i) => ITEMS[i]?.icon ?? i).join(' ')}`;
    case 'fish':
    case 'birds': return `${rarityLabel(r.rarity)} · ${whereText(t, r)} · ${whenText(r)} · ${r.sell} coins`;
    case 'rarities': return `fish ${r.fish} · birds ${r.birds}`;
    case 'recipes': return `${r.station} · ${(r.ingredients as { item?: string; tag?: string; qty: number }[]).map((i) => `${i.qty} ${i.item ?? `any ${i.tag}`}`).join(', ')}`;
    case 'buildings': return `day ${r.minDay} · ${r.buildMinutes} min · ${Object.entries(r.cost as Record<string, number>).map(([k, n]) => `${n} ${k}`).join(', ')}`;
    case 'villagers': return `${r.species} · ${r.personality}`;
    case 'dialogue': return dialogueSummary(r as unknown as DialogueRule, villagerList());
    case 'permits': return `${r.price} coins`;
    case 'paths': return Object.entries(r.cost as Record<string, number>).map(([k, n]) => `${n} ${k}`).join(', ') || 'free';
  }
}

// ── Fish and birds: where and when they turn up ─────────────────────────────
const hh = (n: number) => `${String(n).padStart(2, '0')}:00`;
function whereText(t: GameTable, r: Row): string {
  const biomes = (r.biomes as string[] | undefined) ?? [];
  if (t === 'fish') return `${r.water}${r.water === 'sea' && r.shadow ? ` (${r.shadow} shadow)` : ''}${biomes.length ? ` + ${biomes.join(', ')}` : ''}`;
  return `${biomes.join(', ') || 'nowhere'}${r.perch === 'shore' ? ' (shore)' : ''}`;
}
function whenText(r: Row): string {
  const hours = r.hours as [number, number] | undefined;
  const seasons = (r.seasons as string[] | undefined) ?? [];
  return `${hours ? `${hh(hours[0])}–${hh(hours[1])}` : 'all day'}, ${seasons.length ? seasons.join(', ') : 'all year'}`;
}

/** Fish and bird rows: the same card for both – how often, where and when. */
function spawnCard(t: 'fish' | 'birds', r: Row): HTMLElement {
  const rar = rows('rarities').find((x) => x.id === r.rarity);
  const common = rows('rarities').find((x) => x.id === 'common');
  const rate = Number(rar?.[t] ?? 0), base = Number(common?.[t] ?? 0);
  const same = rows(t).filter((x) => x.rarity === r.rarity && x.id !== r.id);
  const noun = t === 'fish' ? 'fish' : 'birds';
  return h('section', { class: 'ed-card' }, h('h4', {}, t === 'fish' ? '🎣 When it bites' : '🔭 When it lands'),
    h('div', { class: 'stock-tier', style: 'margin-top:0' }, h('b', {}, `💎 ${String(rar?.name ?? r.rarity ?? '–')} · spawn rate ${rate}`),
      h('span', { class: 'muted' }, r.rarity === 'common' ? 'The baseline rarity.' : base > 0 ? `${Math.round((rate / base) * 100)}% as often as a common one.` : ''),
      h('span', { class: 'muted' }, `${same.length} other ${noun} share this rarity. Change the rate in the Rarities table.`)),
    h('div', { class: 'stock-tier' }, h('b', {}, '📍 Where'), h('span', { class: 'muted' }, whereText(t, r))),
    h('div', { class: 'stock-tier' }, h('b', {}, '🕒 When'), h('span', { class: 'muted' }, whenText(r))),
    h('div', { class: 'stock-tier' }, h('b', {}, '🪙 Sells for'), h('span', { class: 'muted' }, `${r.sell} coins`)));
}

// ── Rarities (fish and birds) ───────────────────────────────────────────────
/** A rarity's name from the working Rarities table. */
const rarityLabel = (r: unknown) => String(rows('rarities').find((x) => x.id === r)?.name ?? r ?? '–').toLowerCase();

/** Rarities row: how its spawn rates compare, and which fish and birds have it. */
function rarityCard(r: Row): HTMLElement {
  const common = rows('rarities').find((x) => x.id === 'common');
  const rel = (k: 'fish' | 'birds') => {
    const base = Number(common?.[k] ?? 0), v = Number(r[k] ?? 0);
    return base > 0 ? `${Math.round((v / base) * 100)}% as often as a common one` : '–';
  };
  const fish = rows('fish').filter((f) => f.rarity === r.id);
  const birds = rows('birds').filter((b) => b.rarity === r.id);
  const names = (list: Row[]) => (list.length ? list.map((x) => `${x.icon ?? ''} ${x.name ?? x.id}`).join(' · ') : 'none');
  return h('section', { class: 'ed-card' }, h('h4', {}, `💎 ${String(r.name ?? r.id)}`),
    h('p', { class: 'muted', style: 'margin-top:0' }, 'A spawn rate is a weight: among the fish (or birds) that could turn up at that place, time and season, each one is picked in proportion to the rate of its rarity. Rain makes rare and very rare fish bite twice as eagerly.'),
    h('div', { class: 'stock-tier' }, h('b', {}, `🐟 Fish (${fish.length}) · ${r.id === 'common' ? 'the baseline' : rel('fish')}`), h('span', { class: 'muted' }, names(fish))),
    h('div', { class: 'stock-tier' }, h('b', {}, `🐦 Birds (${birds.length}) · ${r.id === 'common' ? 'the baseline' : rel('birds')}`), h('span', { class: 'muted' }, names(birds))));
}

// ── Daily shop stock (item tiers) ──────────────────────────────────────────
/** Stock options from the working tables, so unsaved tiers and lists show. */
function stockOpts(shop: BuildingType, list?: string[]): StockOptions {
  const tiers = new Map(rows('items').map((it) => [String(it.id), (it.tier === 2 || it.tier === 3 ? it.tier : 1) as ItemTier]));
  const lists = new Map(rows('shopStock').map((x) => [String(x.shop), x.items as string[]]));
  return { list: list ?? lists.get(shop) ?? [], tierOf: (id) => tiers.get(id) ?? 1 };
}

function stockSlotsText(shop: BuildingType) {
  const s = STOCK_SLOTS[shop];
  return s ? `${s.join(' / ')} items` : 'everything';
}

const pct = (x: number | undefined) => (x === undefined ? '–' : `${Math.round(x * 100)}%`);
const itemName = (id: string) => {
  const it = rows('items').find((x) => x.id === id);
  return `${it?.icon ?? ''} ${it?.name ?? id}`;
};
let sampleDay = 0;
let sampleLevel = 1;

/** Shop stock row: how much goes out each day, the odds per tier, the list by tier and a sample day. */
function shopStockCard(shop: BuildingType, list: string[]) {
  const opts = stockOpts(shop, list);
  const card = h('section', { class: 'ed-card' }, h('h4', {}, '🗓️ Daily stock'));
  const slots = STOCK_SLOTS[shop];
  card.append(h('p', { class: 'muted', style: 'margin-top:0' }, slots
    ? `Puts out ${slots.join(' / ')} of its ${list.length} items a day (shop tier ${slots.map((_, i) => i + 1).join(' / ')}), picked by item tier. New stock every morning at ${String(SHOP_OPEN_HOUR).padStart(2, '0')}:00 island time, the same for everyone on an island.`
    : 'Sells everything on its list every day.'));
  const levels = slots ? slots.map((_, i) => i + 1) : [1];
  const odds = levels.map((l) => stockOdds(shop, l, opts));
  const byTier = ([1, 2, 3] as ItemTier[]).map((t) => list.filter((id) => opts.tierOf!(id) === t));
  const avg = (m: Map<string, number>, ids: string[]) => (ids.length ? ids.reduce((a, id) => a + (m.get(id) ?? 0), 0) / ids.length : undefined);
  card.append(h('table', { class: 'stock-tbl' },
    h('thead', {}, h('tr', {}, h('th', {}, 'Item tier'), h('th', {}, 'Items'), h('th', {}, 'Weight'), levels.map((l) => h('th', {}, slots ? `Out · shop tier ${l}` : 'Out')))),
    h('tbody', {}, ([1, 2, 3] as ItemTier[]).map((t, i) => h('tr', {},
      h('td', {}, ITEM_TIERS[t].name), h('td', {}, String(byTier[i].length)), h('td', {}, String(ITEM_TIERS[t].weight)),
      odds.map((m) => h('td', {}, pct(avg(m, byTier[i])))))))));
  card.append(h('div', { class: 'help' }, '“Out”: the chance that one item of that tier is on the shelves on a given day.'));
  // A sample day on a made-up island.
  const sample = h('div', { class: 'col' });
  const drawSample = () => {
    const day = stockDayKey(Date.now() + sampleDay * 86_400_000, 'UTC');
    const today = dailyStock(shop, 'editor-sample', day, sampleLevel, opts);
    sample.replaceChildren(
      h('div', { class: 'pv-row' }, h('span', { class: 'muted' }, 'A sample day'),
        levels.length > 1 ? levels.map((l) => btn(`Shop tier ${l}`, l === sampleLevel, () => { sampleLevel = l; drawSample(); })) : null,
        btn('↻ Another day', false, () => { sampleDay++; drawSample(); })),
      h('div', { class: 'stock-sample' }, today.map((id) => {
        const t = opts.tierOf!(id);
        return h('span', { class: `pill${t > 1 ? ` t${t}` : ''}`, title: ITEM_TIERS[t].name }, itemName(id));
      })));
  };
  drawSample();
  card.append(sample);
  // The list by tier.
  for (const t of [3, 2, 1] as ItemTier[]) {
    const ids = byTier[t - 1];
    if (!ids.length) continue;
    card.append(h('div', { class: 'stock-tier' }, h('b', {}, `${ITEM_TIERS[t].name} (${ids.length})`), h('span', { class: 'muted' }, ids.map(itemName).join(' · '))));
  }
  return card;
}

/** Item row: which shops sell it and how often it is out. */
function itemStockCard(r: Row): HTMLElement | null {
  const id = String(r.id);
  const shops = rows('shopStock').filter((x) => (x.items as string[]).includes(id));
  if (!shops.length) return null;
  const tier = (r.tier === 2 || r.tier === 3 ? r.tier : 1) as ItemTier;
  const card = h('section', { class: 'ed-card' }, h('h4', {}, '🗓️ In shops'),
    h('p', { class: 'muted', style: 'margin-top:0' }, `${ITEM_TIERS[tier].name} (weight ${ITEM_TIERS[tier].weight}). How often it is on the shelves on a given day:`));
  for (const x of shops) {
    const shop = x.shop as BuildingType;
    const opts = stockOpts(shop);
    const base = opts.tierOf!;
    opts.tierOf = (i) => (i === id ? tier : base(i)); // this row's (applied) tier
    const levels = STOCK_SLOTS[shop] ? STOCK_SLOTS[shop]!.map((_, i) => i + 1) : [1];
    card.append(h('div', { class: 'stock-tier' }, h('b', {}, `${BUILDINGS[shop]?.icon ?? '🏪'} ${BUILDINGS[shop]?.name ?? shop}`),
      h('span', {}, levels.map((l) => `${STOCK_SLOTS[shop] ? `tier ${l}: ` : ''}${pct(stockOdds(shop, l, opts).get(id) ?? 0)}${Number.isFinite(stockSlots(shop, l)) ? '' : ' (always)'}`).join(' · '))));
  }
  return card;
}

function rowEditor(): HTMLElement {
  const info = TABLE_INFO[table];
  const list = rows(table);
  const r = rowKey ? list.find((x) => keyOf(table, x) === rowKey) : undefined;
  if (!r) {
    preview.show(null);
    return h('div', { class: 'box edpanel' }, h('div', { class: 'empty big' }, h('div', { style: 'font-size:48px' }, info.icon), h('h3', {}, `Pick a ${info.label.toLowerCase()} row`), h('p', { class: 'muted' }, info.canAdd ? 'or create a new one with “+ New”.' : 'Its attributes open here.')));
  }
  const k = keyOf(table, r);
  const def = defaultRow(table, k);
  const errBox = h('div');
  if (!info.custom) unapplied = false; // the form is rebuilt from the row
  const canDelete = !def || info.canDelete;
  const markUnapplied = () => { unapplied = true; applyBtn.classList.add('pulse'); };

  // Read the edited row: from the draft (custom editors) or the generic form.
  let readForm: () => Row;
  let body: HTMLElement;
  if (info.custom) {
    if (!draft || draft.table !== table || draft.key !== k) draft = { table, key: k, row: structuredClone(r) };
    const d = draft;
    readForm = () => structuredClone(d.row);
    body = dialogueEditor(d.row as unknown as DialogueRule, dlgHost, markUnapplied, { idLocked: !!def });
  } else {
    const getters: [FieldHint, Getter][] = [];
    const form = h('div', { class: 'ed-form' });
    const fields = table === 'shopStock' ? [{ key: 'shop', type: 'string' } as FieldHint, ...info.fields] : table === 'buildings' ? [{ key: 'type', type: 'string' } as FieldHint, ...info.fields] : info.fields;
    for (const f of fields) {
      const locked = (f.key === info.key && !!def) || (f.key === info.key && !info.canAdd);
      const ed = fieldEditor(f, r[f.key], locked);
      getters.push([f, ed.get]);
      form.append(h('div', { class: `fld${WIDE_FIELDS.has(f.type) ? ' wide' : ''}${locked ? ' locked' : ''}` },
        h('label', { title: f.key }, f.label ?? f.key, f.required ? h('span', { class: 'req' }, ' *') : null), ed.el, f.help ? h('div', { class: 'help' }, f.help) : null));
    }
    form.addEventListener('input', markUnapplied);
    form.addEventListener('change', markUnapplied);
    readForm = () => {
      const next: Row = structuredClone(r);
      for (const [f, get] of getters) {
        const v = get();
        if (v === undefined) delete next[f.key];
        else next[f.key] = v;
      }
      return next;
    };
    const hasPreview = ['villagers', 'fish', 'birds', 'items', 'buildings', 'paths'].includes(table);
    const aside = h('div', { class: 'ed-aside' });
    if (hasPreview) {
      aside.append(h('section', { class: 'ed-card' }, h('div', { class: 'row', style: 'justify-content:space-between' }, h('h4', { style: 'margin:0' }, '👁️ Preview'), h('button', { class: 'btn ghost small', onclick: () => { try { previewRow(table, readForm(), villagerList()); } catch (e) { toast((e as Error).message, false); } } }, '↻ Update')),
        preview.el, preview.controls, table === 'items' ? h('div', { class: 'muted' }, 'Furniture shows its 3D model, clothes are shown on the player.') : null));
      setTimeout(() => previewRow(table, r, villagerList()));
    }
    if (table === 'villagers') aside.append(villagerDialogueCard(r as unknown as VillagerDef));
    if (table === 'shopStock') aside.append(shopStockCard(r.shop as BuildingType, r.items as string[]));
    if (table === 'rarities') aside.append(rarityCard(r));
    if (table === 'fish' || table === 'birds') aside.append(spawnCard(table, r));
    if (table === 'items') {
      const card = itemStockCard(r);
      if (card) aside.append(card);
    }
    body = h('div', { class: `ed-body${aside.childNodes.length ? '' : ' single'}` }, h('section', { class: 'ed-card' }, h('h4', {}, '📝 Attributes'), form), aside.childNodes.length ? aside : null);
  }

  const apply = () => {
    clear(errBox);
    try {
      const next = readForm();
      const idx = list.indexOf(r);
      const newKey = keyOf(table, next);
      if (newKey !== k && list.some((x) => x !== r && keyOf(table, x) === newKey)) throw new Error(`“${newKey}” is already used`);
      list[idx] = next;
      const errs = validateGameData(workingData()).filter((e) => e.startsWith(`${table}:`) || e.includes(`"${newKey}"`));
      dirty.add(table);
      unapplied = false;
      draft = null;
      rowKey = newKey;
      render();
      if (errs.length) toast(errs.join('\n'), false);
      else toast('Applied – remember to save the table');
    } catch (e) {
      errBox.append(h('div', { class: 'errors' }, (e as Error).message));
    }
  };
  const applyBtn = h('button', { class: `btn${unapplied ? ' pulse' : ''}`, onclick: apply, title: 'Keep this change in the page (Ctrl+Enter)' }, '✔ Apply');
  const head = h('div', { class: 'ed-head' },
    h('div', { class: 'ed-icon' }, rowIcon(table, r, k)),
    h('div', { class: 'ed-title' }, h('h2', {}, rowName(table, r, k)), h('div', { class: 'row', style: 'gap:6px' }, h('code', {}, k), def ? null : h('span', { class: 'pill ok' }, 'new'), def && JSON.stringify(def) !== JSON.stringify(r) ? h('span', { class: 'pill' }, 'edited') : null)),
    h('span', { style: 'flex:1' }),
    h('div', { class: 'row ed-actions' },
      applyBtn,
      def ? h('button', { class: 'btn ghost small', disabled: JSON.stringify(def) === JSON.stringify(r), onclick: () => { list[list.indexOf(r)] = structuredClone(def); unapplied = false; draft = null; dirty.add(table); render(); } }, 'Revert to built-in') : null,
      info.canAdd ? h('button', { class: 'btn ghost small', onclick: () => leaveEditor() && duplicate(r) }, 'Duplicate') : null,
      canDelete && info.canAdd ? h('button', { class: 'btn warn small', onclick: () => { if (!confirm(`Delete “${k}”?`)) return; list.splice(list.indexOf(r), 1); unapplied = false; draft = null; rowKey = null; dirty.add(table); render(); } }, 'Delete') : null));
  const panel = h('div', { class: 'box edpanel' }, head, errBox, body,
    h('p', { class: 'muted', style: 'margin:12px 4px 0' }, '“Apply” keeps the change in this page; “Save” (left) sends the whole table to the server.'));
  panel.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); apply(); } });
  return panel;
}

/** On a villager: the dialogue rules they can say, and a shortcut to write more. */
function villagerDialogueCard(v: VillagerDef): HTMLElement {
  const rules = (rows('dialogue') as unknown as DialogueRule[]);
  const mine = rules.filter((r) => r.villagers?.includes(v.id));
  const shared = rules.filter((r) => !r.villagers?.length && speakerMatches(r, v));
  const link = (r: DialogueRule) => h('button', { class: 'linkrow', onclick: () => openRow('dialogue', r.id) }, h('b', {}, r.note || r.id), h('span', { class: 'muted' }, dialogueSummary(r, villagerList()).split(' — ')[1] ?? ''));
  return h('section', { class: 'ed-card' },
    h('div', { class: 'row', style: 'justify-content:space-between' }, h('h4', { style: 'margin:0' }, '💬 Dialogue'),
      h('button', { class: 'btn small', onclick: () => newDialogueFor(v) }, `+ Line for ${v.name}`)),
    h('div', { class: 'muted', style: 'margin:6px 0' }, `${mine.length} just for ${v.name} · ${shared.length} shared with others`),
    h('div', { class: 'col', style: 'gap:2px' }, mine.map(link)),
    shared.length ? h('details', {}, h('summary', { class: 'muted' }, 'Shared rules'), h('div', { class: 'col', style: 'gap:2px' }, shared.map(link))) : null);
}

function newDialogueFor(v: VillagerDef) {
  if (!leaveEditor()) return;
  const list = rows('dialogue');
  let id = `dlg_${v.id.replace(/^v_/, '')}`;
  for (let n = 2; list.some((r) => r.id === id); n++) id = `dlg_${v.id.replace(/^v_/, '')}_${n}`;
  list.push({ id, note: `${v.name}: new line`, villagers: [v.id], when: [], lines: ['Hi {player}, {cp}!'], priority: 20 });
  dirty.add('dialogue');
  table = 'dialogue';
  rowKey = id;
  filter = '';
  render();
}

function addRow() {
  if (!leaveEditor()) return;
  const info = TABLE_INFO[table];
  const blank = info.blank?.() ?? {};
  const list = rows(table);
  let id = String(blank[info.key] ?? 'new');
  for (let n = 2; list.some((r) => keyOf(table, r) === id); n++) id = `${String(blank[info.key])}_${n}`;
  blank[info.key] = id;
  list.push(blank);
  rowKey = id;
  dirty.add(table);
  render();
}

function duplicate(r: Row) {
  const info = TABLE_INFO[table];
  const list = rows(table);
  const copy = structuredClone(r);
  let id = `${keyOf(table, r)}_copy`;
  for (let n = 2; list.some((x) => keyOf(table, x) === id); n++) id = `${keyOf(table, r)}_copy${n}`;
  copy[info.key] = id;
  if (typeof copy.name === 'string') copy.name = `${copy.name} (copy)`;
  if (table === 'dialogue') copy.note = `${copy.note || keyOf(table, r)} (copy)`;
  list.push(copy);
  rowKey = id;
  dirty.add(table);
  render();
}

// ── Server round-trips ───────────────────────────────────────────────────────
async function reload() {
  const r = await api<{ current: GameData; defaults: GameData; overridden: { tbl: string }[] }>('GET', '/api/dev/gamedata');
  current = r.current;
  defaults = r.defaults;
  overridden = new Set(r.overridden.map((o) => o.tbl));
}

async function saveTable() {
  const data = dataFrom(table, rows(table));
  const errs = validateGameData(workingData());
  if (errs.length) return toast(`Fix these first:\n${errs.join('\n')}`, false);
  try {
    await api('PUT', `/api/dev/gamedata/${table}`, { data });
    dirty.delete(table);
    delete work[table];
    await reload();
    toast(`${TABLE_INFO[table].label} saved – reload the game to see it`);
    render();
  } catch (e) {
    toast((e as Error).message, false);
  }
}

async function resetTable() {
  if (!confirm(`Throw away all custom ${TABLE_INFO[table].label.toLowerCase()} and go back to the built-in data?`)) return;
  try {
    await api('DELETE', `/api/dev/gamedata/${table}`);
    delete work[table];
    dirty.delete(table);
    await reload();
    toast('Reset');
    render();
  } catch (e) {
    toast((e as Error).message, false);
  }
}

function exportAll() {
  const blob = new Blob([JSON.stringify(workingData(), null, 2)], { type: 'application/json' });
  const a = h('a', { href: URL.createObjectURL(blob), download: `hearthwood-gamedata-${new Date().toISOString().slice(0, 10)}.json` }) as HTMLAnchorElement;
  a.click();
  URL.revokeObjectURL(a.href);
}

async function importFile(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    const r = await api<{ tables: string[] }>('PUT', '/api/dev/gamedata', { data });
    for (const t of GAME_TABLES) delete work[t];
    dirty.clear();
    await reload();
    toast(`Imported: ${r.tables.join(', ')}`);
    render();
  } catch (err) {
    toast((err as Error).message, false);
  }
}

// ── Boot ─────────────────────────────────────────────────────────────────────
async function start() {
  const info = await health();
  if (!info.dev) {
    app.append(h('div', { class: 'screen' }, h('div', { class: 'card col', style: 'max-width:440px;text-align:center' },
      h('h2', {}, '🛠️ Dev mode only'), h('p', {}, 'The game creation tool is only available while the server runs in dev mode (npm run dev:fast).'),
      h('a', { class: 'btn', href: '/' }, 'Back to the game'))));
    return;
  }
  for (;;) {
    if (!token()) await showLogin(app, { health: info });
    try {
      await reload();
      break;
    } catch (e) {
      if ((e as { status?: number }).status === 401) clearToken();
      else throw e;
    }
  }
  window.onbeforeunload = () => (dirty.size || unapplied ? 'Unsaved changes' : undefined);
  render();
  // Bird, furniture, building and path previews use the kit and house models once they're in
  // (redrawn then, unless you're in the middle of an edit).
  void Promise.all([loadKitAssets(), loadHouseAssets()]).then(() => { if (!unapplied) render(); });
}
watchEmojis(document.body);
start();
