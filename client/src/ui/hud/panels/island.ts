// ⚙️ Options & island panel: account, visitors, roles, location and time zone.

import { type Access } from '@hearthwood/shared';
import { logout } from '../../../auth.ts';
import { net } from '../../../net.ts';
import { state } from '../../../state.ts';
import { h } from '../../dom.ts';
import { travelTo } from './map.ts';
import type { Hud } from '../../hud.ts';
import { fpsVisible, setFpsVisible } from '../fps.ts';
import { namesVisible, setNamesVisible } from '../names.ts';

export function islandPanel(hud: Hud, b: HTMLElement) {
  const self = state.self;
  if (!self) return;
  accountBox(hud, b);
  displayBox(b);
  const opts: [Access, string, string][] = [
    ['private', '🔒 Nobody', 'Only you.'],
    ['friends', '💌 Friends', 'Everyone on your friend list.'],
    ['invite', '🎟️ Friends + invite code', 'Friends, plus anyone you give the code to.'],
    ['public', '🌍 Everyone', 'Listed on the world map for all players.'],
  ];
  b.append(h('h3', {}, 'Who may visit your island?'), h('div', { class: 'list' }, opts.map(([a, label, desc]) => h('label', { class: 'item', style: 'cursor:pointer' },
    h('div', {}, h('b', {}, label), h('div', { class: 'muted' }, desc)),
    h('input', { type: 'radio', name: 'access', checked: self.access === a, onchange: () => net.send({ t: 'access', access: a }) })))));
  b.append(h('div', { class: 'row', style: 'margin-top:10px' }, 'Invite code:', h('span', { class: 'pill', style: 'font-size:16px' }, self.inviteCode ?? '–'),
    h('button', { class: 'btn ghost small', onclick: () => navigator.clipboard?.writeText(self.inviteCode ?? '') }, 'Copy'),
    h('button', { class: 'btn ghost small', onclick: () => net.send({ t: 'newInvite' }) }, 'New code')),
    h('p', { class: 'muted' }, 'Generating a new code invalidates the old one.'));
  const room = state.room;
  if (room && room.ownerId === self.id) {
    const visitors = [...hud.world.players.entries()].filter(([id]) => id !== self.id);
    b.append(h('h3', { style: 'margin-top:10px' }, `Visitors here (${visitors.length})`),
      h('div', { class: 'list' }, visitors.map(([id, p]) => h('div', { class: 'item' }, p.label.element.textContent ?? id, h('button', { class: 'btn warn small', onclick: () => net.send({ t: 'kick', id }) }, 'Send home')))));
  }
  rolesBox(hud, b);
  geoBox(hud, b);
  if (state.dev) b.append(h('p', { class: 'muted', style: 'margin-top:12px' }, 'Dev mode: chat /kit, /give <item> [n], /coins [n], /day [n], /finish'));
}

/** Screen options that only affect this browser. */
function displayBox(b: HTMLElement) {
  const toggle = (label: string, desc: string, on: boolean, set: (v: boolean) => void) => {
    const box = h('input', { type: 'checkbox', checked: on, onchange: () => set(box.checked) }) as HTMLInputElement;
    return h('label', { class: 'item', style: 'cursor:pointer' }, h('div', {}, h('b', {}, label), h('div', { class: 'muted' }, desc)), box);
  };
  b.append(h('h3', { style: 'margin-top:10px' }, '🖥️ Display'),
    h('div', { class: 'list' },
      toggle('Show names', 'Player and villager names above their heads.', namesVisible(), (v) => setNamesVisible(v)),
      toggle('Show FPS counter', 'Frames per second, in the bottom-right corner.', fpsVisible(), (v) => setFpsVisible(v))));
}

/** Friends who may build on / live on your island, and islands you help on. */
export function rolesBox(hud: Hud, b: HTMLElement) {
  const self = state.self!;
  b.append(h('h3', { style: 'margin-top:14px' }, '👷 Builders & residents'),
    h('p', { class: 'muted' }, 'Builders may build, pave, terraform and place furniture on your island. Residents live there: they can also gather, use your workbench and shops, and build their own tent and house – everything you can, except managing visitors.'));
  if (!state.friends.length) b.append(h('p', { class: 'muted' }, 'Add friends (O) first.'));
  else b.append(h('div', { class: 'list' }, state.friends.map((f) => {
    const cur: string = self.islandRoles[f.id] ?? 'none';
    const sel = h('select', { onchange: () => net.send({ t: 'role', id: f.id, role: sel.value as 'none' | 'builder' | 'resident' }) },
      h('option', { value: 'none', selected: cur === 'none' }, 'Visitor'),
      h('option', { value: 'builder', selected: cur === 'builder' }, '🔨 Builder'),
      h('option', { value: 'resident', selected: cur === 'resident' }, '🏡 Resident')) as HTMLSelectElement;
    return h('div', { class: 'item' }, h('span', {}, `${f.online ? '🟢' : '⚪'} ${f.name}`), sel);
  })));
  if (self.helping.length) {
    b.append(h('h3', { style: 'margin-top:14px' }, '🧭 Islands you help on'), h('div', { class: 'list' }, self.helping.map((i) => h('div', { class: 'item' },
      h('div', {}, h('b', {}, i.name), h('div', { class: 'muted' }, `${i.owner}’s island · ${i.role === 'resident' ? '🏡 resident' : '🔨 builder'}`)),
      h('button', { class: 'btn small', onclick: () => { hud.close(); travelTo(hud, { kind: 'island', id: i.id }); } }, 'Go there')))));
  }
}

/** Where you are in the world: drives your island's sun, seasons and clock. */
export function geoBox(hud: Hud, b: HTMLElement) {
  const self = state.self!;
  const zones = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') ?? [self.geo.tz];
  if (!zones.includes(self.geo.tz)) zones.unshift(self.geo.tz);
  const tz = h('select', {}, zones.map((z) => h('option', { value: z, selected: z === self.geo.tz }, z.replace(/_/g, ' ')))) as HTMLSelectElement;
  const lat = h('input', { type: 'number', step: '0.5', min: -90, max: 90, value: String(self.geo.lat), style: 'width:90px' }) as HTMLInputElement;
  const lon = h('input', { type: 'number', step: '0.5', min: -180, max: 180, value: String(self.geo.lon), style: 'width:90px' }) as HTMLInputElement;
  const note = h('span', { class: 'muted' });
  b.append(h('h3', { style: 'margin-top:14px' }, '📍 Location & time zone'),
    h('p', { class: 'muted' }, 'Your island follows the real sun, seasons and clock of this place (stored roughly, to the nearest ~50 km).'),
    h('div', { class: 'col' },
      h('label', { class: 'row' }, 'Time zone', tz),
      h('label', { class: 'row' }, 'Latitude', lat, 'Longitude', lon),
      h('div', { class: 'row' },
        h('button', { class: 'btn ghost small', onclick: () => {
          const z = Intl.DateTimeFormat().resolvedOptions().timeZone;
          if (z) tz.value = z;
          note.textContent = navigator.geolocation ? 'Asking your browser…' : 'This browser can’t share a location.';
          navigator.geolocation?.getCurrentPosition(
            (p) => { lat.value = String(Math.round(p.coords.latitude * 2) / 2); lon.value = String(Math.round(p.coords.longitude * 2) / 2); note.textContent = 'Found you – press Save.'; },
            () => { note.textContent = 'Location not shared – time zone set, enter coordinates by hand.'; },
            { timeout: 8000 });
        } }, '📡 Use this device'),
        h('button', { class: 'btn small', onclick: () => {
          const la = Number(lat.value), lo = Number(lon.value);
          if (!Number.isFinite(la) || !Number.isFinite(lo) || Math.abs(la) > 90 || Math.abs(lo) > 180) return hud.toast('Latitude −90…90, longitude −180…180.', 'warn');
          net.send({ t: 'geo', lat: la, lon: lo, tz: tz.value });
        } }, 'Save'),
        note)));
}

/** Who you're logged in as, log-out and links to the tools. */
export function accountBox(hud: Hud, b: HTMLElement) {
  const self = state.self!;
  b.append(h('div', { class: 'row', style: 'justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:12px' },
    h('div', {}, h('b', {}, self.username ? `👤 ${self.username}` : '👤 Guest (dev mode)'), h('div', { class: 'muted' }, `Friend code ${self.code}`)),
    h('div', { class: 'row', style: 'gap:6px' },
      self.admin ? h('a', { class: 'btn ghost small', href: '/admin.html', target: '_blank' }, '🛡️ Admin tool') : null,
      state.dev ? h('a', { class: 'btn ghost small', href: '/editor.html', target: '_blank' }, '🛠️ Game creation tool') : null,
      h('button', { class: 'btn ghost small', onclick: async () => { await logout(); location.reload(); } }, 'Log out'))));
}
