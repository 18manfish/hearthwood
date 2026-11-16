// Structured editors for the game creation tool's composite fields (lists of
// items, costs, recipe ingredients, tools, building lists, birthdays), so no
// field ever needs hand-written JSON.

import { BUILDINGS, ITEM_TAGS, type BuildingType, type FieldHint } from '@hearthwood/shared';
import { h, clear } from '../ui/dom.ts';
import { chips, mdPicker, num, select } from './dialogue.ts';

type Row = Record<string, unknown>;
export type Editor = { el: HTMLElement; get: () => unknown };

/** Where the pickers get their item lists (the working tables, so unsaved rows show). */
export interface ItemSource {
  items: () => Row[];
  fish: () => Row[];
  birds: () => Row[];
}

export interface ItemOption { value: string; label: string; group: string; buyable: boolean }

const CATEGORY_LABEL: Record<string, string> = {
  material: 'Materials', tool: 'Tools', food: 'Food', meal: 'Meals', furniture: 'Furniture', clothing: 'Clothing', plant: 'Plants', fish: 'Fish', bird: 'Birds',
};

export function itemOptions(src: ItemSource): ItemOption[] {
  const out: ItemOption[] = [];
  const add = (r: Row, cat: string) => out.push({
    value: String(r.id), label: `${r.icon ?? ''} ${r.name ?? r.id}`.trim(), group: CATEGORY_LABEL[cat] ?? cat, buyable: typeof r.buy === 'number',
  });
  const items = [...src.items()].sort((a, b) => String(a.category).localeCompare(String(b.category)) || String(a.name).localeCompare(String(b.name)));
  for (const r of items) add(r, String(r.category));
  for (const r of src.fish()) add(r, 'fish');
  for (const r of src.birds()) add(r, 'bird');
  return out;
}

/** Tell the form something changed (it marks the row as un-applied). */
const touch = (el: HTMLElement) => el.dispatchEvent(new Event('input', { bubbles: true }));
const removeBtn = (onclick: () => void, locked: boolean) =>
  h('button', { type: 'button', class: 'btn ghost small sx-x', title: 'Remove', disabled: locked, onclick }, '✕');

function lock(el: HTMLElement, locked: boolean) {
  if (!locked) return el;
  el.classList.add('locked');
  el.querySelectorAll('input,select,button').forEach((x) => ((x as HTMLInputElement).disabled = true));
  return el;
}

/** An "add" dropdown: pick an entry and it's added (then the dropdown resets). */
function adder(options: readonly ItemOption[] | readonly { value: string; label: string; group?: string }[], label: string, onPick: (v: string) => void): HTMLSelectElement {
  const s = select(options as { value: string; label: string; group?: string }[], undefined, (v) => { if (v) onPick(String(v)); }, label);
  s.classList.add('sx-add');
  return s;
}

// ── One item ─────────────────────────────────────────────────────────────────
function itemPick(value: unknown, src: ItemSource, locked: boolean): Editor {
  const opts = itemOptions(src);
  let cur = typeof value === 'string' ? value : '';
  if (cur && !opts.some((o) => o.value === cur)) opts.unshift({ value: cur, label: `${cur} (unknown)`, group: 'Unknown', buyable: false });
  const s = select(opts, cur || undefined, (v) => { cur = String(v); }, cur ? undefined : '– pick an item –');
  if (locked) s.disabled = true;
  return { el: s, get: () => cur || undefined };
}

// ── A list of items (shop stock, a villager's favourite things) ──────────────
function itemList(f: FieldHint, value: unknown, src: ItemSource, locked: boolean): Editor {
  const wasList = Array.isArray(value);
  const list = wasList ? [...(value as string[])] : [];
  const box = h('div', { class: 'sx-list' });
  const draw = () => {
    clear(box);
    const opts = itemOptions(src);
    const byId = new Map(opts.map((o) => [o.value, o]));
    box.append(h('div', { class: 'chips' }, list.length ? list.map((id, i) => h('span', { class: `chip on sx-chip${byId.has(id) ? '' : ' bad'}`, title: id },
      byId.get(id)?.label ?? `${id} (unknown)`,
      locked ? null : h('button', { type: 'button', class: 'sx-cx', title: 'Remove', onclick: () => { list.splice(i, 1); draw(); touch(box); } }, '✕')))
      : h('span', { class: 'muted' }, 'none yet')));
    if (!locked) {
      const free = opts.filter((o) => !list.includes(o.value) && (f.pick !== 'buyable' || o.buyable));
      box.append(adder(free, f.pick === 'buyable' ? '+ Add an item (only items with a buy price)…' : '+ Add an item…', (v) => { list.push(v); draw(); touch(box); }));
    }
  };
  draw();
  return { el: box, get: () => (list.length || wasList || f.required ? [...list] : undefined) };
}

// ── Item → amount (building and path costs) ──────────────────────────────────
function costEditor(value: unknown, src: ItemSource, locked: boolean): Editor {
  const entries: [string, number][] = Object.entries((value ?? {}) as Record<string, number>);
  const box = h('div', { class: 'sx-rows' });
  const draw = () => {
    clear(box);
    const opts = itemOptions(src);
    entries.forEach((e, i) => {
      const others = opts.filter((o) => o.value === e[0] || !entries.some((x) => x[0] === o.value));
      box.append(h('div', { class: 'sx-row' },
        num(e[1], (n) => { e[1] = n ?? 0; }, { min: 1, step: 1, class: 'sx-qty', disabled: locked }),
        h('span', { class: 'muted' }, '×'),
        select(others, e[0], (v) => { e[0] = String(v); draw(); }),
        removeBtn(() => { entries.splice(i, 1); draw(); touch(box); }, locked)));
    });
    if (!entries.length) box.append(h('div', { class: 'muted' }, 'Free'));
    if (!locked) {
      const free = opts.filter((o) => !entries.some((x) => x[0] === o.value));
      box.append(adder(free, '+ Add a material…', (v) => { entries.push([v, 1]); draw(); touch(box); }));
    }
    lock(box, locked);
  };
  draw();
  return {
    el: box,
    get: () => {
      for (const [id, n] of entries) if (!Number.isInteger(n) || n < 1) throw new Error(`cost: the amount of ${id} must be a whole number ≥ 1`);
      return Object.fromEntries(entries);
    },
  };
}

// ── Recipe ingredients: an item, or any item with a tag ─────────────────────
type Ingredient = { item?: string; tag?: string; qty: number };

function ingredientsEditor(value: unknown, src: ItemSource, locked: boolean): Editor {
  const list: Ingredient[] = Array.isArray(value) ? structuredClone(value as Ingredient[]) : [];
  const box = h('div', { class: 'sx-rows' });
  const tags = ITEM_TAGS.map((t) => ({ value: t, label: `any ${t}` }));
  const draw = () => {
    clear(box);
    const opts = itemOptions(src);
    list.forEach((ing, i) => {
      const isTag = ing.tag !== undefined;
      const kind = chips([{ value: 'item', label: 'Item' }, { value: 'tag', label: 'Any of a kind' }], [isTag ? 'tag' : 'item'], (s) => {
        if (s[0] === 'tag' && !isTag) { delete ing.item; ing.tag = ITEM_TAGS[0]; }
        if (s[0] === 'item' && isTag) { delete ing.tag; ing.item = String(opts[0]?.value ?? 'wood'); }
        draw(); touch(box);
      }, true);
      kind.classList.add('sx-seg');
      box.append(h('div', { class: 'sx-row' },
        num(ing.qty, (n) => { ing.qty = n ?? 0; }, { min: 1, step: 1, class: 'sx-qty' }),
        h('span', { class: 'muted' }, '×'),
        isTag ? select(tags, ing.tag, (v) => { ing.tag = String(v); }) : select(opts, ing.item, (v) => { ing.item = String(v); }),
        kind,
        removeBtn(() => { list.splice(i, 1); draw(); touch(box); }, locked)));
    });
    if (!list.length) box.append(h('div', { class: 'muted' }, 'No ingredients yet'));
    if (!locked) box.append(h('div', { class: 'row', style: 'gap:6px' },
      h('button', { type: 'button', class: 'btn ghost small', onclick: () => { list.push({ item: 'wood', qty: 1 }); draw(); touch(box); } }, '+ Item'),
      h('button', { type: 'button', class: 'btn ghost small', onclick: () => { list.push({ tag: ITEM_TAGS[0], qty: 1 }); draw(); touch(box); } }, '+ Any of a kind')));
    lock(box, locked);
  };
  draw();
  return {
    el: box,
    get: () => {
      for (const ing of list) if (!Number.isInteger(ing.qty) || ing.qty < 1) throw new Error('ingredients: every amount must be a whole number ≥ 1');
      return list.map((ing) => (ing.tag !== undefined ? { tag: ing.tag, qty: ing.qty } : { item: ing.item, qty: ing.qty }));
    },
  };
}

// ── Tool: what it does and how good it is ───────────────────────────────────
const TOOL_LABEL: Record<string, string> = { axe: '🪓 Axe – chops trees', shovel: '⛏️ Shovel – digs', rod: '🎣 Rod – fishing', net: '🥅 Net – catches birds' };

function toolEditor(f: FieldHint, value: unknown, locked: boolean): Editor {
  const cur = (value ?? {}) as { kind?: string; power?: number };
  let kind = cur.kind ?? '';
  let power = cur.power ?? 1;
  const kinds = (f.options ?? Object.keys(TOOL_LABEL)).map((k) => ({ value: k, label: TOOL_LABEL[k] ?? k }));
  const pw = num(power, (n) => { power = n ?? 1; }, { min: 1, max: 5, step: 1, class: 'sx-qty', disabled: locked || !kind });
  const s = select(kinds, kind || undefined, (v) => { kind = String(v); pw.disabled = locked || !kind; }, '– not a tool –');
  if (locked) s.disabled = true;
  return {
    el: h('div', { class: 'row', style: 'gap:8px;flex-wrap:nowrap' }, s, h('span', { class: 'muted' }, 'power'), pw),
    get: () => {
      if (!kind) return undefined;
      if (!Number.isInteger(power) || power < 1) throw new Error('tool: power must be a whole number ≥ 1');
      return { kind, power };
    },
  };
}

// ── Building types (what must be built first) ───────────────────────────────
function buildingsEditor(f: FieldHint, value: unknown, locked: boolean): Editor {
  const wasList = Array.isArray(value);
  let sel = wasList ? [...(value as string[])] : [];
  const opts = (f.options ?? Object.keys(BUILDINGS)).map((t) => ({ value: t, label: `${BUILDINGS[t as BuildingType]?.icon ?? ''} ${BUILDINGS[t as BuildingType]?.name ?? t}` }));
  const el = chips(opts, sel, (s) => { sel = s; touch(el); });
  if (locked) el.classList.add('locked');
  return { el, get: () => (sel.length || wasList || f.required ? sel : undefined) };
}

// ── MM-DD as day + month ─────────────────────────────────────────────────────
function dateEditor(f: FieldHint, value: unknown, locked: boolean): Editor {
  let cur = typeof value === 'string' ? value : undefined;
  const el = mdPicker(cur, (v) => { cur = v; touch(el); }, !f.required);
  return { el: lock(el, locked), get: () => cur };
}

/** The editor for a structured field type, or null if it isn't one of these. */
export function structuredField(f: FieldHint, value: unknown, src: ItemSource, locked: boolean): Editor | null {
  switch (f.type) {
    case 'item': return itemPick(value, src, locked);
    case 'items': return itemList(f, value, src, locked);
    case 'cost': return costEditor(value, src, locked);
    case 'ingredients': return ingredientsEditor(value, src, locked);
    case 'tool': return toolEditor(f, value, locked);
    case 'buildings': return buildingsEditor(f, value, locked);
    case 'date': return dateEditor(f, value, locked);
    default: return null;
  }
}
