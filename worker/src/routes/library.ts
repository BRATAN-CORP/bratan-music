import { Hono } from 'hono';
import type { Env, Variables } from '../types/env';
import { jwtAuth } from '../middleware/auth';

const library = new Hono<{ Bindings: Env; Variables: Variables }>();

library.use('/*', jwtAuth);

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

interface DbRow {
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
  cover_url?: string | null;
  pinned_at?: number | null;
  created_at: number;
  updated_at: number;
  track_count?: number | null;
}

function rowToTrack(r: DbRow) {
  const snap = safeJson<TrackSnapshot>(r.snapshot);
  return {
    id: r.track_id,
    source: r.source,
    addedAt: r.added_at,
    title: snap?.title ?? '',
    artist: snap?.artist ?? '',
    album: snap?.album ?? '',
    coverUrl: snap?.coverUrl ?? '',
    duration: snap?.duration ?? 0,
  };
}

function rowToPlaylist(r: PlaylistRow) {
  return {
    id: r.id,
    name: r.name,
    isLiked: Boolean(r.is_liked),
    coverUrl: r.cover_url ?? null,
    pinnedAt: r.pinned_at ?? null,
    trackCount: Number(r.track_count ?? 0),
    updatedAt: Number(r.updated_at ?? 0),
    createdAt: Number(r.created_at ?? 0),
  };
}

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
  let snapshot: TrackSnapshot | null = null;
  try {
    const body = await c.req.json<TrackSnapshot>().catch(() => null);
    if (body && typeof body === 'object') snapshot = body;
  } catch {
    snapshot = null;
  }

  const playlistId = await ensureLikedPlaylist(c.env.DB, userId);

  const exists = await c.env.DB.prepare(
    'SELECT track_id FROM playlist_tracks WHERE playlist_id = ? AND track_id = ?'
  ).bind(playlistId, trackId).first();

  if (exists) {
    if (snapshot) {
      await c.env.DB.prepare(
        'UPDATE playlist_tracks SET snapshot = ? WHERE playlist_id = ? AND track_id = ?'
      ).bind(JSON.stringify(snapshot), playlistId, trackId).run();
    }
    return c.json({ ok: true, liked: true });
  }

  const maxPos = await c.env.DB.prepare(
    'SELECT MAX(position) as max_pos FROM playlist_tracks WHERE playlist_id = ?'
  ).bind(playlistId).first<{ max_pos: number | null }>();

  const position = (maxPos?.max_pos ?? -1) + 1;
  const now = Math.floor(Date.now() / 1000);

  await c.env.DB.prepare(
    'INSERT INTO playlist_tracks (playlist_id, track_id, source, position, added_at, snapshot) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(playlistId, trackId, source, position, now, snapshot ? JSON.stringify(snapshot) : null).run();

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

library.get('/like/:trackId', async (c) => {
  const userId = c.get('userId');
  const trackId = c.req.param('trackId');
  const playlistId = await ensureLikedPlaylist(c.env.DB, userId);
  const row = await c.env.DB.prepare(
    'SELECT track_id FROM playlist_tracks WHERE playlist_id = ? AND track_id = ?'
  ).bind(playlistId, trackId).first();
  return c.json({ liked: Boolean(row) });
});

library.get('/likes/ids', async (c) => {
  const userId = c.get('userId');
  const playlistId = await ensureLikedPlaylist(c.env.DB, userId);
  const rows = await c.env.DB.prepare(
    'SELECT track_id FROM playlist_tracks WHERE playlist_id = ?'
  ).bind(playlistId).all<{ track_id: string }>();
  return c.json({ ids: (rows.results ?? []).map((r) => r.track_id) });
});

library.get('/liked', async (c) => {
  const userId = c.get('userId');
  const limit = parseInt(c.req.query('limit') ?? '50', 10);
  const offset = parseInt(c.req.query('offset') ?? '0', 10);

  const playlistId = await ensureLikedPlaylist(c.env.DB, userId);

  const tracks = await c.env.DB.prepare(
    'SELECT * FROM playlist_tracks WHERE playlist_id = ? ORDER BY added_at DESC LIMIT ? OFFSET ?'
  ).bind(playlistId, limit, offset).all<DbRow>();

  const total = await c.env.DB.prepare(
    'SELECT COUNT(*) as count FROM playlist_tracks WHERE playlist_id = ?'
  ).bind(playlistId).first<{ count: number }>();

  return c.json({
    items: (tracks.results ?? []).map(rowToTrack),
    total: total?.count ?? 0,
    limit,
    offset,
  });
});

library.get('/playlists', async (c) => {
  const userId = c.get('userId');

  const items = await c.env.DB.prepare(
    'SELECT p.*, (SELECT COUNT(*) FROM playlist_tracks WHERE playlist_id = p.id) as track_count FROM playlists p WHERE p.user_id = ? ORDER BY p.is_liked DESC, p.updated_at DESC'
  ).bind(userId).all<PlaylistRow>();

  return c.json({ items: (items.results ?? []).map(rowToPlaylist) });
});

// ── Library items (albums & artists) ─────────────────────────────────

interface LibraryItemRow {
  user_id: string;
  item_id: string;
  type: string;
  snapshot?: string | null;
  added_at: number;
}

library.post('/items/:type/:itemId', async (c) => {
  const userId = c.get('userId');
  const type = c.req.param('type');
  const itemId = c.req.param('itemId');

  if (type !== 'album' && type !== 'artist') {
    return c.json({ error: 'Invalid type' }, 400);
  }

  let snapshot: Record<string, unknown> | null = null;
  try {
    const body = await c.req.json<Record<string, unknown>>().catch(() => null);
    if (body && typeof body === 'object') snapshot = body;
  } catch {
    snapshot = null;
  }

  const now = Math.floor(Date.now() / 1000);
  await c.env.DB.prepare(
    'INSERT OR REPLACE INTO library_items (user_id, item_id, type, snapshot, added_at) VALUES (?, ?, ?, ?, ?)'
  ).bind(userId, itemId, type, snapshot ? JSON.stringify(snapshot) : null, now).run();

  return c.json({ ok: true }, 201);
});

library.delete('/items/:type/:itemId', async (c) => {
  const userId = c.get('userId');
  const type = c.req.param('type');
  const itemId = c.req.param('itemId');

  if (type !== 'album' && type !== 'artist') {
    return c.json({ error: 'Invalid type' }, 400);
  }

  await c.env.DB.prepare(
    'DELETE FROM library_items WHERE user_id = ? AND item_id = ? AND type = ?'
  ).bind(userId, itemId, type).run();

  return c.json({ ok: true });
});

library.get('/items/:type', async (c) => {
  const userId = c.get('userId');
  const type = c.req.param('type');

  if (type !== 'album' && type !== 'artist') {
    return c.json({ error: 'Invalid type' }, 400);
  }

  const rows = await c.env.DB.prepare(
    'SELECT * FROM library_items WHERE user_id = ? AND type = ? ORDER BY added_at DESC'
  ).bind(userId, type).all<LibraryItemRow>();

  const items = (rows.results ?? []).map((r) => {
    const snap = safeJson<Record<string, unknown>>(r.snapshot);
    return { id: r.item_id, addedAt: r.added_at, ...snap };
  });

  return c.json({ items });
});

library.get('/items/:type/ids', async (c) => {
  const userId = c.get('userId');
  const type = c.req.param('type');

  if (type !== 'album' && type !== 'artist') {
    return c.json({ error: 'Invalid type' }, 400);
  }

  const rows = await c.env.DB.prepare(
    'SELECT item_id FROM library_items WHERE user_id = ? AND type = ?'
  ).bind(userId, type).all<{ item_id: string }>();

  return c.json({ ids: (rows.results ?? []).map((r) => r.item_id) });
});

export { library };
