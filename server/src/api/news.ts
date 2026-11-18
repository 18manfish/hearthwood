// HTTP API: the news boxes on the start screen (everyone reads them, admins write them).

import crypto from 'node:crypto';
import { HttpError, readJson } from '../http.ts';
import type { NewsRow } from '../store.ts';
import { type Api, str } from './context.ts';

export function newsRoutes(api: Api) {
  const { r, store, admin, actor } = api;
  const newsView = (n: NewsRow) => ({ id: n.id, title: n.title, body: n.body, icon: n.icon ?? '📰', created: n.created, updated: n.updated, author: n.author, pinned: !!n.pinned, published: !!n.published, imageOnly: !!n.image_only });
  r.on('GET', '/api/news', () => ({ news: store.news().map(newsView) }));
  r.on('GET', '/api/admin/news', ({ req }) => {
    admin(req);
    return { news: store.news(true).map(newsView) };
  });
  const readNews = async (req: Parameters<typeof readJson>[0]) => {
    const b = await readJson(req, 64 * 1024);
    return {
      title: str(b.title, 1, 120, 'Title'),
      body: str(b.body, 0, 60000, 'Text'),
      icon: typeof b.icon === 'string' && b.icon.length <= 16 ? b.icon || '📰' : '📰',
      pinned: b.pinned === true,
      published: b.published !== false,
      imageOnly: b.imageOnly === true,
    };
  };
  r.on('POST', '/api/admin/news', async ({ req }) => {
    const me = admin(req);
    const id = store.saveNews(await readNews(req), actor(me));
    store.audit(actor(me), 'news.create', String(id));
    return { ok: true, id };
  });
  r.on('PUT', '/api/admin/news/:id', async ({ req, params }) => {
    const me = admin(req);
    const id = Number(params.id);
    if (!store.news(true).some((n) => n.id === id)) throw new HttpError(404, 'No such news box.');
    store.saveNews({ ...(await readNews(req)), id }, actor(me));
    store.audit(actor(me), 'news.edit', String(id));
    return { ok: true, id };
  });
  // Images inside news boxes: uploaded as a data URL, served as plain files.
  const IMAGE_TYPES: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };
  r.on('POST', '/api/admin/news/images', async ({ req }) => {
    const me = admin(req);
    const b = await readJson(req, 8 * 1024 * 1024);
    const m = typeof b.data === 'string' ? /^data:(image\/[a-z]+);base64,([A-Za-z0-9+/=]+)$/.exec(b.data) : null;
    if (!m || !IMAGE_TYPES[m[1]]) throw new HttpError(400, 'Send a PNG, JPEG, WebP or GIF image.');
    const data = Buffer.from(m[2], 'base64');
    if (!data.length || data.length > 5 * 1024 * 1024) throw new HttpError(413, 'Images can be at most 5 MB.');
    const id = `${crypto.randomBytes(9).toString('base64url')}.${IMAGE_TYPES[m[1]]}`;
    store.saveNewsImage(id, m[1], data, actor(me));
    store.audit(actor(me), 'news.image', id, { bytes: data.length });
    return { ok: true, id, url: `/api/news/images/${id}` };
  });
  r.on('GET', '/api/news/images/:id', ({ res, params }) => {
    const img = /^[A-Za-z0-9_-]+\.[a-z]+$/.test(params.id) ? store.newsImage(params.id) : undefined;
    if (!img) throw new HttpError(404, 'No such image.');
    res.writeHead(200, { 'content-type': img.mime, 'content-length': img.data.byteLength, 'cache-control': 'public, max-age=31536000, immutable', 'x-content-type-options': 'nosniff' });
    res.end(Buffer.from(img.data));
  });
  r.on('DELETE', '/api/admin/news/:id', ({ req, params }) => {
    const me = admin(req);
    store.deleteNews(Number(params.id));
    store.audit(actor(me), 'news.delete', params.id);
    return { ok: true };
  });
}

