// Game creation tool: the small controls its forms are made of.

import { h, clear } from '../ui/dom.ts';

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A button that is lit while its choice is the current one. */
export const btn = (label: string, on: boolean, onclick: () => void, title = '') =>
  h('button', { class: `btn small${on ? '' : ' ghost'}`, title, onclick }, label);

/** Toggle chips; `onChange` gets the new selection. */
export function chips<T extends string | number>(options: readonly { value: T; label: string; title?: string }[], selected: readonly T[], onChange: (sel: T[]) => void, single = false): HTMLElement {
  const sel = new Set<T>(selected);
  const box = h('div', { class: 'chips' });
  const draw = () => {
    clear(box);
    for (const o of options) {
      box.append(h('button', {
        type: 'button', class: `chip${sel.has(o.value) ? ' on' : ''}`, title: o.title ?? '',
        onclick: () => {
          if (single) { sel.clear(); sel.add(o.value); } else if (sel.has(o.value)) sel.delete(o.value); else sel.add(o.value);
          draw();
          onChange(options.map((x) => x.value).filter((v) => sel.has(v)));
        },
      }, o.label));
    }
  };
  draw();
  return box;
}

export function seg<T extends string>(options: readonly { value: T; label: string }[], value: T, onChange: (v: T) => void): HTMLElement {
  return chips(options, [value], (s) => onChange(s[0]), true);
}

export function select<T extends string | number>(options: readonly { value: T; label: string; group?: string }[], value: T | undefined, onChange: (v: T) => void, blank?: string): HTMLSelectElement {
  const s = h('select', {}) as HTMLSelectElement;
  if (blank !== undefined) s.append(h('option', { value: '' }, blank));
  const groups = new Map<string, HTMLElement>();
  for (const o of options) {
    const opt = h('option', { value: String(o.value), selected: o.value === value }, o.label);
    if (o.group) {
      if (!groups.has(o.group)) { const g = h('optgroup', { label: o.group }); groups.set(o.group, g); s.append(g); }
      groups.get(o.group)!.append(opt);
    } else s.append(opt);
  }
  s.onchange = () => {
    const o = options.find((x) => String(x.value) === s.value);
    onChange((o ? o.value : '') as T);
  };
  return s;
}

export function num(value: number | undefined, onChange: (v: number | undefined) => void, attrs: Record<string, unknown> = {}): HTMLInputElement {
  const i = h('input', { type: 'number', value: value === undefined ? '' : String(value), ...attrs }) as HTMLInputElement;
  i.oninput = () => onChange(i.value === '' ? undefined : Number(i.value));
  return i;
}

/** MM-DD as month + day selects. */
export function mdPicker(value: string | undefined, onChange: (v: string | undefined) => void, optional = false): HTMLElement {
  let m = value ? Number(value.slice(0, 2)) : 0;
  let d = value ? Number(value.slice(3)) : 0;
  const emit = () => onChange(m && d ? `${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` : undefined);
  const months = MONTHS.map((label, i) => ({ value: i + 1, label }));
  const days = Array.from({ length: 31 }, (_, i) => ({ value: i + 1, label: String(i + 1) }));
  return h('span', { class: 'row', style: 'gap:4px;flex-wrap:nowrap' },
    select(days, d || undefined, (v) => { d = Number(v) || 0; emit(); }, optional ? '–' : undefined),
    select(months, m || undefined, (v) => { m = Number(v) || 0; emit(); }, optional ? '–' : undefined));
}
