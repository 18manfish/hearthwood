// Dialogue rule editor + live simulator for the game creation tool.

import {
  BIOME_IDS, BUILDINGS, DIALOGUE_EVENTS, DIALOGUE_PLACEHOLDERS, FRIENDSHIP_LEVELS, ITEMS, PERSONALITIES, SEASON_NAMES, SPECIES, TRIGGER_KINDS, WEEKDAYS,
  checkRules, composeDialogue, easterDate, moonAge, villagerLine, hashMany,
  type DialogueContext, type DialogueEvent, type DialogueRule, type DialogueTrigger, type VillagerDef, type Weather, type Season, type BiomeId,
} from '@hearthwood/shared';
import { h, clear } from '../ui/dom.ts';

export interface DialogueHost {
  /** Working copy of the villager table. */
  villagers(): VillagerDef[];
  /** Every rule, with the draft in place of the row being edited. */
  rules(): DialogueRule[];
}

const WEATHERS: Weather[] = ['clear', 'cloudy', 'rain', 'storm', 'snow', 'fog', 'sandstorm', 'heatwave'];
const WEATHER_ICON: Record<Weather, string> = { clear: '☀️', cloudy: '☁️', rain: '🌧️', storm: '⛈️', snow: '❄️', fog: '🌫️', sandstorm: '🏜️', heatwave: '🥵' };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const SPECIES_ICON: Record<string, string> = { cat: '🐱', dog: '🐶', rabbit: '🐰', bear: '🐻', fox: '🦊', owl: '🦉', deer: '🦌', frog: '🐸', penguin: '🐧', koala: '🐨', duck: '🦆', hamster: '🐹', wolf: '🐺', squirrel: '🐿️' };
const STATE_FLAGS: DialogueEvent[] = ['first_meeting', 'level_up', 'gifted_today', 'construction', 'new_arrival', 'neighbor_new_arrival'];
const hourLabel = (n: number) => `${String(n).padStart(2, '0')}:00`;
const mdLabel = (md: string) => `${Number(md.slice(3))} ${MONTHS[Number(md.slice(0, 2)) - 1] ?? '?'}`;
const vIcon = (v: VillagerDef) => SPECIES_ICON[v.species] ?? '🙂';
const kindInfo = (k: DialogueTrigger['k']) => TRIGGER_KINDS.find((x) => x.k === k)!;
const eventLabel = (id: string) => DIALOGUE_EVENTS.find((e) => e.id === id)?.label ?? id;

// ── Small widgets ───────────────────────────────────────────────────────────

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

function seg<T extends string>(options: readonly { value: T; label: string }[], value: T, onChange: (v: T) => void): HTMLElement {
  return chips(options, [value], (s) => onChange(s[0]), true);
}

function select<T extends string | number>(options: readonly { value: T; label: string; group?: string }[], value: T | undefined, onChange: (v: T) => void, blank?: string): HTMLSelectElement {
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

function num(value: number | undefined, onChange: (v: number | undefined) => void, attrs: Record<string, unknown> = {}): HTMLInputElement {
  const i = h('input', { type: 'number', value: value === undefined ? '' : String(value), ...attrs }) as HTMLInputElement;
  i.oninput = () => onChange(i.value === '' ? undefined : Number(i.value));
  return i;
}

/** MM-DD as month + day selects. */
function mdPicker(value: string | undefined, onChange: (v: string | undefined) => void, optional = false): HTMLElement {
  let m = value ? Number(value.slice(0, 2)) : 0;
  let d = value ? Number(value.slice(3)) : 0;
  const emit = () => onChange(m && d ? `${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` : undefined);
  const months = MONTHS.map((label, i) => ({ value: i + 1, label }));
  const days = Array.from({ length: 31 }, (_, i) => ({ value: i + 1, label: String(i + 1) }));
  return h('span', { class: 'row', style: 'gap:4px;flex-wrap:nowrap' },
    select(days, d || undefined, (v) => { d = Number(v) || 0; emit(); }, optional ? '–' : undefined),
    select(months, m || undefined, (v) => { m = Number(v) || 0; emit(); }, optional ? '–' : undefined));
}

const optNum = (v: unknown) => (v === undefined || String(v) === '' ? undefined : Number(v));
const hours = Array.from({ length: 25 }, (_, i) => ({ value: i, label: hourLabel(i) }));
const levels = FRIENDSHIP_LEVELS.map((l, i) => ({ value: i, label: `${'♥'.repeat(i + 1)} ${l.name}` }));

// ── Trigger text (list summaries, card titles) ──────────────────────────────

export function triggerText(t: DialogueTrigger, villagers: VillagerDef[]): string {
  const range = (a?: number, b?: number, f = (n: number) => String(n)) => (a !== undefined && b !== undefined ? `${f(a)}–${f(b)}` : a !== undefined ? `≥ ${f(a)}` : b !== undefined ? `≤ ${f(b)}` : 'any');
  const vname = (id: string) => (id === 'any' ? 'any neighbour' : villagers.find((v) => v.id === id)?.name ?? id);
  const body = (() => {
    switch (t.k) {
      case 'date': return t.to && t.to !== t.from ? `${mdLabel(t.from)} – ${mdLabel(t.to)}` : mdLabel(t.from);
      case 'weekday': return t.days.map((d) => WEEKDAYS[d].slice(0, 3)).join(', ');
      case 'time': return `${hourLabel(t.from)}–${hourLabel(t.to)}`;
      case 'season': return t.seasons.join(', ');
      case 'weather': return t.weather.map((w) => WEATHER_ICON[w]).join(' ');
      case 'temp': return `${range(t.min, t.max)} °C`;
      case 'event': return eventLabel(t.event);
      case 'neighbor': return `${vname(t.villager)} ${t.where === 'nearby' ? 'nearby' : 'on island'}`;
      case 'friendship': return range(t.min, t.max, (n) => FRIENDSHIP_LEVELS[n]?.name ?? String(n));
      case 'islandDay': return `day ${range(t.min, t.max)}`;
      case 'building': return `${BUILDINGS[t.building as keyof typeof BUILDINGS]?.name ?? t.building} ${t.state === 'none' ? 'not built' : t.state === 'building' ? 'under construction' : 'built'}`;
      case 'item': return `carries ${ITEMS[t.item]?.name ?? t.item}`;
      case 'hat': return `wears ${ITEMS[t.item]?.name ?? t.item}`;
      case 'player': return t.who;
      case 'place': return t.where;
      case 'biome': return t.biomes.join(', ');
    }
  })();
  return `${t.not ? 'NOT ' : ''}${kindInfo(t.k).icon} ${body}`;
}

export function dialogueSummary(r: DialogueRule, villagers: VillagerDef[]): string {
  const who = [
    ...(r.villagers ?? []).map((id) => villagers.find((v) => v.id === id)?.name ?? id),
    ...(r.personalities ?? []),
    ...(r.species ?? []),
  ];
  const when = r.when.map((t) => triggerText(t, villagers)).join(r.match === 'any' ? ' or ' : ' · ');
  return `${who.length ? who.join(', ') : 'anyone'} — ${when || 'always'} · p${r.priority}${r.mode && r.mode !== 'replace' ? ` · ${r.mode}` : ''}`;
}

// ── Trigger card bodies ─────────────────────────────────────────────────────

function triggerBody(t: DialogueTrigger, host: DialogueHost, changed: () => void): HTMLElement {
  const set = <K extends string>(key: K, v: unknown) => {
    const o = t as unknown as Record<string, unknown>;
    if (v === undefined || v === '') delete o[key];
    else o[key] = v;
    changed();
  };
  const lbl = (text: string) => h('span', { class: 'muted' }, text);
  switch (t.k) {
    case 'date':
      return h('div', { class: 'row' }, lbl('from'), mdPicker(t.from, (v) => set('from', v ?? '01-01')), lbl('to'), mdPicker(t.to, (v) => set('to', v), true),
        h('span', { class: 'muted' }, 'Leave “to” empty for a single day. Ranges may wrap over New Year.'));
    case 'weekday':
      return chips(WEEKDAYS.map((d, i) => ({ value: i, label: d.slice(0, 3) })), t.days, (s) => set('days', s));
    case 'time':
      return h('div', { class: 'row' }, lbl('from'), select(hours, t.from, (v) => set('from', Number(v))), lbl('until'), select(hours, t.to, (v) => set('to', Number(v))),
        h('span', { class: 'muted' }, 'Local island time; wraps past midnight (e.g. 21:00 → 05:00).'));
    case 'season':
      return chips(SEASON_NAMES.map((s) => ({ value: s, label: s })), t.seasons, (s) => set('seasons', s as Season[]));
    case 'weather':
      return chips(WEATHERS.map((w) => ({ value: w, label: `${WEATHER_ICON[w]} ${w}` })), t.weather, (s) => set('weather', s));
    case 'temp':
      return h('div', { class: 'row' }, lbl('min °C'), num(t.min, (v) => set('min', v), { style: 'width:90px' }), lbl('max °C'), num(t.max, (v) => set('max', v), { style: 'width:90px' }));
    case 'event':
      return select(DIALOGUE_EVENTS.map((e) => ({ value: e.id, label: e.label, group: e.group })), t.event, (v) => set('event', v));
    case 'neighbor':
      return h('div', { class: 'row' },
        select([{ value: 'any', label: '★ Any neighbour' }, ...host.villagers().map((v) => ({ value: v.id, label: `${vIcon(v)} ${v.name}` }))], t.villager, (v) => set('villager', v)),
        seg([{ value: 'island', label: '🏝️ lives on the island' }, { value: 'nearby', label: '👀 is nearby' }] as const, t.where, (v) => set('where', v)),
        h('span', { class: 'muted' }, '{neighbor} becomes this villager.'));
    case 'friendship':
      return h('div', { class: 'row' }, lbl('at least'), select(levels, t.min, (v) => set('min', optNum(v)), '–'), lbl('at most'), select(levels, t.max, (v) => set('max', optNum(v)), '–'));
    case 'islandDay':
      return h('div', { class: 'row' }, lbl('from day'), num(t.min, (v) => set('min', v), { style: 'width:90px', min: 1 }), lbl('to day'), num(t.max, (v) => set('max', v), { style: 'width:90px', min: 1 }));
    case 'building':
      return h('div', { class: 'row' },
        select(Object.values(BUILDINGS).map((b) => ({ value: b.type as string, label: `${b.icon} ${b.name}` })), t.building, (v) => set('building', v)),
        seg([{ value: 'built', label: 'built' }, { value: 'building', label: 'under construction' }, { value: 'none', label: 'not built' }] as const, t.state, (v) => set('state', v)));
    case 'item':
      return select(Object.values(ITEMS).filter((i) => i.category !== 'tool').map((i) => ({ value: i.id, label: `${i.icon} ${i.name}`, group: i.category })), t.item, (v) => set('item', v));
    case 'hat':
      return select(Object.values(ITEMS).filter((i) => i.wear === 'hat').map((i) => ({ value: i.id, label: `${i.icon} ${i.name}` })), t.item, (v) => set('item', v));
    case 'player':
      return seg([{ value: 'owner', label: '👑 island owner' }, { value: 'resident', label: '🏠 resident' }, { value: 'visitor', label: '🧳 visitor' }] as const, t.who, (v) => set('who', v));
    case 'place':
      return seg([{ value: 'outdoors', label: '🌳 outdoors' }, { value: 'indoors', label: '🏠 indoors' }] as const, t.where, (v) => set('where', v));
    case 'biome':
      return chips(BIOME_IDS.map((b) => ({ value: b, label: b })), t.biomes, (s) => set('biomes', s as BiomeId[]));
  }
}

// ── The editor ──────────────────────────────────────────────────────────────

/** Edits `draft` in place; calls `changed` after every edit. */
export function dialogueEditor(draft: DialogueRule, host: DialogueHost, changed: () => void, opts: { idLocked: boolean }): HTMLElement {
  const villagers = host.villagers();
  const simBox = h('div');
  const sim = simulator(draft, host);
  const touch = () => { changed(); sim.refresh(); };

  // Basics
  const idIn = h('input', { value: draft.id, disabled: opts.idLocked, oninput: () => { draft.id = idIn.value.trim(); touch(); } }) as HTMLInputElement;
  const noteIn = h('input', { value: draft.note ?? '', placeholder: 'What is this for? (editor only)', oninput: () => { draft.note = noteIn.value || undefined; touch(); } }) as HTMLInputElement;
  const enabled = h('input', { type: 'checkbox', checked: !draft.disabled, onchange: () => { draft.disabled = enabled.checked ? undefined : true; touch(); } }) as HTMLInputElement;
  const basics = card('⚙️ Basics', null,
    h('div', { class: 'ed-form' },
      fld('id', idIn, 'Must start with dlg_'),
      fld('note', noteIn),
      fld('priority', num(draft.priority, (v) => { draft.priority = v ?? 0; touch(); }), 'Higher wins when several rules match. Generic chat = 0.'),
      fld('chance %', num(draft.chance ?? 100, (v) => { draft.chance = v === undefined || v >= 100 ? undefined : Math.max(1, v); touch(); }, { min: 1, max: 100 }), 'Rolled once per player per day.'),
      fld('how it’s used', seg([{ value: 'replace', label: 'Replace chat' }, { value: 'before', label: 'Say before' }, { value: 'after', label: 'Say after' }] as const, draft.mode ?? 'replace', (v) => { draft.mode = v === 'replace' ? undefined : v; touch(); }), 'Before/after adds a line to the normal chat.', true),
      fld('enabled', h('span', { class: 'switch' }, enabled, h('span', {}, 'Rule is active')))));

  // Who
  const who = card('🗣️ Who says it', 'Nothing selected = anyone. All selected filters must fit.',
    h('div', { class: 'col', style: 'gap:12px' },
      fld('villagers', chips(villagers.map((v) => ({ value: v.id, label: `${vIcon(v)} ${v.name}`, title: `${v.personality} ${v.species}` })), draft.villagers ?? [], (s) => { draft.villagers = s.length ? s : undefined; touch(); }), undefined, true),
      fld('personality', chips(PERSONALITIES.map((p) => ({ value: p, label: p })), draft.personalities ?? [], (s) => { draft.personalities = s.length ? s : undefined; touch(); }), undefined, true),
      fld('species', chips(SPECIES.map((p) => ({ value: p, label: `${SPECIES_ICON[p]} ${p}` })), draft.species ?? [], (s) => { draft.species = s.length ? s : undefined; touch(); }), undefined, true)));

  // When
  const trigList = h('div', { class: 'col', style: 'gap:10px' });
  const drawTriggers = () => {
    clear(trigList);
    if (!draft.when.length) trigList.append(h('div', { class: 'empty' }, 'No triggers – this rule can fire any time.'));
    draft.when.forEach((t, i) => {
      const title = h('b', {}, `${kindInfo(t.k).icon} ${kindInfo(t.k).label}`);
      const notBox = h('input', { type: 'checkbox', checked: !!t.not, onchange: () => { if (notBox.checked) t.not = true; else delete t.not; touch(); } }) as HTMLInputElement;
      trigList.append(h('div', { class: `trig${t.not ? ' neg' : ''}` },
        h('div', { class: 'trig-head' }, title, h('span', { style: 'flex:1' }),
          h('label', { class: 'row muted', style: 'gap:4px', title: 'Fire when this is NOT the case' }, notBox, 'invert (NOT)'),
          h('button', { class: 'x', title: 'Remove trigger', onclick: () => { draft.when.splice(i, 1); drawTriggers(); touch(); } }, '✕')),
        triggerBody(t, host, touch)));
    });
  };
  drawTriggers();
  const addSel = select(TRIGGER_KINDS.map((k) => ({ value: k.k, label: `${k.icon} ${k.label}`, group: k.group })), undefined, (k) => {
    if (!k) return;
    draft.when.push(kindInfo(k).blank());
    addSel.value = '';
    drawTriggers();
    touch();
  }, '+ Add a trigger…');
  addSel.classList.add('addtrig');
  const when = card('⏰ When', null,
    h('div', { class: 'row', style: 'margin-bottom:10px' }, h('span', { class: 'muted' }, 'Fire when'),
      seg([{ value: 'all', label: 'all triggers match' }, { value: 'any', label: 'any trigger matches' }] as const, draft.match ?? 'all', (v) => { draft.match = v === 'all' ? undefined : v; touch(); })),
    trigList, h('div', { class: 'row', style: 'margin-top:10px' }, addSel));

  // Lines
  let lastText: HTMLTextAreaElement | null = null;
  const lineList = h('div', { class: 'col', style: 'gap:10px' });
  const drawLines = () => {
    clear(lineList);
    draft.lines.forEach((text, i) => {
      const ta = h('textarea', { rows: Math.max(2, text.split('\n').length + 1), class: 'prose', placeholder: 'What the villager says… (Enter = new page)' }, text) as HTMLTextAreaElement;
      ta.oninput = () => { draft.lines[i] = ta.value; ta.rows = Math.max(2, ta.value.split('\n').length + 1); touch(); };
      ta.onfocus = () => (lastText = ta);
      lineList.append(h('div', { class: 'variant' }, h('div', { class: 'vnum' }, String(i + 1)), ta,
        h('button', { class: 'x', title: 'Remove variant', disabled: draft.lines.length < 2, onclick: () => { draft.lines.splice(i, 1); drawLines(); touch(); } }, '✕')));
    });
  };
  drawLines();
  const insert = (tok: string) => {
    const ta = lastText ?? lineList.querySelector('textarea');
    if (!ta) return;
    const a = ta.selectionStart ?? ta.value.length, b = ta.selectionEnd ?? a;
    ta.value = ta.value.slice(0, a) + tok + ta.value.slice(b);
    ta.focus();
    ta.selectionStart = ta.selectionEnd = a + tok.length;
    ta.dispatchEvent(new Event('input'));
  };
  const lines = card('💬 What they say', 'One variant is picked at random each chat. Each line inside a variant is its own page.',
    h('div', { class: 'chips', style: 'margin-bottom:10px' }, h('span', { class: 'muted' }, 'Insert:'), DIALOGUE_PLACEHOLDERS.map(([tok, title]) => h('button', { type: 'button', class: 'chip tok', title, onclick: () => insert(tok) }, tok))),
    lineList,
    h('div', { class: 'row', style: 'margin-top:10px' }, h('button', { class: 'btn ghost small', disabled: draft.lines.length >= 30, onclick: () => { draft.lines.push(''); drawLines(); touch(); (lineList.querySelector('.variant:last-child textarea') as HTMLTextAreaElement | null)?.focus(); } }, '+ Add variant')));

  // Replies
  const replyList = h('div', { class: 'col', style: 'gap:8px' });
  const drawReplies = () => {
    clear(replyList);
    const list = draft.replies ?? [];
    if (!list.length) replyList.append(h('div', { class: 'empty' }, 'No replies – the chat just ends.'));
    list.forEach((r, i) => {
      const t = h('input', { value: r.text, placeholder: 'Player says…', maxlength: 80, oninput: () => { r.text = t.value; touch(); } }) as HTMLInputElement;
      const a = h('input', { value: r.answer, placeholder: 'Villager answers…', maxlength: 400, oninput: () => { r.answer = a.value; touch(); } }) as HTMLInputElement;
      replyList.append(h('div', { class: 'reply' }, h('span', {}, '🧑'), t, h('span', {}, '→'), a,
        h('button', { class: 'x', onclick: () => { list.splice(i, 1); if (!list.length) delete draft.replies; drawReplies(); touch(); } }, '✕')));
    });
  };
  drawReplies();
  const replies = card('↩️ Player replies', 'Optional choices shown after the last page (up to 4).', replyList,
    h('div', { class: 'row', style: 'margin-top:10px' }, h('button', { class: 'btn ghost small', onclick: () => { if ((draft.replies ??= []).length < 4) draft.replies.push({ text: '', answer: '' }); drawReplies(); touch(); } }, '+ Add reply')));

  simBox.append(sim.el);
  return h('div', { class: 'dlg-ed' },
    h('div', { class: 'dlg-main' }, basics, who, when, lines, replies),
    h('div', { class: 'dlg-side' }, simBox));
}

function card(title: string, help: string | null, ...body: (HTMLElement | null)[]): HTMLElement {
  return h('section', { class: 'ed-card' }, h('h4', {}, title), help ? h('p', { class: 'muted', style: 'margin:-4px 0 10px' }, help) : null, ...body);
}

function fld(label: string, control: HTMLElement, help?: string, wide = false): HTMLElement {
  return h('div', { class: `fld${wide ? ' wide' : ''}` }, h('label', {}, label), control, help ? h('div', { class: 'help' }, help) : null);
}

// ── Simulator ───────────────────────────────────────────────────────────────

interface SimState {
  vid: string;
  date: string;
  hour: number;
  weather: Weather;
  season: Season;
  temp: number;
  level: number;
  biome: BiomeId;
  islandDay: number;
  neighbors: Record<string, 'island' | 'nearby'>;
  flags: DialogueEvent[];
  role: 'owner' | 'resident' | 'visitor';
  place: 'outdoors' | 'indoors';
  item: string;
  hat: string;
  built: string[];
  roll: number;
}

const todayKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const S: SimState = {
  vid: '', date: todayKey(), hour: 12, weather: 'clear', season: 'summer', temp: 18, level: 1, biome: 'grassland', islandDay: 12,
  neighbors: {}, flags: [], role: 'owner', place: 'outdoors', item: '', hat: '', built: ['town_hall', 'restaurant'], roll: 0,
};

function simContext(def: VillagerDef, villagers: VillagerDef[]): DialogueContext {
  const md = S.date.slice(5);
  const freshNeighbors = S.flags.includes('neighbor_new_arrival');
  return {
    speaker: def, level: S.level, player: 'Tester', island: 'Test Island', dayKey: S.date, hour: S.hour, weather: S.weather, season: S.season, tempC: S.temp,
    aurora: S.biome === 'nordic', biome: S.biome, islandDay: S.islandDay, foundedDayKey: undefined,
    neighbors: Object.entries(S.neighbors).filter(([id]) => id !== def.id).map(([id, where]) => ({
      id, dist: where === 'nearby' ? 3 : 30, birthday: villagers.find((v) => v.id === id)?.birthday === md, newArrival: freshNeighbors,
    })),
    buildings: Object.fromEntries(S.built.map((b) => [b, 'built' as const])),
    inventory: S.item ? { [S.item]: 1 } : {}, hat: S.hat || null, role: S.role, place: S.place,
    flags: S.flags.filter((f) => f !== 'neighbor_new_arrival'),
    seed: hashMany(S.date, 'tester', def.id, S.roll), nonce: S.roll,
  };
}

/** Next date (from today) whose moon age satisfies `ok`. */
function nextMoon(ok: (age: number) => boolean): string {
  const t = Date.parse(`${todayKey()}T12:00:00Z`);
  for (let i = 0; i < 40; i++) {
    const k = new Date(t + i * 86400000).toISOString().slice(0, 10);
    if (ok(moonAge(k))) return k;
  }
  return todayKey();
}

/** Change the simulated situation so `rule` fires (as far as possible). */
function tuneTo(rule: DialogueRule, villagers: VillagerDef[]) {
  const year = S.date.slice(0, 4);
  const speaker = villagers.find((v) => (!rule.villagers?.length || rule.villagers.includes(v.id)) && (!rule.personalities?.length || rule.personalities.includes(v.personality)) && (!rule.species?.length || rule.species.includes(v.species)));
  if (speaker) S.vid = speaker.id;
  S.flags = [];
  const triggers = rule.match === 'any' ? rule.when.slice(0, 1) : rule.when;
  for (const t of triggers) {
    if (t.not) continue;
    switch (t.k) {
      case 'date': S.date = `${year}-${t.from}`; break;
      case 'weekday': {
        const base = Date.parse(`${S.date}T12:00:00Z`);
        for (let i = 0; i < 7; i++) { const k = new Date(base + i * 86400000); if (t.days.includes(k.getUTCDay())) { S.date = k.toISOString().slice(0, 10); break; } }
        break;
      }
      case 'time': S.hour = t.from; break;
      case 'season': S.season = t.seasons[0]; break;
      case 'weather': S.weather = t.weather[0]; break;
      case 'temp': S.temp = t.max !== undefined ? t.max - 1 : (t.min ?? 0) + 1; break;
      case 'friendship': S.level = t.min ?? t.max ?? 0; break;
      case 'islandDay': S.islandDay = t.min ?? t.max ?? 1; break;
      case 'building': S.built = t.state === 'none' ? S.built.filter((b) => b !== t.building) : [...new Set([...S.built, t.building])]; break;
      case 'item': S.item = t.item; break;
      case 'hat': S.hat = t.item; break;
      case 'player': S.role = t.who; break;
      case 'place': S.place = t.where; break;
      case 'biome': S.biome = t.biomes[0]; break;
      case 'neighbor': {
        const id = t.villager === 'any' ? villagers.find((v) => v.id !== S.vid)?.id : t.villager;
        if (id) S.neighbors[id] = t.where;
        break;
      }
      case 'event': {
        const fixed: Partial<Record<DialogueEvent, string>> = { new_year: '01-01', valentines: '02-14', april_fools: '04-01', summer_solstice: '06-21', halloween: '10-31', christmas_eve: '12-24', christmas: '12-25', new_years_eve: '12-31' };
        if (fixed[t.event]) S.date = `${year}-${fixed[t.event]}`;
        else if (t.event === 'easter') S.date = `${year}-${easterDate(Number(year))}`;
        else if (t.event === 'full_moon') S.date = nextMoon((a) => Math.abs(a - 14.77) <= 1);
        else if (t.event === 'new_moon') S.date = nextMoon((a) => a <= 1 || a >= 28.5);
        else if (t.event === 'own_birthday' && speaker) S.date = `${year}-${speaker.birthday}`;
        else if (t.event === 'neighbor_birthday') {
          const n = villagers.find((v) => v.id !== S.vid);
          if (n) { S.neighbors[n.id] ??= 'island'; S.date = `${year}-${n.birthday}`; }
        } else if (t.event === 'aurora') { S.biome = 'nordic'; S.hour = 22; }
        else if (t.event === 'alone') S.neighbors = {};
        else if (t.event === 'island_anniversary') { /* needs a founding date – not simulated */ }
        else {
          if (!S.flags.includes(t.event)) S.flags.push(t.event);
          if (t.event === 'neighbor_new_arrival') { const n = villagers.find((v) => v.id !== S.vid); if (n) S.neighbors[n.id] ??= 'island'; }
        }
        break;
      }
    }
  }
}

function simulator(draft: DialogueRule, host: DialogueHost) {
  const el = h('section', { class: 'ed-card sim' });
  const out = h('div');
  const controls = h('div');

  const refresh = () => {
    clear(out);
    const villagers = host.villagers();
    const def = villagers.find((v) => v.id === S.vid) ?? villagers[0];
    if (!def) return out.append(h('p', { class: 'muted' }, 'No villagers.'));
    const ctx = simContext(def, villagers);
    const rules = host.rules();
    const base = villagerLine(def, S.level, { player: ctx.player, weather: S.weather, hour: S.hour, seed: ctx.seed, birthday: S.date.slice(5) === def.birthday });
    const res = composeDialogue(rules, ctx, base);
    const usedThis = res.used.includes(draft.id);
    out.append(
      h('div', { class: `sim-verdict ${usedThis ? 'yes' : 'no'}` }, usedThis ? '✅ This rule is used here' : '❌ This rule is not used here'),
      h('div', { class: 'bubble-who' }, `${vIcon(def)} ${def.name} says`),
      h('div', { class: 'bubbles' }, res.line.split('\n').filter((p) => p.trim()).map((p) => h('div', { class: 'sbubble' }, p))),
      res.replies?.length ? h('div', { class: 'col', style: 'gap:4px;margin-top:6px' }, res.replies.map((r) => h('div', { class: 'sim-reply' }, h('b', {}, `🧑 ${r.text}`), h('span', {}, ` → ${r.answer}`)))) : '',
      h('div', { class: 'muted', style: 'margin:8px 0 4px' }, res.used.length ? `From: ${res.used.join(' + ')}` : 'Generic personality line (no rule matched).'),
    );
    const checks = checkRules(rules, ctx).filter((c) => c.why !== 'not this villager' || c.rule.id === draft.id)
      .sort((a, b) => Number(b.ok) - Number(a.ok) || b.rule.priority - a.rule.priority);
    out.append(h('details', { open: !usedThis }, h('summary', {}, `Rules for ${def.name} (${checks.filter((c) => c.ok).length} match)`),
      h('table', { class: 'data sim-rules' }, checks.map((c) => h('tr', { class: c.rule.id === draft.id ? 'me' : '' },
        h('td', {}, res.used.includes(c.rule.id) ? '⭐' : c.ok ? '✓' : '✗'),
        h('td', {}, h('b', {}, c.rule.id), h('div', { class: 'muted' }, c.ok ? `priority ${c.rule.priority}${c.rule.mode && c.rule.mode !== 'replace' ? ` · ${c.rule.mode}` : ''}` : c.why)))))));
  };

  const drawControls = () => {
    clear(controls);
    const villagers = host.villagers();
    if (!villagers.some((v) => v.id === S.vid)) S.vid = villagers[0]?.id ?? '';
    const dateIn = h('input', { type: 'date', value: S.date, onchange: () => { if (dateIn.value) { S.date = dateIn.value; refresh(); } } }) as HTMLInputElement;
    const ch = <T>(apply: (v: T) => void) => (v: T) => { apply(v); refresh(); };
    const nb = villagers.filter((v) => v.id !== S.vid);
    const nbBox = h('div', { class: 'chips' }, nb.map((v) => {
      const st = S.neighbors[v.id];
      return h('button', {
        type: 'button', class: `chip${st ? ' on' : ''}${st === 'nearby' ? ' near' : ''}`, title: 'Click: off → on island → nearby',
        onclick: () => { if (!st) S.neighbors[v.id] = 'island'; else if (st === 'island') S.neighbors[v.id] = 'nearby'; else delete S.neighbors[v.id]; drawControls(); refresh(); },
      }, `${vIcon(v)} ${v.name}${st === 'nearby' ? ' 👀' : ''}`);
    }));
    controls.append(
      h('div', { class: 'sim-grid' },
        sf('Villager', select(villagers.map((v) => ({ value: v.id, label: `${vIcon(v)} ${v.name}` })), S.vid, ch((v) => { S.vid = v; drawControls(); }))),
        sf('Friendship', select(levels, S.level, ch((v) => (S.level = Number(v))))),
        sf('Date', dateIn),
        sf('Hour', select(hours.slice(0, 24), S.hour, ch((v) => (S.hour = Number(v))))),
        sf('Weather', select(WEATHERS.map((w) => ({ value: w, label: `${WEATHER_ICON[w]} ${w}` })), S.weather, ch((v) => (S.weather = v)))),
        sf('Season', select(SEASON_NAMES.map((s) => ({ value: s, label: s })), S.season, ch((v) => (S.season = v)))),
        sf('Temp °C', num(S.temp, ch((v) => (S.temp = v ?? 0)))),
        sf('Biome', select(BIOME_IDS.map((b) => ({ value: b, label: b })), S.biome, ch((v) => (S.biome = v)))),
        sf('Player', select([{ value: 'owner', label: 'owner' }, { value: 'resident', label: 'resident' }, { value: 'visitor', label: 'visitor' }] as const, S.role, ch((v) => (S.role = v)))),
        sf('Place', select([{ value: 'outdoors', label: 'outdoors' }, { value: 'indoors', label: 'indoors' }] as const, S.place, ch((v) => (S.place = v)))),
        sf('Island day', num(S.islandDay, ch((v) => (S.islandDay = v ?? 1)))),
        sf('Carries', select(Object.values(ITEMS).filter((i) => i.category !== 'tool').map((i) => ({ value: i.id, label: `${i.icon} ${i.name}` })), S.item || undefined, ch((v) => (S.item = v)), '–'))),
      h('div', { class: 'muted', style: 'margin:8px 0 4px' }, `Neighbours (click: on island → nearby → off)`), nbBox,
      h('div', { class: 'muted', style: 'margin:8px 0 4px' }, 'Situation'),
      chips(STATE_FLAGS.map((f) => ({ value: f, label: eventLabel(f).replace(/ \(\{neighbor\}\)/, '') })), S.flags, ch((s) => (S.flags = s))),
    );
  };

  el.append(
    h('div', { class: 'row', style: 'justify-content:space-between;margin-bottom:6px' }, h('h4', { style: 'margin:0' }, '🧪 Try it out'),
      h('div', { class: 'row' },
        h('button', { class: 'btn small', title: 'Set the situation so this rule fires', onclick: () => { tuneTo(draft, host.villagers()); drawControls(); refresh(); } }, '🎯 Make it fire'),
        h('button', { class: 'btn ghost small', title: 'Pick other variants', onclick: () => { S.roll++; refresh(); } }, '🎲'))),
    out, h('hr'), controls);
  drawControls();
  refresh();
  return { el, refresh };
}

function sf(label: string, control: HTMLElement) {
  return h('label', { class: 'sf' }, h('span', {}, label), control);
}
