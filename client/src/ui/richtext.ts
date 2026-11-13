// News box bodies. New boxes are stored as (sanitised) HTML written in the
// admin tool's editor; older boxes are plain text with blank-line paragraphs
// and **bold**. Everything is cleaned through an allow-list before it is shown.

import { h } from './dom.ts';

/** Tags kept as they are. Anything else is unwrapped (its text is kept). */
const ALLOWED = new Set(['P', 'BR', 'B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'H2', 'H3', 'H4', 'UL', 'OL', 'LI', 'A', 'IMG', 'BLOCKQUOTE', 'HR', 'FIGURE', 'FIGCAPTION', 'DIV', 'SPAN']);
/** Tags dropped together with everything inside them. */
const DROP = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'TEMPLATE', 'NOSCRIPT', 'SVG', 'MATH', 'FORM', 'INPUT', 'BUTTON', 'SELECT', 'TEXTAREA', 'LINK', 'META', 'HEAD', 'TITLE', 'VIDEO', 'AUDIO', 'CANVAS']);
/** Classes the editor uses for image size and placement. */
export const IMG_CLASSES = ['img-small', 'img-medium', 'img-full', 'img-left', 'img-right', 'img-center'];
const TEXT_ALIGN = ['left', 'center', 'right'];

const safeHref = (v: string) => /^(https?:|mailto:)/i.test(v.trim()) || /^\/(?!\/)/.test(v.trim());
const safeSrc = (v: string) => /^https:\/\//i.test(v.trim()) || /^\/api\/news\/images\/[A-Za-z0-9_-]+\.[a-z]+$/.test(v.trim()) || /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(v.trim());

function clean(node: Node) {
  for (const child of [...node.childNodes]) {
    if (child.nodeType === Node.TEXT_NODE) continue;
    if (child.nodeType !== Node.ELEMENT_NODE) {
      child.remove();
      continue;
    }
    const el = child as HTMLElement;
    const tag = el.tagName;
    if (DROP.has(tag)) {
      el.remove();
      continue;
    }
    // Normalise a few equivalents the browser's editor likes to produce.
    if (!ALLOWED.has(tag) || tag === 'STRIKE') {
      clean(el);
      if (tag === 'STRIKE') {
        const s = document.createElement('s');
        s.append(...el.childNodes);
        el.replaceWith(s);
      } else if (['H1'].includes(tag)) {
        const h2 = document.createElement('h2');
        h2.append(...el.childNodes);
        el.replaceWith(h2);
      } else el.replaceWith(...el.childNodes);
      continue;
    }
    // Attributes: keep only the few we understand.
    const keep: [string, string][] = [];
    if (tag === 'A') {
      const href = el.getAttribute('href') ?? '';
      if (safeHref(href)) keep.push(['href', href.trim()], ['target', '_blank'], ['rel', 'noopener noreferrer']);
    }
    if (tag === 'IMG') {
      const src = el.getAttribute('src') ?? '';
      if (!safeSrc(src)) {
        el.remove();
        continue;
      }
      keep.push(['src', src.trim()], ['alt', (el.getAttribute('alt') ?? '').slice(0, 200)], ['loading', 'lazy']);
      const cls = (el.getAttribute('class') ?? '').split(/\s+/).filter((c) => IMG_CLASSES.includes(c));
      if (cls.length) keep.push(['class', cls.join(' ')]);
    }
    if (['P', 'H2', 'H3', 'H4', 'DIV', 'LI', 'FIGURE', 'FIGCAPTION'].includes(tag)) {
      const align = el.style?.textAlign || el.getAttribute('align') || '';
      if (TEXT_ALIGN.includes(align)) keep.push(['style', `text-align:${align}`]);
    }
    for (const a of [...el.attributes]) el.removeAttribute(a.name);
    for (const [k, v] of keep) el.setAttribute(k, v);
    clean(el);
  }
}

/** Clean HTML from the editor (or pasted from elsewhere) down to the allowed subset. */
export function sanitizeHtml(html: string): string {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  clean(doc.body);
  return doc.body.innerHTML.trim();
}

/** Is this body stored as HTML (new editor) rather than legacy plain text? */
export const isHtmlBody = (text: string) => /^\s*</.test(text);

/** Legacy plain text → paragraphs (blank line = new paragraph, **bold** allowed). */
function legacyText(text: string, box: HTMLElement) {
  for (const para of text.split(/\n\s*\n/)) {
    const p = h('p');
    for (const part of para.split(/(\*\*[^*]+\*\*)/)) {
      if (/^\*\*[^*]+\*\*$/.test(part)) p.append(h('b', {}, part.slice(2, -2)));
      else part.split('\n').forEach((line, j, lines) => {
        p.append(line);
        if (j < lines.length - 1) p.append(h('br'));
      });
    }
    box.append(p);
  }
}

/** A news body ready to show: sanitised HTML, or legacy text turned into paragraphs. */
export function renderNewsBody(text: string): HTMLElement {
  const box = h('div', { class: 'news-body' });
  if (isHtmlBody(text)) box.innerHTML = sanitizeHtml(text);
  else legacyText(text, box);
  return box;
}

/** Legacy text as editor HTML, so old boxes open nicely in the new editor. */
export function bodyToEditorHtml(text: string): string {
  return isHtmlBody(text) ? sanitizeHtml(text) : renderNewsBody(text).innerHTML;
}
