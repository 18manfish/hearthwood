// What the player's input does in the world: confirming placement ghosts, sending
// painted path / terraforming tiles at a steady pace, interacting, and "back".

import { type Action } from '@hearthwood/shared';
import { net } from '../net.ts';
import { state } from '../state.ts';
import { clearPadFocus } from '../input/padnav.ts';
import { game } from './session.ts';

export function confirmGhost() {
  const g = game.world?.ghost;
  if (!g || !game.hud) return;
  if (!g.ok) return game.hud.toast('You can’t place it there.', 'warn');
  const p = g.type === 'build' && g.moving
    ? game.hud.act({ k: 'relocate', id: g.moving, x: g.tx, z: g.tz })
    : g.type === 'build'
    ? game.hud.act({ k: 'build', type: g.building, x: g.tx, z: g.tz })
    : game.hud.act({ k: 'place', item: g.item, x: g.tx, z: g.tz, rot: g.rot });
  const keep = g.type === 'place';
  p.then((r) => {
    if (r.ok && (!keep || (state.inv[(g as { item: string }).item] ?? 0) <= 0)) game.world?.cancelGhost();
  });
}

// Path painting: tiles are queued and sent at a steady pace the server accepts.
const paintQueue: [number, number, Action][] = [];
let paintTimer: ReturnType<typeof setInterval> | null = null;
let lastPaintError = 0;
export function queuePaint(x: number, z: number, action: Action) {
  if (!paintQueue.some((p) => p[0] === x && p[1] === z)) paintQueue.push([x, z, action]);
  if (paintTimer) return;
  paintTimer = setInterval(async () => {
    const next = paintQueue.shift();
    if (!next) {
      clearInterval(paintTimer!);
      paintTimer = null;
      return;
    }
    const r = await net.act(next[2]);
    if (!r.ok && r.err && Date.now() - lastPaintError > 1500) {
      lastPaintError = Date.now();
      game.hud?.toast(r.err, 'warn');
      if (/materials|shovel|Pick|Spade|Town Hall/i.test(r.err)) paintQueue.length = 0;
    }
  }, paintQueue[0]?.[2].k === 'terra' ? 130 : 70);
}

/** Context-sensitive interaction (E / Space). */
export async function interact() {
  if (!game.world || !game.hud) return;
  if (game.world.ghost) return confirmGhost();
  if (game.world.paint) return game.world.paintFacing();
  const t = game.world.target;
  if (!t) return;
  switch (t.kind) {
    case 'object': {
      const o = t.o;
      if (o.kind === 'tree') {
        if ((o.stage ?? 2) < 2) return game.hud.toast('Still growing – come back later!');
        const chop = game.world.tool === 'axe' && (state.inv.stone_axe || state.inv.iron_axe);
        game.world.swing();
        return game.hud.act(chop ? { k: 'chop', id: o.id } : { k: 'shake', id: o.id });
      }
      if (o.kind === 'stump') { game.world.swing(); return game.hud.act({ k: 'dig', id: o.id }); }
      if (o.kind === 'rock') { game.world.swing(); return game.hud.act({ k: 'hit', id: o.id }); }
      if (o.kind === 'furniture') return;
      if (o.kind === 'bird') {
        if (!(state.inv.bird_net || state.inv.silk_net)) return game.hud.toast('You need a bird net – craft one from wood and fiber.', 'warn');
        if (game.world.tool !== 'net') return game.hud.toast('Select the bird net in your hotbar first.', 'warn');
        game.world.swing();
        return game.hud.act({ k: 'catch', id: o.id });
      }
      return game.hud.act({ k: 'forage', id: o.id });
    }
    case 'villager':
      return game.hud.openVillager(t.id);
    case 'building':
      return game.hud.openBuilding(t.b);
    case 'water': {
      if (t.empty) return game.hud.toast('No fish here – cast next to a fish shadow.', 'warn');
      game.world.startCast(t.x, t.z);
      const r = await game.hud.act({ k: 'cast', x: t.x, z: t.z });
      if (!r.ok || r.msg) game.world.endCast();
      return;
    }
    case 'plant':
      return game.hud.act({ k: 'plant', x: t.x, z: t.z });
    case 'reel': {
      const c = game.world.cast;
      if (!c) return;
      if (!c.bite || !c.id) {
        game.world.endCast();
        return game.hud.toast('Too early – the fish swam away!', 'warn');
      }
      game.world.endCast();
      const r = await game.hud.act({ k: 'reel', castId: c.id });
      if (r.ok && r.msg) game.hud.toast(r.msg, 'warn');
      return;
    }
  }
}

/** Escape / Ⓑ: cancel placement, close dialog or menu (shared by keyboard and controller). */
export function back() {
  if (!game.world || !game.hud) return;
  if (game.world.paint) {
    game.world.stopPaint();
    if (game.world.tool === 'pick' || game.world.tool === 'spade') game.hud.selectTool('hand');
  } else if (game.world.ghost) game.world.cancelGhost();
  else if (game.hud.talkingTo) game.hud.closeDialog();
  else game.hud.close();
  clearPadFocus();
  game.hud.setPrompt(game.world.target?.label ?? null);
}

