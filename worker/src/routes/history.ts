import { Hono } from 'hono';
import type { Env, Variables } from '../types/env';
import { jwtAuth } from '../middleware/auth';

const history = new Hono<{ Bindings: Env; Variables: Variables }>();

history.use('/*', jwtAuth);

/**
 * Frontend pings this when the audio engine has played a track for at
 * least 30 seconds OR the track ended naturally. We only persist
 * "significant" plays — quick skips never reach this endpoint.
 *
 * The artist id, title, etc. are taken from the snapshot the player
 * already has, so we don't need to round-trip Tidal. This means liked
 * tracks / overrides (without an artistId) still land in history with
 * a null artist_id — that's fine, they just won't influence the
 * artist-weight signal.
 */
history.post('/play', async (c) => {
  const userId = c.get('userId');
  interface PlayBody {
    trackId?: string;
    source?: string;
    artistId?: string;
    artistName?: string;
    title?: string;
    albumId?: string;
    coverUrl?: string;
    duration?: number;
    listenedSeconds?: number;
    completed?: boolean;
  }
  const body = await c.req.json<PlayBody>().catch(() => ({} as PlayBody));

  if (!body.trackId || typeof body.trackId !== 'string') {
    return c.json({ error: 'trackId обязателен' }, 400);
  }

  await c.env.DB
    .prepare(
      `INSERT INTO play_history
         (user_id, track_id, source, artist_id, artist_name, title, album_id,
          cover_url, duration, listened_seconds, completed, played_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      userId,
      body.trackId,
      typeof body.source === 'string' ? body.source : 'tidal',
      typeof body.artistId === 'string' ? body.artistId : null,
      typeof body.artistName === 'string' ? body.artistName : '',
      typeof body.title === 'string' ? body.title : '',
      typeof body.albumId === 'string' ? body.albumId : null,
      typeof body.coverUrl === 'string' ? body.coverUrl : null,
      typeof body.duration === 'number' && Number.isFinite(body.duration) ? Math.floor(body.duration) : 0,
      typeof body.listenedSeconds === 'number' && Number.isFinite(body.listenedSeconds) ? Math.floor(body.listenedSeconds) : 0,
      body.completed ? 1 : 0,
      Date.now(),
    )
    .run();

  return c.json({ ok: true });
});

interface RecentRow {
  track_id: string;
  source: string;
  artist_id: string | null;
  artist_name: string;
  title: string;
  album_id: string | null;
  cover_url: string | null;
  duration: number;
  played_at: number;
}

/**
 * Recent plays for the home-page "история" section. Deduplicates on
 * (track_id, source) so the same song played 5 times today doesn't
 * fill the strip — most recent timestamp wins.
 */
history.get('/recent', async (c) => {
  const userId = c.get('userId');
  const limit = Math.min(50, Math.max(1, parseInt(c.req.query('limit') ?? '20', 10) || 20));
  const res = await c.env.DB
    .prepare(
      `SELECT track_id, source, artist_id, artist_name, title, album_id,
              cover_url, duration, MAX(played_at) AS played_at
         FROM play_history
        WHERE user_id = ?
        GROUP BY track_id, source
        ORDER BY played_at DESC
        LIMIT ?`,
    )
    .bind(userId, limit)
    .all<RecentRow>();

  const items = (res.results ?? []).map((r) => ({
    id: r.track_id,
    source: r.source,
    title: r.title,
    artist: r.artist_name,
    artistId: r.artist_id ?? undefined,
    albumId: r.album_id ?? undefined,
    coverUrl: r.cover_url ?? undefined,
    duration: r.duration,
    playedAt: r.played_at,
  }));

  return c.json({ items });
});

export { history };
