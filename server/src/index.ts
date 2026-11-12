import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { WebSocketServer } from 'ws';
import { PROTOCOL_VERSION } from '@hearthwood/shared';
import { config } from './config.ts';
import { Store } from './store.ts';
import { Game } from './game/Game.ts';
import { buildApi } from './api.ts';
import { clientIp, json } from './http.ts';
import { logger, logLevel } from './log.ts';

const log = logger('server');
const httpLog = logger('http');

process.on('uncaughtException', (e) => log.error('uncaught exception', { err: e }));
process.on('unhandledRejection', (e) => log.error('unhandled rejection', { err: e }));

const store = new Store(config.dataDir);
store.load();
store.seedNews();
const game = new Game(store);
game.loadGameData();
game.start();
const api = buildApi(game, store);

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};

/** Pretty URLs for the tools; the game creation tool only exists in dev mode. */
const PAGES: Record<string, string> = { '/admin': 'admin.html', '/admin/': 'admin.html', '/editor': 'editor.html', '/editor/': 'editor.html' };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  // Basic hardening headers.
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('referrer-policy', 'no-referrer');
  res.setHeader('x-frame-options', 'DENY');

  if (url.pathname.startsWith('/api/')) {
    try {
      if (await api.handle(req, res, url)) return;
    } catch (e) {
      httpLog.error('api error', { path: url.pathname, err: e });
      if (!res.headersSent) return json(res, 500, { error: 'Server error' });
      return;
    }
    return json(res, 404, { error: 'not found' });
  }

  // Serve the built client in production (in dev, Vite serves it and proxies /api + /ws here).
  if (req.method === 'GET' && fs.existsSync(config.clientDist)) {
    const page = PAGES[url.pathname];
    const rel = page ?? path.normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
    if (!config.devFast && rel.startsWith('editor')) return json(res, 404, { error: 'The game creation tool is only available in dev mode.' });
    let file = path.join(config.clientDist, rel);
    if (!file.startsWith(config.clientDist)) {
      httpLog.warn('path traversal attempt', { ip: clientIp(req), path: url.pathname });
      return json(res, 403, { error: 'forbidden' });
    }
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
    httpLog.warn('websocket origin refused', { ip: clientIp(req), origin });
    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
    return socket.destroy();
  }
  wss.handleUpgrade(req, socket, head, (ws) => game.handleConnection(ws, clientIp(req)));
});

server.listen(config.port, config.host, () => {
  log.info(`listening on http://localhost:${config.port}`, { protocol: PROTOCOL_VERSION, devFast: config.devFast || undefined, logLevel, data: config.dataDir });
});

function shutdown() {
  log.info('saving & shutting down');
  game.stop();
  store.close();
  wss.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
