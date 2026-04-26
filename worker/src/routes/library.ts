import { Hono } from 'hono';
import type { Env, Variables } from '../types/env';
import { jwtAuth } from '../middleware/auth';

const library = new Hono<{ Bindings: Env; Variables: Variables }>();

library.use('/*', jwtAuth);

async function ensureLikedPlaylist(db: D1Database, userId: string): Promise<string> {
  const existing = await db.prepare(
    'SELECT id FROM playlists WHERE user_id = ? AND is_liked = 1 LIMIT 1'
  ).bind(userId).first<{ id: string }>();

  if (existing) return existing.id;

  const id = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  await db.prepare(
    'INSERT INTO playlists (id, user_id, name, is_liked, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)'
  ).bind(id, userId, 'Мне нравится', now, now).run();

  return id;
}

library.post('/like/:trackId', async (c) => {
  const userId = c.get('userId');
  const trackId = c.req.param('trackId');
  const source = c.req.query('source') ?? 'tidal';

  const playlistId = await ensureLikedPlaylist(c.env.DB, userId);

  const exists = await c.env.DB.prepare(
    'SELECT track_id FROM playlist_tracks WHERE playlist_id = ? AND track_id = ?'
  ).bind(playlistId, trackId).first();

  if (exists) {
    return c.json({ ok: true, liked: true });
  }

  const maxPos = await c.env.DB.prepare(
    'SELECT MAX(position) as max_pos FROM playlist_tracks WHERE playlist_id = ?'
  ).bind(playlistId).first<{ max_pos: number | null }>();

  const position = (maxPos?.max_pos ?? -1) + 1;
  const now = Math.floor(Date.now() / 1000);

  await c.env.DB.prepare(
    'INSERT INTO playlist_tracks (playlist_id, track_id, source, position, added_at) VALUES (?, ?, ?, ?, ?)'
  ).bind(playlistId, trackId, source, position, now).run();

  await c.env.DB.prepare('UPDATE playlists SET updated_at = ? WHERE id = ?').bind(now, playlistId).run();
  return c.json({ ok: true, liked: true }, 201);
});

library.delete('/like/:trackId', async (c) => {
  const userId = c.get('userId');
  const trackId = c.req.param('trackId');

  const playlistId = await ensureLikedPlaylist(c.env.DB, userId);

  await c.env.DB.prepare(
    'DELETE FROM playlist_tracks WHERE playlist_id = ? AND track_id = ?'
  ).bind(playlistId, trackId).run();

  const now = Math.floor(Date.now() / 1000);
  await c.env.DB.prepare('UPDATE playlists SET updated_at = ? WHERE id = ?').bind(now, playlistId).run();
  return c.json({ ok: true, liked: false });
});

library.get('/liked', async (c) => {
  const userId = c.get('userId');
  const limit = parseInt(c.req.query('limit') ?? '50', 10);
  const offset = parseInt(c.req.query('offset') ?? '0', 10);

  const playlistId = await ensureLikedPlaylist(c.env.DB, userId);

  const tracks = await c.env.DB.prepare(
    'SELECT * FROM playlist_tracks WHERE playlist_id = ? ORDER BY added_at DESC LIMIT ? OFFSET ?'
  ).bind(playlistId, limit, offset).all();

  const total = await c.env.DB.prepare(
    'SELECT COUNT(*) as count FROM playlist_tracks WHERE playlist_id = ?'
  ).bind(playlistId).first<{ count: number }>();

  return c.json({
    items: tracks.results,
    total: total?.count ?? 0,
    limit,
    offset,
  });
});

library.get('/playlists', async (c) => {
  const userId = c.get('userId');

  const items = await c.env.DB.prepare(
    'SELECT p.*, (SELECT COUNT(*) FROM playlist_tracks WHERE playlist_id = p.id) as track_count FROM playlists p WHERE p.user_id = ? ORDER BY p.is_liked DESC, p.updated_at DESC'
  ).bind(userId).all();

  return c.json({ items: items.results });
});

export { library };
