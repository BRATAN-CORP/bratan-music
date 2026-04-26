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

  const storageService = new StorageService(c.env);
  const object = await storageService.getObject(override.r2_key);

  if (!object) {
    return c.json({ error: 'Файл не найден в хранилище' }, 404);
  }

  return new Response(object.body, {
    headers: {
      'Content-Type': override.mime_type,
      'Cache-Control': 'private, max-age=3600',
    },
  });
});

export { overrides };
