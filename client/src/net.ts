// WebSocket connection to the authoritative server. Handles auth, reconnects,
// clock sync and typed message dispatch.

import { PROTOCOL_VERSION, type ClientMessage, type ServerMessage } from '@hearthwood/shared';
import { clearToken, token as getToken } from './auth.ts';

type Handler = (m: ServerMessage) => void;


export class Net {
  private ws: WebSocket | null = null;
  private handlers = new Set<Handler>();
  private seq = 0;
  private pending = new Map<number, (m: Extract<ServerMessage, { t: 'res' }>) => void>();
  /** Called as each action goes out and when its answer arrives (sounds hook in here). */
  onActSent: ((a: Extract<ClientMessage, { t: 'act' }>['a']) => void) | null = null;
  onActDone: ((a: Extract<ClientMessage, { t: 'act' }>['a'], r: Extract<ServerMessage, { t: 'res' }>) => void) | null = null;
  private retry = 0;
  private closedByServer = false;
  /** serverTime ≈ Date.now() + clockOffset */
  clockOffset = 0;
  rtt = 0;
  onStatus: (s: 'connecting' | 'online' | 'offline' | 'fatal', msg?: string) => void = () => {};
  /** The server wants a (new) login: 'login' (token unknown), 'register' (guest account must pick a name), 'banned'. */
  onAuth: (kind: 'login' | 'register' | 'banned', msg: string) => void = () => {};

  on(h: Handler) {
    this.handlers.add(h);
    return () => this.handlers.delete(h);
  }

  async connect() {
    this.onStatus('connecting');
    const token = getToken();
    if (!token) return this.onAuth('login', '');
    this.closedByServer = false;
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
      if (m.t === 'err' && (m.code === 'auth' || m.code === 'register' || m.code === 'banned' || m.code === 'kicked')) {
        this.closedByServer = true;
        if (m.code === 'auth') clearToken(); // token unknown (e.g. logged out elsewhere)
        if (m.code === 'kicked') this.onStatus('fatal', m.msg);
        else this.onAuth(m.code === 'auth' ? 'login' : m.code, m.msg);
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
    this.onActSent?.(a);
    return new Promise((resolve0) => {
      const resolve = (r: Extract<ServerMessage, { t: 'res' }>) => {
        this.onActDone?.(a, r);
        resolve0(r);
      };
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
