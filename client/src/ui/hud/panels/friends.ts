// 💌 Friends panel: codes, requests, visiting.

import { net } from '../../../net.ts';
import { state } from '../../../state.ts';
import { h } from '../../dom.ts';
import { travelTo } from './map.ts';
import type { Hud } from '../../hud.ts';

export function friendsPanel(hud: Hud, b: HTMLElement) {
  const self = state.self;
  const code = h('input', { placeholder: 'Friend code', maxlength: 12, style: 'width:140px' }) as HTMLInputElement;
  b.append(
    h('div', { class: 'row' }, h('span', {}, 'Your friend code:'), h('span', { class: 'pill', style: 'font-size:16px' }, self?.code ?? '…'),
      h('button', { class: 'btn ghost small', onclick: () => navigator.clipboard?.writeText(self?.code ?? '') }, 'Copy')),
    h('div', { class: 'row', style: 'margin:10px 0' }, code, h('button', { class: 'btn small', onclick: () => { if (code.value.trim()) net.send({ t: 'friend', op: 'request', code: code.value.trim().toUpperCase() }); code.value = ''; } }, 'Add friend')),
  );
  if (state.incoming.length) b.append(h('h3', {}, 'Requests'), h('div', { class: 'list' }, state.incoming.map((f) => h('div', { class: 'item' }, `💌 ${f.name}`,
    h('div', { class: 'row' }, h('button', { class: 'btn small', onclick: () => net.send({ t: 'friend', op: 'accept', id: f.id }) }, 'Accept'), h('button', { class: 'btn ghost small', onclick: () => net.send({ t: 'friend', op: 'decline', id: f.id }) }, 'Decline'))))));
  if (state.outgoing.length) b.append(h('h3', { style: 'margin-top:10px' }, 'Pending'), h('div', { class: 'list' }, state.outgoing.map((f) => h('div', { class: 'item' }, `⏳ ${f.name}`, h('button', { class: 'btn ghost small', onclick: () => net.send({ t: 'friend', op: 'cancel', id: f.id }) }, 'Cancel')))));
  b.append(h('h3', { style: 'margin-top:10px' }, `Friends (${state.friends.length})`));
  if (!state.friends.length) b.append(h('p', { class: 'muted' }, 'Share your code with friends so you can visit each other’s islands.'));
  b.append(h('div', { class: 'list' }, state.friends.map((f) => h('div', { class: 'item' }, h('span', {}, f.online ? '🟢 ' : '⚪ ', h('b', {}, f.name), h('span', { class: 'muted' }, ` · ${f.code}`)),
    h('div', { class: 'row' },
      f.islandId ? h('button', { class: 'btn small', onclick: () => travelTo(hud, { kind: 'island', id: f.islandId! }) }, 'Visit') : null,
      h('button', { class: 'btn ghost small', onclick: () => { if (confirm(`Remove ${f.name} from your friends?`)) net.send({ t: 'friend', op: 'remove', id: f.id }); } }, 'Remove'))))));
}
