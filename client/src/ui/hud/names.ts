// Player and villager names above their heads. Off by default; toggled from
// the ⚙️ Options menu and remembered in this browser. Only the name tags are
// hidden – speech bubbles share the same layer and stay visible.

import { remembered } from './remembered.ts';

const choice = remembered('hearthwood.showNames');
const CLS = 'hide-names';

export function namesVisible(): boolean {
  return !document.body.classList.contains(CLS);
}

function show(on: boolean) {
  document.body.classList.toggle(CLS, !on);
}

/** Show or hide the names, and remember the choice. */
export function setNamesVisible(on: boolean) {
  show(on);
  choice.set(on);
}

/** Apply the player's last choice (default: names off). */
export function initNames() {
  show(choice.get());
}
