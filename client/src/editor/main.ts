// Game creation tool (dev mode only): edit items, fish, birds, recipes, shop
// stock, buildings, villagers, permits and paths. Changes are validated by the
// server, stored in its database and pushed to every client.

import '../style.css';
import '../tools.css';
import * as THREE from 'three';
import {
  BIRD_BY_ID, BUILDINGS, ITEMS, TABLE_INFO, GAME_TABLES, validateGameData,
  speakerMatches,
  type BirdDef, type DialogueRule, type FieldHint, type GameData, type GameTable, type ItemDef, type VillagerDef, type BuildingType, type Building,
} from '@hearthwood/shared';
import { chips, dialogueEditor, dialogueSummary, SPECIES_ICON, type DialogueHost } from './dialogue.ts';
import { api, clearToken, health, logout, token } from '../auth.ts';
import { showLogin } from '../ui/login.ts';
import { h, clear } from '../ui/dom.ts';
import { birdModel, buildingModel, furnitureModel } from '../game/models.ts';
import { loadKitAssets } from '../game/assets/kit.ts';
import { makeVillager, animateRig, type Rig } from '../game/characters.ts';

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

// ── 3D preview ──────────────────────────────────────────────────────────────
class Preview3D {
  readonly el = h('div', { class: 'preview3d' });
  private renderer: THREE.WebGLRenderer | null = null;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(32, 4 / 3, 0.05, 80);
  private obj: THREE.Object3D | null = null;
  private rig: Rig | null = null;
  constructor() {
    try {
      this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
      this.el.appendChild(this.renderer.domElement);
    } catch {
      this.el.append(h('div', { class: 'muted', style: 'padding:20px' }, 'No WebGL – preview unavailable.'));
    }
    this.scene.add(new THREE.HemisphereLight('#ffffff', '#88aa66', 1.6));
    const d = new THREE.DirectionalLight('#fff4dc', 1.8);
    d.position.set(2, 4, 3);
    this.scene.add(d);
    const clock = new THREE.Clock();
    const loop = () => {
      requestAnimationFrame(loop);
      if (!this.renderer || !this.el.isConnected) return;
      const w = this.el.clientWidth, hh = this.el.clientHeight;
      if (w && hh) {
        this.renderer.setSize(w, hh, false);
        this.camera.aspect = w / hh;
        this.camera.updateProjectionMatrix();
      }
      const dt = clock.getDelta();
      if (this.obj) this.obj.rotation.y += dt * 0.6;
      if (this.rig) animateRig(this.rig, dt, 0, 0);
      this.renderer.render(this.scene, this.camera);
    };
    loop();
  }
  show(o: THREE.Object3D | null, rig: Rig | null = null, fit = 1.4) {
    if (this.obj) this.scene.remove(this.obj);
    this.obj = o;
    this.rig = rig;
    if (!o) return;
    const holder = new THREE.Group();
    holder.add(o);
    this.obj = holder;
    this.scene.add(holder);
    const box = new THREE.Box3().setFromObject(o);
    const size = box.getSize(new THREE.Vector3());
    const c = box.getCenter(new THREE.Vector3());
    o.position.sub(new THREE.Vector3(c.x, box.min.y, c.z));
    const r = Math.max(size.x, size.y, size.z, 0.3) * fit;
    this.camera.position.set(0, size.y * 0.6 + r * 0.45, r * 1.9);
    this.camera.lookAt(0, size.y * 0.45, 0);
  }
}
const preview = new Preview3D();

/** Build a model from an (unsaved) row so the preview matches the edit. */
function previewRow(t: GameTable, r: Row) {
  try {
    if (t === 'villagers') {
      const rig = makeVillager(r as unknown as VillagerDef);
      return preview.show(rig.root, rig, 1.3);
    }
    if (t === 'birds') {
      const prev = BIRD_BY_ID[r.id as string];
      BIRD_BY_ID[r.id as string] = r as unknown as BirdDef;
      const m = birdModel(r.id as string, 0);
      if (prev) BIRD_BY_ID[r.id as string] = prev;
      else delete BIRD_BY_ID[r.id as string];
      return preview.show(m, null, 1.6);
    }
    if (t === 'items' && r.category === 'furniture') {
      const prev = ITEMS[r.id as string];
      ITEMS[r.id as string] = r as unknown as ItemDef;
      const m = furnitureModel(r.id as string, 0);
      if (prev) ITEMS[r.id as string] = prev;
      else delete ITEMS[r.id as string];
      return preview.show(m);
    }
    if (t === 'buildings') {
      const prev = BUILDINGS[r.type as BuildingType];
      (BUILDINGS as Record<string, unknown>)[r.type as string] = r;
      const b: Building = { id: 'preview', type: r.type as BuildingType, x: 0, z: 0, w: r.w as number, h: r.h as number, completeAt: 0 };
      const m = buildingModel(b, Date.now());
      (BUILDINGS as Record<string, unknown>)[r.type as string] = prev;
      return preview.show(m, null, 1.2);
    }
  } catch (e) {
    console.warn('preview failed', e);
  }
  preview.show(null);
}

// ── Form generation from the field hints ────────────────────────────────────
type Getter = () => unknown;

const hourOpts = Array.from({ length: 25 }, (_, i) => i);

function fieldEditor(f: FieldHint, value: unknown, locked: boolean): { el: HTMLElement; get: Getter } {
  const dis = locked ? { disabled: true } : {};
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
      let sel = Array.isArray(value) ? (value as string[]) : [];
      const el = chips((f.options ?? []).map((o) => ({ value: o, label: o })), sel, (s) => { sel = s; el.dispatchEvent(new Event('input', { bubbles: true })); });
      if (locked) el.classList.add('locked');
      return { el, get: () => (sel.length || f.required ? sel : undefined) };
    }
    case 'text': {
      const t = h('textarea', { rows: 3, class: 'prose', ...dis }, String(value ?? '')) as HTMLTextAreaElement;
      return { el: t, get: () => (t.value === '' ? undefined : t.value) };
    }
    case 'json': {
      const short = value === undefined ? '' : JSON.stringify(value);
      const text = short.length > 60 ? JSON.stringify(value, null, 2) : short;
      const t = h('textarea', { rows: Math.min(10, Math.max(2, text.split('\n').length)), ...dis }, text) as HTMLTextAreaElement;
      return {
        el: t,
        get: () => {
          if (!t.value.trim()) return undefined;
          try {
            return JSON.parse(t.value);
          } catch {
            throw new Error(`${f.key}: invalid JSON`);
          }
        },
      };
    }
    default: {
      const i = h('input', { value: String(value ?? ''), ...dis }) as HTMLInputElement;
      return { el: i, get: () => (i.value === '' ? undefined : i.value) };
    }
  }
}

const WIDE_FIELDS = new Set<FieldHint['type']>(['tags', 'json', 'text', 'colors']);

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

function summaryOf(t: GameTable, r: Row): string {
  switch (t) {
    case 'items': return `${r.category} · sell ${r.sell}${r.buy !== undefined ? ` · buy ${r.buy}` : ''}`;
    case 'fish': return `${r.water} · ${r.sell} · rarity ${r.rarity}`;
    case 'birds': return `${(r.biomes as string[]).join(', ')} · ${r.sell}`;
    case 'recipes': return `${r.station} · ${(r.ingredients as { item?: string; tag?: string; qty: number }[]).map((i) => `${i.qty} ${i.item ?? `any ${i.tag}`}`).join(', ')}`;
    case 'shopStock': return (r.items as string[]).map((i) => ITEMS[i]?.icon ?? i).join(' ');
    case 'buildings': return `day ${r.minDay} · ${r.buildMinutes} min · ${Object.entries(r.cost as Record<string, number>).map(([k, n]) => `${n} ${k}`).join(', ')}`;
    case 'villagers': return `${r.species} · ${r.personality}`;
    case 'dialogue': return dialogueSummary(r as unknown as DialogueRule, villagerList());
    case 'permits': return `${r.price} coins`;
    case 'paths': return Object.entries(r.cost as Record<string, number>).map(([k, n]) => `${n} ${k}`).join(', ') || 'free';
  }
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
    const hasPreview = ['villagers', 'birds', 'items', 'buildings'].includes(table);
    const aside = h('div', { class: 'ed-aside' });
    if (hasPreview) {
      aside.append(h('section', { class: 'ed-card' }, h('div', { class: 'row', style: 'justify-content:space-between' }, h('h4', { style: 'margin:0' }, '👁️ Preview'), h('button', { class: 'btn ghost small', onclick: () => { try { previewRow(table, readForm()); } catch (e) { toast((e as Error).message, false); } } }, '↻ Update')),
        preview.el, table === 'items' ? h('div', { class: 'muted' }, 'Furniture items show their 3D model.') : null));
      setTimeout(() => previewRow(table, r));
    }
    if (table === 'villagers') aside.append(villagerDialogueCard(r as unknown as VillagerDef));
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
  // Bird and furniture previews use the kit models once they're in.
  loadKitAssets().then(render);
}
start();
