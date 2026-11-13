// Start screen: logo, news boxes from the server, and a Play button.

import { api, logout } from '../auth.ts';
import { h, clear } from './dom.ts';
import { renderNewsBody } from './richtext.ts';

export interface NewsItem {
  id: number;
  title: string;
  body: string;
  icon: string;
  created: number;
  updated: number;
  author: string | null;
  pinned: boolean;
  published: boolean;
}

/** The game's logo: a little island with a tree and the name. */
export function logo(size = 1): HTMLElement {
  const el = h('div', { class: 'logo', style: `--s:${size}` });
  el.innerHTML = `
    <svg viewBox="0 0 220 120" aria-hidden="true">
      <defs>
        <linearGradient id="lg-sea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7fd4f0"/><stop offset="1" stop-color="#3fa9d6"/></linearGradient>
      </defs>
      <ellipse cx="110" cy="100" rx="104" ry="16" fill="url(#lg-sea)"/>
      <ellipse cx="110" cy="92" rx="70" ry="14" fill="#f3e2b3"/>
      <ellipse cx="110" cy="86" rx="58" ry="11" fill="#79b84c"/>
      <rect x="128" y="58" width="22" height="18" rx="2" fill="#e8d2a6"/>
      <path d="M124 60 L139 46 L154 60 Z" fill="#b5523b"/>
      <rect x="136" y="66" width="6" height="10" fill="#8d5a3b"/>
      <rect x="84" y="50" width="6" height="30" rx="2" fill="#7a5230"/>
      <circle cx="87" cy="44" r="17" fill="#4f9e3a"/>
      <circle cx="76" cy="52" r="10" fill="#5fae4a"/>
      <circle cx="99" cy="51" r="10" fill="#5fae4a"/>
      <circle cx="80" cy="40" r="3" fill="#e53935"/><circle cx="95" cy="45" r="3" fill="#e53935"/>
      <circle cx="176" cy="26" r="11" fill="#f6c445"/>
    </svg>
    <div class="logo-word">Hearthwood</div>
    <div class="logo-sub">a cozy island life, together</div>`;
  return el;
}

export function newsCard(n: NewsItem): HTMLElement {
  return h('article', { class: `news${n.pinned ? ' pinned' : ''}` },
    h('header', {}, h('span', { class: 'news-icon' }, n.icon || '📰'), h('div', {},
      h('h3', {}, n.title, n.pinned ? h('span', { class: 'pill', style: 'margin-left:8px' }, '📌 pinned') : null),
      h('div', { class: 'muted' }, new Date(n.created).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })))),
    renderNewsBody(n.body));
}

/** Show the start screen; resolves when the player presses Play. */
export async function showStart(app: HTMLElement, who: string | null): Promise<void> {
  const news = await api<{ news: NewsItem[] }>('GET', '/api/news').then((r) => r.news).catch(() => [] as NewsItem[]);
  return new Promise((resolve) => {
    clear(app);
    const play = h('button', { class: 'btn play', onclick: () => resolve() }, '▶  Play') as HTMLButtonElement;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        window.removeEventListener('keydown', onKey);
        resolve();
      }
    };
    window.addEventListener('keydown', onKey);
    app.append(h('div', { class: 'screen start' },
      h('div', { class: 'start-col' },
        logo(),
        h('div', { class: 'row', style: 'justify-content:center;gap:12px' }, play),
        who ? h('div', { class: 'muted', style: 'text-align:center' }, `Logged in as ${who} · `,
          h('a', { href: '#', onclick: async (e: Event) => { e.preventDefault(); await logout(); location.reload(); } }, 'log out')) : null,
        h('section', { class: 'news-list' }, news.length ? news.map(newsCard) : h('p', { class: 'muted', style: 'text-align:center' }, 'No news yet.')))));
    setTimeout(() => play.focus());
  });
}
