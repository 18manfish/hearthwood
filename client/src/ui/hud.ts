// In-game HUD and menus. All buttons only *ask* the server; results come back
// as messages that update `state`, which re-renders the relevant UI.
// The Hud keeps the shell (top bar, prompt, chat, toasts, panel host); the hotbar and
// each panel live in ./hud.

import { CHAPTERS, ITEMS, localTime, type Building, type TalkView, type MapIsland } from '@hearthwood/shared';
import { net } from '../net.ts';
import { state, watch } from '../state.ts';
import { debug, type World, type Tool } from '../game/World.ts';
import { DEFAULT_HOTBAR, type Hotbar, type HotbarTool, type TerraOp } from '@hearthwood/shared';
import { PATHS, TERRA_INFO } from '@hearthwood/shared';
import { h, clear } from './dom.ts';
import { BIOME_ICON } from './map.ts';
import { Preview } from './creator.ts';
import { type PanelId, SEASON_ICON, WEATHER_ICON, cap } from './hud/common.ts';
import { assignSlot, cycleSlot, cycleTerra, renderHotbar, selectSlot, selectTool, swapSlots } from './hud/hotbar.ts';
import { albumPanel } from './hud/panels/album.ts';
import { bagPanel } from './hud/panels/bag.ts';
import { buildPanel } from './hud/panels/build.ts';
import { openBuilding } from './hud/panels/building.ts';
import { craftPanel } from './hud/panels/craft.ts';
import { debugPanel } from './hud/panels/debug.ts';
import { friendsPanel } from './hud/panels/friends.ts';
import { goalsPanel } from './hud/panels/goals.ts';
import { islandPanel } from './hud/panels/island.ts';
import { mailPanel, writeBottle } from './hud/panels/mail.ts';
import { mapPanel } from './hud/panels/map.ts';
import { closeDialog, onTalk, openVillager } from './hud/panels/villager.ts';

export { ITEM_LIST } from '@hearthwood/shared';

export class Hud {
  readonly root = h('div', { class: 'hud' });
  loc = h('div', { class: 'loc' });
  coins = h('div', { class: 'coins' });
  hotbar = h('div', { class: 'hotbar' });
  prompt = h('div', { class: 'prompt', style: 'display:none' });
  log = h('div', { class: 'log' });
  readonly chatInput = h('input', { placeholder: 'Press Enter to chat…', maxlength: 140 }) as HTMLInputElement;
  toasts = h('div', { class: 'toasts' });
  panelHost = h('div');
  dialogHost = h('div');
  badges: Record<string, HTMLElement> = {};
  panel: PanelId | null = null;
  panelRefresh: (() => void) | null = null;
  talkingTo: string | null = null;
  /** Show controller button glyphs instead of keyboard keys. */
  padMode = false;
  lastPrompt: { text: string | null; bite: boolean } = { text: null, bite: false };

  constructor(app: HTMLElement, readonly world: World) {
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
        btn('📬', 'L', 'mail', 'Mail'), btn('📖', 'K', 'album', 'Album'), btn('⚙️', 'V', 'island', 'Options & island'), btn('🐞', 'F3', 'debug', 'Developer debug')),
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
    this.lastPrompt = { text, bite };
    const pad = this.padMode;
    if (this.world.paint) {
      const t = this.world.paint.type;
      const op = this.world.paint.terra;
      const what = op ? TERRA_INFO[op].name.toLowerCase() : t ? `lay ${PATHS[t - 1].name}` : 'remove paths';
      text = pad ? `Hold Ⓐ and walk to ${what} · Ⓑ to stop` : t ? `Click & drag to ${what} (or E in front of you) · Esc to stop` : `Click & drag to ${what} · Esc to stop`;
      if (op) text += pad ? ' · Ⓨ next tool' : ' · R next tool';
    } else if (this.world.ghost) {
      text = this.world.ghost.type === 'build'
        ? pad ? 'Ⓐ build in front of you · Ⓑ cancel' : 'Click to build here · Esc to cancel'
        : pad ? 'Ⓐ place · Ⓨ rotate · Ⓑ cancel' : 'E / click to place · R to rotate · Esc to cancel';
    }
    if (!text) {
      this.prompt.style.display = 'none';
      return;
    }
    this.prompt.style.display = '';
    this.prompt.className = `prompt${bite ? ' bite' : ''}`;
    clear(this.prompt);
    if (!text.includes('Ⓐ')) this.prompt.append(h('kbd', {}, this.padMode ? 'Ⓐ' : 'E'));
    this.prompt.append(text);
  }

  /** Switch hints between keyboard and controller glyphs. */
  setPadMode(on: boolean) {
    if (on === this.padMode) return;
    this.padMode = on;
    this.root.classList.toggle('pad', on);
    this.setPrompt(this.world.target?.label ?? this.lastPrompt.text, this.lastPrompt.bite);
  }

  isTyping() {
    const a = document.activeElement;
    return !!a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT');
  }

  // ── HUD rendering ───────────────────────────────────────────────────────
  render() {
    this.coins.textContent = `🪙 ${state.coins.toLocaleString()}`;
    this.renderLoc();
    renderHotbar(this);
    this.renderBadges();
  }

  renderLoc() {
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

  // ── Hotbar ──────────────────────────────────────────────────────────────
  /** The ten slots (synced to the server so they follow you between devices). */
  get slots(): Hotbar {
    return state.self?.hotbar ?? DEFAULT_HOTBAR;
  }

  dragFrom = -1;

  /** Last terraforming operation used with each tool. */
  terraOp: Record<'pick' | 'spade', TerraOp> = { pick: 'raise', spade: 'water' };

  renderBadges() {
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

  preview: Preview | null = null;
  debugTimer: ReturnType<typeof setInterval> | null = null;
  close() {
    if (this.debugTimer) clearInterval(this.debugTimer);
    this.debugTimer = null;
    this.preview?.dispose();
    this.preview = null;
    clear(this.panelHost);
    this.panel = null;
    this.panelRefresh = null;
  }

  frame(title: string, body: HTMLElement, id: PanelId | null = null) {
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
  live(title: string, id: PanelId | null, render: (body: HTMLElement) => void) {
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
    closeDialog(this);
    switch (id) {
      case 'goals': return this.live('Goals', id, (b) => goalsPanel(this, b));
      case 'bag': return this.live('Pockets', id, (b) => bagPanel(this, b, true));
      case 'craft': return this.live('Crafting', id, (b) => craftPanel(this, b, ['hand', 'workbench']));
      case 'build': return this.live('Build', id, (b) => buildPanel(this, b));
      case 'map':
        net.send({ t: 'map' });
        return this.live('World map', id, (b) => mapPanel(this, b));
      case 'friends': return this.live('Friends', id, (b) => friendsPanel(this, b));
      case 'mail': return this.live('Letters', id, (b) => {
        b.append(h('p', { class: 'muted' }, 'Read your letters anywhere. To send one, walk up to your mailbox 📮 (build it from the Build menu).'));
        mailPanel(this, b, false);
      });
      case 'island': return this.live('⚙️ Options & island', id, (b) => islandPanel(this, b));
      case 'album': return this.live('📖 Album', id, (b) => albumPanel(this, b));
      case 'debug': return debugPanel(this);
    }
  }

  // ── Album ───────────────────────────────────────────────────────────────
  albumTab: 'fish' | 'birds' = 'fish';

  // ── Developer debug menu (F3 / `) ───────────────────────────────────────

  mapSel: { kind: 'island'; isl: MapIsland } | { kind: 'shared'; id: string } | null = null;

  // ── Actions ─────────────────────────────────────────────────────────────
  async act(a: Parameters<typeof net.act>[0]) {
    const r = await net.act(a);
    if (!r.ok) this.toast(r.err ?? 'Can’t do that.', 'warn');
    else if (r.msg) this.toast(r.msg, 'good');
    this.gain(r.gained);
    return r;
  }

  // ── API (the work lives in ./hud) ──────────────────────────────────
  /** Put a tool into a slot; if it already sits elsewhere, the two slots swap. */
  assignSlot(i: number, t: HotbarTool | null) {
    return assignSlot(this, i, t);
  }

  swapSlots(i: number, j: number) {
    return swapSlots(this, i, j);
  }

  renderHotbar() {
    return renderHotbar(this);
  }

  selectSlot(i: number) {
    return selectSlot(this, i);
  }

  /** LB / RB: step through the filled slots. */
  cycleSlot(dir: 1 | -1) {
    return cycleSlot(this, dir);
  }

  selectTool(t: Tool) {
    return selectTool(this, t);
  }

  /** R / Ⓨ while terraforming: next operation of the same tool. */
  cycleTerra() {
    return cycleTerra(this);
  }

  /** Write a message in a bottle and throw it into the sea. */
  writeBottle() {
    return writeBottle(this);
  }

  openBuilding(bld: Building) {
    return openBuilding(this, bld);
  }

  openVillager(id: string) {
    return openVillager(this, id);
  }

  closeDialog() {
    return closeDialog(this);
  }

  onTalk(v: TalkView) {
    return onTalk(this, v);
  }
}
