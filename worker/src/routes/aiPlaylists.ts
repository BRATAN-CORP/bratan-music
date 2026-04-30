import { Hono } from 'hono';
import type { Env, Variables } from '../types/env';
import { jwtAuth } from '../middleware/auth';
import { AiPlaylistService, AiPlaylistError } from '../services/AiPlaylistService';
import type { Track } from '../types/music';

/**
 * AI playlist endpoints.
 *
 *   POST /ai/playlists/generate   — non-persistent preview. The
 *                                   frontend renders the returned
 *                                   tracks and lets the user
 *                                   approve/reject before saving.
 *   POST /ai/playlists/save       — persists an approved preview
 *                                   to the user's library as a
 *                                   regular playlist + playlist_tracks
 *                                   rows. Atomic via batch().
 */

export const aiPlaylists = new Hono<{ Bindings: Env; Variables: Variables }>();

aiPlaylists.use('/*', jwtAuth);

interface GenerateBody {
  prompt?: string;
  size?: number;
}

aiPlaylists.post('/generate', async (c) => {
  const body = await c.req.json<GenerateBody>().catch(() => ({} as GenerateBody));
  const prompt = (body.prompt ?? '').trim();
  if (!prompt) return c.json({ error: 'Промпт обязателен' }, 400);
  if (prompt.length > 200) return c.json({ error: 'Промпт слишком длинный (максимум 200 символов)' }, 400);

  try {
    const svc = new AiPlaylistService(c.env);
    const preview = await svc.generate(prompt, body.size);
    return c.json(preview);
  } catch (err) {
    if (err instanceof AiPlaylistError) {
      return c.json({ error: err.message }, err.status as 400 | 422 | 502 | 503);
    }
    console.error('[ai/generate] unhandled', err);
    return c.json({ error: 'Не удалось сгенерировать плейлист' }, 500);
  }
});

interface SaveBody {
  name?: string;
  description?: string;
  tracks?: Track[];
  prompt?: string;
}

aiPlaylists.post('/save', async (c) => {
  const userId = c.get('userId');
  const body = await c.req.json<SaveBody>().catch(() => ({} as SaveBody));
  const name = (body.name ?? '').trim().slice(0, 80);
  const description = (body.description ?? '').trim().slice(0, 280);
  const tracks = Array.isArray(body.tracks) ? body.tracks : [];
  if (!name) return c.json({ error: 'Название обязательно' }, 400);
  if (!tracks.length) return c.json({ error: 'Нужен хотя бы один трек' }, 400);
  if (tracks.length > 100) return c.json({ error: 'Максимум 100 треков' }, 400);

  const now = Math.floor(Date.now() / 1000);
  const playlistId = crypto.randomUUID();
  const cover = tracks.find((t) => t.coverUrl)?.coverUrl ?? null;

  const stmts = [
    c.env.DB.prepare(
      `INSERT INTO playlists (id, user_id, name, description, is_liked,
                              cover_url, created_at, updated_at)
       VALUES (?, ?, ?, ?, 0, ?, ?, ?)`,
    ).bind(playlistId, userId, name, description || null, cover, now, now),
  ];

  // Cap snapshot to a known shape so we don't accidentally persist
  // server-side fields the UI doesn't render.
  for (let i = 0; i < tracks.length; i++) {
    const t = tracks[i];
    if (!t || !t.id) continue;
    const snapshot = JSON.stringify({
      id: t.id,
      source: t.source ?? 'tidal',
      title: t.title,
      artist: t.artist,
      artistId: t.artistId,
      artists: t.artists,
      album: t.album,
      albumId: t.albumId,
      duration: t.duration,
      coverUrl: t.coverUrl,
      explicit: !!t.explicit,
      quality: t.quality,
    });
    stmts.push(
      c.env.DB.prepare(
        `INSERT INTO playlist_tracks (playlist_id, track_id, source, position,
                                      added_at, snapshot)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).bind(playlistId, t.id, t.source ?? 'tidal', i, now, snapshot),
    );
  }

  await c.env.DB.batch(stmts);
  return c.json({ id: playlistId, name, description, trackCount: tracks.length }, 201);
});
