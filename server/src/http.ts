// Tiny HTTP helpers: JSON bodies, replies, bearer auth and a minimal router.

import type http from 'node:http';

export class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export function json(res: http.ServerResponse, code: number, body: unknown) {
  res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

export function clientIp(req: http.IncomingMessage) {
  return req.socket.remoteAddress ?? 'unknown';
}

/** Read a JSON body (default limit 2 MB). */
export function readJson(req: http.IncomingMessage, limit = 2 * 1024 * 1024): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        reject(new HttpError(413, 'Request too large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        const v = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (typeof v !== 'object' || v === null || Array.isArray(v)) return reject(new HttpError(400, 'Expected a JSON object'));
        resolve(v as Record<string, unknown>);
      } catch {
        reject(new HttpError(400, 'Malformed JSON'));
      }
    });
    req.on('error', reject);
  });
}

export function bearer(req: http.IncomingMessage): string | null {
  const h = req.headers.authorization;
  return h && h.startsWith('Bearer ') ? h.slice(7).trim() : null;
}

export type Handler = (ctx: { req: http.IncomingMessage; res: http.ServerResponse; params: Record<string, string>; url: URL }) => Promise<unknown> | unknown;

/** Routes like "GET /api/admin/players/:id". A handler's return value is sent as JSON. */
export class Router {
  private routes: { method: string; parts: string[]; handler: Handler }[] = [];

  on(method: string, pattern: string, handler: Handler) {
    this.routes.push({ method, parts: pattern.split('/').filter(Boolean), handler });
    return this;
  }

  /** Try to handle the request; false if no route matched. */
  async handle(req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<boolean> {
    const segs = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    let pathMatched = false;
    for (const r of this.routes) {
      if (r.parts.length !== segs.length) continue;
      const params: Record<string, string> = {};
      const ok = r.parts.every((p, i) => (p.startsWith(':') ? ((params[p.slice(1)] = segs[i]), true) : p === segs[i]));
      if (!ok) continue;
      pathMatched = true;
      if (r.method !== req.method) continue;
      try {
        const out = await r.handler({ req, res, params, url });
        if (!res.headersSent) json(res, 200, out ?? { ok: true });
      } catch (e) {
        if (res.headersSent) return true;
        if (e instanceof HttpError) json(res, e.status, { error: e.message });
        else throw e;
      }
      return true;
    }
    if (pathMatched) {
      json(res, 405, { error: 'Method not allowed' });
      return true;
    }
    return false;
  }
}
