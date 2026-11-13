// Player and villager names above their heads. Off by default; toggled from
// the ⚙️ Options menu and remembered in this browser. Only the name tags are
// hidden – speech bubbles share the same layer and stay visible.

const KEY = 'hearthwood.showNames';
const CLS = 'hide-names';

export function namesVisible(): boolean {
  return !document.body.classList.contains(CLS);
}

/** Show or hide the names (and remember the choice). */
export function setNamesVisible(on: boolean, remember = true) {
  document.body.classList.toggle(CLS, !on);
  if (remember) {
    try {
      localStorage.setItem(KEY, on ? '1' : '0');
    } catch { /* private mode etc. */ }
  }
}

/** Apply the player's last choice (default: names off). */
export function initNames() {
  let on = false;
  try {
    on = localStorage.getItem(KEY) === '1';
  } catch { /* ignore */ }
  setNamesVisible(on, false);
}
