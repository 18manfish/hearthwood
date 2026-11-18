// Admin tool: what every page shares – the page shell with its navigation, the
// "unsaved changes" guard, server calls that report errors, and small form helpers.

import { api, logout } from '../auth.ts';
import { h, clear } from '../ui/dom.ts';

export const app = document.getElementById('app')!;

/** Who is logged in (set once at start). */
export interface Me { id: string; username: string | null; name: string; admin: boolean; dev: boolean }
let me: Me;
export function setMe(m: Me) {
  me = m;
}

const toastBox = h('div', { class: 'toastbox' });
export function toast(text: string, ok = true) {
  const t = h('div', { class: ok ? 'okmsg' : 'errors' }, text);
  toastBox.append(t);
  setTimeout(() => t.remove(), ok ? 2500 : 6000);
}
export async function call<T = Record<string, unknown>>(method: string, path: string, body?: unknown): Promise<T | null> {
  try {
    return await api<T>(method, path, body);
  } catch (e) {
    toast((e as Error).message, false);
    return null;
  }
}
export const ago = (t: number) => {
  const s = Math.round((Date.now() - t) / 1000);
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} d ago`;
};
export const field = (label: string, input: HTMLElement, help?: string) => [h('label', {}, label), input, help ? h('div', { class: 'muted help' }, help) : null];
export const input = (value: string | number, attrs: Record<string, unknown> = {}) => h('input', { value: String(value ?? ''), ...attrs }) as HTMLInputElement;
export const select = (options: [string, string][], value: string, attrs: Record<string, unknown> = {}) =>
  h('select', attrs, options.map(([v, l]) => h('option', { value: v, selected: v === value }, l))) as HTMLSelectElement;
export const textarea = (value: unknown, rows = 6) => h('textarea', { rows }, JSON.stringify(value, null, 1)) as HTMLTextAreaElement;
export const parseJson = (t: HTMLTextAreaElement, what: string) => {
  try {
    return JSON.parse(t.value);
  } catch {
    throw new Error(`${what}: invalid JSON`);
  }
};

let unsaved: () => boolean = () => false;
/** The current page reports unsaved work here, so navigating away can ask first. */
export function guardUnsaved(dirty: () => boolean) {
  unsaved = dirty;
}
export const hasUnsaved = () => unsaved();

export function shell(active: string, body: HTMLElement) {
  unsaved = () => false;
  window.onbeforeunload = null;
  clear(app);
  const nav = (hash: string, label: string) => h('a', { class: `btn small${active === hash ? ' on' : ' ghost'}`, href: `#${hash}` }, label);
  app.append(
    h('div', { class: 'tb' },
      h('span', { class: 'brand' }, '🛡️ Hearthwood Admin'),
      nav('players', '👥 Players'), nav('islands', '🏝️ Islands'), nav('news', '📰 News'), nav('gifts', '🎁 Gifts'), nav('audit', '📜 Audit log'),
      h('span', { class: 'sp' }),
      me.dev ? h('a', { class: 'btn ghost small', href: '/editor.html' }, '🛠️ Game creation tool') : null,
      h('a', { class: 'btn ghost small', href: '/' }, '🎮 Game'),
      h('span', { class: 'muted' }, `👤 ${me.username ?? me.name}`),
      h('button', { class: 'btn ghost small', onclick: async () => { await logout(); location.reload(); } }, 'Log out')),
    h('div', { class: 'wrap' }, body),
    toastBox,
  );
}
