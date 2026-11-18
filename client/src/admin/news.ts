// Admin tool: the news boxes on the start screen.

import { api } from '../auth.ts';
import { newsCard, type NewsItem } from '../ui/start.ts';
import { h, clear } from '../ui/dom.ts';
import { bodyToEditorHtml } from '../ui/richtext.ts';
import { call, input, shell, toast, guardUnsaved } from './ui.ts';
import { createWysiwyg, fileToDataUrl } from './wysiwyg.ts';

export async function newsPage(editId: number | null) {
  const r = await call<{ news: NewsItem[] }>('GET', '/api/admin/news');
  if (!r) return;
  const list = h('div', { class: 'box col' });
  const editor = h('div', { class: 'col', style: 'gap:16px' });
  shell('news', h('div', { class: 'split-news' }, list, editor));
  list.append(h('div', { class: 'row' }, h('h3', { style: 'margin:0' }, '📰 Start-screen news'), h('span', { style: 'flex:1' }),
    h('a', { class: 'btn small', href: '#news/0' }, '+ New box')),
    h('p', { class: 'muted' }, 'Shown on the start screen, pinned boxes first, then newest first. Drafts (unpublished) are only visible here.'),
    h('table', { class: 'data' }, h('tr', {}, ['', 'Title', 'Date'].map((t) => h('th', {}, t))),
      r.news.map((n) => h('tr', { class: `click${n.id === editId ? ' sel' : ''}`, onclick: () => (location.hash = `news/${n.id}`) },
        h('td', { style: 'font-size:22px' }, n.imageOnly ? '🖼️' : n.icon), h('td', {}, h('b', {}, n.title), n.pinned ? h('span', { class: 'pill', style: 'margin-left:6px' }, '📌') : null, n.published ? null : h('span', { class: 'pill no', style: 'margin-left:6px' }, 'draft'),
          n.author ? h('div', { class: 'muted' }, n.author) : null),
        h('td', { class: 'muted' }, new Date(n.created).toLocaleDateString())))));
  if (editId === null) return void editor.append(h('div', { class: 'box' }, h('p', { class: 'muted' }, 'Pick a news box, or create a new one.')));
  const n: NewsItem = r.news.find((x) => x.id === editId) ?? { id: 0, title: '', body: '', icon: '📰', created: Date.now(), updated: Date.now(), author: null, pinned: false, published: true };
  const title = input(n.title, { maxlength: 120, style: 'flex:1;font-size:16px;font-weight:700', placeholder: 'Title' });
  const icon = input(n.icon, { maxlength: 16, style: 'width:64px;font-size:22px;text-align:center', title: 'An emoji' });
  const pinned = h('input', { type: 'checkbox', checked: n.pinned }) as HTMLInputElement;
  const published = h('input', { type: 'checkbox', checked: n.published }) as HTMLInputElement;
  const imageOnly = h('input', { type: 'checkbox', checked: !!n.imageOnly }) as HTMLInputElement;
  const preview = h('div');
  const imgHint = h('div', { class: 'errors', style: 'display:none' }, 'Picture only is on, but there’s no picture yet – add one with 🖼️ Image. Until then the box shows as a normal text box.');
  let dirty = false;
  const body = createWysiwyg({
    html: bodyToEditorHtml(n.body),
    upload: async (file) => {
      const res = await api<{ url: string }>('POST', '/api/admin/news/images', { data: await fileToDataUrl(file) });
      return res.url;
    },
    onChange: () => { dirty = true; draw(); },
    onError: (m) => toast(m, false),
  });
  let raf = 0;
  const draw = () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      clear(preview);
      const html = body.getHtml();
      imgHint.style.display = imageOnly.checked && !/<img\b/i.test(html) ? '' : 'none';
      preview.append(newsCard({ ...n, title: title.value || 'Untitled', icon: icon.value || '📰', body: html, pinned: pinned.checked, imageOnly: imageOnly.checked }));
    });
  };
  for (const el of [title, icon, pinned, published, imageOnly]) el.addEventListener('input', () => { dirty = true; draw(); });
  draw();
  window.onbeforeunload = () => (dirty ? 'Unsaved changes' : undefined);
  guardUnsaved(() => dirty);
  const save = async () => {
    const html = body.getHtml();
    if (html.length > 60000) return toast('The text is too long (max 60 000 characters of HTML).', false);
    const payload = { title: title.value, icon: icon.value, body: html, pinned: pinned.checked, published: published.checked, imageOnly: imageOnly.checked };
    const res = await call<{ id: number }>(n.id ? 'PUT' : 'POST', n.id ? `/api/admin/news/${n.id}` : '/api/admin/news', payload);
    if (res) { dirty = false; toast('Saved'); location.hash = `news/${res.id}`; newsPage(res.id); }
  };
  editor.append(h('div', { class: 'box col', style: 'gap:10px' },
    h('div', { class: 'row' }, h('h3', { style: 'margin:0' }, n.id ? 'Edit news box' : 'New news box'), h('span', { style: 'flex:1' }),
      h('label', { class: 'row', style: 'gap:4px', title: 'The box shows just one picture (the first in the text) – no icon, title, date or text. The title is still used as the picture’s description.' }, imageOnly, '🖼️ Picture only'),
      h('label', { class: 'row', style: 'gap:4px', title: 'Stays at the top' }, pinned, '📌 Pinned'),
      h('label', { class: 'row', style: 'gap:4px', title: 'Untick to keep it as a draft' }, published, '🌍 Published')),
    h('div', { class: 'row' }, icon, title),
    imgHint,
    body.el,
    h('div', { class: 'row' },
      h('button', { class: 'btn', onclick: save }, '💾 Save'),
      n.id ? h('button', { class: 'btn warn small', onclick: async () => {
        if (!confirm('Delete this news box?')) return;
        if (await call('DELETE', `/api/admin/news/${n.id}`)) { dirty = false; toast('Deleted'); location.hash = 'news'; }
      } }, 'Delete') : null)),
    h('div', { class: 'box' }, h('h3', {}, '👁️ Preview – as players see it'), h('p', { class: 'muted', style: 'margin-top:0' }, 'News boxes sit on the right of the start screen, 360 px wide.'), h('div', { class: 'news-preview' }, preview)));
}
