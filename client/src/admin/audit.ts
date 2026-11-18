// Admin tool: the log of what admins did.

import { h } from '../ui/dom.ts';
import { call, shell } from './ui.ts';

export async function auditPage() {
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
