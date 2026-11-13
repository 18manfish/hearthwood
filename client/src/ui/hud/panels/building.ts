// Counters inside buildings: town hall services, shops and their stock.

import { type Building, BUILDINGS, type BuildingType, ENTERABLE, equip, outfitOf, type Outfit, HOUSE_TIERS, houseLevel, ITEMS, type Look, MAX_HOUSE_LEVEL, MYSTERY_TOUR_COST, PERMITS, SHOP_STOCK } from '@hearthwood/shared';
import { net } from '../../../net.ts';
import { state } from '../../../state.ts';
import { lookEditor, Preview } from '../../creator.ts';
import { h } from '../../dom.ts';
import { hasPermit, have } from '../common.ts';
import { bagPanel } from './bag.ts';
import { craftPanel } from './craft.ts';
import { islandPanel } from './island.ts';
import { billboardPanel, letterTo, mailPanel } from './mail.ts';
import { travelTo } from './map.ts';
import type { Hud } from '../../hud.ts';

export function openBuilding(hud: Hud, bld: Building) {
  const def = BUILDINGS[bld.type];
  const now = net.serverNow();
  if (bld.completeAt > now) {
    const mins = Math.ceil((bld.completeAt - now) / 60000);
    return hud.toast(`${def.name} will be ready in ${mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins} min`}.`);
  }
  const room = state.room!;
  const own = room.role === 'owner' || room.role === 'resident';
  // Every enterable building opens its interior; services are at the counter inside.
  if (ENTERABLE.includes(bld.type)) return travelTo(hud, { kind: 'enter', id: bld.id });
  const service: BuildingType = bld.type === 'counter' && bld.role ? bld.role : bld.type;
  switch (service) {
    case 'dock':
      if (room.kind === 'tour') return travelTo(hud, { kind: 'home' });
      return hud.open('map');
    case 'campfire':
      if (!own) return hud.toast('A cosy campfire.');
      return hud.live('🔥 Campfire cooking', null, (b) => craftPanel(hud, b, ['campfire']));
    case 'workbench':
      if (!own) return hud.toast('A sturdy workbench.');
      return hud.live('🛠️ Workbench', null, (b) => craftPanel(hud, b, ['hand', 'workbench']));
    case 'restaurant':
      if (!own) return hud.toast('“Sorry, the kitchen is for the chef only!”');
      return hud.live('🍽️ Restaurant kitchen', null, (b) => craftPanel(hud, b, ['restaurant', 'campfire']));
    case 'exit':
      return travelTo(hud, { kind: 'exit' });
    case 'bed':
      return hud.toast(room.interior === 'tent' ? 'You curl up in the sleeping bag for a moment… zZz' : 'You stretch out on the comfy bed… zZz', 'good');
    case 'chest':
      if (!own) return hud.toast('That’s not your chest.');
      return hud.live('🧰 Storage chest', null, (b) => {
        b.append(h('h3', {}, 'Sell box'));
        bagPanel(hud, b);
      });
    case 'town_hall':
      return hud.live('🏛️ Town Hall', null, (b) => {
        if (own) {
          const vs = state.quest?.villagers ?? 0;
          b.append(h('p', {}, `Welcome, mayor! ${vs}/7 villagers live here.`));
          houseUpgrade(hud, b);
          b.append(h('h3', {}, '📜 Permits'));
          const pg = h('div', { class: 'grid' });
          for (const pm of PERMITS) {
            const owned = hasPermit(pm.id);
            pg.append(h('div', { class: `tile${owned ? '' : state.coins < pm.price ? ' locked' : ''}` },
              h('div', { class: 'row' }, h('span', { class: 'ico' }, pm.icon), h('div', {}, h('div', { class: 'nm' }, pm.name), h('div', { class: 'muted' }, pm.desc))),
              h('button', { class: 'btn small', disabled: owned || state.coins < pm.price, onclick: () => hud.act({ k: 'permit', id: pm.id }) }, owned ? 'Owned ✓' : `🪙 ${pm.price}`)));
          }
          b.append(pg, h('h3', {}, 'Sell goods'));
          bagPanel(hud, b);
          b.append(h('hr'));
          islandPanel(hud, b);
        } else b.append(h('p', {}, `Welcome to the Town Hall! The mayor is ${room.ownerName}.`));
      });
    case 'tool_store':
    case 'furniture_store':
      return hud.live(`${BUILDINGS[service].icon} ${BUILDINGS[service].name}`, null, (b) => shopPanel(hud, b, service));
    case 'clothing_shop': {
      // Rendered once (it hosts a live 3D preview).
      const body = h('div');
      shopPanel(hud, body, service);
      return hud.frame(`${BUILDINGS[service].icon} ${BUILDINGS[service].name}`, body);
    }
    case 'billboard':
      return hud.live('📌 Billboard', null, (b) => billboardPanel(hud, b));
    case 'mailbox':
      if (room.kind === 'shared') return hud.live(`📮 ${room.name} mailbox`, null, (b) => mailPanel(hud, b, true));
      if (own) return hud.live('📮 Your mailbox', null, (b) => mailPanel(hud, b, true));
      return hud.live(`📮 ${room.ownerName}’s mailbox`, null, (b) => letterTo(hud, b, room.ownerId!, room.ownerName ?? 'them'));
    case 'travel_agent':
      return hud.live('✈️ Travel Agent', null, (b) => {
        b.append(h('p', {}, 'Fancy an adventure? A mystery tour takes you to a random, untouched island packed with resources. Gather everything you like, then return via the dock.'),
          h('button', { class: 'btn', disabled: !own, onclick: () => travelTo(hud, { kind: 'tour' }) }, `🎫 Mystery tour (${MYSTERY_TOUR_COST} coins)`),
          h('button', { class: 'btn ghost', style: 'margin-left:8px', onclick: () => hud.open('map') }, '🗺️ World map'));
      });
  }
}

export function shopPanel(hud: Hud, b: HTMLElement, type: BuildingType) {
  const stock = SHOP_STOCK[type] ?? [];
  b.append(h('p', { class: 'muted' }, `You have 🪙 ${state.coins.toLocaleString()}`));
  const grid = h('div', { class: 'grid' });
  for (const id of stock) {
    const it = ITEMS[id];
    grid.append(h('div', { class: 'tile' }, h('span', { class: 'ico' }, it.icon), h('div', { class: 'nm' }, it.name), h('div', { class: 'muted' }, `🪙 ${it.buy}${have(id) ? ` · own ${have(id)}` : ''}`),
      h('div', { class: 'row' },
        h('button', { class: 'btn small', disabled: state.coins < (it.buy ?? 0), onclick: () => hud.act({ k: 'buy', shop: type, item: id, n: 1 }) }, 'Buy'),
        it.wear && type === 'clothing_shop' ? h('button', { class: 'btn ghost small', 'data-try': id }, 'Try on') : '')));
  }
  b.append(grid);
  if (type === 'clothing_shop' && state.self) {
    const self = state.self;
    const look: Look = { ...self.look };
    const prevEl = h('div', { class: 'preview', style: 'height:260px;position:relative;border-radius:16px;background:#eef7e6' });
    b.append(h('h3', { style: 'margin-top:14px' }, '💇 Makeover (200 coins)'));
    // Try clothes on before buying them.
    let trying: Outfit = outfitOf(self);
    const ed = lookEditor(() => self.gender, look, () => prev.set(self.gender, look, trying));
    b.append(h('div', { class: 'row', style: 'align-items:flex-start' }, h('div', { style: 'width:200px' }, prevEl), ed.root));
    b.append(h('button', { class: 'btn', onclick: () => hud.act({ k: 'restyle', look }) }, 'Apply makeover'));
    const prev = new Preview(prevEl);
    prev.set(self.gender, look, trying);
    hud.preview = prev;
    for (const btn of grid.querySelectorAll<HTMLElement>('[data-try]')) {
      btn.onclick = () => {
        trying = equip(trying, btn.dataset.try!);
        prev.set(self.gender, look, trying);
      };
    }
  }
}

/** Town Hall: your Starter House tier and the next upgrade. */
function houseUpgrade(hud: Hud, b: HTMLElement) {
  const house = state.quest?.house;
  b.append(h('h3', {}, '🏠 Your house'));
  if (!house) {
    b.append(h('p', { class: 'muted' }, 'Build your Starter House first – then the builders here can make it grander.'));
    return;
  }
  const now = net.serverNow();
  const level = houseLevel(house, now);
  const cur = HOUSE_TIERS[level - 1];
  const box = h('div', { class: 'tile', style: 'text-align:left' },
    h('div', { class: 'row' }, h('span', { class: 'ico' }, cur.icon), h('div', {}, h('div', { class: 'nm' }, `${cur.name} · tier ${level} of ${MAX_HOUSE_LEVEL}`), h('div', { class: 'muted' }, cur.description))));
  b.append(box);
  if (house.upgrade && house.upgrade.at > now) {
    const next = HOUSE_TIERS[house.upgrade.level - 1];
    const mins = Math.ceil((house.upgrade.at - now) / 60000);
    box.append(h('p', {}, `🏗️ Becoming the ${next.name} – ready in ${mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins} min`}.`));
    return;
  }
  const next = HOUSE_TIERS[level];
  if (!next) {
    box.append(h('p', {}, '✨ The grandest house on the island!'));
    return;
  }
  const day = state.quest?.islandDay ?? 1;
  // Upgrades are ordered here, so the Town Hall requirement is met; the server checks the rest.
  const missing = day < next.minDay ? [`island day ${next.minDay}`] : [];
  const enough = Object.entries(next.cost).every(([id, n]) => have(id) >= n) && state.coins >= next.coins;
  box.append(
    h('p', { style: 'margin:10px 0 4px' }, h('b', {}, `Next: ${next.icon} ${next.name}`), h('br'), h('span', { class: 'muted' }, next.description)),
    h('div', { class: 'row', style: 'gap:6px;margin:6px 0' },
      h('span', { class: `pill${state.coins >= next.coins ? ' ok' : ' no'}` }, `🪙 ${next.coins.toLocaleString()}`),
      Object.entries(next.cost).map(([id, n]) => h('span', { class: `pill${have(id) >= n ? ' ok' : ' no'}`, title: ITEMS[id]?.name ?? id }, `${ITEMS[id]?.icon ?? ''} ${have(id)}/${n}`))),
    h('div', { class: 'muted' }, `Takes about ${next.buildMinutes >= 60 ? `${Math.round(next.buildMinutes / 60)}h` : `${next.buildMinutes} min`} · bigger interior (${next.interior}×${next.interior}) · you can keep living there meanwhile.`),
    missing.length ? h('p', { class: 'muted' }, `Unlocks with ${missing.join(' and ')}.`) : '',
    h('button', { class: 'btn', style: 'margin-top:8px', disabled: !enough || missing.length > 0, onclick: () => { if (confirm(`Upgrade to the ${next.name}?`)) hud.act({ k: 'upgrade' }); } }, `⬆️ Upgrade to ${next.name}`));
}
