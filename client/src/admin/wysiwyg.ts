// A small, dependency-free WYSIWYG editor for news boxes: formatting, lists,
// links, alignment and images (upload, paste, drag & drop or by URL). The
// output is cleaned with the same allow-list the start screen uses.

import { h } from '../ui/dom.ts';
import { sanitizeHtml } from '../ui/richtext.ts';

export interface Wysiwyg {
  el: HTMLElement;
  getHtml(): string;
  setHtml(html: string): void;
  focus(): void;
}

interface Options {
  html: string;
  /** Upload an image file; resolves to its URL. */
  upload: (file: File) => Promise<string>;
  onChange?: () => void;
  onError?: (message: string) => void;
}

const SIZES: [string, string][] = [['img-small', 'S'], ['img-medium', 'M'], ['img-full', 'Full'], ['', 'Original']];
const PLACES: [string, string, string][] = [['img-left', '⇤', 'Float left, text wraps on the right'], ['img-center', '↔', 'Centred on its own line'], ['img-right', '⇥', 'Float right, text wraps on the left']];

export function createWysiwyg(opts: Options): Wysiwyg {
  const area = h('div', { class: 'wy-area news-body', contenteditable: 'true', spellcheck: 'true' });
  const source = h('textarea', { class: 'wy-source', spellcheck: 'false', style: 'display:none' }) as HTMLTextAreaElement;
  const fileInput = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif', multiple: true, style: 'display:none' }) as HTMLInputElement;
  const status = h('span', { class: 'muted wy-status' });
  const imgBar = h('div', { class: 'wy-imgbar', style: 'display:none' });
  const toolbar = h('div', { class: 'wy-toolbar' });
  const root = h('div', { class: 'wy' }, h('div', { class: 'wy-bars' }, toolbar, imgBar), area, source, h('div', { class: 'wy-foot' }, status, h('span', { class: 'muted' }, 'Tip: paste or drop images straight into the text · Ctrl+B / I / U · Ctrl+K for a link')), fileInput);

  let sourceMode = false;
  let selImg: HTMLImageElement | null = null;
  let savedRange: Range | null = null;
  let uploading = 0;

  const changed = () => {
    updateStatus();
    opts.onChange?.();
  };
  const exec = (cmd: string, value?: string) => {
    area.focus();
    restoreRange();
    document.execCommand(cmd, false, value);
    refreshState();
    changed();
  };

  // ── Selection bookkeeping (toolbar clicks and dialogs steal focus) ─────────
  const saveRange = () => {
    const s = getSelection();
    if (s && s.rangeCount && area.contains(s.anchorNode)) savedRange = s.getRangeAt(0).cloneRange();
  };
  const restoreRange = () => {
    const s = getSelection();
    if (!s) return;
    if (s.rangeCount && area.contains(s.anchorNode)) return;
    s.removeAllRanges();
    if (savedRange) s.addRange(savedRange);
    else {
      const r = document.createRange();
      r.selectNodeContents(area);
      r.collapse(false);
      s.addRange(r);
    }
  };
  document.addEventListener('selectionchange', () => {
    if (!root.isConnected) return;
    saveRange();
    refreshState();
  });

  // ── Toolbar ────────────────────────────────────────────────────────────────
  const stateBtns: [HTMLButtonElement, () => boolean][] = [];
  const btn = (label: string, title: string, run: () => void, active?: () => boolean, cls = '') => {
    const b = h('button', { type: 'button', class: `wy-btn ${cls}`, title, onmousedown: (e: Event) => e.preventDefault(), onclick: () => run() }, label) as HTMLButtonElement;
    if (active) stateBtns.push([b, active]);
    return b;
  };
  const q = (cmd: string) => () => {
    try {
      return document.queryCommandState(cmd);
    } catch {
      return false;
    }
  };
  const block = h('select', { class: 'wy-block', title: 'Paragraph style', onchange: () => { exec('formatBlock', `<${block.value}>`); } },
    h('option', { value: 'p' }, 'Paragraph'), h('option', { value: 'h2' }, 'Heading'), h('option', { value: 'h3' }, 'Subheading'), h('option', { value: 'blockquote' }, 'Quote')) as HTMLSelectElement;
  const sep = () => h('span', { class: 'wy-sep' });
  const sourceBtn = btn('</>', 'Edit the HTML directly', () => toggleSource(), () => sourceMode);
  toolbar.append(
    block, sep(),
    btn('B', 'Bold (Ctrl+B)', () => exec('bold'), q('bold'), 'b'),
    btn('I', 'Italic (Ctrl+I)', () => exec('italic'), q('italic'), 'i'),
    btn('U', 'Underline (Ctrl+U)', () => exec('underline'), q('underline'), 'u'),
    btn('S', 'Strikethrough', () => exec('strikeThrough'), q('strikeThrough'), 's'),
    sep(),
    btn('• List', 'Bulleted list', () => exec('insertUnorderedList'), q('insertUnorderedList')),
    btn('1. List', 'Numbered list', () => exec('insertOrderedList'), q('insertOrderedList')),
    sep(),
    btn('⇤', 'Align left', () => exec('justifyLeft'), q('justifyLeft')),
    btn('↔', 'Centre', () => exec('justifyCenter'), q('justifyCenter')),
    btn('⇥', 'Align right', () => exec('justifyRight'), q('justifyRight')),
    sep(),
    btn('🔗 Link', 'Add or change a link (Ctrl+K)', () => addLink()),
    btn('⛓️‍💥', 'Remove link', () => exec('unlink')),
    btn('🖼️ Image', 'Upload an image from your computer', () => { saveRange(); fileInput.click(); }),
    btn('🌐 Image URL', 'Insert an image from a web address (https://…)', () => imageFromUrl()),
    btn('―', 'Divider line', () => exec('insertHorizontalRule')),
    sep(),
    btn('🧹', 'Clear formatting', () => { exec('removeFormat'); exec('formatBlock', '<p>'); }),
    btn('↶', 'Undo (Ctrl+Z)', () => exec('undo')),
    btn('↷', 'Redo (Ctrl+Y)', () => exec('redo')),
    h('span', { style: 'flex:1' }),
    sourceBtn,
  );

  function refreshState() {
    for (const [b, f] of stateBtns) b.classList.toggle('on', f());
    if (sourceMode) return;
    let v = 'p';
    try {
      v = String(document.queryCommandValue('formatBlock') || 'p').toLowerCase().replace(/[<>]/g, '');
    } catch { /* ignore */ }
    block.value = ['h2', 'h3', 'blockquote'].includes(v) ? v : 'p';
  }

  function addLink() {
    saveRange();
    const s = getSelection();
    const current = s?.anchorNode ? (s.anchorNode.nodeType === 1 ? (s.anchorNode as Element) : s.anchorNode.parentElement)?.closest('a') : null;
    const url = prompt('Link address (https://…)', current?.getAttribute('href') ?? 'https://');
    if (!url || url === 'https://') return;
    if (!/^(https?:|mailto:|\/)/i.test(url)) return opts.onError?.('Links must start with https://, http://, mailto: or /');
    if (s && s.isCollapsed && !current) exec('insertHTML', `<a href="${escapeAttr(url)}">${escapeHtml(url)}</a>`);
    else exec('createLink', url);
  }

  function imageFromUrl() {
    saveRange();
    const url = prompt('Image address (must start with https://)', 'https://');
    if (!url || url === 'https://') return;
    if (!/^https:\/\//i.test(url)) return opts.onError?.('Image addresses must start with https://');
    insertImage(url);
  }

  // ── Images ─────────────────────────────────────────────────────────────────
  function insertImage(url: string, alt = '') {
    exec('insertHTML', `<img src="${escapeAttr(url)}" alt="${escapeAttr(alt)}" class="img-full img-center"><p><br></p>`);
  }

  async function uploadFiles(files: File[]) {
    const images = files.filter((f) => /^image\/(png|jpeg|webp|gif)$/.test(f.type));
    if (!images.length) return opts.onError?.('Only PNG, JPEG, WebP and GIF images can be added.');
    const range = savedRange?.cloneRange() ?? null;
    for (const f of images) {
      uploading++;
      updateStatus();
      try {
        const url = await opts.upload(await shrinkImage(f));
        savedRange = range;
        insertImage(url, f.name.replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' '));
      } catch (e) {
        opts.onError?.(`Couldn’t upload ${f.name}: ${(e as Error).message}`);
      } finally {
        uploading--;
        updateStatus();
      }
    }
  }
  fileInput.onchange = () => {
    const files = [...(fileInput.files ?? [])];
    fileInput.value = '';
    if (files.length) void uploadFiles(files);
  };

  function selectImage(img: HTMLImageElement | null) {
    selImg?.classList.remove('wy-sel');
    selImg = img;
    imgBar.replaceChildren();
    imgBar.style.display = img ? '' : 'none';
    if (!img) return;
    img.classList.add('wy-sel');
    const has = (c: string) => img.classList.contains(c);
    const setFrom = (group: string[], c: string) => {
      img.classList.remove(...group);
      if (c) img.classList.add(c);
      changed();
      selectImage(img);
    };
    const alt = h('input', { value: img.alt, placeholder: 'Describe the image (for screen readers)', style: 'flex:1;min-width:160px', oninput: () => { img.alt = alt.value; changed(); } }) as HTMLInputElement;
    imgBar.append(
      h('b', {}, '🖼️ Image'),
      h('span', { class: 'muted' }, 'Size'),
      ...SIZES.map(([c, l]) => h('button', { type: 'button', class: `wy-btn${(c ? has(c) : !SIZES.some(([x]) => x && has(x))) ? ' on' : ''}`, onclick: () => setFrom(SIZES.map(([x]) => x).filter(Boolean), c) }, l)),
      h('span', { class: 'muted' }, 'Place'),
      ...PLACES.map(([c, l, t]) => h('button', { type: 'button', title: t, class: `wy-btn${has(c) ? ' on' : ''}`, onclick: () => setFrom(PLACES.map(([x]) => x), c) }, l)),
      alt,
      h('button', { type: 'button', class: 'wy-btn warn', onclick: () => { img.remove(); selectImage(null); changed(); } }, '🗑️ Remove'),
      h('button', { type: 'button', class: 'wy-btn', title: 'Done', onclick: () => selectImage(null) }, '✕'),
    );
  }

  // ── Content events ─────────────────────────────────────────────────────────
  area.addEventListener('input', () => {
    if (selImg && !area.contains(selImg)) selectImage(null);
    // Typing straight into the editor root (e.g. after select-all + delete) → keep it in a paragraph.
    const first = area.firstChild;
    if (first && first.nodeType === 3 && area.childNodes.length === 1) document.execCommand('formatBlock', false, '<p>');
    changed();
  });
  area.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    selectImage(t.tagName === 'IMG' && area.contains(t) ? (t as HTMLImageElement) : null);
  });
  area.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      addLink();
    }
    if (selImg && (e.key === 'Delete' || e.key === 'Backspace')) {
      e.preventDefault();
      selImg.remove();
      selectImage(null);
      changed();
    }
  });
  area.addEventListener('paste', (e) => {
    const dt = e.clipboardData;
    if (!dt) return;
    const files = [...dt.files].filter((f) => f.type.startsWith('image/'));
    e.preventDefault();
    if (files.length) {
      saveRange();
      void uploadFiles(files);
      return;
    }
    const html = dt.getData('text/html');
    if (html) exec('insertHTML', sanitizeHtml(html.replace(/<!--[\s\S]*?-->/g, '')));
    else exec('insertText', dt.getData('text/plain'));
  });
  area.addEventListener('dragover', (e) => {
    if (e.dataTransfer?.types.includes('Files')) {
      e.preventDefault();
      area.classList.add('drop');
    }
  });
  area.addEventListener('dragleave', () => area.classList.remove('drop'));
  area.addEventListener('drop', (e) => {
    area.classList.remove('drop');
    const files = [...(e.dataTransfer?.files ?? [])];
    if (!files.length) return;
    e.preventDefault();
    const doc = document as Document & { caretRangeFromPoint?: (x: number, y: number) => Range | null; caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null };
    let r: Range | null = null;
    if (doc.caretRangeFromPoint) r = doc.caretRangeFromPoint(e.clientX, e.clientY);
    else if (doc.caretPositionFromPoint) {
      const p = doc.caretPositionFromPoint(e.clientX, e.clientY);
      if (p) {
        r = document.createRange();
        r.setStart(p.offsetNode, p.offset);
      }
    }
    if (r && area.contains(r.startContainer)) savedRange = r;
    void uploadFiles(files);
  });

  // ── HTML source mode ───────────────────────────────────────────────────────
  function toggleSource() {
    selectImage(null);
    if (!sourceMode) {
      source.value = prettyHtml(getHtml());
      area.style.display = 'none';
      source.style.display = '';
      source.focus();
    } else {
      area.innerHTML = sanitizeHtml(source.value);
      source.style.display = 'none';
      area.style.display = '';
      area.focus();
    }
    sourceMode = !sourceMode;
    for (const el of toolbar.querySelectorAll<HTMLElement>('button, select')) if (el !== sourceBtn) (el as HTMLButtonElement).disabled = sourceMode;
    refreshState();
    changed();
  }
  source.addEventListener('input', changed);

  function updateStatus() {
    const text = (sourceMode ? source.value.replace(/<[^>]*>/g, ' ') : area.innerText) ?? '';
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    const imgs = sourceMode ? (source.value.match(/<img\b/gi) ?? []).length : area.querySelectorAll('img').length;
    status.textContent = `${words} words · ${imgs} image${imgs === 1 ? '' : 's'}${uploading ? ` · ⏳ uploading ${uploading}…` : ''}`;
  }

  /** Wrap loose top-level text / inline runs in paragraphs. */
  function wrapLoose(html: string) {
    const box = document.createElement('div');
    box.innerHTML = html;
    const BLOCK = /^(P|H2|H3|H4|UL|OL|BLOCKQUOTE|HR|FIGURE|DIV)$/;
    let run: HTMLParagraphElement | null = null;
    for (const n of [...box.childNodes]) {
      const isBlock = n.nodeType === 1 && BLOCK.test((n as Element).tagName);
      if (isBlock) { run = null; continue; }
      if (!run) {
        if (n.nodeType === 3 && !n.textContent!.trim()) continue;
        run = document.createElement('p');
        n.before(run);
      }
      run.append(n);
    }
    return box.innerHTML;
  }

  function getHtml() {
    const html = wrapLoose(sourceMode ? source.value : area.innerHTML);
    // Drop the empty paragraphs the browser leaves behind (an "empty" editor still holds <p><br></p>).
    return sanitizeHtml(html).replace(/<p>\s*<\/p>/g, '').replace(/(<p>(<br>|&nbsp;|\s)*<\/p>)+$/, '').trim();
  }
  function setHtml(html: string) {
    area.innerHTML = sanitizeHtml(html) || '<p><br></p>';
    if (sourceMode) source.value = prettyHtml(getHtml());
    selectImage(null);
    updateStatus();
  }

  try {
    document.execCommand('defaultParagraphSeparator', false, 'p');
    document.execCommand('styleWithCSS', false, 'false');
  } catch { /* old browsers */ }
  setHtml(opts.html);
  return { el: root, getHtml, setHtml, focus: () => area.focus() };
}

// ── Helpers ──────────────────────────────────────────────────────────────────
const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const escapeAttr = escapeHtml;

/** One block per line, so the HTML view is readable. */
function prettyHtml(html: string) {
  return html.replace(/(<\/(p|h2|h3|h4|ul|ol|li|blockquote|figure|div)>|<hr>|<br>(?=<))/g, '$1\n').replace(/(<(ul|ol)>)/g, '$1\n').trim();
}

/** Downscale big photos before upload (GIFs are kept as they are, to stay animated). */
async function shrinkImage(file: File, max = 1600): Promise<File> {
  if (file.type === 'image/gif') return file;
  const bmp = await createImageBitmap(file).catch(() => null);
  if (!bmp) return file;
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  if (k === 1 && file.size < 1.5 * 1024 * 1024) return file;
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k);
  c.height = Math.round(bmp.height * k);
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
  const type = file.type === 'image/jpeg' ? 'image/jpeg' : 'image/webp';
  const blob = await new Promise<Blob | null>((res) => c.toBlob(res, type, 0.86));
  if (!blob || blob.type !== type) return file;
  return new File([blob], file.name, { type });
}

/** File → data URL (for the upload request). */
export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = () => rej(r.error ?? new Error('Couldn’t read the file'));
    r.readAsDataURL(file);
  });
}

