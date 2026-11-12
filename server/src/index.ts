import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { WebSocketServer } from 'ws';
import { PROTOCOL_VERSION } from '@hearthwood/shared';
import { config } from './config.ts';
import { Store } from './store.ts';
import { Game } from './game/Game.ts';

const store = new Store(config.dataDir);
store.load();
const game = new Game(store);
game.start();

// ── Tiny per-IP limiter for account creation ───────────────────────────────
const registerLog = new Map<string, number[]>();
function allowRegister(ip: string) {
  const now = Date.now();
  const list = (registerLog.get(ip) ?? []).filter((t) => now - t < 3600_000);
  if (list.length >= config.registerPerHourPerIp) return false;
  list.push(now);
  registerLog.set(ip, list);
  return true;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};

function json(res: http.ServerResponse, code: number, body: unknown) {
  res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

function clientIp(req: http.IncomingMessage) {
  return req.socket.remoteAddress ?? 'unknown';
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  // Basic hardening headers.
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('referrer-policy', 'no-referrer');

  if (url.pathname === '/api/health') return json(res, 200, { ok: true, protocol: PROTOCOL_VERSION, online: game.online.size });

  if (url.pathname === '/api/register') {
    if (req.method !== 'POST') return json(res, 405, { error: 'POST only' });
    if (!allowRegister(clientIp(req))) return json(res, 429, { error: 'Too many new accounts from this address. Try later.' });
    const out = game.register();
    return json(res, 200, out);
  }

  // Serve the built client in production (in dev, Vite serves it and proxies /api + /ws here).
  if (req.method === 'GET' && fs.existsSync(config.clientDist)) {
    const rel = path.normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
    let file = path.join(config.clientDist, rel);
    if (!file.startsWith(config.clientDist)) return json(res, 403, { error: 'forbidden' });
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(config.clientDist, 'index.html');
    res.writeHead(200, {
      'content-type': MIME[path.extname(file)] ?? 'application/octet-stream',
      'cache-control': file.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
    return fs.createReadStream(file).pipe(res);
  }

  json(res, 404, { error: 'not found' });
});

const wss = new WebSocketServer({ noServer: true, maxPayload: config.maxMessageBytes });

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname !== '/ws') return socket.destroy();
  const origin = req.headers.origin;
  if (config.allowedOrigins.length && (!origin || !config.allowedOrigins.includes(origin))) {
    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
    return socket.destroy();
  }
  wss.handleUpgrade(req, socket, head, (ws) => game.handleConnection(ws, clientIp(req)));
});

server.listen(config.port, config.host, () => {
  console.log(`[hearthwood] server listening on http://localhost:${config.port}  (protocol v${PROTOCOL_VERSION}${config.devFast ? ', DEV_FAST' : ''})`);
});

function shutdown() {
  console.log('\n[hearthwood] saving & shutting down…');
  game.stop();
  wss.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
