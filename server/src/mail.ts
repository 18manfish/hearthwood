// Sending email (confirmation codes) over SMTP – a small client on node:net/tls, so the
// server needs no extra packages. Configure it with environment variables:
//
//   SMTP_HOST     e.g. smtp.gmail.com, mail.infomaniak.com, smtp.sendgrid.net
//   SMTP_PORT     587 (STARTTLS, the default) or 465 (TLS from the start)
//   SMTP_SECURE   1 for TLS from the start (port 465 sets it automatically)
//   SMTP_USER     login name (often the email address)
//   SMTP_PASS     password / app password / API key
//   SMTP_FROM     sender, e.g. "Hearthwood <noreply@example.com>" (defaults to SMTP_USER)
//
// Without SMTP_HOST no mail is sent: the message (with its code) is written to the server
// log instead, so a server without mail set up can still be run and tested.
//
// Passwords are only sent over an encrypted connection (STARTTLS or TLS), except to a
// mail server on this same machine.

import net from 'node:net';
import tls from 'node:tls';
import os from 'node:os';
import crypto from 'node:crypto';
import { logger } from './log.ts';

const log = logger('mail');

export interface MailConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
}

export function mailConfigFromEnv(env = process.env): MailConfig | null {
  const host = env.SMTP_HOST?.trim();
  if (!host) return null;
  const port = Number(env.SMTP_PORT) || (env.SMTP_SECURE === '1' ? 465 : 587);
  const user = env.SMTP_USER ?? '';
  return { host, port, secure: env.SMTP_SECURE === '1' || port === 465, user, pass: env.SMTP_PASS ?? '', from: env.SMTP_FROM || user || `hearthwood@${os.hostname()}` };
}

export const mailConfig = mailConfigFromEnv();

export interface Message {
  to: string;
  subject: string;
  text: string;
}

/** The address part of "Name <addr>". */
const addrOf = (s: string) => /<([^>]+)>/.exec(s)?.[1] ?? s.trim();
const isLocal = (host: string) => host === 'localhost' || host === '127.0.0.1' || host === '::1';

/** RFC 2047 encoding for a header with non-ASCII text. */
const header = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s).toString('base64')}?=`);

function build(cfg: MailConfig, m: Message): string {
  const body = Buffer.from(m.text.replace(/\r?\n/g, '\r\n')).toString('base64').replace(/.{76}/g, '$&\r\n');
  return [
    `From: ${cfg.from}`,
    `To: ${m.to}`,
    `Subject: ${header(m.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${crypto.randomUUID()}@${addrOf(cfg.from).split('@')[1] ?? 'hearthwood'}>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    body,
  ].join('\r\n');
}

/** One SMTP conversation: read replies (multi-line aware), send commands. */
class Conn {
  private buf = '';
  private waiting: ((line: { code: number; text: string }) => void) | null = null;
  private failed: Error | null = null;
  private onFail: ((e: Error) => void) | null = null;
  constructor(public sock: net.Socket) {
    this.attach(sock);
  }
  attach(sock: net.Socket) {
    this.sock = sock;
    sock.setEncoding('utf8');
    sock.on('data', (d: string) => { this.buf += d; this.pump(); });
    sock.on('error', (e) => this.fail(e));
    sock.on('close', () => this.fail(new Error('connection closed')));
  }
  private fail(e: Error) {
    if (this.failed) return;
    this.failed = e;
    this.onFail?.(e);
  }
  private pump() {
    // A reply is complete at a line "NNN text" (a dash after the code means more lines follow).
    for (;;) {
      const lines = this.buf.split('\r\n');
      const end = lines.findIndex((l) => /^\d{3}( |$)/.test(l));
      if (end < 0 || end === lines.length - 1) return;
      const reply = lines.slice(0, end + 1);
      this.buf = lines.slice(end + 1).join('\r\n');
      const w = this.waiting;
      this.waiting = null;
      w?.({ code: Number(reply[end].slice(0, 3)), text: reply.map((l) => l.slice(4)).join('\n') });
    }
  }
  read(timeoutMs = 20000): Promise<{ code: number; text: string }> {
    return new Promise((resolve, reject) => {
      if (this.failed) return reject(this.failed);
      const t = setTimeout(() => reject(new Error('mail server timed out')), timeoutMs);
      this.onFail = (e) => { clearTimeout(t); reject(e); };
      this.waiting = (r) => { clearTimeout(t); this.onFail = null; resolve(r); };
      this.pump();
    });
  }
  async cmd(line: string, ok: number[], shown = line): Promise<string> {
    this.sock.write(`${line}\r\n`);
    const r = await this.read();
    if (!ok.includes(r.code)) throw new Error(`${shown.split(' ')[0]} → ${r.code} ${r.text}`);
    return r.text;
  }
}

/** Send one message. Throws with the server's answer if it is refused. */
export async function smtpSend(cfg: MailConfig, m: Message): Promise<void> {
  const raw = cfg.secure
    ? tls.connect({ host: cfg.host, port: cfg.port, servername: cfg.host })
    : net.connect({ host: cfg.host, port: cfg.port });
  const c = new Conn(raw);
  try {
    const hi = await c.read();
    if (hi.code !== 220) throw new Error(`greeting → ${hi.code} ${hi.text}`);
    const me = os.hostname() || 'hearthwood';
    let caps = await c.cmd(`EHLO ${me}`, [250]);
    let encrypted = cfg.secure;
    if (!encrypted && /^STARTTLS\b/im.test(caps)) {
      await c.cmd('STARTTLS', [220]);
      const secured = tls.connect({ socket: raw, servername: cfg.host });
      await new Promise<void>((res, rej) => { secured.once('secureConnect', res); secured.once('error', rej); });
      raw.removeAllListeners('data');
      c.attach(secured);
      encrypted = true;
      caps = await c.cmd(`EHLO ${me}`, [250]);
    }
    if (cfg.user) {
      if (!encrypted && !isLocal(cfg.host)) throw new Error('the mail server offers no encryption (STARTTLS) – not sending the password');
      if (/^AUTH\b.*\bPLAIN\b/im.test(caps)) {
        await c.cmd(`AUTH PLAIN ${Buffer.from(`\0${cfg.user}\0${cfg.pass}`).toString('base64')}`, [235], 'AUTH PLAIN');
      } else {
        await c.cmd('AUTH LOGIN', [334]);
        await c.cmd(Buffer.from(cfg.user).toString('base64'), [334], 'AUTH user');
        await c.cmd(Buffer.from(cfg.pass).toString('base64'), [235], 'AUTH password');
      }
    }
    await c.cmd(`MAIL FROM:<${addrOf(cfg.from)}>`, [250]);
    await c.cmd(`RCPT TO:<${m.to}>`, [250, 251]);
    await c.cmd('DATA', [354]);
    // Dot-stuffing: a line starting with "." gets another one.
    await c.cmd(`${build(cfg, m).replace(/^\./gm, '..')}\r\n.`, [250], 'message');
    await c.cmd('QUIT', [221]).catch(() => undefined);
  } finally {
    c.sock.destroy();
    raw.destroy();
  }
}

/** Send a message (or, without SMTP set up, write it to the log). Resolves to whether it was sent. */
export async function sendMail(m: Message, cfg = mailConfig): Promise<boolean> {
  if (!cfg) {
    log.warn('SMTP is not set up (SMTP_HOST) – email written to the log instead', { to: m.to, subject: m.subject, text: m.text });
    return false;
  }
  try {
    await smtpSend(cfg, m);
    log.info('email sent', { to: m.to, subject: m.subject });
    return true;
  } catch (e) {
    log.error('email could not be sent', { to: m.to, err: (e as Error).message });
    throw e;
  }
}
