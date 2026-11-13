// The hotbar: slots, picking and swapping tools, the hotbar editor, cycling
// terraforming tools.

import { type Hotbar, HOTBAR_INFO, HOTBAR_SIZE, HOTBAR_TOOLS, type HotbarTool, PERMIT_BY_ID, type PermitId, TERRA_INFO, TERRA_PERMIT } from '@hearthwood/shared';
import { type Tool } from '../../game/World.ts';
import { net } from '../../net.ts';
import { state } from '../../state.ts';
import { clear, h } from '../dom.ts';
import { hasPermit, have, toolOwned } from './common.ts';
import type { Hud } from '../hud.ts';

export function setSlots(hud: Hud, slots: Hotbar) {
  if (state.self) state.self.hotbar = slots;
  net.send({ t: 'hotbar', slots });
  renderHotbar(hud);
  hud.panelRefresh?.();
}

/** Put a tool into a slot; if it already sits elsewhere, the two slots swap. */
export function assignSlot(hud: Hud, i: number, t: HotbarTool | null) {
  const s = [...hud.slots];
  const j = t ? s.indexOf(t) : -1;
  if (j >= 0) s[j] = s[i];
  s[i] = t;
  setSlots(hud, s);
}

export function swapSlots(hud: Hud, i: number, j: number) {
  const s = [...hud.slots];
  [s[i], s[j]] = [s[j], s[i]];
  setSlots(hud, s);
}

export function renderHotbar(hud: Hud) {
  clear(hud.hotbar);
  hud.slots.forEach((tool, i) => {
    const info = tool ? HOTBAR_INFO[tool] : null;
    const owned = tool ? toolOwned(tool) : false;
    const n = tool === 'sapling' ? have('sapling') : 0;
    const el = h('button', {
      class: `slot${tool && hud.world.tool === tool ? ' sel' : ''}${tool && !owned ? ' off' : ''}${tool ? '' : ' empty'}`,
      title: `${info ? info.name : 'Empty slot'} – right-click to change, drag to rearrange`,
      draggable: 'true',
      onclick: () => selectSlot(hud, i),
      oncontextmenu: (e: Event) => { e.preventDefault(); slotPicker(hud, i, el); },
      ondragstart: () => (hud.dragFrom = i),
      ondragover: (e: Event) => e.preventDefault(),
      ondrop: (e: Event) => { e.preventDefault(); if (hud.dragFrom >= 0 && hud.dragFrom !== i) swapSlots(hud, hud.dragFrom, i); hud.dragFrom = -1; },
    }, h('span', { class: 'k' }, String((i + 1) % 10)), info ? info.icon : '', n ? h('span', { class: 'n' }, String(n)) : null);
    hud.hotbar.appendChild(el);
  });
}

/** Small pop-up above a slot to choose what goes in it. */
export function slotPicker(hud: Hud, i: number, anchor: HTMLElement) {
  document.querySelector('.slot-picker')?.remove();
  const box = h('div', { class: 'slot-picker' });
  const close = () => { box.remove(); window.removeEventListener('pointerdown', outside, true); };
  const outside = (e: Event) => { if (!box.contains(e.target as Node)) close(); };
  for (const t of HOTBAR_TOOLS) {
    const info = HOTBAR_INFO[t];
    box.append(h('button', { class: `btn small${hud.slots[i] === t ? '' : ' ghost'}${toolOwned(t) ? '' : ' off'}`, title: info.name, onclick: () => { assignSlot(hud, i, t); close(); } }, `${info.icon} ${info.name}`));
  }
  box.append(h('button', { class: 'btn ghost small', onclick: () => { assignSlot(hud, i, null); close(); } }, '⬜ Empty'));
  const r = anchor.getBoundingClientRect();
  box.style.left = `${Math.max(8, r.left + r.width / 2 - 90)}px`;
  box.style.bottom = `${window.innerHeight - r.top + 8}px`;
  hud.root.appendChild(box);
  setTimeout(() => window.addEventListener('pointerdown', outside, true));
}

export function selectSlot(hud: Hud, i: number) {
  const t = hud.slots[i];
  if (t) selectTool(hud, t);
}

/** LB / RB: step through the filled slots. */
export function cycleSlot(hud: Hud, dir: 1 | -1) {
  const s = hud.slots;
  let i = Math.max(0, s.indexOf(hud.world.tool));
  for (let k = 0; k < HOTBAR_SIZE; k++) {
    i = (i + dir + HOTBAR_SIZE) % HOTBAR_SIZE;
    if (s[i]) return selectTool(hud, s[i]!);
  }
}

export function selectTool(hud: Hud, t: Tool) {
  const wasTerra = !!hud.world.paint?.terra;
  if (t === 'pick' || t === 'spade') {
    const permit = PERMIT_BY_ID[HOTBAR_INFO[t].permit as PermitId];
    // Builders and residents use the owner's permits (the server checks).
    if (!hasPermit(permit.id) && state.room?.role === 'owner') return hud.toast(`You need a ${permit.name} – buy it at the Town Hall.`, 'warn');
    if (!state.room?.canBuild) return hud.toast('You can only reshape your own island.', 'warn');
    hud.world.tool = t;
    hud.world.startTerra(hud.terraOp[t]);
    hud.setPrompt('');
  } else {
    hud.world.tool = t;
    if (wasTerra) {
      hud.world.stopPaint();
      hud.setPrompt(hud.world.target?.label ?? null);
    }
  }
  renderHotbar(hud);
}

/** R / Ⓨ while terraforming: next operation of the same tool. */
export function cycleTerra(hud: Hud) {
  const op = hud.world.paint?.terra;
  if (!op) return;
  const permit = TERRA_PERMIT[op];
  const ops = PERMIT_BY_ID[permit].ops;
  const next = ops[(ops.indexOf(op) + 1) % ops.length];
  const tool = permit === 'permit_cliff' ? 'pick' : 'spade';
  hud.terraOp[tool] = next;
  hud.world.startTerra(next);
  hud.setPrompt('');
  hud.toast(`${TERRA_INFO[next].icon} ${TERRA_INFO[next].name}`);
}

/** Hotbar editor (works with mouse and controller): one dropdown per slot. */
export function hotbarEditor(hud: Hud, b: HTMLElement) {
  const row = h('div', { class: 'hotbar-edit' });
  hud.slots.forEach((cur, i) => {
    const sel = h('select', { title: `Slot ${(i + 1) % 10}`, onchange: () => assignSlot(hud, i, (sel.value || null) as HotbarTool | null) },
      h('option', { value: '' }, `${(i + 1) % 10}: –`),
      HOTBAR_TOOLS.map((t) => h('option', { value: t, selected: cur === t }, `${(i + 1) % 10}: ${HOTBAR_INFO[t].icon} ${HOTBAR_INFO[t].name}${toolOwned(t) ? '' : ' (not owned)'}`))) as HTMLSelectElement;
    row.append(sel);
  });
  b.append(h('h3', {}, '🧰 Hotbar'), h('p', { class: 'muted' }, 'Choose a tool for each slot (picking one already in use swaps them). You can also right-click or drag slots on the hotbar.'), row);
}
