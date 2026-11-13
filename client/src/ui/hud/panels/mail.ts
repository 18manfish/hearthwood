// 📬 Letters: reading and writing, the billboard, messages in bottles.

import { BOTTLE_MAX_CHARS, ITEMS } from '@hearthwood/shared';
import { net } from '../../../net.ts';
import { state } from '../../../state.ts';
import { h } from '../../dom.ts';
import type { Hud } from '../../hud.ts';

export function mailPanel(hud: Hud, b: HTMLElement, compose: boolean) {
  if (compose) {
    if (!state.friends.length) b.append(h('p', { class: 'muted' }, 'Add friends (O) to send them letters. Visitors can also leave you letters here.'));
    else {
      const to = h('select', {}, state.friends.map((f) => h('option', { value: f.id }, f.name))) as HTMLSelectElement;
      const item = h('select', {}, h('option', { value: '' }, '(no gift)'), Object.entries(state.inv).filter(([id]) => ITEMS[id].category !== 'tool').map(([id, n]) => h('option', { value: id }, `${ITEMS[id].icon} ${ITEMS[id].name} (${n})`))) as HTMLSelectElement;
      const text = h('textarea', { rows: 3, maxlength: 280, placeholder: 'Write a letter…' }) as HTMLTextAreaElement;
      b.append(h('div', { class: 'col', style: 'margin-bottom:14px' }, h('h3', {}, '✉️ Send a letter'),
        h('div', { class: 'field' }, 'To', to), h('div', { class: 'field' }, 'Attach a gift', item), h('div', { class: 'field' }, 'Message', text),
        h('button', { class: 'btn', onclick: () => hud.act({ k: 'mail', to: to.value, text: text.value, item: item.value || undefined, n: item.value ? 1 : undefined }) }, 'Send')));
    }
  }
  b.append(h('h3', {}, `Inbox (${state.mail.length})`));
  if (!state.mail.length) b.append(h('p', { class: 'muted' }, 'No letters yet.'));
  b.append(h('div', { class: 'list' }, state.mail.map((m) => h('div', { class: 'item' },
    h('div', {}, h('b', {}, `From ${m.fromName}`), h('div', {}, m.text || h('i', { class: 'muted' }, '(no message)')), m.item ? h('div', { class: 'muted' }, `Gift: ${ITEMS[m.item]?.icon} ${m.n}× ${ITEMS[m.item]?.name}`) : null),
    h('button', { class: 'btn small', onclick: () => hud.act({ k: 'takeMail', mailId: m.id }) }, m.item ? 'Take gift' : 'Discard')))));
}

/** The town billboard: read notes, pin your own, take yours down. */
export function billboardPanel(hud: Hud, b: HTMLElement) {
  const posts = state.room?.board ?? [];
  const ago = (t: number) => {
    const m = Math.max(0, Math.round((net.serverNow() - t) / 60000));
    return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
  };
  const text = h('textarea', { rows: 2, maxlength: 140, placeholder: 'Selling peaches, meet at the fountain at 8! …' }) as HTMLTextAreaElement;
  const left = h('span', { class: 'muted' }, '140');
  text.addEventListener('input', () => (left.textContent = String(140 - text.value.length)));
  b.append(
    h('div', { class: 'col', style: 'margin-bottom:12px' },
      h('div', { class: 'field' }, 'Pin a note for everyone who visits', text),
      h('div', { class: 'row', style: 'justify-content:space-between' }, left,
        h('button', { class: 'btn', onclick: () => {
          const v = text.value.trim();
          if (!v) return;
          net.send({ t: 'board', op: 'post', text: v });
          text.value = '';
          left.textContent = '140';
        } }, '📌 Pin note'))),
    h('h3', {}, `Notes (${posts.length})`),
  );
  if (!posts.length) b.append(h('p', { class: 'muted' }, 'Nothing pinned yet – be the first!'));
  const colors = ['#fff8b5', '#ffd6e0', '#cdeffd', '#d9f7c8'];
  b.append(h('div', { class: 'grid', style: 'grid-template-columns:repeat(auto-fill,minmax(200px,1fr))' }, posts.map((p, i) =>
    h('div', { class: 'tile', style: `background:${colors[i % colors.length]};transform:rotate(${((i * 37) % 5) - 2}deg)` },
      h('div', { style: 'font-weight:700;white-space:pre-wrap;word-break:break-word' }, p.text),
      h('div', { class: 'row', style: 'justify-content:space-between' },
        h('span', { class: 'muted' }, `— ${p.name}, ${ago(p.at)}`),
        p.by === state.self?.id ? h('button', { class: 'btn ghost small', onclick: () => net.send({ t: 'board', op: 'delete', id: p.id }) }, 'Take down') : '')))));
}

/** Leave a letter (and optional gift) in someone else's mailbox. */
export function letterTo(hud: Hud, b: HTMLElement, ownerId: string, ownerName: string) {
  const item = h('select', {}, h('option', { value: '' }, '(no gift)'), Object.entries(state.inv).filter(([id]) => ITEMS[id].category !== 'tool').map(([id, n]) => h('option', { value: id }, `${ITEMS[id].icon} ${ITEMS[id].name} (${n})`))) as HTMLSelectElement;
  const text = h('textarea', { rows: 3, maxlength: 280, placeholder: `Write ${ownerName} a letter…` }) as HTMLTextAreaElement;
  b.append(h('div', { class: 'col' },
    h('p', { class: 'muted' }, `Drop a letter into ${ownerName}’s mailbox – they’ll find it next time they check their mail.`),
    h('div', { class: 'field' }, 'Attach a gift', item), h('div', { class: 'field' }, 'Message', text),
    h('button', { class: 'btn', onclick: async () => {
      const r = await hud.act({ k: 'mail', to: ownerId, text: text.value, item: item.value || undefined, n: item.value ? 1 : undefined });
      if (r.ok) hud.close();
    } }, '✉️ Post letter')));
}

/** Write a message in a bottle and throw it into the sea. */
export function writeBottle(hud: Hud) {
  const text = h('textarea', { rows: 4, maxlength: BOTTLE_MAX_CHARS, placeholder: 'Dear stranger…', style: 'width:100%' }) as HTMLTextAreaElement;
  const body = h('div', { class: 'col' },
    h('p', { class: 'muted' }, 'Stand near the sea and throw it in. Within a day it washes up on a random player’s beach.'),
    text,
    h('button', { class: 'btn', onclick: async () => {
      const r = await hud.act({ k: 'bottle', text: text.value });
      if (r.ok) hud.close();
    } }, '🍾 Throw it into the sea'));
  hud.frame('🍾 Message in a bottle', body);
  setTimeout(() => text.focus());
}
