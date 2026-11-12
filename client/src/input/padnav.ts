// Spatial focus navigation for menus when using a controller: the D-pad /
// stick moves a visible highlight to the nearest control in that direction,
// A clicks it. Sliders and dropdowns are adjusted with left/right.

const FOCUSABLE = 'button:not([disabled]), input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea, label:has(input[type=checkbox])';

let current: HTMLElement | null = null;

function visible(el: HTMLElement) {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
}

function setFocus(el: HTMLElement | null) {
  current?.classList.remove('pad-focus');
  current = el;
  if (!el) return;
  el.classList.add('pad-focus');
  // Don't pop up the on-screen keyboard / caret for text fields.
  if (el.tagName === 'BUTTON' || el.tagName === 'SELECT' || (el as HTMLInputElement).type === 'range' || (el as HTMLInputElement).type === 'checkbox') el.focus({ preventScroll: true });
  el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

export function clearPadFocus() {
  setFocus(null);
}

/** Topmost interactive layer: open panel, villager dialog, or a full screen (creator). */
export function focusRoot(): HTMLElement | null {
  return (
    (document.querySelector('.panel-back .panel') as HTMLElement | null) ??
    (document.querySelector('.dialog') as HTMLElement | null) ??
    (document.querySelector('.screen') as HTMLElement | null)
  );
}

function candidates(root: HTMLElement): HTMLElement[] {
  const list = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(visible);
  // A checkbox's <label> is the target, not the tiny box inside it.
  return list.filter((el) => !(el.tagName === 'INPUT' && (el as HTMLInputElement).type === 'checkbox' && el.closest('label')));
}

export function navigate(dir: 'UP' | 'DOWN' | 'LEFT' | 'RIGHT'): boolean {
  const root = focusRoot();
  if (!root) return false;
  const list = candidates(root);
  if (!list.length) return true;
  if (!current || !root.contains(current) || !visible(current)) {
    setFocus(list[0]);
    return true;
  }
  // Left/right adjust sliders and dropdowns instead of moving.
  if (dir === 'LEFT' || dir === 'RIGHT') {
    const step = dir === 'RIGHT' ? 1 : -1;
    if (current instanceof HTMLSelectElement) {
      const n = current.options.length;
      current.selectedIndex = (current.selectedIndex + step + n) % n;
      current.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
    if (current instanceof HTMLInputElement && current.type === 'range') {
      if (step > 0) current.stepUp();
      else current.stepDown();
      current.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    }
    if (current instanceof HTMLInputElement && current.type === 'number') {
      if (step > 0) current.stepUp();
      else current.stepDown();
      return true;
    }
  }
  const a = current.getBoundingClientRect();
  const ax = a.left + a.width / 2, ay = a.top + a.height / 2;
  let best: HTMLElement | null = null;
  let bestScore = Infinity;
  for (const el of list) {
    if (el === current) continue;
    const b = el.getBoundingClientRect();
    const bx = b.left + b.width / 2, by = b.top + b.height / 2;
    const dx = bx - ax, dy = by - ay;
    const along = dir === 'RIGHT' ? dx : dir === 'LEFT' ? -dx : dir === 'DOWN' ? dy : -dy;
    const across = dir === 'RIGHT' || dir === 'LEFT' ? Math.abs(dy) : Math.abs(dx);
    if (along <= 4) continue;
    const score = along + across * 2.2;
    if (score < bestScore) {
      bestScore = score;
      best = el;
    }
  }
  if (best) setFocus(best);
  return true;
}

/** Press the highlighted control. */
export function activate(): boolean {
  const root = focusRoot();
  if (!root) return false;
  if (!current || !root.contains(current)) {
    navigate('DOWN');
    return true;
  }
  if (current instanceof HTMLInputElement && (current.type === 'text' || current.type === 'number' || !current.type)) {
    current.focus(); // let a keyboard take over, if there is one
    return true;
  }
  if (current instanceof HTMLTextAreaElement) {
    current.focus();
    return true;
  }
  if (current instanceof HTMLSelectElement) {
    const n = current.options.length;
    current.selectedIndex = (current.selectedIndex + 1) % n;
    current.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }
  current.click();
  // Menus often re-render: keep a highlight on something sensible.
  requestAnimationFrame(() => {
    if (current && !current.isConnected) {
      current = null;
      const r = focusRoot();
      if (r) {
        const l = candidates(r);
        if (l.length) setFocus(l[0]);
      }
    }
  });
  return true;
}

/** Scroll the open panel (right stick). */
export function scrollMenu(dy: number) {
  const body = document.querySelector('.panel-back .panel .body') as HTMLElement | null;
  if (body) body.scrollTop += dy;
}
