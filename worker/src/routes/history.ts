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
  interface ArtistRefBody {
    id?: string;
    name?: string;
  }
  interface PlayBody {
    trackId?: string;
    source?: string;
    artistId?: string;
    artistName?: string;
    /**
     * Full structured contributor list. Migration 0024 stores this so
     * the recent-plays renderer can give each name its own link.
     */
    artists?: ArtistRefBody[];
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

  // Normalise the artists list so DB only ever sees `{id,name}` rows
  // with non-empty strings — drops any junk and keeps the column
  // round-trip safe to JSON.parse on read.
  const normalisedArtists = Array.isArray(body.artists)
    ? body.artists
        .map((a) => ({
          id: typeof a?.id === 'string' ? a.id : '',
          name: typeof a?.name === 'string' ? a.name : '',
        }))
        .filter((a) => a.id && a.name)
    : [];
  const artistsJson = normalisedArtists.length > 0 ? JSON.stringify(normalisedArtists) : null;

  await c.env.DB
    .prepare(
      `INSERT INTO play_history
         (user_id, track_id, source, artist_id, artist_name, artists_json, title, album_id,
          cover_url, duration, listened_seconds, completed, played_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      userId,
      body.trackId,
      typeof body.source === 'string' ? body.source : 'tidal',
      typeof body.artistId === 'string' ? body.artistId : null,
      typeof body.artistName === 'string' ? body.artistName : '',
      artistsJson,
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
  artists_json: string | null;
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
  // GROUP BY (track_id, source) collapses repeats; MAX(played_at)
  // wins the latest timestamp. We carry artists_json through the
  // grouping with MAX() too — for repeated plays the value is
  // either the same JSON or NULL, so MAX prefers the populated row.
  const res = await c.env.DB
    .prepare(
      `SELECT track_id, source, artist_id, artist_name,
              MAX(artists_json) AS artists_json,
              title, album_id, cover_url, duration,
              MAX(played_at) AS played_at
         FROM play_history
        WHERE user_id = ?
        GROUP BY track_id, source
        ORDER BY played_at DESC
        LIMIT ?`,
    )
    .bind(userId, limit)
    .all<RecentRow>();

  const items = (res.results ?? []).map((r) => {
    let artists: { id: string; name: string }[] | undefined;
    if (r.artists_json) {
      try {
        const parsed = JSON.parse(r.artists_json) as unknown;
        if (Array.isArray(parsed)) {
          artists = parsed
            .map((a) => {
              const obj = a as { id?: unknown; name?: unknown };
              return {
                id: typeof obj.id === 'string' ? obj.id : '',
                name: typeof obj.name === 'string' ? obj.name : '',
              };
            })
            .filter((a) => a.id && a.name);
          if (artists.length === 0) artists = undefined;
        }
      } catch {
        // malformed row — fall back to the joined-string render
      }
    }
    return {
      id: r.track_id,
      source: r.source,
      title: r.title,
      artist: r.artist_name,
      artistId: r.artist_id ?? undefined,
      artists,
      albumId: r.album_id ?? undefined,
      coverUrl: r.cover_url ?? undefined,
      duration: r.duration,
      playedAt: r.played_at,
    };
  });

  return c.json({ items });
});

/**
 * Wipe the authenticated user's play history. Self-service from the
 * profile page — the user id is taken from the JWT, the body is
 * ignored, so there's no way to delete somebody else's rows.
 *
 * Touches `play_history` only — does NOT clear taste profile,
 * dislikes or daily playlists. Use `/user/reset-recommendations`
 * for that. Symmetric with that endpoint's design: returns the
 * deleted-rows count so the UI can show a meaningful receipt.
 */
history.delete('/', async (c) => {
  const userId = c.get('userId');
  const result = await c.env.DB
    .prepare(`DELETE FROM play_history WHERE user_id = ?`)
    .bind(userId)
    .run();
  // D1 returns `meta.changes` for affected-row counts. Fall back to 0
  // on the off-chance the binding shape changes — a missing count is
  // strictly cosmetic, the rows are gone either way.
  const deleted = (result.meta as { changes?: number } | undefined)?.changes ?? 0;
  return c.json({ ok: true, deleted });
});

export { history };
