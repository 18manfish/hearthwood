// 🐞 Developer debug panel (F3): live stats and dev commands.

import { BIOMES, DEV_COMMANDS, type DevCommand, ITEM_LIST, type Season, SEASONS_BY_MODEL, type Weather } from '@hearthwood/shared';
import { debug } from '../../../game/World.ts';
import { net } from '../../../net.ts';
import { state } from '../../../state.ts';
import { h } from '../../dom.ts';
import type { Hud } from '../../hud.ts';

export function debugPanel(hud: Hud) {
  const body = h('div', { class: 'col' });
  const stats = h('pre', { style: 'margin:0;background:#2b2118;color:#d7f5c4;padding:10px 12px;border-radius:12px;font-size:12px;line-height:1.45;white-space:pre-wrap' });
  const w = hud.world;
  const drawStats = () => {
    const me = w.me;
    const g = w.grid;
    const tx = me ? Math.floor(me.x) : 0, tz = me ? Math.floor(me.z) : 0;
    const info = (w.renderer as unknown as { info?: { render?: { calls?: number; triangles?: number } } }).info?.render;
    const env = state.env;
    stats.textContent = [
      `FPS ${debug.fps}   ping ${net.rtt} ms   clock offset ${Math.round(net.clockOffset)} ms`,
      `room ${state.room?.id} (${state.room?.kind}${state.room?.interior ? ':' + state.room.interior : ''})  biome ${state.room?.biome}`,
      me && g ? `pos ${me.x.toFixed(2)}, ${me.z.toFixed(2)}  tile ${tx},${tz}  type ${g.tile(tx, tz)}  level ${g.level(tx, tz)}  ramp ${g.ramp(tx, tz)}  y ${g.surfaceY(me.x, me.z).toFixed(2)}` : 'pos –',
      `objects ${w.objects.size}  buildings ${w.buildings.size}  players ${w.players.size}  target ${w.target?.label ?? '–'}`,
      env ? `env ${env.season} / ${env.weather} (${Math.round(env.intensity * 100)}%) ${env.tempC}°C  day ${env.islandDay}  ${env.dayKey} ${env.hour}:${String(env.minute).padStart(2, '0')} ${env.geo.tz} (${env.geo.lat}, ${env.geo.lon})` : '',
      info ? `draw calls ${info.calls ?? '?'}  triangles ${info.triangles ?? '?'}` : '',
      `server dev mode: ${state.dev ? 'ON' : 'off (start with npm run dev:fast for server commands)'}`,
    ].filter(Boolean).join('\n');
  };
  drawStats();
  hud.debugTimer = setInterval(drawStats, 400);

  const slider = (label: string, min: number, max: number, step: number, get: () => number, set: (v: number) => void, fmt = (v: number) => v.toFixed(3)) => {
    const out = h('span', { class: 'muted' }, fmt(get()));
    const inp = h('input', { type: 'range', min, max, step, value: String(get()), style: 'flex:1', oninput: (e: Event) => { const v = Number((e.target as HTMLInputElement).value); set(v); out.textContent = fmt(v); } });
    return h('div', { class: 'row' }, h('b', { style: 'width:150px' }, label), inp, out);
  };
  const toggle = (label: string, get: () => boolean, set: (v: boolean) => void) =>
    h('label', { class: 'row', style: 'cursor:pointer' }, h('input', { type: 'checkbox', checked: get(), onchange: (e: Event) => set((e.target as HTMLInputElement).checked) }), label);
  const weathers: Weather[] = ['clear', 'cloudy', 'rain', 'storm', 'snow', 'fog', 'sandstorm', 'heatwave'];
  const dev = (cmd: DevCommand, ...args: (string | number)[]) => net.send({ t: 'dev', cmd, args: args.map(String) });
  const visWeather = h('select', { onchange: (e: Event) => { const v = (e.target as HTMLSelectElement).value; debug.weather = v ? (v as Weather) : null; } },
    h('option', { value: '' }, '(real weather)'), weathers.map((x) => h('option', { value: x, selected: debug.weather === x }, x))) as HTMLSelectElement;

  // Season: on a dev server this changes the island for real (fish, weather,
  // visuals for everyone); otherwise it is a local visual preview.
  const model = state.room ? BIOMES[state.room.biome].seasonModel : 'temperate';
  const seasonSel = h('select', {
    onchange: (e: Event) => {
      const v = (e.target as HTMLSelectElement).value;
      if (state.dev) {
        debug.season = null;
        dev('season', v || 'normal');
      } else debug.season = v ? (v as Season) : null;
    },
  }, h('option', { value: '' }, `(real: ${state.env?.season ?? '?'})`),
    SEASONS_BY_MODEL[model].map((x) => h('option', { value: x, selected: (debug.season ?? null) === x }, x))) as HTMLSelectElement;
  const seasonRow = h('div', { class: 'row' }, h('b', { style: 'width:150px' }, 'Season'), seasonSel,
    h('span', { class: 'muted' }, state.dev ? 'applies to the whole island (fish, weather, visuals)' : 'visual preview only'));

  body.append(
    stats,
    h('h3', {}, 'Season'),
    seasonRow,
    h('h3', {}, 'Client (visual only)'),
    slider('World bend', 0, 0.03, 0.0005, () => debug.bend, (v) => (debug.bend = v)),
    slider('Time of day shift', -12, 12, 0.25, () => debug.timeOffsetH, (v) => (debug.timeOffsetH = v), (v) => `${v >= 0 ? '+' : ''}${v}h`),
    h('div', { class: 'row' }, h('b', { style: 'width:150px' }, 'Weather preview'), visWeather),
    h('div', { class: 'row', style: 'gap:16px' },
      toggle('Shadows', () => debug.shadows, (v) => (debug.shadows = v)),
      toggle('Name labels', () => debug.labels, (v) => (debug.labels = v)),
      toggle('Collision grid', () => debug.grid, (v) => { debug.grid = v; w.toggleGridOverlay(v); })),
  );

  const give = h('select', {}, ITEM_LIST.map((it) => h('option', { value: it.id }, `${it.icon} ${it.name}`))) as HTMLSelectElement;
  const qty = h('input', { type: 'number', value: '10', min: 1, max: 999, style: 'width:70px' }) as HTMLInputElement;
  const srvWeather = h('select', {}, h('option', { value: 'normal' }, '(normal)'), weathers.map((x) => h('option', { value: x }, x))) as HTMLSelectElement;
  const b = (label: string, fn: () => void) => h('button', { class: 'btn small', disabled: !state.dev, onclick: fn }, label);
  body.append(
    h('h3', { style: 'margin-top:6px' }, 'Server (dev mode)'),
    state.dev ? '' : h('p', { class: 'muted' }, 'These need the server running with DEV_FAST=1 (npm run dev:fast).'),
    h('div', { class: 'row' }, b('🧰 Material kit', () => dev('kit')), b('🪙 +1000', () => dev('coins', 1000)), b('🪙 +10000', () => dev('coins', 10000)), b('🗑️ Empty pockets', () => dev('clearinv')), b('📜 All permits', () => dev('permits')), b('🐦 Land birds', () => dev('birds', 4))),
    h('div', { class: 'row' }, b('📅 Day +1', () => dev('day', 1)), b('Day +7', () => dev('day', 7)), b('Day +30', () => dev('day', 30)), b('⏩ Finish building & growth', () => dev('finish')), b('♻️ Respawn resources', () => dev('respawn'))),
    h('div', { class: 'row' }, give, qty, b('Give', () => dev('give', give.value, Math.max(1, Math.min(999, Number(qty.value) || 1))))),
    h('div', { class: 'row' }, h('b', {}, 'Island weather'), srvWeather, b('Set (30 min)', () => dev('weather', srvWeather.value))),
    h('div', { class: 'row' }, b('📍 Teleport to spawn', () => state.room && dev('tp', state.room.spawn.x, state.room.spawn.z)),
      b('🏠 Go home', () => net.send({ t: 'travel', to: { kind: 'home' } }))),
    h('p', { class: 'muted' }, `Chat shortcuts: ${DEV_COMMANDS.map((c) => '/' + c).join(' ')}`),
  );
  hud.frame('🐞 Developer debug', body, 'debug');
}
