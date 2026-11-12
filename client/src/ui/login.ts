// Log-in / create-account screen. Outside dev mode an account (username +
// password) is required; in dev mode you may also play as a guest.

import { api, setToken, type Health } from '../auth.ts';
import { h, clear } from './dom.ts';

export type LoginMode = 'login' | 'register' | 'claim';

/** Show the form; resolves once a login token is stored. */
export function showLogin(app: HTMLElement, opts: { health: Health; mode?: LoginMode; message?: string }): Promise<void> {
  return new Promise((resolve) => {
    let mode: LoginMode = opts.mode ?? 'login';
    const draw = (message = opts.message ?? '') => {
      clear(app);
      const user = h('input', { placeholder: 'Username', autocomplete: 'username', maxlength: 20 }) as HTMLInputElement;
      const pass = h('input', { type: 'password', placeholder: 'Password', autocomplete: mode === 'login' ? 'current-password' : 'new-password', maxlength: 200 }) as HTMLInputElement;
      const pass2 = h('input', { type: 'password', placeholder: 'Repeat password', autocomplete: 'new-password', maxlength: 200 }) as HTMLInputElement;
      const msg = h('div', { class: 'muted', style: 'min-height:20px;color:#b84358' }, message);
      const busy = (on: boolean) => form.querySelectorAll('button').forEach((b) => ((b as HTMLButtonElement).disabled = on));
      const submit = async () => {
        msg.textContent = '';
        if (mode !== 'login' && pass.value !== pass2.value) return void (msg.textContent = 'The passwords don’t match.');
        busy(true);
        try {
          const body = { username: user.value.trim(), password: pass.value };
          if (mode === 'claim') await api('POST', '/api/account', body);
          else {
            const r = await api<{ token: string }>('POST', mode === 'login' ? '/api/login' : '/api/register', body);
            setToken(r.token);
          }
          resolve();
        } catch (e) {
          msg.textContent = (e as Error).message;
          busy(false);
        }
      };
      const guest = async () => {
        busy(true);
        try {
          const r = await api<{ token: string }>('POST', '/api/register', {});
          setToken(r.token);
          resolve();
        } catch (e) {
          msg.textContent = (e as Error).message;
          busy(false);
        }
      };
      const tab = (m: LoginMode, label: string) => h('button', { type: 'button', class: `btn small${mode === m ? '' : ' ghost'}`, onclick: () => { mode = m; draw(); } }, label);
      const title = mode === 'claim' ? 'Secure your account' : mode === 'login' ? 'Welcome back!' : 'Create an account';
      const form = h('form', { class: 'col', style: 'gap:10px', onsubmit: (e: Event) => { e.preventDefault(); submit(); } },
        mode !== 'claim' ? h('div', { class: 'row', style: 'justify-content:center' }, tab('login', 'Log in'), tab('register', 'Create account')) : null,
        h('h2', { style: 'margin:4px 0' }, title),
        mode === 'claim' ? h('p', { class: 'muted', style: 'margin:0' }, 'This server needs a username and password. Your island and items stay with you.') : null,
        user, pass, mode !== 'login' ? pass2 : null,
        mode !== 'login' ? h('div', { class: 'muted', style: 'font-size:12px' }, 'Username: 3–20 letters, digits or _. Password: at least 8 characters.') : null,
        msg,
        h('button', { class: 'btn', type: 'submit' }, mode === 'login' ? 'Log in' : mode === 'claim' ? 'Save & play' : 'Create account & play'),
        opts.health.guests && mode !== 'claim'
          ? h('button', { class: 'btn ghost small', type: 'button', onclick: guest }, '🧪 Play as guest (dev mode)')
          : null);
      app.appendChild(h('div', { class: 'screen' }, h('div', { class: 'card col login', style: 'max-width:380px;width:100%' },
        h('div', { class: 'title', style: 'text-align:center' }, '🌿 Hearthwood'), form)));
      setTimeout(() => user.focus());
    };
    draw();
  });
}
