import { Hono } from 'hono';
import type { Env, Variables } from '../types/env';
import { jwtAuth } from '../middleware/auth';
import { TidalService } from '../services/tidal/TidalService';

const tracks = new Hono<{ Bindings: Env; Variables: Variables }>();

tracks.use('/*', jwtAuth);

tracks.get('/:id', async (c) => {
  const id = c.req.param('id');
  const tidal = new TidalService(c.env);
  const track = await tidal.getTrack(id);
  return c.json(track);
});

tracks.get('/:id/stream', async (c) => {
  const id = c.req.param('id');
  const userId = c.get('userId');
  const isAdmin = c.get('isAdmin');

  if (!isAdmin) {
    const now = Math.floor(Date.now() / 1000);
    const sub = await c.env.DB.prepare(
      'SELECT id FROM subscriptions WHERE user_id = ? AND status = ? AND expires_at > ? LIMIT 1'
    ).bind(userId, 'active', now).first();

    if (!sub) {
      const today = new Date().toISOString().split('T')[0];
      const listen = await c.env.DB.prepare(
        'SELECT count FROM daily_listens WHERE user_id = ? AND date = ?'
      ).bind(userId, today).first<{ count: number }>();

      const used = listen?.count ?? 0;
      if (used >= 3) {
        return c.json({ error: 'Лимит 3 трека в сутки исчерпан. Оформите подписку.' }, 403);
      }

      if (listen) {
        await c.env.DB.prepare(
          'UPDATE daily_listens SET count = count + 1 WHERE user_id = ? AND date = ?'
        ).bind(userId, today).run();
      } else {
        await c.env.DB.prepare(
          'INSERT INTO daily_listens (user_id, date, count) VALUES (?, ?, 1)'
        ).bind(userId, today).run();
      }
    }
  }

  const override = await c.env.DB.prepare(
    'SELECT r2_key, mime_type FROM track_overrides WHERE user_id = ? AND track_id = ? LIMIT 1'
  ).bind(userId, id).first<{ r2_key: string; mime_type: string }>();

  if (override) {
    return c.json({ url: override.r2_key, mimeType: override.mime_type, source: 'override' });
  }

  const tidal = new TidalService(c.env);
  const url = await tidal.getStreamUrl(id);
  return c.json({ url, source: 'tidal' });
});

tracks.get('/:id/download', async (c) => {
  const id = c.req.param('id');
  const tidal = new TidalService(c.env);
  const url = await tidal.getDownloadUrl(id);
  return c.json({ url, source: 'tidal' });
});

tracks.get('/:id/radio', async (c) => {
  const id = c.req.param('id');
  const tidal = new TidalService(c.env);
  const tracks = await tidal.getTrackRadio(id);
  return c.json({ items: tracks });
});

export { tracks };
