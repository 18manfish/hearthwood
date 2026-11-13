// Server messages that update the client state, the HUD or the world.

import { type ServerMessage } from '@hearthwood/shared';
import { net } from '../net.ts';
import { set, state } from '../state.ts';
import { showCreator, showRecreate } from '../ui/creator.ts';
import { game, app, startGame, statusScreen } from './session.ts';
import { fishBite, fishResult } from '../audio/actions.ts';

export function bindMessages() {
  net.on((m: ServerMessage) => {
    switch (m.t) {
      case 'welcome':
        set('dev', m.dev);
        if (!m.you && m.recreate) {
          // New character model: redo your looks, then on to your island.
          if (game.creating) return;
          game.creating = true;
          showRecreate(app, m.recreate, (r) => {
            statusScreen('Back to your island…');
            net.send({ t: 'recreate', ...r });
          });
          return;
        }
        if (!m.you) {
          if (game.creating) return;
          game.creating = true;
          showCreator(app, (r) => {
            statusScreen('Sailing to your new island…');
            net.send({ t: 'create', ...r });
          });
          return;
        }
        game.creating = false;
        set('self', m.you);
        set('inv', m.you.inv);
        set('coins', m.you.coins);
        set('album', m.you.album);
        startGame();
        return;
      case 'self':
        set('self', m.you);
        set('coins', m.you.coins);
        return;
      case 'album':
        set('album', m.album);
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
        game.world!.load(m.room);
        game.hud!.close();
        game.hud!.closeDialog();
        return;
      case 'board':
        game.world?.handle(m);
        if (state.room) set('room', state.room); // refresh an open billboard panel
        return;
      case 'env':
        set('env', m.env);
        game.world?.handle(m);
        return;
      case 'toast':
        game.hud?.toast(m.text, m.kind);
        return;
      case 'chat':
        game.hud?.chat(m.name, m.text, m.sys);
        return;
      case 'talk':
        game.hud?.onTalk(m.v);
        return;
      case 'fish':
        fishResult(m.ok);
        game.world?.handle(m);
        if (!m.ok) game.hud?.toast(m.msg, 'warn');
        else game.hud?.toast(`🎣 ${m.msg}`, 'good');
        return;
      case 'bite':
        fishBite();
        if (game.world?.cast && !game.world.cast.id) game.world.cast.id = m.castId;
        game.world?.handle(m);
        game.hud?.setPrompt('❗ Reel in!', true);
        return;
      case 'err':
        if (m.code === 'bad_message' || m.code === 'server') console.warn('[server]', m.msg);
        if (['auth', 'register', 'banned', 'kicked'].includes(m.code)) return; // handled by net.onAuth / onStatus
        if (!game.world) statusScreen(m.msg);
        else game.hud?.toast(m.msg, 'warn');
        return;
      default:
        game.world?.handle(m);
    }
  });
}
