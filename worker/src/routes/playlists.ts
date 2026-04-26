import { Hono } from 'hono';
import type { Env, Variables } from '../types/env';
import { jwtAuth } from '../middleware/auth';

const playlists = new Hono<{ Bindings: Env; Variables: Variables }>();

playlists.use('/*', jwtAuth);

playlists.get('/', async (c) => {
  const userId = c.get('userId');
  const items = await c.env.DB.prepare(
    'SELECT * FROM playlists WHERE user_id = ? ORDER BY updated_at DESC'
  ).bind(userId).all();

  return c.json({ items: items.results });
});

playlists.post('/', async (c) => {
  const userId = c.get('userId');
  const body = await c.req.json<{ name: string }>();

  if (!body.name?.trim()) {
    return c.json({ error: 'Название обязательно' }, 400);
  }

  const now = Math.floor(Date.now() / 1000);
  const id = crypto.randomUUID();

  await c.env.DB.prepare(
    'INSERT INTO playlists (id, user_id, name, is_liked, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)'
  ).bind(id, userId, body.name.trim(), now, now).run();

  const playlist = await c.env.DB.prepare('SELECT * FROM playlists WHERE id = ?').bind(id).first();
  return c.json(playlist, 201);
});

playlists.get('/:id', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');

  const playlist = await c.env.DB.prepare(
    'SELECT * FROM playlists WHERE id = ? AND user_id = ?'
  ).bind(id, userId).first();

  if (!playlist) {
    return c.json({ error: 'Плейлист не найден' }, 404);
  }

  const tracks = await c.env.DB.prepare(
    'SELECT * FROM playlist_tracks WHERE playlist_id = ? ORDER BY position ASC'
  ).bind(id).all();

  return c.json({ ...playlist, tracks: tracks.results });
});

playlists.put('/:id', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  const body = await c.req.json<{ name: string }>();

  const existing = await c.env.DB.prepare(
    'SELECT id, is_liked FROM playlists WHERE id = ? AND user_id = ?'
  ).bind(id, userId).first<{ id: string; is_liked: number }>();

  if (!existing) {
    return c.json({ error: 'Плейлист не найден' }, 404);
  }

  if (existing.is_liked === 1) {
    return c.json({ error: 'Системный плейлист нельзя переименовать' }, 400);
  }

  const now = Math.floor(Date.now() / 1000);
  await c.env.DB.prepare(
    'UPDATE playlists SET name = ?, updated_at = ? WHERE id = ?'
  ).bind(body.name.trim(), now, id).run();

  const updated = await c.env.DB.prepare('SELECT * FROM playlists WHERE id = ?').bind(id).first();
  return c.json(updated);
});

playlists.delete('/:id', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');

  const existing = await c.env.DB.prepare(
    'SELECT id, is_liked FROM playlists WHERE id = ? AND user_id = ?'
  ).bind(id, userId).first<{ id: string; is_liked: number }>();

  if (!existing) {
    return c.json({ error: 'Плейлист не найден' }, 404);
  }

  if (existing.is_liked === 1) {
    return c.json({ error: 'Системный плейлист нельзя удалить' }, 400);
  }

  await c.env.DB.prepare('DELETE FROM playlists WHERE id = ?').bind(id).run();
  return c.json({ ok: true });
});

playlists.post('/:id/tracks', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  const body = await c.req.json<{ trackId: string; source?: string }>();

  const playlist = await c.env.DB.prepare(
    'SELECT id FROM playlists WHERE id = ? AND user_id = ?'
  ).bind(id, userId).first();

  if (!playlist) {
    return c.json({ error: 'Плейлист не найден' }, 404);
  }

  const maxPos = await c.env.DB.prepare(
    'SELECT MAX(position) as max_pos FROM playlist_tracks WHERE playlist_id = ?'
  ).bind(id).first<{ max_pos: number | null }>();

  const position = (maxPos?.max_pos ?? -1) + 1;
  const now = Math.floor(Date.now() / 1000);

  await c.env.DB.prepare(
    'INSERT OR IGNORE INTO playlist_tracks (playlist_id, track_id, source, position, added_at) VALUES (?, ?, ?, ?, ?)'
  ).bind(id, body.trackId, body.source ?? 'tidal', position, now).run();

  await c.env.DB.prepare('UPDATE playlists SET updated_at = ? WHERE id = ?').bind(now, id).run();
  return c.json({ ok: true }, 201);
});

playlists.delete('/:id/tracks/:trackId', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  const trackId = c.req.param('trackId');

  const playlist = await c.env.DB.prepare(
    'SELECT id FROM playlists WHERE id = ? AND user_id = ?'
  ).bind(id, userId).first();

  if (!playlist) {
    return c.json({ error: 'Плейлист не найден' }, 404);
  }

  await c.env.DB.prepare(
    'DELETE FROM playlist_tracks WHERE playlist_id = ? AND track_id = ?'
  ).bind(id, trackId).run();

  const now = Math.floor(Date.now() / 1000);
  await c.env.DB.prepare('UPDATE playlists SET updated_at = ? WHERE id = ?').bind(now, id).run();
  return c.json({ ok: true });
});

export { playlists };
