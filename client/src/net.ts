// WebSocket connection to the authoritative server. Handles auth, reconnects,
// clock sync and typed message dispatch.

import { PROTOCOL_VERSION, type ClientMessage, type ServerMessage } from '@hearthwood/shared';

type Handler = (m: ServerMessage) => void;

const TOKEN_KEY = 'hearthwood.token';

export class Net {
  private ws: WebSocket | null = null;
  private handlers = new Set<Handler>();
  private seq = 0;
  private pending = new Map<number, (m: Extract<ServerMessage, { t: 'res' }>) => void>();
  private retry = 0;
  private closedByServer = false;
  /** serverTime ≈ Date.now() + clockOffset */
  clockOffset = 0;
  rtt = 0;
  onStatus: (s: 'connecting' | 'online' | 'offline' | 'fatal', msg?: string) => void = () => {};

  on(h: Handler) {
    this.handlers.add(h);
    return () => this.handlers.delete(h);
  }

  async connect() {
    this.onStatus('connecting');
    let token = localStorage.getItem(TOKEN_KEY);
    if (!token) {
      const r = await fetch('/api/register', { method: 'POST' });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        this.onStatus('fatal', body.error ?? 'Could not create an account.');
        return;
      }
      token = (await r.json()).token as string;
      localStorage.setItem(TOKEN_KEY, token);
    }
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.send({ t: 'hello', token: token!, v: PROTOCOL_VERSION });
      this.onStatus('online');
      this.ping();
    };
    ws.onmessage = (ev) => {
      let m: ServerMessage;
      try {
        m = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (m.t === 'pong') {
        this.rtt = Date.now() - m.ct;
        this.clockOffset = m.st + this.rtt / 2 - Date.now();
      }
      if (m.t === 'err' && m.code === 'auth') {
        // Token unknown (e.g. server data wiped) – start fresh.
        localStorage.removeItem(TOKEN_KEY);
      }
      if (m.t === 'err' && (m.code === 'replaced' || m.code === 'version')) {
        this.closedByServer = true;
        this.onStatus('fatal', m.msg);
      }
      if (m.t === 'res') {
        const cb = this.pending.get(m.seq);
        if (cb) {
          this.pending.delete(m.seq);
          cb(m);
        }
      }
      for (const h of this.handlers) h(m);
    };
    ws.onclose = () => {
      this.ws = null;
      if (this.closedByServer) return;
      this.onStatus('offline');
      const delay = Math.min(10000, 500 * 2 ** this.retry++);
      setTimeout(() => this.connect(), delay);
    };
  }

  private ping() {
    if (!this.ws) return;
    this.send({ t: 'ping', ct: Date.now() });
    setTimeout(() => this.ping(), 10000);
  }

  send(m: ClientMessage) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  nextSeq() {
    return ++this.seq;
  }

  /** Send an action and resolve with the server's verdict. */
  act(a: Extract<ClientMessage, { t: 'act' }>['a']): Promise<Extract<ServerMessage, { t: 'res' }>> {
    const seq = this.nextSeq();
    return new Promise((resolve) => {
      this.pending.set(seq, resolve);
      this.send({ t: 'act', seq, a });
      setTimeout(() => {
        if (this.pending.delete(seq)) resolve({ t: 'res', seq, ok: false, err: 'No response from server.' });
      }, 5000);
    });
  }

  serverNow() {
    return Date.now() + this.clockOffset;
  }
}

export const net = new Net();
