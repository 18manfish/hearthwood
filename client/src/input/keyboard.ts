// Keyboard controls.

import type { Hud } from '../ui/hud.ts';
import { game } from '../app/session.ts';
import { back, interact } from '../app/actions.ts';

export function bindKeys() {
  const slotKeys = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9', 'Digit0'];
  window.addEventListener('keydown', (e) => {
    if (!game.world || !game.hud) return;
    if (game.hud.isTyping()) return;
    if (e.code === 'Enter') {
      e.preventDefault();
      game.hud.chatInput.focus();
      return;
    }
    if (e.code === 'F3' || e.code === 'Backquote') {
      e.preventDefault();
      return game.hud.toggle('debug');
    }
    game.hud.setPadMode(false);
    if (game.world) game.world.padAim = false;
    if (e.code === 'Escape') return back();
    const panelKeys: Record<string, Parameters<Hud['toggle']>[0]> = { KeyG: 'goals', KeyI: 'bag', KeyC: 'craft', KeyB: 'build', KeyM: 'map', KeyO: 'friends', KeyL: 'mail', KeyV: 'island', KeyK: 'album' };
    if (panelKeys[e.code]) return game.hud.toggle(panelKeys[e.code]);
    if (game.hud.panel) return; // menus open: no world input
    const slot = slotKeys.indexOf(e.code);
    if (slot >= 0) return game.hud.selectSlot(slot);
    if (e.code === 'KeyE' || e.code === 'Space') {
      e.preventDefault();
      if (!e.repeat) interact();
      return;
    }
    if (e.code === 'KeyR') {
      if (game.world.paint?.terra) return game.hud.cycleTerra();
      return game.world.rotateGhost();
    }
    if (e.code === 'KeyF' && game.world.target?.kind === 'object' && game.world.target.o.kind === 'furniture') {
      game.hud.act({ k: 'pickup', id: game.world.target.o.id });
      return;
    }
    game.world.keys.add(e.code);
  });
  window.addEventListener('keyup', (e) => game.world?.keys.delete(e.code));
  window.addEventListener('blur', () => game.world?.keys.clear());
}

