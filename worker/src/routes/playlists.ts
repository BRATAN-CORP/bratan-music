import { Hono } from 'hono';
import type { Env, Variables } from '../types/env';
import { jwtAuth } from '../middleware/auth';
import { TidalService } from '../services/tidal/TidalService';
import type { ArtistRef } from '../types/music';

const playlists = new Hono<{ Bindings: Env; Variables: Variables }>();

playlists.use('/*', jwtAuth);

/**
 * Generate a URL-safe random share token. Long enough to be
 * effectively unguessable (≈26 chars of base62 ≈ 154 bits) but
 * short enough to fit in a friendly share URL.
 */
function generateShareToken(): string {
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  // base64url without padding
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

interface TrackSnapshot {
  title?: string;
  artist?: string;
  /** Primary contributor id — used when `artists` is missing. */
  artistId?: string;
  /** Full credit list (Tidal returns one row per `MAIN`/`FEATURED`
   *  contributor). Persisted so liked / playlist tracks keep their
   *  per-artist links across reloads. */
  artists?: ArtistRef[];
  album?: string;
  coverUrl?: string;
  /** Animated mp4 cover URL (Tidal). Only some albums expose it; we
   *  persist it inside the JSON snapshot so liked / playlist tracks
   *  retain the animated cover after a refresh. */
  coverVideoUrl?: string;
  duration?: number;
  /** Source-provider Explicit flag. Persisted so playlist / liked tracks
   *  surface the ExplicitBadge in the mini-player and mobile dock. */
  explicit?: boolean;
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
  cover_url?: string | null;
  pinned_at?: number | null;
  created_at: number;
  updated_at: number;
  track_count?: number | null;
  // 0009_playlist_share columns. Optional on the type so older D1
  // result rows (from before the migration applied) decode cleanly.
  is_public?: number | null;
  share_token?: string | null;
  source_kind?: 'user' | 'tidal' | null;
  source_playlist_id?: string | null;
  source_user_id?: string | null;
  source_track_count?: number | null;
  // 0019_playlist_description.
  description?: string | null;
}

// Hard cap to keep D1 rows small. Frontend should resize+JPEG-compress
// before upload, so anything above this is almost certainly malicious or
// a misconfigured client.
const MAX_COVER_BYTES = 256 * 1024;
const COVER_DATA_URL_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;

function rowToTrack(r: PtRow) {
  const snap = safeJson<TrackSnapshot>(r.snapshot);
  return {
    id: r.track_id,
    source: r.source,
    addedAt: r.added_at,
    position: r.position,
    title: snap?.title ?? '',
    artist: snap?.artist ?? '',
    artistId: snap?.artistId,
    artists: snap?.artists,
    album: snap?.album ?? '',
    coverUrl: snap?.coverUrl ?? '',
    coverVideoUrl: snap?.coverVideoUrl ?? undefined,
    duration: snap?.duration ?? 0,
    explicit: snap?.explicit,
  };
}

function rowToPlaylist(r: PlaylistRow) {
  return {
    id: r.id,
    name: r.name,
    description: r.description ?? null,
    isLiked: Boolean(r.is_liked),
    coverUrl: r.cover_url ?? null,
    pinnedAt: r.pinned_at ?? null,
    trackCount: Number(r.track_count ?? 0),
    updatedAt: Number(r.updated_at ?? 0),
    createdAt: Number(r.created_at ?? 0),
    isPublic: Boolean(r.is_public),
    shareToken: r.share_token ?? null,
    sourceKind: (r.source_kind ?? null) as 'user' | 'tidal' | null,
    sourcePlaylistId: r.source_playlist_id ?? null,
    sourceUserId: r.source_user_id ?? null,
  };
}

/**
 * Whether this playlist is read-only for the requester. True when:
 * - the row carries a `source_kind` (it's a saved reference); OR
 * - the requester is not the owner (e.g. accessing via /shared/:token).
 * Read-only enforcement happens in the routes below — the flag is
 * only echoed in responses so the UI can hide editing affordances.
 */
function isReadOnly(r: PlaylistRow, requesterId: string): boolean {
  if (r.source_kind) return true;
  return r.user_id !== requesterId;
}

// Track-count resolution for the library list. Three cases:
//   * Owned playlists (source_kind IS NULL): count this playlist's own rows.
//   * Linked-user (source_kind = 'user'): count the source playlist's rows,
//     but only while it's still public — drops to 0 if the owner unpublishes.
//   * Linked-tidal (source_kind = 'tidal'): no local rows exist, fall back to
//     the cached `source_track_count` (populated on save / detail-view).
// Coalesces to 0 so the column is always a number.
const LIST_TRACK_COUNT_SQL = `
  CASE
    WHEN p.source_kind IS NULL THEN
      (SELECT COUNT(*) FROM playlist_tracks WHERE playlist_id = p.id)
    WHEN p.source_kind = 'user' THEN
      COALESCE((
        SELECT COUNT(*) FROM playlist_tracks pt
        JOIN playlists src ON src.id = pt.playlist_id
        WHERE src.id = p.source_playlist_id AND src.is_public = 1
      ), 0)
    ELSE COALESCE(p.source_track_count, 0)
  END
`;

playlists.get('/', async (c) => {
  const userId = c.get('userId');
  const items = await c.env.DB.prepare(
    `SELECT p.*, ${LIST_TRACK_COUNT_SQL} as track_count FROM playlists p WHERE p.user_id = ? ORDER BY p.is_liked DESC, p.updated_at DESC`
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

/**
 * Resolve the tracks for a saved-reference playlist:
 * - `source_kind = 'user'`: read the original playlist's tracks
 *   (only if it's still public, otherwise return empty).
 * - `source_kind = 'tidal'`: fetch on demand from TidalService using
 *   the stored `source_playlist_id` (Tidal UUID). Network failures
 *   degrade gracefully to an empty list rather than 500-ing.
 */
async function resolveLinkedTracks(c: { env: Env }, p: PlaylistRow): Promise<unknown[]> {
  const sourceId = p.source_playlist_id;
  if (!sourceId) return [];
  if (p.source_kind === 'user') {
    const orig = await c.env.DB.prepare(
      'SELECT id, is_public FROM playlists WHERE id = ?'
    ).bind(sourceId).first<{ id: string; is_public: number | null }>();
    if (!orig || !orig.is_public) return [];
    const tracks = await c.env.DB.prepare(
      'SELECT * FROM playlist_tracks WHERE playlist_id = ? ORDER BY position ASC'
    ).bind(sourceId).all<PtRow>();
    return (tracks.results ?? []).map(rowToTrack);
  }
  if (p.source_kind === 'tidal') {
    try {
      const tidal = new TidalService(c.env);
      return await tidal.getPlaylistTracks(sourceId);
    } catch {
      return [];
    }
  }
  return [];
}

playlists.get('/:id', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');

  const playlist = await c.env.DB.prepare(
    'SELECT p.*, (SELECT COUNT(*) FROM playlist_tracks WHERE playlist_id = p.id) as track_count FROM playlists p WHERE p.id = ? AND p.user_id = ?'
  ).bind(id, userId).first<PlaylistRow>();

  if (!playlist) {
    return c.json({ error: 'Плейлист не найден' }, 404);
  }

  // Linked playlists resolve their tracks from the source on every
  // read, so changes to the original automatically propagate.
  const tracks = playlist.source_kind
    ? await resolveLinkedTracks(c, playlist)
    : (await c.env.DB.prepare(
        'SELECT * FROM playlist_tracks WHERE playlist_id = ? ORDER BY position ASC'
      ).bind(id).all<PtRow>()).results?.map(rowToTrack) ?? [];

  // Refresh the cached count on every detail-view read so the library
  // list stays accurate even when the source changes between sessions.
  if (playlist.source_kind && tracks.length !== (playlist.source_track_count ?? -1)) {
    await c.env.DB.prepare(
      'UPDATE playlists SET source_track_count = ? WHERE id = ?'
    ).bind(tracks.length, id).run();
  }

  return c.json({
    ...rowToPlaylist(playlist),
    tracks,
    readOnly: isReadOnly(playlist, userId),
    // For linked playlists the cached track_count is meaningless
    // (it counts the empty `playlist_tracks` rows in the requester's
    // copy, not the source). Override with the resolved length.
    trackCount: playlist.source_kind ? tracks.length : Number(playlist.track_count ?? 0),
  });
});

playlists.put('/:id', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  const body = await c.req.json<{ name: string }>();

  const existing = await c.env.DB.prepare(
    'SELECT id, is_liked, source_kind FROM playlists WHERE id = ? AND user_id = ?'
  ).bind(id, userId).first<{ id: string; is_liked: number; source_kind: string | null }>();

  if (!existing) {
    return c.json({ error: 'Плейлист не найден' }, 404);
  }

  if (existing.is_liked === 1) {
    return c.json({ error: 'Системный плейлист нельзя переименовать' }, 400);
  }

  if (existing.source_kind) {
    return c.json({ error: 'Сохранённый плейлист нельзя переименовать' }, 400);
  }

  const now = Math.floor(Date.now() / 1000);
  await c.env.DB.prepare(
    'UPDATE playlists SET name = ?, updated_at = ? WHERE id = ?'
  ).bind(body.name.trim(), now, id).run();

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

playlists.put('/:id/cover', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  const body = await c.req.json<{ dataUrl?: string }>().catch(() => ({} as { dataUrl?: string }));

  const dataUrl = body.dataUrl?.trim();
  if (!dataUrl) {
    return c.json({ error: 'dataUrl обязателен' }, 400);
  }
  if (!COVER_DATA_URL_RE.test(dataUrl)) {
    return c.json({ error: 'Допустимы JPEG/PNG/WebP в формате data URL' }, 400);
  }
  if (dataUrl.length > MAX_COVER_BYTES * 1.4) {
    // base64 inflates ~4/3, so cap the encoded length proportionally.
    return c.json({ error: 'Обложка слишком большая. Сжмите изображение и повторите.' }, 413);
  }

  const existing = await c.env.DB.prepare(
    'SELECT id, source_kind FROM playlists WHERE id = ? AND user_id = ?'
  ).bind(id, userId).first<{ id: string; source_kind: string | null }>();
  if (!existing) {
    return c.json({ error: 'Плейлист не найден' }, 404);
  }
  if (existing.source_kind) {
    return c.json({ error: 'Обложку сохранённого плейлиста нельзя менять' }, 400);
  }

  const now = Math.floor(Date.now() / 1000);
  await c.env.DB.prepare(
    'UPDATE playlists SET cover_url = ?, updated_at = ? WHERE id = ?'
  ).bind(dataUrl, now, id).run();

  return c.json({ ok: true, coverUrl: dataUrl });
});

playlists.delete('/:id/cover', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');

  const existing = await c.env.DB.prepare(
    'SELECT id FROM playlists WHERE id = ? AND user_id = ?'
  ).bind(id, userId).first<{ id: string }>();
  if (!existing) {
    return c.json({ error: 'Плейлист не найден' }, 404);
  }

  const now = Math.floor(Date.now() / 1000);
  await c.env.DB.prepare(
    'UPDATE playlists SET cover_url = NULL, updated_at = ? WHERE id = ?'
  ).bind(now, id).run();

  return c.json({ ok: true });
});

/**
 * Pin / unpin a playlist to the desktop sidebar. We store a timestamp so the
 * UI can sort by "most recently pinned" without an explicit position column.
 */
playlists.put('/:id/pin', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  const body = await c.req.json<{ pinned: boolean }>().catch(() => ({ pinned: true }));

  const existing = await c.env.DB.prepare(
    'SELECT id FROM playlists WHERE id = ? AND user_id = ?'
  ).bind(id, userId).first<{ id: string }>();
  if (!existing) {
    return c.json({ error: 'Плейлист не найден' }, 404);
  }

  const now = Math.floor(Date.now() / 1000);
  if (body.pinned) {
    await c.env.DB.prepare(
      'UPDATE playlists SET pinned_at = ?, updated_at = ? WHERE id = ?'
    ).bind(now, now, id).run();
    return c.json({ ok: true, pinnedAt: now });
  } else {
    await c.env.DB.prepare(
      'UPDATE playlists SET pinned_at = NULL, updated_at = ? WHERE id = ?'
    ).bind(now, id).run();
    return c.json({ ok: true, pinnedAt: null });
  }
});

playlists.post('/:id/tracks', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  const body = await c.req.json<{ trackId: string; source?: string; snapshot?: TrackSnapshot }>();

  const playlist = await c.env.DB.prepare(
    'SELECT id, source_kind FROM playlists WHERE id = ? AND user_id = ?'
  ).bind(id, userId).first<{ id: string; source_kind: string | null }>();

  if (!playlist) {
    return c.json({ error: 'Плейлист не найден' }, 404);
  }

  if (playlist.source_kind) {
    return c.json({ error: 'В сохранённый плейлист нельзя добавлять треки' }, 400);
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
    'SELECT id, source_kind FROM playlists WHERE id = ? AND user_id = ?'
  ).bind(id, userId).first<{ id: string; source_kind: string | null }>();

  if (!playlist) {
    return c.json({ error: 'Плейлист не найден' }, 404);
  }

  if (playlist.source_kind) {
    return c.json({ error: 'Порядок сохранённого плейлиста нельзя изменять' }, 400);
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
    'SELECT id, source_kind FROM playlists WHERE id = ? AND user_id = ?'
  ).bind(id, userId).first<{ id: string; source_kind: string | null }>();

  if (!playlist) {
    return c.json({ error: 'Плейлист не найден' }, 404);
  }

  if (playlist.source_kind) {
    return c.json({ error: 'Из сохранённого плейлиста нельзя удалять треки' }, 400);
  }

  await c.env.DB.prepare(
    'DELETE FROM playlist_tracks WHERE playlist_id = ? AND track_id = ?'
  ).bind(id, trackId).run();

  const now = Math.floor(Date.now() / 1000);
  await c.env.DB.prepare('UPDATE playlists SET updated_at = ? WHERE id = ?').bind(now, id).run();
  return c.json({ ok: true });
});

// ── Sharing ─────────────────────────────────────────────────────────────────

/**
 * Toggle a playlist's public visibility. Owner-only. Lazily generates
 * a `share_token` the first time the playlist is published so the UI
 * can build a link straight away. Subsequent toggles preserve the
 * token (so re-enabling sharing keeps the same URL).
 *
 * Body: `{ public: boolean }`. Response: `{ isPublic, shareToken }`.
 */
playlists.put('/:id/share', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  const body = await c.req.json<{ public?: boolean }>().catch(() => ({} as { public?: boolean }));
  const wantPublic = Boolean(body.public);

  const row = await c.env.DB.prepare(
    'SELECT id, is_liked, share_token, source_kind FROM playlists WHERE id = ? AND user_id = ?'
  ).bind(id, userId).first<{ id: string; is_liked: number; share_token: string | null; source_kind: string | null }>();
  if (!row) {
    return c.json({ error: 'Плейлист не найден' }, 404);
  }
  if (row.is_liked === 1) {
    return c.json({ error: 'Системный плейлист нельзя сделать публичным' }, 400);
  }
  if (row.source_kind) {
    return c.json({ error: 'Сохранённый плейлист нельзя поделить — поделитесь оригиналом' }, 400);
  }

  const now = Math.floor(Date.now() / 1000);
  let token = row.share_token;
  if (wantPublic && !token) {
    // Generate-until-unique. The token space is 2^160 so collisions
    // are vanishingly unlikely, but we still check defensively to
    // avoid 500s if the impossible happens.
    for (let i = 0; i < 5; i++) {
      const candidate = generateShareToken();
      const taken = await c.env.DB.prepare('SELECT 1 FROM playlists WHERE share_token = ?').bind(candidate).first();
      if (!taken) { token = candidate; break; }
    }
  }
  await c.env.DB.prepare(
    'UPDATE playlists SET is_public = ?, share_token = ?, updated_at = ? WHERE id = ?'
  ).bind(wantPublic ? 1 : 0, token ?? null, now, id).run();

  return c.json({ ok: true, isPublic: wantPublic, shareToken: token ?? null });
});

/**
 * Save a Tidal editorial playlist as a linked-tidal playlist in the
 * user's library. Body: `{ tidalId, name, coverUrl?, curator? }`.
 *
 * The created row carries `source_kind='tidal'` + `source_playlist_id`,
 * so subsequent reads resolve tracks via TidalService and all mutate
 * routes block with 400. Re-saving the same Tidal playlist returns
 * the existing row (idempotent).
 */
playlists.post('/external/tidal', async (c) => {
  const userId = c.get('userId');
  const body = await c.req.json<{
    tidalId: string;
    name: string;
    coverUrl?: string | null;
    curator?: string | null;
    trackCount?: number | null;
  }>().catch(() => null);
  if (!body || !body.tidalId || !body.name?.trim()) {
    return c.json({ error: 'tidalId и name обязательны' }, 400);
  }
  if (!/^[a-fA-F0-9-]{36}$/.test(body.tidalId)) {
    return c.json({ error: 'Неверный UUID Tidal-плейлиста' }, 400);
  }

  const existing = await c.env.DB.prepare(
    "SELECT * FROM playlists WHERE user_id = ? AND source_kind = 'tidal' AND source_playlist_id = ? LIMIT 1"
  ).bind(userId, body.tidalId).first<PlaylistRow>();
  if (existing) {
    return c.json(rowToPlaylist(existing));
  }

  // Seed the cached count from the caller (Explore feed already
  // surfaces it on the editorial playlist tile). Falls back to NULL
  // — the next detail-view read will populate it.
  const seedCount = typeof body.trackCount === 'number' && body.trackCount >= 0
    ? Math.floor(body.trackCount)
    : null;

  const now = Math.floor(Date.now() / 1000);
  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    "INSERT INTO playlists (id, user_id, name, is_liked, cover_url, created_at, updated_at, source_kind, source_playlist_id, source_track_count) VALUES (?, ?, ?, 0, ?, ?, ?, 'tidal', ?, ?)"
  ).bind(id, userId, body.name.trim(), body.coverUrl ?? null, now, now, body.tidalId, seedCount).run();

  const row = await c.env.DB.prepare('SELECT * FROM playlists WHERE id = ?').bind(id).first<PlaylistRow>();
  return c.json(row ? rowToPlaylist(row) : { id }, 201);
});

/**
 * Fetch a playlist by its public share token. JWT-required (we only
 * surface public content to authenticated users), but no ownership
 * check — anyone with the link gets read-only access. Returns the
 * full track list and a minimal `owner` block (display name only,
 * never tg_username) so the UI can credit the curator.
 */
playlists.get('/shared/:token', async (c) => {
  const requesterId = c.get('userId');
  const token = c.req.param('token');
  if (!token || token.length < 16 || !/^[A-Za-z0-9_-]+$/.test(token)) {
    return c.json({ error: 'Неверная ссылка' }, 400);
  }

  const row = await c.env.DB.prepare(
    'SELECT p.*, (SELECT COUNT(*) FROM playlist_tracks WHERE playlist_id = p.id) as track_count FROM playlists p WHERE p.share_token = ? AND p.is_public = 1'
  ).bind(token).first<PlaylistRow>();
  if (!row) {
    return c.json({ error: 'Плейлист недоступен или больше не публичный' }, 404);
  }

  const ownerRow = await c.env.DB.prepare(
    'SELECT tg_name, tg_username FROM users WHERE id = ?'
  ).bind(row.user_id).first<{ tg_name: string | null; tg_username: string | null }>();

  const tracks = (await c.env.DB.prepare(
    'SELECT * FROM playlist_tracks WHERE playlist_id = ? ORDER BY position ASC'
  ).bind(row.id).all<PtRow>()).results?.map(rowToTrack) ?? [];

  // Surface whether the requester has already saved this playlist
  // so the UI can show "Открыть" instead of "Сохранить".
  const savedRow = await c.env.DB.prepare(
    "SELECT id FROM playlists WHERE user_id = ? AND source_kind = 'user' AND source_playlist_id = ? LIMIT 1"
  ).bind(requesterId, row.id).first<{ id: string }>();

  return c.json({
    ...rowToPlaylist(row),
    tracks,
    trackCount: tracks.length,
    readOnly: row.user_id !== requesterId,
    isOwner: row.user_id === requesterId,
    owner: ownerRow ? { name: ownerRow.tg_name ?? 'Пользователь' } : null,
    savedPlaylistId: savedRow?.id ?? null,
  });
});

/**
 * Save a public playlist into the requester's library as a linked
 * reference. Idempotent — re-saving returns the existing row. The
 * created row is read-only and resolves tracks from the source on
 * every fetch, so future changes to the original automatically
 * propagate.
 */
playlists.post('/shared/:token/save', async (c) => {
  const userId = c.get('userId');
  const token = c.req.param('token');
  if (!token || token.length < 16 || !/^[A-Za-z0-9_-]+$/.test(token)) {
    return c.json({ error: 'Неверная ссылка' }, 400);
  }

  const source = await c.env.DB.prepare(
    'SELECT id, user_id, name, cover_url FROM playlists WHERE share_token = ? AND is_public = 1'
  ).bind(token).first<{ id: string; user_id: string; name: string; cover_url: string | null }>();
  if (!source) {
    return c.json({ error: 'Плейлист недоступен' }, 404);
  }
  if (source.user_id === userId) {
    return c.json({ error: 'Это ваш плейлист' }, 400);
  }

  const existing = await c.env.DB.prepare(
    "SELECT * FROM playlists WHERE user_id = ? AND source_kind = 'user' AND source_playlist_id = ? LIMIT 1"
  ).bind(userId, source.id).first<PlaylistRow>();
  if (existing) {
    return c.json(rowToPlaylist(existing));
  }

  const now = Math.floor(Date.now() / 1000);
  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    "INSERT INTO playlists (id, user_id, name, is_liked, cover_url, created_at, updated_at, source_kind, source_playlist_id, source_user_id) VALUES (?, ?, ?, 0, ?, ?, ?, 'user', ?, ?)"
  ).bind(id, userId, source.name, source.cover_url ?? null, now, now, source.id, source.user_id).run();

  const row = await c.env.DB.prepare('SELECT * FROM playlists WHERE id = ?').bind(id).first<PlaylistRow>();
  return c.json(row ? rowToPlaylist(row) : { id }, 201);
});

export { playlists };
