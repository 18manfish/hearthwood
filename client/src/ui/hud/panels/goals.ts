// 📜 Goals panel: the current chapter's goals and rewards.

import { CHAPTERS, ITEMS } from '@hearthwood/shared';
import { state } from '../../../state.ts';
import { h } from '../../dom.ts';
import type { Hud } from '../../hud.ts';

export function goalsPanel(hud: Hud, b: HTMLElement) {
  const q = state.quest;
  if (!q) return b.append('Loading…');
  if (q.chapter > CHAPTERS.length) {
    b.append(h('h3', {}, '🎉 Your town is complete!'), h('p', {}, 'All seven villagers live here and every shop is open. Keep befriending your neighbours, decorating, fishing and visiting friends.'));
  } else {
    const c = CHAPTERS[q.chapter - 1];
    const behind = q.islandDay > c.byDay;
    b.append(
      h('div', { class: 'row', style: 'justify-content:space-between' },
        h('h3', {}, `Chapter ${c.id}: ${c.title}`),
        h('span', { class: `pill ${behind ? 'no' : 'ok'}` }, `Target: day ${c.byDay} · today: day ${q.islandDay}${behind ? ' (take your time!)' : ''}`)),
      h('p', {}, c.intro),
      h('div', { class: 'col' }, c.goals.map((g, i) => h('div', { class: `goal${q.done[i] ? ' done' : ''}` }, q.done[i] ? '✅' : '⬜', g.label))),
      h('p', { class: 'muted' }, `Reward: ${c.reward.coins} coins${c.reward.items ? ' + ' + Object.entries(c.reward.items).map(([id, n]) => `${n}× ${ITEMS[id].name}`).join(', ') : ''}`),
    );
  }
  b.append(h('h3', { style: 'margin-top:14px' }, 'Your journey'),
    h('div', { class: 'list' }, CHAPTERS.map((c) => h('div', { class: 'item' }, `${c.id < (q.chapter) ? '✅' : c.id === q.chapter ? '👉' : '🔒'} ${c.title}`, h('span', { class: 'muted' }, `by day ${c.byDay}`)))),
    h('p', { class: 'muted' }, 'Tips: shake trees for branches, pick up loose stones by hand, pick bushes for fibre. Buildings unlock as your island ages – time follows the real calendar.'));
}
