// Confirming an email address: enter it, get a 6-digit code by email, type the code.
// Every account with a username needs a confirmed address before it can play – new
// accounts right after registering, older ones on their next login.

import { EMAIL_CODE_LENGTH } from '@hearthwood/shared';
import { api, logout } from '../auth.ts';
import { h, clear } from './dom.ts';

export interface EmailStatus {
  email: string | null;
  pending: { email: string; sentAt: number } | null;
  needed: boolean;
}

/** Show the email screen; resolves once the address is confirmed. */
export function showEmailGate(app: HTMLElement, status: EmailStatus, opts: { username?: string | null; message?: string; devCode?: string } = {}): Promise<void> {
  return new Promise((resolve) => {
    let pending = status.pending;
    let devCode = opts.devCode;
    const card = h('div', { class: 'card col login', style: 'max-width:400px;width:100%;gap:10px' });
    clear(app);
    app.appendChild(h('div', { class: 'screen' }, card));

    const frame = (...body: (Node | string | null)[]) => {
      clear(card);
      card.append(h('div', { class: 'title', style: 'text-align:center' }, '🌿 Hearthwood'), ...body.filter((x): x is Node | string => x !== null),
        h('button', { class: 'btn ghost small', type: 'button', style: 'align-self:center', onclick: async () => { await logout(); location.reload(); } },
          opts.username ? `Not ${opts.username}? Log out` : 'Log out'));
    };

    /** Step 1: the address. */
    const askAddress = (message = opts.message ?? '') => {
      const email = h('input', { type: 'email', placeholder: 'you@example.com', autocomplete: 'email', maxlength: 254, value: pending?.email ?? '' }) as HTMLInputElement;
      const msg = h('div', { class: 'muted', style: 'min-height:20px;color:#b84358' }, message);
      const btn = h('button', { class: 'btn', type: 'submit' }, 'Send me a code') as HTMLButtonElement;
      const form = h('form', { class: 'col', style: 'gap:10px', onsubmit: async (e: Event) => {
        e.preventDefault();
        msg.textContent = '';
        btn.disabled = true;
        try {
          const r = await api<{ sentTo: string; devCode?: string }>('POST', '/api/email', { email: email.value });
          pending = { email: r.sentTo, sentAt: Date.now() };
          devCode = r.devCode;
          askCode();
        } catch (err) {
          msg.textContent = (err as Error).message;
          btn.disabled = false;
        }
      } },
      h('h2', { style: 'margin:4px 0' }, '📧 Your email address'),
      h('p', { class: 'muted', style: 'margin:0' }, 'Your account needs an email address. We’ll send you a code to confirm it – after that you can also log in with it.'),
      email, msg, btn);
      frame(form);
      setTimeout(() => email.focus());
    };

    /** Step 2: the code from the email. */
    const askCode = (message = '') => {
      const code = h('input', {
        inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: EMAIL_CODE_LENGTH + 2, placeholder: '123456',
        style: 'font-size:26px;letter-spacing:8px;text-align:center',
      }) as HTMLInputElement;
      const msg = h('div', { class: 'muted', style: 'min-height:20px;color:#b84358' }, message);
      const btn = h('button', { class: 'btn', type: 'submit' }, 'Confirm') as HTMLButtonElement;
      const submit = async () => {
        msg.textContent = '';
        btn.disabled = true;
        try {
          await api('POST', '/api/email/verify', { code: code.value });
          resolve();
        } catch (err) {
          msg.textContent = (err as Error).message;
          btn.disabled = false;
          code.select();
        }
      };
      // Pasting or typing the sixth digit confirms straight away.
      code.oninput = () => {
        code.value = code.value.replace(/\D/g, '').slice(0, EMAIL_CODE_LENGTH);
        if (code.value.length === EMAIL_CODE_LENGTH) void submit();
      };
      const resend = h('button', { class: 'btn ghost small', type: 'button' }, 'Send it again') as HTMLButtonElement;
      const tick = () => {
        const wait = Math.ceil((60_000 - (Date.now() - (pending?.sentAt ?? 0))) / 1000);
        resend.disabled = wait > 0;
        resend.textContent = wait > 0 ? `Send it again (${wait} s)` : 'Send it again';
        if (wait > 0 && resend.isConnected) setTimeout(tick, 1000);
      };
      resend.onclick = async () => {
        try {
          const r = await api<{ sentTo: string; devCode?: string }>('POST', '/api/email', { email: pending!.email });
          pending = { email: r.sentTo, sentAt: Date.now() };
          devCode = r.devCode;
          askCode('A new code is on its way.');
        } catch (err) {
          msg.textContent = (err as Error).message;
        }
      };
      const form = h('form', { class: 'col', style: 'gap:10px', onsubmit: (e: Event) => { e.preventDefault(); void submit(); } },
        h('h2', { style: 'margin:4px 0' }, '📬 Check your email'),
        h('p', { style: 'margin:0' }, 'We sent a 6-digit code to ', h('b', {}, pending!.email), '. It’s valid for 30 minutes – have a look in the spam folder too.'),
        devCode ? h('div', { class: 'pill', style: 'align-self:flex-start' }, `🧪 Dev server without mail: the code is ${devCode}`) : null,
        code, msg, btn,
        h('div', { class: 'row', style: 'justify-content:space-between' }, resend,
          h('button', { class: 'btn ghost small', type: 'button', onclick: () => askAddress() }, 'Use another address')));
      frame(form);
      tick();
      setTimeout(() => code.focus());
    };

    if (pending) askCode();
    else askAddress();
  });
}
