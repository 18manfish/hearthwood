// Controller support (Animal Crossing style layout).

import { GamepadInput, type PadButton } from './gamepad.ts';
import { activate, clearPadFocus, focusRoot, navigate, scrollMenu } from './padnav.ts';
import { game } from '../app/session.ts';
import { back, interact } from '../app/actions.ts';

// ── Controller ────────────────────────────────────────────────────────────
// Layout (Animal Crossing style):
//   Left stick / D-pad  move (hold Ⓑ to run) · navigate menus
//   Ⓐ interact / confirm / hold to paint paths   Ⓑ back / cancel (hold while moving to run)
//   Ⓧ pockets   Ⓨ pick up furniture / rotate while placing
//   LB / RB cycle tools   LT build menu   RT craft menu
//   START goals   SELECT world map   R3 debug menu   Right stick zoom / scroll menus
let bMoved = false;
const menuOpen = () => !game.world || !!document.querySelector('.panel-back') || !!game.hud?.talkingTo;

export function bindPad() {
  new GamepadInput({
    connected(name) {
      game.hud?.toast(`🎮 Controller connected${name ? '' : ''} – press START for goals`, 'good');
    },
    disconnected() {
      game.hud?.toast('🎮 Controller disconnected', 'warn');
      game.hud?.setPadMode(false);
      if (game.world) game.world.analog = { x: 0, z: 0, run: false };
    },
    down(b: PadButton) {
      game.hud?.setPadMode(true);
      if (game.world) game.world.padAim = true;
      // Menus (and the character creator) take the input first.
      if (menuOpen()) {
        if (b === 'A') activate();
        else if (b === 'B') {
          const a = document.activeElement as HTMLElement | null;
          if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA')) a.blur();
          else if (game.world) back();
        } else if (game.world && game.hud) {
          if (b === 'X') game.hud.toggle('bag');
          if (b === 'START') game.hud.toggle('goals');
          if (b === 'SELECT') game.hud.toggle('map');
          if (b === 'R3') game.hud.toggle('debug');
          if (b === 'LT') game.hud.toggle('build');
          if (b === 'RT') game.hud.toggle('craft');
        }
        return;
      }
      if (!game.world || !game.hud) return;
      switch (b) {
        case 'A':
          if (game.world.paint) {
            game.world.paint.down = true;
            game.world.paint.last = '';
            game.world.paintFacing();
          } else interact();
          break;
        case 'B':
          bMoved = false;
          break;
        case 'X': game.hud.toggle('bag'); break;
        case 'Y':
          if (game.world.paint?.terra) game.hud.cycleTerra();
          else if (game.world.ghost?.type === 'place') game.world.rotateGhost();
          else if (game.world.target?.kind === 'object' && game.world.target.o.kind === 'furniture') game.hud.act({ k: 'pickup', id: game.world.target.o.id });
          break;
        case 'LB':
        case 'RB':
          game.hud.cycleSlot(b === 'RB' ? 1 : -1);
          break;
        case 'LT': game.hud.toggle('build'); break;
        case 'RT': game.hud.toggle('craft'); break;
        case 'START': game.hud.toggle('goals'); break;
        case 'SELECT': game.hud.toggle('map'); break;
        case 'R3': game.hud.toggle('debug'); break;
      }
    },
    up(b: PadButton) {
      if (!game.world) return;
      if (b === 'A' && game.world.paint) game.world.paint.down = false;
      // A quick tap of Ⓑ (without running) means "back".
      if (b === 'B' && !bMoved && !menuOpen()) back();
    },
    nav(dir) {
      if (menuOpen()) navigate(dir);
    },
    frame(s) {
      if (!game.world) return;
      if (menuOpen()) {
        game.world.analog = { x: 0, z: 0, run: false };
        if (s.ry) scrollMenu(s.ry * 14);
        if (!focusRoot()) clearPadFocus();
        return;
      }
      const moving = Math.hypot(s.lx, s.ly) > 0;
      if (moving && s.held.has('B')) bMoved = true;
      game.world.analog = { x: s.lx, z: s.ly, run: s.held.has('B') };
      if (s.ry) game.world.zoom(s.ry * 0.25);
    },
  });
}
