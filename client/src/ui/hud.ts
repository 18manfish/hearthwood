// In-game HUD and menus. All buttons only *ask* the server; results come back
// as messages that update `state`, which re-renders the relevant UI.

import {
  BUILDINGS, BUILDABLE, CHAPTERS, ITEMS, ITEM_LIST, MYSTERY_TOUR_COST, RECIPES, SHOP_STOCK, SHARED_LOCATIONS, VILLAGER_HOUSE_MONTH_ONE_LIMIT,
  VILLAGER_HOUSE_MONTH_TWO_MIN_DAY, BIOMES, localTime, villagerDef, friendshipLevel, FRIENDSHIP_LEVELS,
  type Access, type Building, type BuildingType, type Ingredient, type RecipeDef, type TalkView, type MapIsland, type Look, type TravelTarget,
} from '@hearthwood/shared';
import { net } from '../net.ts';
import { state, watch } from '../state.ts';
import { debug, type World, type Tool } from '../game/World.ts';
import { DEV_COMMANDS, SEASONS_BY_MODEL, type DevCommand, type Weather, type Season } from '@hearthwood/shared';
import { h, clear } from './dom.ts';
import { renderWorldMap, BIOME_ICON } from './map.ts';
import { lookEditor, Preview } from './creator.ts';

const WEATHER_ICON: Record<string, string> = { clear: '☀️', cloudy: '☁️', rain: '🌧️', storm: '⛈️', snow: '❄️', fog: '🌫️', sandstorm: '🌪️', heatwave: '🔥' };
const SEASON_ICON: Record<string, string> = { spring: '🌸', summer: '🌻', autumn: '🍂', winter: '⛄', wet: '🌧️', dry: '🌞', hot: '🔆', cool: '🌙' };

type PanelId = 'goals' | 'bag' | 'craft' | 'build' | 'map' | 'friends' | 'mail' | 'island' | 'debug';

function have(id: string) {
  return state.inv[id] ?? 0;
}

function tagCount(tag: string) {
  let n = 0;
  for (const [id, q] of Object.entries(state.inv)) if (ITEMS[id]?.tags.includes(tag as never) && ITEMS[id].category !== 'tool') n += q;
  return n;
}

function ingLabel(ing: Ingredient) {
  if ('item' in ing) return { label: `${ITEMS[ing.item].icon} ${ITEMS[ing.item].name}`, have: have(ing.item), need: ing.qty };
  return { label: `any ${ing.tag}`, have: tagCount(ing.tag), need: ing.qty };
}

export class Hud {
  readonly root = h('div', { class: 'hud' });
  private loc = h('div', { class: 'loc' });
  private coins = h('div', { class: 'coins' });
  private hotbar = h('div', { class: 'hotbar' });
  private prompt = h('div', { class: 'prompt', style: 'display:none' });
  private log = h('div', { class: 'log' });
  readonly chatInput = h('input', { placeholder: 'Press Enter to chat…', maxlength: 140 }) as HTMLInputElement;
  private toasts = h('div', { class: 'toasts' });
  private panelHost = h('div');
  private dialogHost = h('div');
  private badges: Record<string, HTMLElement> = {};
  panel: PanelId | null = null;
  private panelRefresh: (() => void) | null = null;
  talkingTo: string | null = null;

  constructor(app: HTMLElement, private world: World) {
    const btn = (icon: string, key: string, id: PanelId, title: string) => {
      const badge = h('span', { class: 'badge', style: 'display:none' });
      this.badges[id] = badge;
      return h('button', { class: 'iconbtn', title, onclick: () => this.toggle(id) }, icon, h('span', { class: 'key' }, key), badge);
    };
    this.root.append(
      this.loc,
      h('div', { class: 'topbar' }, this.coins,
        btn('📜', 'G', 'goals', 'Goals'), btn('🎒', 'I', 'bag', 'Pockets'), btn('🔨', 'C', 'craft', 'Craft'),
        btn('🏗️', 'B', 'build', 'Build'), btn('🗺️', 'M', 'map', 'World map'), btn('💌', 'O', 'friends', 'Friends'),
        btn('📬', 'L', 'mail', 'Mail'), btn('⚙️', 'V', 'island', 'Island & visitors'), btn('🐞', 'F3', 'debug', 'Developer debug')),
      this.hotbar,
      this.prompt,
      h('div', { class: 'chat' }, this.log, this.chatInput),
      this.toasts,
      this.dialogHost,
      this.panelHost,
    );
    app.appendChild(this.root);

    this.chatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const text = this.chatInput.value.trim();
        if (text) net.send({ t: 'chat', text });
        this.chatInput.value = '';
        this.chatInput.blur();
      }
      if (e.key === 'Escape') this.chatInput.blur();
      e.stopPropagation();
    });

    watch(['self', 'inv', 'coins', 'room', 'env', 'quest'], () => this.render());
    watch(['mail', 'friends', 'incoming'], () => this.renderBadges());
    watch(['*'], () => this.panelRefresh?.());
    setInterval(() => this.renderLoc(), 1000);
    world.onTarget = (t) => this.setPrompt(t ? t.label : null, t?.kind === 'reel' && !!world.cast?.bite);
    this.render();
  }

  // ── Small widgets ───────────────────────────────────────────────────────
  toast(text: string, kind: 'info' | 'good' | 'warn' = 'info') {
    const t = h('div', { class: `toast ${kind}` }, text);
    this.toasts.appendChild(t);
    setTimeout(() => t.remove(), 3500);
    while (this.toasts.children.length > 4) this.toasts.firstChild!.remove();
  }

  gain(g: Record<string, number> | undefined) {
    if (!g) return;
    let i = 0;
    for (const [id, n] of Object.entries(g)) {
      const el = h('div', { class: 'gain', style: `left:calc(50% + ${i * 50 - 20}px);top:calc(50% - ${60 + i * 6}px)` }, `+${n} ${ITEMS[id]?.icon ?? ''}`);
      this.root.appendChild(el);
      setTimeout(() => el.remove(), 1300);
      i++;
    }
  }

  chat(name: string, text: string, sys = false) {
    const line = h('div', { class: sys ? 'sys' : '' }, sys ? `✨ ${text}` : h('b', {}, `${name}: `), sys ? null : text);
    this.log.appendChild(line);
    while (this.log.children.length > 60) this.log.firstChild!.remove();
    this.log.scrollTop = this.log.scrollHeight;
  }

  setPrompt(text: string | null, bite = false) {
    if (this.world.ghost) {
      text = this.world.ghost.type === 'build' ? 'Click to build here · Esc to cancel' : 'E / click to place · R to rotate · Esc to cancel';
    }
    if (!text) {
      this.prompt.style.display = 'none';
      return;
    }
    this.prompt.style.display = '';
    this.prompt.className = `prompt${bite ? ' bite' : ''}`;
    clear(this.prompt);
    this.prompt.append(h('kbd', {}, 'E'), text);
  }

  isTyping() {
    const a = document.activeElement;
    return !!a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT');
  }

  // ── HUD rendering ───────────────────────────────────────────────────────
  private render() {
    this.coins.textContent = `🪙 ${state.coins.toLocaleString()}`;
    this.renderLoc();
    this.renderHotbar();
    this.renderBadges();
  }

  private renderLoc() {
    const env = state.env;
    const room = state.room;
    if (!env || !room) return;
    const lt = localTime(net.serverNow(), env.geo.tz);
    clear(this.loc);
    const owner = room.kind === 'island' ? (room.ownerId === state.self?.id ? 'Your island' : `${room.ownerName}’s island`) : room.kind === 'shared' ? 'Shared location' : room.kind === 'interior' ? 'Indoors' : 'Mystery tour';
    this.loc.append(
      h('div', { class: 'name' }, `${BIOME_ICON[room.biome]} ${room.name}`),
      h('div', { class: 'muted' }, owner + (room.kind === 'island' ? ` · Day ${env.islandDay}` : '')),
      h('div', { class: 'clock' }, `${String(lt.hour).padStart(2, '0')}:${String(lt.minute).padStart(2, '0')}`),
      h('div', {}, `${SEASON_ICON[env.season]} ${cap(env.season)} · ${WEATHER_ICON[env.weather]} ${cap(env.weather)} · ${Math.round(env.tempC)}°C`),
    );
  }

  renderHotbar() {
    clear(this.hotbar);
    const slots: [Tool, string, boolean, number?][] = [
      ['hand', '✋', true],
      ['axe', '🪓', have('stone_axe') + have('iron_axe') > 0],
      ['shovel', '⛏️', have('shovel') + have('iron_shovel') > 0],
      ['rod', '🎣', have('fishing_rod') + have('pro_rod') > 0],
      ['sapling', '🌱', have('sapling') > 0, have('sapling')],
    ];
    slots.forEach(([tool, icon, owned, n], i) => {
      this.hotbar.appendChild(h('button', { class: `slot${this.world.tool === tool ? ' sel' : ''}${owned ? '' : ' off'}`, title: tool, onclick: () => this.selectTool(tool) },
        h('span', { class: 'k' }, String(i + 1)), icon, n ? h('span', { class: 'n' }, String(n)) : null));
    });
  }

  selectTool(t: Tool) {
    this.world.tool = t;
    this.renderHotbar();
  }

  private renderBadges() {
    const set = (id: string, n: number) => {
      const b = this.badges[id];
      if (!b) return;
      b.style.display = n ? '' : 'none';
      b.textContent = String(n);
    };
    set('mail', state.mail.length);
    set('friends', state.incoming.length);
    const q = state.quest;
    set('goals', q && q.chapter <= CHAPTERS.length ? q.done.filter((d) => !d).length : 0);
  }

  // ── Panels ──────────────────────────────────────────────────────────────
  toggle(id: PanelId) {
    if (this.panel === id) this.close();
    else this.open(id);
  }

  private preview: Preview | null = null;
  private debugTimer: ReturnType<typeof setInterval> | null = null;
  close() {
    if (this.debugTimer) clearInterval(this.debugTimer);
    this.debugTimer = null;
    this.preview?.dispose();
    this.preview = null;
    clear(this.panelHost);
    this.panel = null;
    this.panelRefresh = null;
  }

  private frame(title: string, body: HTMLElement, id: PanelId | null = null) {
    if (this.preview && !body.contains(this.preview.el)) { this.preview.dispose(); this.preview = null; }
    clear(this.panelHost);
    this.panel = id;
    this.panelRefresh = null;
    const back = h('div', { class: 'panel-back', onclick: (e: Event) => { if (e.target === back) this.close(); } },
      h('div', { class: 'panel' },
        h('header', {}, h('h2', {}, title), h('button', { class: 'btn ghost small', onclick: () => this.close() }, '✕')),
        h('div', { class: 'body' }, body)));
    this.panelHost.appendChild(back);
  }

  /** Mount a panel whose body re-renders on every state change. */
  private live(title: string, id: PanelId | null, render: (body: HTMLElement) => void) {
    const body = h('div');
    const draw = () => {
      const scroll = body.parentElement?.scrollTop ?? 0;
      clear(body);
      render(body);
      if (body.parentElement) body.parentElement.scrollTop = scroll;
    };
    draw();
    this.frame(title, body, id);
    this.panelRefresh = draw;
  }

  open(id: PanelId) {
    this.closeDialog();
    switch (id) {
      case 'goals': return this.live('Goals', id, (b) => this.goals(b));
      case 'bag': return this.live('Pockets', id, (b) => this.bag(b));
      case 'craft': return this.live('Crafting', id, (b) => this.craft(b, ['hand', 'workbench']));
      case 'build': return this.live('Build', id, (b) => this.build(b));
      case 'map':
        net.send({ t: 'map' });
        return this.live('World map', id, (b) => this.map(b));
      case 'friends': return this.live('Friends', id, (b) => this.friends(b));
      case 'mail': return this.live('Mailbox', id, (b) => this.mail(b, false));
      case 'island': return this.live('Island & visitors', id, (b) => this.island(b));
      case 'debug': return this.debugPanel();
    }
  }

  // ── Developer debug menu (F3 / `) ───────────────────────────────────────
  private debugPanel() {
    const body = h('div', { class: 'col' });
    const stats = h('pre', { style: 'margin:0;background:#2b2118;color:#d7f5c4;padding:10px 12px;border-radius:12px;font-size:12px;line-height:1.45;white-space:pre-wrap' });
    const w = this.world;
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
    this.debugTimer = setInterval(drawStats, 400);

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
      h('div', { class: 'row' }, b('🧰 Material kit', () => dev('kit')), b('🪙 +1000', () => dev('coins', 1000)), b('🪙 +10000', () => dev('coins', 10000)), b('🗑️ Empty pockets', () => dev('clearinv'))),
      h('div', { class: 'row' }, b('📅 Day +1', () => dev('day', 1)), b('Day +7', () => dev('day', 7)), b('Day +30', () => dev('day', 30)), b('⏩ Finish building & growth', () => dev('finish')), b('♻️ Respawn resources', () => dev('respawn'))),
      h('div', { class: 'row' }, give, qty, b('Give', () => dev('give', give.value, Math.max(1, Math.min(999, Number(qty.value) || 1))))),
      h('div', { class: 'row' }, h('b', {}, 'Island weather'), srvWeather, b('Set (30 min)', () => dev('weather', srvWeather.value))),
      h('div', { class: 'row' }, b('📍 Teleport to spawn', () => state.room && dev('tp', state.room.spawn.x, state.room.spawn.z)),
        b('🏠 Go home', () => net.send({ t: 'travel', to: { kind: 'home' } }))),
      h('p', { class: 'muted' }, `Chat shortcuts: ${DEV_COMMANDS.map((c) => '/' + c).join(' ')}`),
    );
    this.frame('🐞 Developer debug', body, 'debug');
  }

  private goals(b: HTMLElement) {
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

  private bag(b: HTMLElement) {
    const items = Object.entries(state.inv).filter(([, n]) => n > 0).sort((a, c) => ITEMS[a[0]].category.localeCompare(ITEMS[c[0]].category) || a[0].localeCompare(c[0]));
    if (!items.length) return b.append(h('p', { class: 'muted' }, 'Your pockets are empty. Shake some trees!'));
    const canBuild = state.room?.canDecorate;
    b.append(h('p', { class: 'muted' }, 'Sell items at the storage chest in your tent or house, or at the town hall.'));
    const grid = h('div', { class: 'grid' });
    for (const [id, n] of items) {
      const it = ITEMS[id];
      const actions = h('div', { class: 'row' });
      if (it.placeable && canBuild) actions.append(h('button', { class: 'btn small', onclick: () => { this.close(); this.world.startPlaceGhost(id); this.setPrompt(''); } }, 'Place'));
      if (it.wear) actions.append(h('button', { class: 'btn small', onclick: () => this.act({ k: 'wear', item: state.self?.hat === id ? null : id }) }, state.self?.hat === id ? 'Take off' : 'Wear'));
      actions.append(h('button', { class: 'btn ghost small', title: `${it.sell} each`, onclick: () => this.act({ k: 'sell', item: id, n: 1 }) }, `Sell ${it.sell}`));
      if (n > 1) actions.append(h('button', { class: 'btn ghost small', onclick: () => this.act({ k: 'sell', item: id, n }) }, 'All'));
      grid.append(h('div', { class: 'tile' }, h('div', { class: 'row', style: 'justify-content:space-between' }, h('span', { class: 'ico' }, it.icon), h('b', {}, `×${n}`)), h('div', { class: 'nm' }, it.name), actions));
    }
    b.append(grid);
  }

  private craft(b: HTMLElement, stations: RecipeDef['station'][]) {
    const recipes = RECIPES.filter((r) => stations.includes(r.station));
    const grid = h('div', { class: 'grid' });
    for (const r of recipes) {
      const out = ITEMS[r.output];
      const ings = r.ingredients.map(ingLabel);
      const owned = out.stack === 1 && have(r.output) > 0;
      const ok = ings.every((i) => i.have >= i.need) && !owned;
      const stationName = r.station === 'hand' ? 'by hand' : `at ${BUILDINGS[r.station].name}`;
      grid.append(h('div', { class: `tile${ok ? '' : ' locked'}` },
        h('div', { class: 'row' }, h('span', { class: 'ico' }, out.icon), h('div', {}, h('div', { class: 'nm' }, `${out.name}${r.qty > 1 ? ` ×${r.qty}` : ''}`), h('div', { class: 'muted' }, stationName))),
        h('div', { class: 'col', style: 'gap:2px' }, ings.map((i) => h('div', { class: 'muted', style: i.have >= i.need ? '' : 'color:#b84358' }, `${i.label} ${i.have}/${i.need}`))),
        h('button', { class: 'btn small', disabled: !ok, onclick: () => this.act({ k: 'craft', recipe: r.id }) }, owned ? 'Owned' : 'Make')));
    }
    b.append(grid);
  }

  private build(b: HTMLElement) {
    const room = state.room;
    if (!room?.canBuild) return b.append(h('p', {}, 'You can only build on your own island.'));
    const now = net.serverNow();
    const blds = [...this.world.buildings.values()];
    const done = (t: BuildingType) => blds.filter((x) => x.type === t && x.completeAt <= now).length;
    const total = (t: BuildingType) => blds.filter((x) => x.type === t).length;
    const day = state.env?.islandDay ?? 1;
    const grid = h('div', { class: 'grid' });
    for (const t of BUILDABLE) {
      const d = BUILDINGS[t];
      let lock: string | null = null;
      const missing = d.requires.filter((r) => done(r) < 1);
      let max = d.max;
      if (t === 'villager_house' && day < VILLAGER_HOUSE_MONTH_TWO_MIN_DAY && !state.dev) max = VILLAGER_HOUSE_MONTH_ONE_LIMIT;
      if (missing.length) lock = `Needs ${missing.map((m) => BUILDINGS[m].name).join(', ')}`;
      else if (!state.dev && day < d.minDay) lock = `Unlocks on day ${d.minDay}`;
      else if (total(t) >= max) lock = total(t) >= d.max ? 'Built' : `More on day ${VILLAGER_HOUSE_MONTH_TWO_MIN_DAY}`;
      const afford = Object.entries(d.cost).every(([id, n]) => have(id) >= n);
      grid.append(h('div', { class: `tile${lock ? ' locked' : ''}` },
        h('div', { class: 'row' }, h('span', { class: 'ico' }, d.icon), h('div', {}, h('div', { class: 'nm' }, d.name), h('div', { class: 'muted' }, `${d.w}×${d.h}${d.buildMinutes ? ` · ${d.buildMinutes >= 60 ? d.buildMinutes / 60 + 'h' : d.buildMinutes + 'm'} build` : ''}${d.max > 1 ? ` · ${total(t)}/${d.max}` : ''}`))),
        h('div', { class: 'muted' }, d.description),
        h('div', { class: 'col', style: 'gap:2px' }, Object.entries(d.cost).map(([id, n]) => h('div', { class: 'muted', style: have(id) >= n ? '' : 'color:#b84358' }, `${ITEMS[id].icon} ${ITEMS[id].name} ${have(id)}/${n}`))),
        lock ? h('span', { class: 'pill' }, lock) : h('button', { class: 'btn small', disabled: !afford, onclick: () => { this.close(); this.world.startBuildGhost(t); this.setPrompt(''); } }, afford ? 'Choose spot' : 'Need materials')));
    }
    b.append(grid);
  }

  private mapSel: { kind: 'island'; isl: MapIsland } | { kind: 'shared'; id: string } | null = null;
  private map(b: HTMLElement) {
    const info = h('div', { class: 'card map-info' });
    const drawInfo = () => {
      clear(info);
      const sel = this.mapSel;
      if (!sel) {
        info.append(h('h3', {}, 'Where to?'), h('p', { class: 'muted' }, '⭐ shared locations are open to all. Coloured dots are islands you may visit: 🟡 yours, 🩷 friends, ⚪ public.'));
      } else if (sel.kind === 'shared') {
        const s = SHARED_LOCATIONS.find((x) => x.id === sel.id)!;
        info.append(h('h3', {}, `⭐ ${s.name}`), h('p', {}, s.blurb), h('button', { class: 'btn', onclick: () => this.travel({ kind: 'shared', id: s.id }) }, 'Travel'));
      } else {
        const i = sel.isl;
        info.append(h('h3', {}, `${BIOME_ICON[i.biome]} ${i.name}`), h('div', { class: 'muted' }, `${i.mine ? 'Your island' : `${i.owner}’s island`} · ${BIOMES[i.biome].name}${i.visitors ? ` · ${i.visitors} here now` : ''}`),
          h('button', { class: 'btn', style: 'margin-top:8px', onclick: () => this.travel(i.mine ? { kind: 'home' } : { kind: 'island', id: i.id }) }, i.mine ? 'Go home' : 'Visit'));
      }
      const code = h('input', { placeholder: 'Invite code', maxlength: 12, style: 'width:120px' }) as HTMLInputElement;
      info.append(h('div', { class: 'row', style: 'margin-top:12px' }, code, h('button', { class: 'btn small', onclick: () => code.value.trim() && this.travel({ kind: 'code', code: code.value.trim().toUpperCase() }) }, 'Visit by code')));
      info.append(h('button', { class: 'btn ghost small', style: 'margin-top:8px', onclick: () => this.travel({ kind: 'home' }) }, '🏠 Go home'));
    };
    drawInfo();
    const wrap = h('div', { class: 'map-wrap' }, renderWorldMap({
      mode: 'travel',
      islands: state.map,
      onShared: (id) => { this.mapSel = { kind: 'shared', id }; drawInfo(); },
      onIsland: (isl) => { this.mapSel = { kind: 'island', isl }; drawInfo(); },
    }), info);
    b.append(wrap);
  }

  private travel(to: TravelTarget) {
    net.send({ t: 'travel', to });
    this.close();
  }

  private friends(b: HTMLElement) {
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
        f.islandId ? h('button', { class: 'btn small', onclick: () => this.travel({ kind: 'island', id: f.islandId! }) }, 'Visit') : null,
        h('button', { class: 'btn ghost small', onclick: () => { if (confirm(`Remove ${f.name} from your friends?`)) net.send({ t: 'friend', op: 'remove', id: f.id }); } }, 'Remove'))))));
  }

  private mail(b: HTMLElement, compose: boolean) {
    if (compose) {
      if (!state.friends.length) b.append(h('p', { class: 'muted' }, 'Add friends to send them letters.'));
      else {
        const to = h('select', {}, state.friends.map((f) => h('option', { value: f.id }, f.name))) as HTMLSelectElement;
        const item = h('select', {}, h('option', { value: '' }, '(no gift)'), Object.entries(state.inv).filter(([id]) => ITEMS[id].category !== 'tool').map(([id, n]) => h('option', { value: id }, `${ITEMS[id].icon} ${ITEMS[id].name} (${n})`))) as HTMLSelectElement;
        const text = h('textarea', { rows: 3, maxlength: 280, placeholder: 'Write a letter…' }) as HTMLTextAreaElement;
        b.append(h('div', { class: 'col', style: 'margin-bottom:14px' }, h('h3', {}, '✉️ Send a letter'),
          h('div', { class: 'field' }, 'To', to), h('div', { class: 'field' }, 'Attach a gift', item), h('div', { class: 'field' }, 'Message', text),
          h('button', { class: 'btn', onclick: () => this.act({ k: 'mail', to: to.value, text: text.value, item: item.value || undefined, n: item.value ? 1 : undefined }) }, 'Send')));
      }
    }
    b.append(h('h3', {}, `Inbox (${state.mail.length})`));
    if (!state.mail.length) b.append(h('p', { class: 'muted' }, 'No letters yet.'));
    b.append(h('div', { class: 'list' }, state.mail.map((m) => h('div', { class: 'item' },
      h('div', {}, h('b', {}, `From ${m.fromName}`), h('div', {}, m.text || h('i', { class: 'muted' }, '(no message)')), m.item ? h('div', { class: 'muted' }, `Gift: ${ITEMS[m.item]?.icon} ${m.n}× ${ITEMS[m.item]?.name}`) : null),
      h('button', { class: 'btn small', onclick: () => this.act({ k: 'takeMail', mailId: m.id }) }, m.item ? 'Take gift' : 'Discard')))));
  }

  private island(b: HTMLElement) {
    const self = state.self;
    if (!self) return;
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
      const visitors = [...this.world.players.entries()].filter(([id]) => id !== self.id);
      b.append(h('h3', { style: 'margin-top:10px' }, `Visitors here (${visitors.length})`),
        h('div', { class: 'list' }, visitors.map(([id, p]) => h('div', { class: 'item' }, p.label.element.textContent ?? id, h('button', { class: 'btn warn small', onclick: () => net.send({ t: 'kick', id }) }, 'Send home')))));
    }
    if (state.dev) b.append(h('p', { class: 'muted', style: 'margin-top:12px' }, 'Dev mode: chat /kit, /give <item> [n], /coins [n], /day [n], /finish'));
  }

  // ── Buildings ───────────────────────────────────────────────────────────
  openBuilding(bld: Building) {
    const def = BUILDINGS[bld.type];
    const now = net.serverNow();
    if (bld.completeAt > now) {
      const mins = Math.ceil((bld.completeAt - now) / 60000);
      return this.toast(`${def.name} will be ready in ${mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins} min`}.`);
    }
    const room = state.room!;
    const own = room.ownerId === state.self?.id;
    switch (bld.type) {
      case 'dock':
        if (room.kind === 'tour') return this.travel({ kind: 'home' });
        return this.open('map');
      case 'campfire':
        if (!own) return this.toast('A cosy campfire.');
        return this.live('🔥 Campfire cooking', null, (b) => this.craft(b, ['campfire']));
      case 'workbench':
        if (!own) return this.toast('A sturdy workbench.');
        return this.live('🛠️ Workbench', null, (b) => this.craft(b, ['hand', 'workbench']));
      case 'restaurant':
        return this.live('🍽️ Restaurant kitchen', null, (b) => this.craft(b, ['restaurant', 'campfire']));
      case 'tent':
      case 'cabin':
        return this.travel({ kind: 'enter', id: bld.id });
      case 'exit':
        return this.travel({ kind: 'exit' });
      case 'bed':
        return this.toast(room.interior === 'tent' ? 'You curl up in the sleeping bag for a moment… zZz' : 'You stretch out on the comfy bed… zZz', 'good');
      case 'chest':
        if (!own) return this.toast('That’s not your chest.');
        return this.live('🧰 Storage chest', null, (b) => {
          b.append(h('h3', {}, 'Sell box'));
          this.bag(b);
          if (room.interior === 'cabin') { b.append(h('hr')); this.mail(b, false); }
        });
      case 'town_hall':
        return this.live('🏛️ Town Hall', null, (b) => {
          if (own) {
            const vs = state.quest?.villagers ?? 0;
            b.append(h('p', {}, `Welcome, mayor! ${vs}/7 villagers live here.`), h('h3', {}, 'Sell goods'));
            this.bag(b);
            b.append(h('hr'));
            this.island(b);
          } else b.append(h('p', {}, `Welcome to ${room.name}! The mayor is ${room.ownerName}.`));
        });
      case 'villager_house': {
        const v = bld.villagerId ? villagerDef(bld.villagerId) : null;
        return this.toast(v ? `${v.name}’s house.` : 'An empty house – someone will move in soon!');
      }
      case 'tool_store':
      case 'furniture_store':
        return this.live(`${def.icon} ${def.name}`, null, (b) => this.shop(b, bld.type));
      case 'clothing_shop': {
        // Rendered once (it hosts a live 3D preview).
        const body = h('div');
        this.shop(body, bld.type);
        return this.frame(`${def.icon} ${def.name}`, body);
      }
      case 'post_office':
        return this.live('📮 Post Office', null, (b) => this.mail(b, own));
      case 'travel_agent':
        return this.live('✈️ Travel Agent', null, (b) => {
          b.append(h('p', {}, 'Fancy an adventure? A mystery tour takes you to a random, untouched island packed with resources. Gather everything you like, then return via the dock.'),
            h('button', { class: 'btn', disabled: !own, onclick: () => this.travel({ kind: 'tour' }) }, `🎫 Mystery tour (${MYSTERY_TOUR_COST} coins)`),
            h('button', { class: 'btn ghost', style: 'margin-left:8px', onclick: () => this.open('map') }, '🗺️ World map'));
        });
    }
  }

  private shop(b: HTMLElement, type: BuildingType) {
    const stock = SHOP_STOCK[type] ?? [];
    b.append(h('p', { class: 'muted' }, `You have 🪙 ${state.coins.toLocaleString()}`));
    const grid = h('div', { class: 'grid' });
    for (const id of stock) {
      const it = ITEMS[id];
      grid.append(h('div', { class: 'tile' }, h('span', { class: 'ico' }, it.icon), h('div', { class: 'nm' }, it.name), h('div', { class: 'muted' }, `🪙 ${it.buy}${have(id) ? ` · own ${have(id)}` : ''}`),
        h('button', { class: 'btn small', disabled: state.coins < (it.buy ?? 0), onclick: () => this.act({ k: 'buy', shop: type, item: id, n: 1 }) }, 'Buy')));
    }
    b.append(grid);
    if (type === 'clothing_shop' && state.self) {
      const self = state.self;
      const look: Look = { ...self.look };
      const prevEl = h('div', { class: 'preview', style: 'height:260px;position:relative;border-radius:16px;background:#eef7e6' });
      b.append(h('h3', { style: 'margin-top:14px' }, '💇 Makeover (200 coins)'));
      const ed = lookEditor(() => self.gender, look, () => prev.set(self.gender, look, self.hat));
      b.append(h('div', { class: 'row', style: 'align-items:flex-start' }, h('div', { style: 'width:200px' }, prevEl), ed.root));
      b.append(h('button', { class: 'btn', onclick: () => this.act({ k: 'restyle', look }) }, 'Apply makeover'));
      const prev = new Preview(prevEl);
      prev.set(self.gender, look, self.hat);
      this.preview = prev;
    }
  }

  // ── Villager dialog ─────────────────────────────────────────────────────
  openVillager(id: string) {
    this.talkingTo = id;
    this.act({ k: 'talk', vid: id });
  }

  closeDialog() {
    clear(this.dialogHost);
    this.talkingTo = null;
  }

  onTalk(v: TalkView) {
    const def = villagerDef(v.vid)!;
    this.talkingTo = v.vid;
    this.world.say(v.vid, v.reaction === 'love' ? '😍' : v.reaction === 'like' ? '😊' : v.reaction === 'dislike' ? '😖' : '💬');
    clear(this.dialogHost);
    const lvl = friendshipLevel(v.points);
    const nextMin = v.next ?? FRIENDSHIP_LEVELS[FRIENDSHIP_LEVELS.length - 1].min;
    const curMin = FRIENDSHIP_LEVELS[lvl.level].min;
    const pct = v.next ? Math.round(((v.points - curMin) / (nextMin - curMin)) * 100) : 100;
    const line = h('div', { class: 'line' });
    const picker = h('div');
    const box = h('div', { class: 'dialog' },
      h('div', { class: 'who' }, `${def.name} the ${def.personality} ${def.species}`),
      line,
      h('div', { class: 'row', style: 'justify-content:space-between' },
        h('div', { style: 'flex:1;max-width:260px' }, h('div', { class: 'row' }, h('span', { class: 'hearts' }, '♥'.repeat(lvl.level + 1) + '♡'.repeat(4 - lvl.level)), h('b', {}, v.levelName)), h('div', { class: 'bar' }, h('div', { style: `width:${pct}%` }))),
        h('div', { class: 'row' },
          h('button', { class: 'btn ghost small', onclick: () => this.act({ k: 'talk', vid: v.vid }) }, '💬 Chat'),
          h('button', { class: 'btn small', disabled: v.giftedToday, title: v.giftedToday ? 'One gift per day' : '', onclick: () => this.giftPicker(picker, v.vid) }, v.giftedToday ? '🎁 Gifted today' : '🎁 Give gift'),
          h('button', { class: 'btn ghost small', onclick: () => this.closeDialog() }, 'Bye!'))),
      picker,
      h('div', { class: 'muted', style: 'margin-top:6px' }, `Hint: ${def.name} likes ${def.likes.join(' & ')} things.`));
    this.dialogHost.appendChild(box);
    // Typewriter effect.
    let i = 0;
    const tick = () => {
      line.textContent = v.line.slice(0, i);
      if (i++ < v.line.length) setTimeout(tick, 18);
    };
    tick();
  }

  private giftPicker(host: HTMLElement, vid: string) {
    clear(host);
    const items = Object.entries(state.inv).filter(([id, n]) => n > 0 && ITEMS[id].category !== 'tool');
    if (!items.length) return host.append(h('p', { class: 'muted' }, 'Nothing to give.'));
    host.append(h('div', { class: 'row', style: 'margin-top:10px' }, items.map(([id, n]) => h('button', { class: 'btn ghost small', title: ITEMS[id].name, onclick: () => this.act({ k: 'gift', vid, item: id }) }, `${ITEMS[id].icon} ${n}`))));
  }

  // ── Actions ─────────────────────────────────────────────────────────────
  async act(a: Parameters<typeof net.act>[0]) {
    const r = await net.act(a);
    if (!r.ok) this.toast(r.err ?? 'Can’t do that.', 'warn');
    else if (r.msg) this.toast(r.msg, 'good');
    this.gain(r.gained);
    return r;
  }
}

function cap(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export { ITEM_LIST };
