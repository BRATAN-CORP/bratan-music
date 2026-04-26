import { Hono } from 'hono';
import type { Env, Variables } from '../types/env';
import { jwtAuth } from '../middleware/auth';

const uploads = new Hono<{ Bindings: Env; Variables: Variables }>();

uploads.use('/*', jwtAuth);

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB — Worker request body cap
const ALLOWED_AUDIO = new Set([
  'audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/flac',
  'audio/ogg', 'audio/wav', 'audio/x-wav', 'audio/x-m4a',
]);
// Inline cover dataURL (re-using the same hard cap as playlist covers).
const MAX_COVER_BYTES = 256 * 1024;
const COVER_DATA_URL_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;

interface UserTrackRow {
  id: string;
  user_id: string;
  title: string;
  artist: string;
  album: string;
  cover_url: string | null;
  duration: number;
  r2_key: string;
  mime_type: string;
  size_bytes: number;
  created_at: number;
  updated_at: number;
}

function rowToTrack(r: UserTrackRow) {
  return {
    id: `upload:${r.id}`,
    rawId: r.id,
    title: r.title,
    artist: r.artist,
    album: r.album,
    coverUrl: r.cover_url ?? '',
    duration: r.duration,
    source: 'upload' as const,
    mimeType: r.mime_type,
    sizeBytes: r.size_bytes,
    createdAt: r.created_at,
  };
}

uploads.get('/', async (c) => {
  const userId = c.get('userId');
  const rows = await c.env.DB.prepare(
    'SELECT * FROM user_tracks WHERE user_id = ? ORDER BY created_at DESC'
  ).bind(userId).all<UserTrackRow>();
  return c.json({ items: (rows.results ?? []).map(rowToTrack) });
});

uploads.get('/:id', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  const row = await c.env.DB.prepare(
    'SELECT * FROM user_tracks WHERE id = ? AND user_id = ?'
  ).bind(id, userId).first<UserTrackRow>();
  if (!row) return c.json({ error: 'Не найдено' }, 404);
  return c.json(rowToTrack(row));
});

/**
 * Multipart upload: field "file" is the audio body, optional "title",
 * "artist", "album", "duration", "cover" (data URL).
 */
uploads.post('/', async (c) => {
  const userId = c.get('userId');
  const contentType = c.req.header('Content-Type') ?? '';
  if (!contentType.includes('multipart/form-data')) {
    return c.json({ error: 'Ожидается multipart/form-data' }, 400);
  }
  const form = await c.req.formData();
  const fileEntry = form.get('file');
  // Worker runtime returns a File-shaped object but its types vary; duck-
  // type for the properties we actually use.
  const file = fileEntry as unknown as { name: string; type: string; size: number; stream(): ReadableStream } | null;
  if (!file || typeof (file as { size?: unknown }).size !== 'number') {
    return c.json({ error: 'Файл не передан' }, 400);
  }
  if (file.size > MAX_FILE_SIZE) {
    return c.json({ error: `Файл слишком большой. Лимит ${MAX_FILE_SIZE / 1024 / 1024} МБ` }, 413);
  }
  const mimeType = (file.type || 'audio/mpeg').toLowerCase();
  if (!ALLOWED_AUDIO.has(mimeType)) {
    return c.json({ error: `Неподдерживаемый формат: ${mimeType}` }, 415);
  }

  const title = String(form.get('title') ?? file.name.replace(/\.[^.]+$/, '')).trim().slice(0, 200) || 'Без названия';
  const artist = String(form.get('artist') ?? '').trim().slice(0, 200);
  const album = String(form.get('album') ?? '').trim().slice(0, 200);
  const duration = Number(form.get('duration') ?? 0) || 0;
  const coverRaw = form.get('cover');
  let coverUrl: string | null = null;
  if (typeof coverRaw === 'string' && coverRaw) {
    if (!COVER_DATA_URL_RE.test(coverRaw) || coverRaw.length > MAX_COVER_BYTES * 1.4) {
      return c.json({ error: 'Некорректная обложка' }, 400);
    }
    coverUrl = coverRaw;
  }

  const id = crypto.randomUUID();
  const r2Key = `uploads/${userId}/${id}`;
  await c.env.TRACKS.put(r2Key, file.stream(), {
    httpMetadata: { contentType: mimeType },
    customMetadata: { userId, uploadId: id },
  });

  const now = Math.floor(Date.now() / 1000);
  await c.env.DB.prepare(
    `INSERT INTO user_tracks (id, user_id, title, artist, album, cover_url, duration, r2_key, mime_type, size_bytes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, userId, title, artist, album, coverUrl, duration, r2Key, mimeType, file.size, now, now).run();

  const row = await c.env.DB.prepare('SELECT * FROM user_tracks WHERE id = ?').bind(id).first<UserTrackRow>();
  return c.json(row ? rowToTrack(row) : { id: `upload:${id}` }, 201);
});

uploads.put('/:id', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  const body = await c.req.json<{ title?: string; artist?: string; album?: string; cover?: string | null }>();

  const existing = await c.env.DB.prepare(
    'SELECT * FROM user_tracks WHERE id = ? AND user_id = ?'
  ).bind(id, userId).first<UserTrackRow>();
  if (!existing) return c.json({ error: 'Не найдено' }, 404);

  const title = body.title != null ? String(body.title).trim().slice(0, 200) : existing.title;
  const artist = body.artist != null ? String(body.artist).trim().slice(0, 200) : existing.artist;
  const album = body.album != null ? String(body.album).trim().slice(0, 200) : existing.album;
  let coverUrl: string | null = existing.cover_url;
  if (body.cover === null) {
    coverUrl = null;
  } else if (typeof body.cover === 'string' && body.cover) {
    if (!COVER_DATA_URL_RE.test(body.cover) || body.cover.length > MAX_COVER_BYTES * 1.4) {
      return c.json({ error: 'Некорректная обложка' }, 400);
    }
    coverUrl = body.cover;
  }

  const now = Math.floor(Date.now() / 1000);
  await c.env.DB.prepare(
    'UPDATE user_tracks SET title = ?, artist = ?, album = ?, cover_url = ?, updated_at = ? WHERE id = ?'
  ).bind(title || 'Без названия', artist, album, coverUrl, now, id).run();

  const row = await c.env.DB.prepare('SELECT * FROM user_tracks WHERE id = ?').bind(id).first<UserTrackRow>();
  return c.json(row ? rowToTrack(row) : { id: `upload:${id}` });
});

/** Replace the audio file but keep metadata. */
uploads.put('/:id/file', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  const contentType = c.req.header('Content-Type') ?? '';
  if (!contentType.includes('multipart/form-data')) {
    return c.json({ error: 'Ожидается multipart/form-data' }, 400);
  }
  const existing = await c.env.DB.prepare(
    'SELECT * FROM user_tracks WHERE id = ? AND user_id = ?'
  ).bind(id, userId).first<UserTrackRow>();
  if (!existing) return c.json({ error: 'Не найдено' }, 404);

  const form = await c.req.formData();
  const fileEntry = form.get('file');
  const file = fileEntry as unknown as { name: string; type: string; size: number; stream(): ReadableStream } | null;
  if (!file || typeof (file as { size?: unknown }).size !== 'number') {
    return c.json({ error: 'Файл не передан' }, 400);
  }
  if (file.size > MAX_FILE_SIZE) {
    return c.json({ error: `Файл слишком большой. Лимит ${MAX_FILE_SIZE / 1024 / 1024} МБ` }, 413);
  }
  const mimeType = (file.type || existing.mime_type).toLowerCase();
  if (!ALLOWED_AUDIO.has(mimeType)) {
    return c.json({ error: `Неподдерживаемый формат: ${mimeType}` }, 415);
  }
  const duration = Number(form.get('duration') ?? existing.duration) || existing.duration;

  await c.env.TRACKS.put(existing.r2_key, file.stream(), {
    httpMetadata: { contentType: mimeType },
    customMetadata: { userId, uploadId: id },
  });

  const now = Math.floor(Date.now() / 1000);
  await c.env.DB.prepare(
    'UPDATE user_tracks SET mime_type = ?, size_bytes = ?, duration = ?, updated_at = ? WHERE id = ?'
  ).bind(mimeType, file.size, duration, now, id).run();

  const row = await c.env.DB.prepare('SELECT * FROM user_tracks WHERE id = ?').bind(id).first<UserTrackRow>();
  return c.json(row ? rowToTrack(row) : { id: `upload:${id}` });
});

uploads.delete('/:id', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  const existing = await c.env.DB.prepare(
    'SELECT r2_key FROM user_tracks WHERE id = ? AND user_id = ?'
  ).bind(id, userId).first<{ r2_key: string }>();
  if (!existing) return c.json({ error: 'Не найдено' }, 404);

  try { await c.env.TRACKS.delete(existing.r2_key); } catch { /* ignore */ }
  await c.env.DB.prepare('DELETE FROM user_tracks WHERE id = ?').bind(id).run();
  // Also strip from playlists so the user doesn't end up with phantom tracks.
  await c.env.DB.prepare(
    "DELETE FROM playlist_tracks WHERE track_id = ? AND source = 'upload'"
  ).bind(id).run();

  return c.json({ ok: true });
});

/**
 * Streaming endpoint with Range support (mirror of override stream). The
 * audio element can't send Authorization headers, so we accept ?token= as
 * a fallback in the auth middleware.
 */
uploads.get('/:id/stream', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  const row = await c.env.DB.prepare(
    'SELECT r2_key, mime_type FROM user_tracks WHERE id = ? AND user_id = ?'
  ).bind(id, userId).first<{ r2_key: string; mime_type: string }>();
  if (!row) return c.json({ error: 'Не найдено' }, 404);

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
        rangeOpt = { offset: -end };
      }
    }
  }

  const object = await c.env.TRACKS.get(row.r2_key, rangeOpt ? { range: rangeOpt } : undefined);
  if (!object) return c.json({ error: 'Файл не найден в хранилище' }, 404);

  const total = object.size;
  const headers = new Headers();
  headers.set('Content-Type', row.mime_type);
  headers.set('Accept-Ranges', 'bytes');
  headers.set('Cache-Control', 'private, max-age=3600');
  if (rangeOpt) {
    const start = rangeOpt.offset >= 0 ? rangeOpt.offset : Math.max(0, total + rangeOpt.offset);
    const length = rangeOpt.length ?? (total - start);
    const end = Math.min(total - 1, start + length - 1);
    headers.set('Content-Range', `bytes ${start}-${end}/${total}`);
    headers.set('Content-Length', String(end - start + 1));
    return new Response(object.body, { status: 206, headers });
  }
  headers.set('Content-Length', String(total));
  return new Response(object.body, { status: 200, headers });
});

export { uploads };
