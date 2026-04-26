import { Hono } from 'hono';
import type { Env, Variables } from '../types/env';
import { jwtAuth } from '../middleware/auth';

const playlists = new Hono<{ Bindings: Env; Variables: Variables }>();

// Public cover endpoint — registered BEFORE jwtAuth so <img> tags can
// load it without an Authorization header. The R2 key is namespaced by
// the random playlist UUID, which is effectively unguessable.
playlists.get('/:id/cover', async (c) => {
  const id = c.req.param('id');
  const row = await c.env.DB.prepare(
    'SELECT cover_r2_key FROM playlists WHERE id = ?'
  ).bind(id).first<{ cover_r2_key: string | null }>();

  if (!row?.cover_r2_key) {
    return c.json({ error: 'Обложка не найдена' }, 404);
  }

  const object = await c.env.TRACKS.get(row.cover_r2_key);
  if (!object) {
    return c.json({ error: 'Файл не найден в хранилище' }, 404);
  }

  const headers = new Headers();
  headers.set('Content-Type', object.httpMetadata?.contentType ?? 'image/jpeg');
  headers.set('Cache-Control', 'public, max-age=86400, immutable');
  headers.set('Content-Length', String(object.size));
  return new Response(object.body, { status: 200, headers });
});

playlists.use('/*', jwtAuth);

interface TrackSnapshot {
  title?: string;
  artist?: string;
  album?: string;
  coverUrl?: string;
  duration?: number;
}

function safeJson<T = unknown>(s: string | null | undefined): T | null {
  if (!s) return null;
  try { return JSON.parse(s) as T; } catch { return null; }
}

interface PtRow {
  playlist_id: string;
  track_id: string;
  source: string;
  position: number;
  added_at: number;
  snapshot?: string | null;
}

interface PlaylistRow {
  id: string;
  user_id: string;
  name: string;
  is_liked: number;
  created_at: number;
  updated_at: number;
  track_count?: number | null;
  cover_r2_key?: string | null;
  cover_updated_at?: number | null;
}

const COVER_MAX_BYTES = 2 * 1024 * 1024; // 2 MB
const COVER_ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);

function rowToTrack(r: PtRow) {
  const snap = safeJson<TrackSnapshot>(r.snapshot);
  return {
    id: r.track_id,
    source: r.source,
    addedAt: r.added_at,
    position: r.position,
    title: snap?.title ?? '',
    artist: snap?.artist ?? '',
    album: snap?.album ?? '',
    coverUrl: snap?.coverUrl ?? '',
    duration: snap?.duration ?? 0,
  };
}

function rowToPlaylist(r: PlaylistRow) {
  const hasCover = Boolean(r.cover_r2_key);
  return {
    id: r.id,
    name: r.name,
    isLiked: Boolean(r.is_liked),
    trackCount: Number(r.track_count ?? 0),
    updatedAt: Number(r.updated_at ?? 0),
    createdAt: Number(r.created_at ?? 0),
    coverUrl: hasCover ? `/playlists/${r.id}/cover?v=${r.cover_updated_at ?? 0}` : null,
  };
}

playlists.get('/', async (c) => {
  const userId = c.get('userId');
  const items = await c.env.DB.prepare(
    'SELECT p.*, (SELECT COUNT(*) FROM playlist_tracks WHERE playlist_id = p.id) as track_count FROM playlists p WHERE p.user_id = ? ORDER BY p.is_liked DESC, p.updated_at DESC'
  ).bind(userId).all<PlaylistRow>();

  return c.json({ items: (items.results ?? []).map(rowToPlaylist) });
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

  const playlist = await c.env.DB.prepare(
    'SELECT p.*, 0 as track_count FROM playlists p WHERE p.id = ?'
  ).bind(id).first<PlaylistRow>();
  return c.json(playlist ? rowToPlaylist(playlist) : { id, name: body.name.trim(), isLiked: false, trackCount: 0, updatedAt: now, createdAt: now }, 201);
});

playlists.get('/:id', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');

  const playlist = await c.env.DB.prepare(
    'SELECT p.*, (SELECT COUNT(*) FROM playlist_tracks WHERE playlist_id = p.id) as track_count FROM playlists p WHERE p.id = ? AND p.user_id = ?'
  ).bind(id, userId).first<PlaylistRow>();

  if (!playlist) {
    return c.json({ error: 'Плейлист не найден' }, 404);
  }

  const tracks = await c.env.DB.prepare(
    'SELECT * FROM playlist_tracks WHERE playlist_id = ? ORDER BY position ASC'
  ).bind(id).all<PtRow>();

  return c.json({ ...rowToPlaylist(playlist), tracks: (tracks.results ?? []).map(rowToTrack) });
});

playlists.put('/:id', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  const body = await c.req.json<{ name?: string }>().catch(() => ({}) as { name?: string });
  const name = body.name?.trim();

  if (!name) {
    return c.json({ error: 'Название обязательно' }, 400);
  }

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
  ).bind(name, now, id).run();

  const updated = await c.env.DB.prepare(
    'SELECT p.*, (SELECT COUNT(*) FROM playlist_tracks WHERE playlist_id = p.id) as track_count FROM playlists p WHERE p.id = ?'
  ).bind(id).first<PlaylistRow>();
  return c.json(updated ? rowToPlaylist(updated) : { ok: true });
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
  const body = await c.req.json<{ trackId: string; source?: string; snapshot?: TrackSnapshot }>();

  const playlist = await c.env.DB.prepare(
    'SELECT id FROM playlists WHERE id = ? AND user_id = ?'
  ).bind(id, userId).first();

  if (!playlist) {
    return c.json({ error: 'Плейлист не найден' }, 404);
  }

  const source = body.source ?? 'tidal';
  const existing = await c.env.DB.prepare(
    'SELECT 1 FROM playlist_tracks WHERE playlist_id = ? AND track_id = ? AND source = ? LIMIT 1'
  ).bind(id, body.trackId, source).first();

  if (existing) {
    return c.json({ error: 'Этот трек уже в плейлисте', code: 'duplicate' }, 409);
  }

  const maxPos = await c.env.DB.prepare(
    'SELECT MAX(position) as max_pos FROM playlist_tracks WHERE playlist_id = ?'
  ).bind(id).first<{ max_pos: number | null }>();

  const position = (maxPos?.max_pos ?? -1) + 1;
  const now = Math.floor(Date.now() / 1000);
  const snapJson = body.snapshot ? JSON.stringify(body.snapshot) : null;

  await c.env.DB.prepare(
    'INSERT INTO playlist_tracks (playlist_id, track_id, source, position, added_at, snapshot) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(id, body.trackId, source, position, now, snapJson).run();

  await c.env.DB.prepare('UPDATE playlists SET updated_at = ? WHERE id = ?').bind(now, id).run();
  return c.json({ ok: true }, 201);
});

playlists.put('/:id/reorder', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  const body = await c.req.json<{ trackIds: string[] }>();

  if (!Array.isArray(body.trackIds)) {
    return c.json({ error: 'trackIds must be an array' }, 400);
  }

  const playlist = await c.env.DB.prepare(
    'SELECT id FROM playlists WHERE id = ? AND user_id = ?'
  ).bind(id, userId).first();

  if (!playlist) {
    return c.json({ error: 'Плейлист не найден' }, 404);
  }

  const now = Math.floor(Date.now() / 1000);
  const stmt = c.env.DB.prepare(
    'UPDATE playlist_tracks SET position = ? WHERE playlist_id = ? AND track_id = ?'
  );
  const batch = body.trackIds.map((trackId, idx) => stmt.bind(idx, id, trackId));
  if (batch.length > 0) {
    await c.env.DB.batch(batch);
  }
  await c.env.DB.prepare('UPDATE playlists SET updated_at = ? WHERE id = ?').bind(now, id).run();
  return c.json({ ok: true });
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

// Cover upload: PUT /playlists/:id/cover with raw image bytes (max 2 MB).
playlists.put('/:id/cover', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');

  const existing = await c.env.DB.prepare(
    'SELECT id, is_liked, cover_r2_key FROM playlists WHERE id = ? AND user_id = ?'
  ).bind(id, userId).first<{ id: string; is_liked: number; cover_r2_key: string | null }>();

  if (!existing) {
    return c.json({ error: 'Плейлист не найден' }, 404);
  }
  if (existing.is_liked === 1) {
    return c.json({ error: 'Системный плейлист нельзя редактировать' }, 400);
  }

  const contentType = c.req.header('Content-Type') ?? 'image/jpeg';
  if (!COVER_ALLOWED_MIME.has(contentType)) {
    return c.json({ error: 'Неподдерживаемый формат изображения' }, 400);
  }

  const contentLength = parseInt(c.req.header('Content-Length') ?? '0', 10);
  if (!contentLength || contentLength > COVER_MAX_BYTES) {
    return c.json({ error: 'Файл слишком большой (макс. 2 МБ)' }, 400);
  }

  if (!c.req.raw.body) {
    return c.json({ error: 'Тело запроса обязательно' }, 400);
  }

  const r2Key = `playlist-covers/${userId}/${id}`;
  await c.env.TRACKS.put(r2Key, c.req.raw.body, {
    httpMetadata: { contentType },
  });

  const now = Math.floor(Date.now() / 1000);
  await c.env.DB.prepare(
    'UPDATE playlists SET cover_r2_key = ?, cover_updated_at = ?, updated_at = ? WHERE id = ?'
  ).bind(r2Key, now, now, id).run();

  return c.json({
    ok: true,
    coverUrl: `/playlists/${id}/cover?v=${now}`,
  });
});

playlists.delete('/:id/cover', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');

  const existing = await c.env.DB.prepare(
    'SELECT id, cover_r2_key FROM playlists WHERE id = ? AND user_id = ?'
  ).bind(id, userId).first<{ id: string; cover_r2_key: string | null }>();

  if (!existing) {
    return c.json({ error: 'Плейлист не найден' }, 404);
  }
  if (!existing.cover_r2_key) {
    return c.json({ error: 'Обложка не установлена' }, 404);
  }

  await c.env.TRACKS.delete(existing.cover_r2_key);
  const now = Math.floor(Date.now() / 1000);
  await c.env.DB.prepare(
    'UPDATE playlists SET cover_r2_key = NULL, cover_updated_at = NULL, updated_at = ? WHERE id = ?'
  ).bind(now, id).run();

  return c.json({ ok: true });
});

export { playlists };
