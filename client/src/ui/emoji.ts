// Pixel icons instead of emoji. Every emoji the game uses has a 64×64 icon
// (art/icons/ui_icon_gen.py → client/public/icons/ui/<name>.png, painted in
// Aseprite). Text in the page is watched: any emoji that appears in it is swapped
// for its icon, so toasts, chat, panels and labels need no changes. Canvas
// drawing (3D signs, the admin map) uses drawEmoji().

import { EMOJI_ICONS } from './emojiIcons.ts';

/** The emoji variation selector (written as a code so no build step can mangle it). */
const VS16 = String.fromCharCode(0xfe0f);
const plain = (e: string) => e.split(VS16).join('');
const keys = Object.keys(EMOJI_ICONS).sort((a, b) => b.length - a.length);
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Any known emoji, with or without a variation selector after each part. */
const RE = new RegExp(keys.map((k) => [...k].map((c) => `${esc(c)}\\uFE0F?`).join('')).join('|'), 'gu');

/** The icon's URL for an emoji (null if it has none). */
export function emojiIconUrl(emoji: string): string | null {
  const name = EMOJI_ICONS[plain(emoji)];
  return name ? `/icons/ui/${name}.png` : null;
}

export function hasEmoji(text: string): boolean {
  RE.lastIndex = 0;
  return RE.test(text);
}

/** Text without its emoji (for places that can't show pictures, like <option>). */
export function stripEmoji(text: string): string {
  return text.replace(RE, '').replace(/\s{2,}/g, ' ').trim();
}

/** An <img> showing an emoji's pixel icon. */
export function emojiImg(emoji: string): HTMLImageElement | Text {
  const url = emojiIconUrl(emoji);
  if (!url) return document.createTextNode(emoji);
  const img = document.createElement('img');
  img.className = 'emo';
  img.src = url;
  img.alt = emoji;
  img.draggable = false;
  // A missing picture falls back to the emoji, in a span the watcher leaves alone.
  img.onerror = () => {
    const span = document.createElement('span');
    span.dataset.emoji = '';
    span.textContent = emoji;
    img.replaceWith(span);
  };
  return img;
}

const SKIP = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'INPUT', 'TITLE', 'CANVAS', 'SVG', 'svg', 'text']);

function skip(el: Element | null): boolean {
  for (let e = el; e; e = e.parentElement) {
    if (SKIP.has(e.tagName) || (e as HTMLElement).isContentEditable || e.hasAttribute('data-emoji')) return true;
    if (e.tagName === 'OPTION' || e.tagName === 'SELECT') return true;
  }
  return false;
}

function swapText(node: Text) {
  const text = node.data;
  RE.lastIndex = 0;
  if (!RE.test(text)) return;
  const parent = node.parentElement;
  if (!parent) return;
  if (parent.tagName === 'OPTION') {
    // Options show plain text only.
    node.data = stripEmoji(text);
    return;
  }
  if (skip(parent)) return;
  const frag = document.createDocumentFragment();
  let last = 0;
  let swapped = 0;
  RE.lastIndex = 0;
  for (let m = RE.exec(text); m; m = RE.exec(text)) {
    if (!emojiIconUrl(m[0])) continue; // no icon: keep the emoji as it is
    if (m.index > last) frag.append(text.slice(last, m.index));
    frag.append(emojiImg(m[0]));
    last = m.index + m[0].length;
    swapped++;
  }
  // Only touch the page when something changes (the watcher sees every change).
  if (!swapped) return;
  if (last < text.length) frag.append(text.slice(last));
  node.replaceWith(frag);
}

function swapAttrs(el: Element) {
  for (const a of ['title', 'placeholder', 'aria-label']) {
    const v = el.getAttribute(a);
    if (v && hasEmoji(v)) el.setAttribute(a, stripEmoji(v));
  }
}

/** Swap every emoji under `root` for its icon. */
export function pixelateEmojis(root: Node) {
  if (root.nodeType === Node.TEXT_NODE) return swapText(root as Text);
  if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return;
  if (root.nodeType === Node.ELEMENT_NODE) swapAttrs(root as Element);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  const texts: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.nodeType === Node.TEXT_NODE) texts.push(n as Text);
    else swapAttrs(n as Element);
  }
  for (const t of texts) swapText(t);
}

/** Keep swapping emoji for icons as the page changes. */
export function watchEmojis(root: Node = document.body) {
  pixelateEmojis(root);
  new MutationObserver((list) => {
    for (const m of list) {
      if (m.type === 'characterData') swapText(m.target as Text);
      else if (m.type === 'attributes') swapAttrs(m.target as Element);
      else for (const n of m.addedNodes) pixelateEmojis(n);
    }
  }).observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['title', 'placeholder', 'aria-label'] });
}

// ── Canvas ────────────────────────────────────────────────────────────────
const images = new Map<string, HTMLImageElement>();

/** The icon as an image (starts loading on first use); null without one or outside a browser. */
export function emojiImage(emoji: string, onLoad?: () => void): HTMLImageElement | null {
  const url = emojiIconUrl(emoji);
  if (!url || typeof Image === 'undefined') return null;
  let img = images.get(url);
  if (!img) {
    img = new Image();
    img.src = url;
    images.set(url, img);
  }
  if (onLoad && !(img.complete && img.naturalWidth)) img.addEventListener('load', onLoad, { once: true });
  return img;
}

/**
 * Draw an emoji's icon centred at (x, y), `size` pixels wide.
 * Falls back to the emoji as text until the icon has loaded; `onLoad` lets the
 * caller redraw then.
 */
export function drawEmoji(ctx: CanvasRenderingContext2D, emoji: string, x: number, y: number, size: number, onLoad?: () => void) {
  const img = emojiImage(emoji, onLoad);
  if (img && img.complete && img.naturalWidth) {
    const smooth = ctx.imageSmoothingEnabled;
    // Crisp pixels when drawn at full size or bigger, smooth when scaled down.
    ctx.imageSmoothingEnabled = size < img.naturalWidth;
    ctx.drawImage(img, x - size / 2, y - size / 2, size, size);
    ctx.imageSmoothingEnabled = smooth;
    return;
  }
  ctx.save();
  ctx.font = `${Math.round(size * 0.8)}px serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(emoji, x, y);
  ctx.restore();
}
