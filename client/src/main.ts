// Entry point: wires up the screens, input and server messages, then boots.
//   app/session.ts   the running game (World + HUD) and status screens
//   app/boot.ts      server info → game data → log in → start screen → connect
//   app/messages.ts  server messages → state, HUD and world
//   app/actions.ts   what input does in the world (interact, place, paint, back)
//   input/keyboard.ts, input/pad.ts   keyboard and controller

import './style.css';
import { bindAuth, bindStatus, boot } from './app/boot.ts';
import { bindMessages } from './app/messages.ts';
import { bindPad } from './input/pad.ts';

// Same order as before the split: status → controller → messages → auth → boot.
bindStatus();
bindPad();
bindMessages();
bindAuth();
boot();
