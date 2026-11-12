// Entry point: connects to the server and switches between screens.

import './style.css';
import { type ServerMessage } from '@hearthwood/shared';
import { net } from './net.ts';
import { set, state } from './state.ts';
import { World, type Tool } from './game/World.ts';
import { Hud } from './ui/hud.ts';
import { showCreator } from './ui/creator.ts';
import { h, clear } from './ui/dom.ts';
import { GamepadInput, type PadButton } from './input/gamepad.ts';
import { activate, clearPadFocus, focusRoot, navigate, scrollMenu } from './input/padnav.ts';

const app = document.getElementById('app')!;
let world: World | null = null;
let hud: Hud | null = null;
let creating = false;

function statusScreen(text: string, sub = '') {
  if (world) return hud?.toast(text, 'warn');
  clear(app);
  app.appendChild(h('div', { class: 'screen' }, h('div', { class: 'card col', style: 'align-items:center;text-align:center;max-width:420px' },
    h('div', { class: 'title' }, '🌿 Hearthwood'), h('div', {}, text), sub ? h('div', { class: 'muted' }, sub) : null)));
}

net.onStatus = (s, msg) => {
  if (s === 'connecting' && !world) statusScreen('Connecting to the islands…');
  if (s === 'offline') statusScreen('Connection lost – reconnecting…', 'Is the server running? (npm run dev)');
  if (s === 'fatal') statusScreen(msg ?? 'Disconnected.', 'Refresh the page to play again.');
};

function startGame() {
  if (world) return;
  clear(app);
  const container = h('div', { style: 'position:absolute;inset:0' });
  app.appendChild(container);
  world = new World(container);
  hud = new Hud(app, world);
  world.onGhostClick = () => confirmGhost();
  world.onPaint = (x, z, type) => queuePaint(x, z, type);
  // Debug handle for the browser console when the server runs in dev mode.
  if (state.dev) (window as unknown as Record<string, unknown>).hearthwood = { world, hud, state, net };
  bindKeys();
}

function confirmGhost() {
  const g = world?.ghost;
  if (!g || !hud) return;
  if (!g.ok) return hud.toast('You can’t place it there.', 'warn');
  const p = g.type === 'build'
    ? hud.act({ k: 'build', type: g.building, x: g.tx, z: g.tz })
    : hud.act({ k: 'place', item: g.item, x: g.tx, z: g.tz, rot: g.rot });
  const keep = g.type === 'place';
  p.then((r) => {
    if (r.ok && (!keep || (state.inv[(g as { item: string }).item] ?? 0) <= 0)) world?.cancelGhost();
  });
}

// Path painting: tiles are queued and sent at a steady pace the server accepts.
const paintQueue: [number, number, number][] = [];
let paintTimer: ReturnType<typeof setInterval> | null = null;
let lastPaintError = 0;
function queuePaint(x: number, z: number, type: number) {
  if (!paintQueue.some((p) => p[0] === x && p[1] === z)) paintQueue.push([x, z, type]);
  if (paintTimer) return;
  paintTimer = setInterval(async () => {
    const next = paintQueue.shift();
    if (!next) {
      clearInterval(paintTimer!);
      paintTimer = null;
      return;
    }
    const [px, pz, pt] = next;
    const r = await net.act(pt ? { k: 'pave', x: px, z: pz, path: pt } : { k: 'unpave', x: px, z: pz });
    if (!r.ok && r.err && Date.now() - lastPaintError > 1500) {
      lastPaintError = Date.now();
      hud?.toast(r.err, 'warn');
      if (/materials|shovel/i.test(r.err)) paintQueue.length = 0;
    }
  }, 70);
}

/** Context-sensitive interaction (E / Space). */
async function interact() {
  if (!world || !hud) return;
  if (world.ghost) return confirmGhost();
  if (world.paint) return world.paintFacing();
  const t = world.target;
  if (!t) return;
  switch (t.kind) {
    case 'object': {
      const o = t.o;
      if (o.kind === 'tree') {
        if ((o.stage ?? 2) < 2) return hud.toast('Still growing – come back later!');
        const chop = world.tool === 'axe' && (state.inv.stone_axe || state.inv.iron_axe);
        world.swing();
        return hud.act(chop ? { k: 'chop', id: o.id } : { k: 'shake', id: o.id });
      }
      if (o.kind === 'stump') { world.swing(); return hud.act({ k: 'dig', id: o.id }); }
      if (o.kind === 'rock') { world.swing(); return hud.act({ k: 'hit', id: o.id }); }
      if (o.kind === 'furniture') return;
      return hud.act({ k: 'forage', id: o.id });
    }
    case 'villager':
      return hud.openVillager(t.id);
    case 'building':
      return hud.openBuilding(t.b);
    case 'water': {
      world.startCast(t.x, t.z);
      const r = await hud.act({ k: 'cast', x: t.x, z: t.z });
      if (!r.ok || r.msg) world.endCast();
      return;
    }
    case 'plant':
      return hud.act({ k: 'plant', x: t.x, z: t.z });
    case 'reel': {
      const c = world.cast;
      if (!c) return;
      if (!c.bite || !c.id) {
        world.endCast();
        return hud.toast('Too early – the fish swam away!', 'warn');
      }
      world.endCast();
      const r = await hud.act({ k: 'reel', castId: c.id });
      if (r.ok && r.msg) hud.toast(r.msg, 'warn');
      return;
    }
  }
}

/** Escape / Ⓑ: cancel placement, close dialog or menu (shared by keyboard and controller). */
function back() {
  if (!world || !hud) return;
  if (world.paint) world.stopPaint();
  else if (world.ghost) world.cancelGhost();
  else if (hud.talkingTo) hud.closeDialog();
  else hud.close();
  clearPadFocus();
  hud.setPrompt(world.target?.label ?? null);
}

function bindKeys() {
  const toolKeys: Record<string, Tool> = { Digit1: 'hand', Digit2: 'axe', Digit3: 'shovel', Digit4: 'rod', Digit5: 'sapling' };
  window.addEventListener('keydown', (e) => {
    if (!world || !hud) return;
    if (hud.isTyping()) return;
    if (e.code === 'Enter') {
      e.preventDefault();
      hud.chatInput.focus();
      return;
    }
    if (e.code === 'F3' || e.code === 'Backquote') {
      e.preventDefault();
      return hud.toggle('debug');
    }
    hud.setPadMode(false);
    if (world) world.padAim = false;
    if (e.code === 'Escape') return back();
    const panelKeys: Record<string, Parameters<Hud['toggle']>[0]> = { KeyG: 'goals', KeyI: 'bag', KeyC: 'craft', KeyB: 'build', KeyM: 'map', KeyO: 'friends', KeyL: 'mail', KeyV: 'island' };
    if (panelKeys[e.code]) return hud.toggle(panelKeys[e.code]);
    if (hud.panel) return; // menus open: no world input
    if (toolKeys[e.code]) return hud.selectTool(toolKeys[e.code]);
    if (e.code === 'KeyE' || e.code === 'Space') {
      e.preventDefault();
      if (!e.repeat) interact();
      return;
    }
    if (e.code === 'KeyR') return world.rotateGhost();
    if (e.code === 'KeyF' && world.target?.kind === 'object' && world.target.o.kind === 'furniture') {
      hud.act({ k: 'pickup', id: world.target.o.id });
      return;
    }
    world.keys.add(e.code);
  });
  window.addEventListener('keyup', (e) => world?.keys.delete(e.code));
  window.addEventListener('blur', () => world?.keys.clear());
}

// ── Controller ────────────────────────────────────────────────────────────
// Layout (Animal Crossing style):
//   Left stick / D-pad  move (hold Ⓑ to run) · navigate menus
//   Ⓐ interact / confirm / hold to paint paths   Ⓑ back / cancel (hold while moving to run)
//   Ⓧ pockets   Ⓨ pick up furniture / rotate while placing
//   LB / RB cycle tools   LT build menu   RT craft menu
//   START goals   SELECT world map   R3 debug menu   Right stick zoom / scroll menus
const TOOLS: Tool[] = ['hand', 'axe', 'shovel', 'rod', 'sapling'];
let bMoved = false;
const menuOpen = () => !world || !!document.querySelector('.panel-back') || !!hud?.talkingTo;

new GamepadInput({
  connected(name) {
    hud?.toast(`🎮 Controller connected${name ? '' : ''} – press START for goals`, 'good');
  },
  disconnected() {
    hud?.toast('🎮 Controller disconnected', 'warn');
    hud?.setPadMode(false);
    if (world) world.analog = { x: 0, z: 0, run: false };
  },
  down(b: PadButton) {
    hud?.setPadMode(true);
    if (world) world.padAim = true;
    // Menus (and the character creator) take the input first.
    if (menuOpen()) {
      if (b === 'A') activate();
      else if (b === 'B') {
        const a = document.activeElement as HTMLElement | null;
        if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA')) a.blur();
        else if (world) back();
      } else if (world && hud) {
        if (b === 'X') hud.toggle('bag');
        if (b === 'START') hud.toggle('goals');
        if (b === 'SELECT') hud.toggle('map');
        if (b === 'R3') hud.toggle('debug');
        if (b === 'LT') hud.toggle('build');
        if (b === 'RT') hud.toggle('craft');
      }
      return;
    }
    if (!world || !hud) return;
    switch (b) {
      case 'A':
        if (world.paint) {
          world.paint.down = true;
          world.paint.last = '';
          world.paintFacing();
        } else interact();
        break;
      case 'B':
        bMoved = false;
        break;
      case 'X': hud.toggle('bag'); break;
      case 'Y':
        if (world.ghost?.type === 'place') world.rotateGhost();
        else if (world.target?.kind === 'object' && world.target.o.kind === 'furniture') hud.act({ k: 'pickup', id: world.target.o.id });
        break;
      case 'LB':
      case 'RB': {
        const i = TOOLS.indexOf(world.tool);
        hud.selectTool(TOOLS[(i + (b === 'RB' ? 1 : TOOLS.length - 1)) % TOOLS.length]);
        break;
      }
      case 'LT': hud.toggle('build'); break;
      case 'RT': hud.toggle('craft'); break;
      case 'START': hud.toggle('goals'); break;
      case 'SELECT': hud.toggle('map'); break;
      case 'R3': hud.toggle('debug'); break;
    }
  },
  up(b: PadButton) {
    if (!world) return;
    if (b === 'A' && world.paint) world.paint.down = false;
    // A quick tap of Ⓑ (without running) means "back".
    if (b === 'B' && !bMoved && !menuOpen()) back();
  },
  nav(dir) {
    if (menuOpen()) navigate(dir);
  },
  frame(s) {
    if (!world) return;
    if (menuOpen()) {
      world.analog = { x: 0, z: 0, run: false };
      if (s.ry) scrollMenu(s.ry * 14);
      if (!focusRoot()) clearPadFocus();
      return;
    }
    const moving = Math.hypot(s.lx, s.ly) > 0;
    if (moving && s.held.has('B')) bMoved = true;
    world.analog = { x: s.lx, z: s.ly, run: s.held.has('B') };
    if (s.ry) world.zoom(s.ry * 0.25);
  },
});

net.on((m: ServerMessage) => {
  switch (m.t) {
    case 'welcome':
      set('dev', m.dev);
      if (!m.you) {
        if (creating) return;
        creating = true;
        showCreator(app, (r) => {
          statusScreen('Sailing to your new island…');
          net.send({ t: 'create', ...r });
        });
        return;
      }
      creating = false;
      set('self', m.you);
      set('inv', m.you.inv);
      set('coins', m.you.coins);
      startGame();
      return;
    case 'self':
      set('self', m.you);
      return;
    case 'inv':
      set('coins', m.coins);
      set('inv', m.inv);
      return;
    case 'friends':
      state.incoming = m.incoming;
      state.outgoing = m.outgoing;
      set('friends', m.list);
      set('incoming', m.incoming);
      return;
    case 'mail':
      set('mail', m.list);
      return;
    case 'quest':
      set('quest', m.q);
      return;
    case 'map':
      set('map', m.islands);
      return;
    case 'room':
      startGame();
      state.env = m.env;
      set('room', m.room);
      world!.load(m.room);
      hud!.close();
      hud!.closeDialog();
      return;
    case 'board':
      world?.handle(m);
      if (state.room) set('room', state.room); // refresh an open billboard panel
      return;
    case 'env':
      set('env', m.env);
      world?.handle(m);
      return;
    case 'toast':
      hud?.toast(m.text, m.kind);
      return;
    case 'chat':
      hud?.chat(m.name, m.text, m.sys);
      return;
    case 'talk':
      hud?.onTalk(m.v);
      return;
    case 'fish':
      world?.handle(m);
      if (!m.ok) hud?.toast(m.msg, 'warn');
      else hud?.toast(`🎣 ${m.msg}`, 'good');
      return;
    case 'bite':
      if (world?.cast && !world.cast.id) world.cast.id = m.castId;
      world?.handle(m);
      hud?.setPrompt('❗ Reel in!', true);
      return;
    case 'err':
      if (m.code === 'bad_message' || m.code === 'server') console.warn('[server]', m.msg);
      if (!world && m.code !== 'auth') statusScreen(m.msg);
      else if (world) hud?.toast(m.msg, 'warn');
      if (m.code === 'auth') setTimeout(() => location.reload(), 800);
      return;
    default:
      world?.handle(m);
  }
});

net.connect();
