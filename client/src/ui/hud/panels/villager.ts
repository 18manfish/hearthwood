// Talking to villagers: the dialogue box, replies and gifts.

import { FRIENDSHIP_LEVELS, friendshipLevel, ITEMS, type TalkView, villagerDef } from '@hearthwood/shared';
import { state } from '../../../state.ts';
import { clear, h } from '../../dom.ts';
import type { Hud } from '../../hud.ts';

export function openVillager(hud: Hud, id: string) {
  hud.talkingTo = id;
  hud.act({ k: 'talk', vid: id });
}

export function closeDialog(hud: Hud) {
  clear(hud.dialogHost);
  hud.talkingTo = null;
}

export function onTalk(hud: Hud, v: TalkView) {
  const def = villagerDef(v.vid)!;
  hud.talkingTo = v.vid;
  hud.world.say(v.vid, v.reaction === 'love' ? '😍' : v.reaction === 'like' ? '😊' : v.reaction === 'dislike' ? '😖' : '💬');
  clear(hud.dialogHost);
  const lvl = friendshipLevel(v.points);
  const nextMin = v.next ?? FRIENDSHIP_LEVELS[FRIENDSHIP_LEVELS.length - 1].min;
  const curMin = FRIENDSHIP_LEVELS[lvl.level].min;
  const pct = v.next ? Math.round(((v.points - curMin) / (nextMin - curMin)) * 100) : 100;
  const line = h('div', { class: 'line' });
  const more = h('div', { class: 'more' });
  const picker = h('div');
  const box = h('div', { class: 'dialog' },
    h('div', { class: 'who' }, `${def.name} the ${def.personality} ${def.species}`),
    line,
    more,
    h('div', { class: 'row', style: 'justify-content:space-between' },
      h('div', { style: 'flex:1;max-width:260px' }, h('div', { class: 'row' }, h('span', { class: 'hearts' }, '♥'.repeat(lvl.level + 1) + '♡'.repeat(4 - lvl.level)), h('b', {}, v.levelName)), h('div', { class: 'bar' }, h('div', { style: `width:${pct}%` }))),
      h('div', { class: 'row' },
        h('button', { class: 'btn ghost small', onclick: () => hud.act({ k: 'talk', vid: v.vid }) }, '💬 Chat'),
        h('button', { class: 'btn small', disabled: v.giftedToday, title: v.giftedToday ? 'One gift per day' : '', onclick: () => giftPicker(hud, picker, v.vid) }, v.giftedToday ? '🎁 Gifted today' : '🎁 Give gift'),
        h('button', { class: 'btn ghost small', onclick: () => closeDialog(hud) }, 'Bye!'))),
    picker,
    h('div', { class: 'muted', style: 'margin-top:6px' }, `Hint: ${def.name} likes ${def.likes.join(' & ')} things.`));
  hud.dialogHost.appendChild(box);
  // Pages (one per line of text), typed out; replies after the last page.
  const pages = v.line.split('\n').map((p) => p.trim()).filter(Boolean);
  let page = 0;
  let typing = 0;
  const type = (text: string, done?: () => void) => {
    const run = ++typing;
    let i = 0;
    const tick = () => {
      if (run !== typing) return;
      line.textContent = text.slice(0, i);
      if (i++ < text.length) setTimeout(tick, 18);
      else done?.();
    };
    tick();
  };
  const showPage = () => {
    clear(more);
    type(pages[page] ?? '', () => {
      if (page < pages.length - 1) {
        more.append(h('button', { class: 'btn ghost small', onclick: () => { page++; showPage(); } }, `Next ▸ (${page + 1}/${pages.length})`));
      } else if (v.replies?.length) {
        more.append(h('div', { class: 'row replies' }, v.replies.map((r) => h('button', { class: 'btn small', onclick: () => { clear(more); type(r.answer); } }, r.text))));
      }
    });
  };
  showPage();
}

export function giftPicker(hud: Hud, host: HTMLElement, vid: string) {
  clear(host);
  const items = Object.entries(state.inv).filter(([id, n]) => n > 0 && ITEMS[id].category !== 'tool');
  if (!items.length) return host.append(h('p', { class: 'muted' }, 'Nothing to give.'));
  host.append(h('div', { class: 'row', style: 'margin-top:10px' }, items.map(([id, n]) => h('button', { class: 'btn ghost small', title: ITEMS[id].name, onclick: () => hud.act({ k: 'gift', vid, item: id }) }, `${ITEMS[id].icon} ${n}`))));
}
