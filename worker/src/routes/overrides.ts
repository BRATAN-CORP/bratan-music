import { Hono } from 'hono';
import type { Env, Variables } from '../types/env';
import { jwtAuth } from '../middleware/auth';
import { StorageService } from '../services/StorageService';
import { SubscriptionService } from '../services/SubscriptionService';

const overrides = new Hono<{ Bindings: Env; Variables: Variables }>();

overrides.use('/*', jwtAuth);

overrides.put('/:id/override', async (c) => {
  const userId = c.get('userId');
  const trackId = c.req.param('id');
  const isAdmin = c.get('isAdmin');

  if (!isAdmin) {
    const subService = new SubscriptionService(c.env);
    const hasSub = await subService.hasActiveSubscription(userId);
    if (!hasSub) {
      return c.json({ error: 'Перезалив доступен только для подписчиков' }, 403);
    }
  }

  const contentType = c.req.header('Content-Type') ?? 'audio/mpeg';
  const contentLength = parseInt(c.req.header('Content-Length') ?? '0', 10);
  const source = c.req.query('source') ?? 'tidal';

  if (!c.req.raw.body) {
    return c.json({ error: 'Тело запроса обязательно' }, 400);
  }

  const storageService = new StorageService(c.env);

  try {
    const r2Key = await storageService.upload(
      userId,
      trackId,
      source,
      c.req.raw.body,
      contentType,
      contentLength
    );

    return c.json({ ok: true, r2Key });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Ошибка загрузки';
    return c.json({ error: message }, 400);
  }
});

overrides.delete('/:id/override', async (c) => {
  const userId = c.get('userId');
  const trackId = c.req.param('id');
  const source = c.req.query('source') ?? 'tidal';

  const storageService = new StorageService(c.env);
  const deleted = await storageService.delete(userId, trackId, source);

  if (!deleted) {
    return c.json({ error: 'Перезалив не найден' }, 404);
  }

  return c.json({ ok: true });
});

overrides.get('/:id/override', async (c) => {
  const userId = c.get('userId');
  const trackId = c.req.param('id');
  const source = c.req.query('source') ?? 'tidal';

  const override = await c.env.DB.prepare(
    'SELECT * FROM track_overrides WHERE user_id = ? AND track_id = ? AND source = ?'
  ).bind(userId, trackId, source).first();

  if (!override) {
    return c.json({ exists: false });
  }

  return c.json({ exists: true, override });
});

overrides.get('/:id/override/stream', async (c) => {
  const userId = c.get('userId');
  const trackId = c.req.param('id');
  const source = c.req.query('source') ?? 'tidal';

  const override = await c.env.DB.prepare(
    'SELECT r2_key, mime_type FROM track_overrides WHERE user_id = ? AND track_id = ? AND source = ?'
  ).bind(userId, trackId, source).first<{ r2_key: string; mime_type: string }>();

  if (!override) {
    return c.json({ error: 'Перезалив не найден' }, 404);
  }

  // Honor HTTP Range requests so the <audio> element can seek inside the
  // uploaded file. Without this, R2 returns the full body and the browser
  // refuses to scrub backward (or forward past what's buffered).
  const rangeHeader = c.req.header('Range');
  let rangeOpt: { offset: number; length?: number } | undefined;
  if (rangeHeader) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader);
    if (match) {
      const start = match[1] ? parseInt(match[1], 10) : NaN;
      const end = match[2] ? parseInt(match[2], 10) : NaN;
      if (!Number.isNaN(start)) {
        rangeOpt = { offset: start };
        if (!Number.isNaN(end)) rangeOpt.length = end - start + 1;
      } else if (!Number.isNaN(end)) {
        // suffix-byte-range like "bytes=-N" — ask R2 for the last N bytes
        rangeOpt = { offset: -end };
      }
    }
  }

  const object = await c.env.TRACKS.get(
    override.r2_key,
    rangeOpt ? { range: rangeOpt } : undefined
  );

  if (!object) {
    return c.json({ error: 'Файл не найден в хранилище' }, 404);
  }

  const total = object.size;
  const headers = new Headers();
  headers.set('Content-Type', override.mime_type);
  headers.set('Accept-Ranges', 'bytes');
  headers.set('Cache-Control', 'private, max-age=3600');

  if (rangeOpt) {
    const start = rangeOpt.offset >= 0
      ? rangeOpt.offset
      : Math.max(0, total + rangeOpt.offset);
    const length = rangeOpt.length ?? (total - start);
    const end = Math.min(total - 1, start + length - 1);
    headers.set('Content-Range', `bytes ${start}-${end}/${total}`);
    headers.set('Content-Length', String(end - start + 1));
    return new Response(object.body, { status: 206, headers });
  }

  headers.set('Content-Length', String(total));
  return new Response(object.body, { status: 200, headers });
});

export { overrides };
