// Admin tool: gifts in the mailbox – rules that send them automatically, and sending one by hand.

import {
  BUILDINGS, ITEMS, ITEM_LIST, GIFT_LIMITS, GIFT_TRIGGERS, describeGiftTrigger, isBuildingType, type BuildingType, type GiftLetter, type GiftRule, type GiftTrigger, type GiftTriggerKind,
} from '@hearthwood/shared';
import { h, clear } from '../ui/dom.ts';
import type { PlayerSummary } from './players.ts';
import { ago, call, field, input, select, shell, toast, guardUnsaved } from './ui.ts';

const toLocalInput = (ms: number | undefined) => (ms === undefined ? '' : new Date(ms - new Date(ms).getTimezoneOffset() * 60000).toISOString().slice(0, 16));
const fromLocalInput = (v: string) => (v ? new Date(v).getTime() : undefined);

/** Writing a gift letter: signature, text, items and coins – with a preview as players see it. */
function letterEditor(initial: GiftLetter, onChange: () => void) {
  const fromName = input(initial.fromName, { maxlength: GIFT_LIMITS.fromName, placeholder: 'The Hearthwood Team' });
  const text = h('textarea', { rows: 5, maxlength: GIFT_LIMITS.text, placeholder: 'Dear islander, …' }, initial.text) as HTMLTextAreaElement;
  const coins = input(initial.coins || 0, { type: 'number', min: 0, max: GIFT_LIMITS.coins, style: 'width:120px' });
  const items = initial.items.map((x) => ({ ...x }));
  const itemBox = h('div', { class: 'kv' });
  const preview = h('div', { class: 'list' });
  const sortedItems = [...ITEM_LIST].sort((a, b) => a.name.localeCompare(b.name));
  const get = (): GiftLetter => ({ fromName: fromName.value.trim(), text: text.value, items: items.filter((x) => x.n > 0), coins: Math.max(0, Math.floor(Number(coins.value) || 0)) });
  const drawPreview = () => {
    clear(preview);
    const l = get();
    preview.append(h('div', { class: 'item gift-letter' },
      h('div', { class: 'col', style: 'gap:4px;min-width:0' }, h('b', {}, `🎁 From ${l.fromName || '…'}`),
        l.text ? h('div', { style: 'white-space:pre-wrap;word-break:break-word' }, l.text) : h('i', { class: 'muted' }, '(no message)'),
        h('div', { class: 'gift-items' }, l.items.map((it) => h('span', { class: 'gift-chip' }, `${ITEMS[it.item]?.icon ?? '❓'} ${it.n > 1 ? `${it.n}× ` : ''}${ITEMS[it.item]?.name ?? it.item}`)),
          l.coins ? h('span', { class: 'gift-chip' }, `🪙 ${l.coins.toLocaleString()} coins`) : null)),
      h('button', { class: 'btn small', disabled: true }, l.items.length + (l.coins ? 1 : 0) > 1 ? 'Take gifts' : l.items.length || l.coins ? 'Take gift' : 'Discard')));
  };
  const changed = () => { drawPreview(); onChange(); };
  const drawItems = () => {
    clear(itemBox);
    if (!items.length) itemBox.append(h('span', { class: 'muted', style: 'grid-column:1/-1' }, 'No items yet.'));
    items.forEach((it, i) => {
      const q = input(it.n, { type: 'number', min: 1, max: GIFT_LIMITS.n, oninput: () => { it.n = Math.max(0, Math.floor(Number(q.value) || 0)); changed(); } });
      itemBox.append(h('span', {}, `${ITEMS[it.item]?.icon ?? '❓'} ${ITEMS[it.item]?.name ?? it.item}`), q,
        h('button', { class: 'btn ghost small', title: 'Remove', onclick: () => { items.splice(i, 1); drawItems(); changed(); } }, '✕'));
    });
  };
  const add = select(sortedItems.map((i) => [i.id, `${i.icon} ${i.name}`]), sortedItems[0].id);
  const addBtn = h('button', { class: 'btn ghost small', onclick: () => {
    const same = items.find((x) => x.item === add.value);
    if (same) same.n++;
    else if (items.length >= GIFT_LIMITS.items) return toast(`Up to ${GIFT_LIMITS.items} different items.`, false);
    else items.push({ item: add.value, n: 1 });
    drawItems(); changed();
  } }, '+ Add item');
  for (const el of [fromName, text, coins]) el.addEventListener('input', changed);
  drawItems();
  drawPreview();
  const el = h('div', { class: 'col', style: 'gap:10px' },
    h('div', { class: 'form' }, field('Signed', fromName), field('Letter', text), field('Coins', coins)),
    h('div', {}, h('label', { style: 'font-weight:700;font-size:13px' }, 'Items'), itemBox, h('div', { class: 'row', style: 'margin-top:6px' }, add, addBtn)),
    h('div', {}, h('label', { style: 'font-weight:700;font-size:13px' }, '👁️ In the player’s mail'), preview));
  return { el, get };
}

/** The settings of one kind of trigger. */
function triggerEditor(initial: GiftTrigger, onChange: () => void) {
  const kind = select(Object.entries(GIFT_TRIGGERS).map(([k, v]) => [k, v.name]), initial.kind);
  const params = h('div', { class: 'row' });
  const help = h('div', { class: 'muted help' });
  let get: () => GiftTrigger = () => initial;
  const num = (v: number, min: number, max: number, label: string, mk: (n: number) => GiftTrigger) => {
    const el = input(v, { type: 'number', min, max, style: 'width:90px', oninput: onChange });
    params.append(h('span', {}, label), el);
    get = () => mk(Math.floor(Number(el.value)));
  };
  const draw = () => {
    clear(params);
    const k = kind.value as GiftTriggerKind;
    help.textContent = GIFT_TRIGGERS[k].help;
    const cur = initial.kind === k ? initial : null;
    switch (k) {
      case 'welcome': get = () => ({ kind: 'welcome' }); break;
      case 'login': {
        const rep = select([['once', 'Once'], ['daily', 'Every day'], ['weekly', 'Every week']], cur?.kind === 'login' ? cur.repeat : 'once', { onchange: onChange });
        params.append(rep);
        get = () => ({ kind: 'login', repeat: rep.value as 'once' | 'daily' | 'weekly' });
        break;
      }
      case 'scheduled': {
        const at = input(toLocalInput(cur?.kind === 'scheduled' ? cur.at : Date.now() + 3600_000), { type: 'datetime-local', oninput: onChange });
        params.append(at, h('span', { class: 'muted' }, `your time (${Intl.DateTimeFormat().resolvedOptions().timeZone})`));
        get = () => ({ kind: 'scheduled', at: fromLocalInput(at.value) ?? 0 });
        break;
      }
      case 'accountAge': num(cur?.kind === 'accountAge' ? cur.days : 30, 1, 3650, 'Days', (n) => ({ kind: 'accountAge', days: n })); break;
      case 'chapter': num(cur?.kind === 'chapter' ? cur.chapter : 1, 1, 99, 'Chapter', (n) => ({ kind: 'chapter', chapter: n })); break;
      case 'album': num(cur?.kind === 'album' ? cur.count : 10, 1, 999, 'Species', (n) => ({ kind: 'album', count: n })); break;
      case 'friends': num(cur?.kind === 'friends' ? cur.count : 3, 1, 999, 'Friends', (n) => ({ kind: 'friends', count: n })); break;
      case 'built': {
        const types = (Object.keys(BUILDINGS) as BuildingType[]).filter((t) => !BUILDINGS[t].fixed).sort((a, b) => BUILDINGS[a].name.localeCompare(BUILDINGS[b].name));
        const b = select(types.map((t) => [t, BUILDINGS[t].name]), cur?.kind === 'built' ? cur.building : 'mailbox', { onchange: onChange });
        params.append(b);
        get = () => ({ kind: 'built', building: isBuildingType(b.value) ? b.value : 'mailbox' });
        break;
      }
    }
  };
  kind.addEventListener('change', () => { draw(); onChange(); });
  draw();
  return { el: h('div', { class: 'col', style: 'gap:6px' }, h('div', { class: 'row' }, kind, params), help), get: () => get() };
}

const DEFAULT_LETTER: GiftLetter = { fromName: 'The Hearthwood Team', text: '', items: [], coins: 0 };

export async function giftsPage(sel: string | null, arg?: string) {
  const r = await call<{ rules: GiftRule[] }>('GET', '/api/admin/gifts');
  if (!r) return;
  const list = h('div', { class: 'box col' });
  const editor = h('div', { class: 'col', style: 'gap:16px' });
  shell('gifts', h('div', { class: 'split-news' }, list, editor));
  const now = Date.now();
  const status = (g: GiftRule) =>
    !g.enabled ? h('span', { class: 'pill no' }, 'off')
      : g.trigger.kind === 'scheduled' && g.fired ? h('span', { class: 'pill' }, 'sent')
        : g.until !== undefined && now >= g.until ? h('span', { class: 'pill' }, 'ended')
          : g.from !== undefined && now < g.from ? h('span', { class: 'pill' }, 'upcoming')
            : h('span', { class: 'pill ok' }, 'on');
  list.append(
    h('div', { class: 'row' }, h('h3', { style: 'margin:0' }, '🎁 Gifts'), h('span', { style: 'flex:1' }),
      h('a', { class: `btn small${sel === 'send' ? '' : ' ghost'}`, href: '#gifts/send' }, '✉️ Send now'),
      h('a', { class: 'btn small', href: '#gifts/new' }, '+ Automatic gift')),
    h('p', { class: 'muted' }, 'Letters with items and coins that land in players’ mailboxes. Send one now, or set up automatic gifts that go out by themselves when their trigger fires.'),
    r.rules.length
      ? h('table', { class: 'data' }, h('tr', {}, ['', 'Gift', 'Sent'].map((t) => h('th', {}, t))),
        r.rules.map((g) => h('tr', { class: `click${g.id === sel ? ' sel' : ''}`, onclick: () => (location.hash = `gifts/${g.id}`) },
          h('td', {}, status(g)),
          h('td', {}, h('b', {}, g.name), h('div', { class: 'muted' }, describeGiftTrigger(g.trigger)),
            g.from !== undefined || g.until !== undefined ? h('div', { class: 'muted' }, `${g.from !== undefined ? new Date(g.from).toLocaleDateString() : '…'} – ${g.until !== undefined ? new Date(g.until).toLocaleDateString() : '…'}`) : null),
          h('td', {}, String(g.sent)))))
      : h('p', { class: 'muted' }, 'No automatic gifts yet.'));

  if (sel === 'send') return sendGiftForm(editor, arg);
  if (sel === null) return void editor.append(h('div', { class: 'box' }, h('p', { class: 'muted' }, 'Pick an automatic gift, set up a new one, or send a letter now.')));
  const old = r.rules.find((g) => g.id === sel);
  if (sel !== 'new' && !old) return void editor.append(h('div', { class: 'box' }, h('p', { class: 'muted' }, 'That gift doesn’t exist any more.')));
  let dirty = false;
  const mark = () => { dirty = true; };
  const name = input(old?.name ?? '', { maxlength: GIFT_LIMITS.name, placeholder: 'e.g. Welcome package, Winter festival', style: 'flex:1;font-size:16px;font-weight:700' });
  const enabled = h('input', { type: 'checkbox', checked: old?.enabled ?? true }) as HTMLInputElement;
  const trig = triggerEditor(old?.trigger ?? { kind: 'welcome' }, mark);
  const from = input(toLocalInput(old?.from), { type: 'datetime-local', oninput: mark });
  const until = input(toLocalInput(old?.until), { type: 'datetime-local', oninput: mark });
  const letter = letterEditor(old?.letter ?? DEFAULT_LETTER, mark);
  for (const el of [name, enabled]) el.addEventListener('input', mark);
  window.onbeforeunload = () => (dirty ? 'Unsaved changes' : undefined);
  guardUnsaved(() => dirty);
  const payload = () => ({ name: name.value.trim(), enabled: enabled.checked, trigger: trig.get(), letter: letter.get(), from: fromLocalInput(from.value), until: fromLocalInput(until.value) });
  const save = async () => {
    const res = await call<{ rule: GiftRule }>(old ? 'PUT' : 'POST', old ? `/api/admin/gifts/${old.id}` : '/api/admin/gifts', payload());
    if (res) { dirty = false; toast('Saved'); location.hash = `gifts/${res.rule.id}`; giftsPage(res.rule.id); }
  };
  editor.append(h('div', { class: 'box col', style: 'gap:12px' },
    h('div', { class: 'row' }, h('h3', { style: 'margin:0' }, old ? 'Edit automatic gift' : 'New automatic gift'), h('span', { style: 'flex:1' }),
      h('label', { class: 'row', style: 'gap:4px', title: 'Untick to pause it' }, enabled, '✅ On')),
    h('div', { class: 'row' }, name),
    old ? h('div', { class: 'muted' }, `Sent ${old.sent} time${old.sent === 1 ? '' : 's'} · last changed ${ago(old.updatedAt)} by ${old.author}`) : null,
    h('div', {}, h('h4', { style: 'margin:4px 0' }, '⚡ When it goes out'), trig.el),
    h('div', { class: 'form' }, field('From', from, 'Optional: not before this moment (your time)'), field('Until', until, 'Optional: not after – for events and holidays')),
    h('h4', { style: 'margin:4px 0' }, '✉️ The letter'), letter.el,
    h('div', { class: 'row' },
      h('button', { class: 'btn', onclick: save }, '💾 Save'),
      h('button', { class: 'btn ghost small', title: 'Put this letter in your own mailbox to see it in the game', onclick: async () => { if (await call('POST', '/api/admin/gifts/test', { letter: letter.get() })) toast('A test letter is in your mailbox'); } }, '🧪 Send me a test'),
      old ? h('button', { class: 'btn warn small', onclick: async () => {
        if (!confirm(`Delete “${old.name}”? Letters already sent stay in the mailboxes.`)) return;
        if (await call('DELETE', `/api/admin/gifts/${old.id}`)) { dirty = false; toast('Deleted'); location.hash = 'gifts'; }
      } }, 'Delete') : null)));
}

/** Send a gift letter right now – to everyone, everyone online, or picked players. */
function sendGiftForm(editor: HTMLElement, preselect?: string) {
  const picked = new Map<string, string>();
  const who = select([['all', 'Every player'], ['online', 'Everyone online now'], ['some', 'Chosen players']], preselect ? 'some' : 'all');
  const chips = h('div', { class: 'row', style: 'flex-wrap:wrap;gap:6px' });
  const search = input('', { placeholder: 'Find a player by name, username or code…', style: 'width:300px' });
  const hits = h('div', { class: 'row', style: 'flex-wrap:wrap;gap:6px' });
  const somePanel = h('div', { class: 'col', style: 'gap:6px' }, chips, search, hits);
  const drawChips = () => {
    clear(chips);
    if (!picked.size) chips.append(h('span', { class: 'muted' }, 'Nobody picked yet.'));
    for (const [id, nm] of picked) chips.append(h('span', { class: 'pill ok', style: 'cursor:pointer', title: 'Remove', onclick: () => { picked.delete(id); drawChips(); } }, `${nm} ✕`));
  };
  let timer: ReturnType<typeof setTimeout>;
  search.oninput = () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      clear(hits);
      if (!search.value.trim()) return;
      const res = await call<{ players: PlayerSummary[] }>('GET', `/api/admin/players?q=${encodeURIComponent(search.value)}`);
      for (const p of res?.players.slice(0, 12) ?? []) hits.append(h('button', { class: 'btn ghost small', onclick: () => { picked.set(p.id, p.name); drawChips(); } }, `${p.online ? '🟢' : '⚪'} ${p.name}${p.username ? ` (${p.username})` : ''}`));
    }, 200);
  };
  const showSome = () => (somePanel.style.display = who.value === 'some' ? '' : 'none');
  who.addEventListener('change', showSome);
  showSome();
  drawChips();
  if (preselect) void call<{ player: { id: string; name: string } }>('GET', `/api/admin/players/${preselect}`).then((res) => { if (res) { picked.set(res.player.id, res.player.name); drawChips(); } });
  const letter = letterEditor(DEFAULT_LETTER, () => {});
  editor.append(h('div', { class: 'box col', style: 'gap:12px' },
    h('h3', { style: 'margin:0' }, '✉️ Send a gift now'),
    h('div', { class: 'form' }, field('To', who)), somePanel,
    letter.el,
    h('div', { class: 'row' },
      h('button', { class: 'btn', onclick: async () => {
        const to = who.value === 'some' ? [...picked.keys()] : who.value;
        if (Array.isArray(to) && !to.length) return toast('Pick at least one player.', false);
        const n = Array.isArray(to) ? to.length : who.value === 'all' ? 'every player' : 'everyone online';
        if (!confirm(`Send this letter to ${typeof n === 'number' ? `${n} player${n === 1 ? '' : 's'}` : n}?`)) return;
        const res = await call<{ sent: number }>('POST', '/api/admin/gifts/send', { to, letter: letter.get() });
        if (res) toast(`Sent to ${res.sent} player${res.sent === 1 ? '' : 's'}`);
      } }, '📮 Send'),
      h('button', { class: 'btn ghost small', onclick: async () => { if (await call('POST', '/api/admin/gifts/test', { letter: letter.get() })) toast('A test letter is in your mailbox'); } }, '🧪 Send me a test'))));
}
