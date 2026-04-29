import { Hono } from 'hono';
import type { Env, Variables } from '../types/env';
import { jwtAuth } from '../middleware/auth';
import { DailyPlaylistService } from '../services/DailyPlaylistService';

const dailyPlaylists = new Hono<{ Bindings: Env; Variables: Variables }>();

dailyPlaylists.use('/*', jwtAuth);

/**
 * Three daily-playlists for the home page. Generates them lazily for
 * users whose nightly cron hasn't run yet (brand new, or just logged
 * in before the cron tick).
 */
dailyPlaylists.get('/today', async (c) => {
  const userId = c.get('userId');
  const svc = new DailyPlaylistService(c.env);
  const items = await svc.getToday(userId);
  return c.json({ items });
});

interface PlaylistRow {
  id: string;
  variant: string;
  name: string;
  description: string;
  cover_url: string | null;
  tracks: string;
}

interface CountRow { c: number; }

/**
 * Promote a daily-playlist into the user's permanent library. Copies
 * tracks into a regular `playlists` row + `playlist_tracks` rows so
 * the rest of the library stack treats it like any other playlist.
 *
 * The original daily-playlist row stays untouched (the user might
 * want to save more variants on the same day, and the cron's GC will
 * tidy unsaved rows after 7 days).
 */
dailyPlaylists.post('/save/:id', async (c) => {
  const userId = c.get('userId');
  const dailyId = c.req.param('id');

  const row = await c.env.DB
    .prepare(
      `SELECT id, variant, name, description, cover_url, tracks
         FROM daily_playlists
        WHERE id = ? AND user_id = ?`,
    )
    .bind(dailyId, userId)
    .first<PlaylistRow>();

  if (!row) return c.json({ error: 'Плейлист не найден' }, 404);

  const tracks: { id: string; source?: string; title?: string; artist?: string;
                  album?: string; coverUrl?: string; coverVideoUrl?: string;
                  duration?: number }[] = JSON.parse(row.tracks);

  const today = new Date().toISOString().slice(0, 10);
  const playlistId = crypto.randomUUID();
  const now = Date.now();
  // Append a counter to the name so a user saving multiple days' worth
  // doesn't collide on the (very common) "Плейлист дня #N от ..." names.
  const countRow = await c.env.DB
    .prepare(`SELECT COUNT(*) AS c FROM playlists WHERE user_id = ? AND name LIKE ?`)
    .bind(userId, `${row.name} #%`)
    .first<CountRow>();
  const seq = (countRow?.c ?? 0) + 1;
  const finalName = `${row.name} #${seq} от ${today}`;

  await c.env.DB
    .prepare(
      `INSERT INTO playlists (id, user_id, name, is_liked, cover_url, created_at, updated_at)
       VALUES (?, ?, ?, 0, ?, ?, ?)`,
    )
    .bind(playlistId, userId, finalName, row.cover_url, now, now)
    .run();

  // Mark this daily-playlist row as "saved" so /today can render the
  // home-page card in a persistent "Сохранено" state across reloads.
  await c.env.DB
    .prepare(
      `UPDATE daily_playlists SET saved_to_playlist_id = ? WHERE id = ? AND user_id = ?`,
    )
    .bind(playlistId, dailyId, userId)
    .run();

  if (tracks.length > 0) {
    const stmts = tracks.map((t, i) =>
      c.env.DB
        .prepare(
          `INSERT INTO playlist_tracks (playlist_id, track_id, source, position, added_at, snapshot)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(playlist_id, track_id) DO NOTHING`,
        )
        .bind(
          playlistId,
          t.id,
          t.source ?? 'tidal',
          i,
          now,
          JSON.stringify({
            title: t.title,
            artist: t.artist,
            album: t.album,
            coverUrl: t.coverUrl,
            coverVideoUrl: t.coverVideoUrl,
            duration: t.duration,
          }),
        ),
    );
    await c.env.DB.batch(stmts);
  }

  return c.json({ id: playlistId, name: finalName });
});

export { dailyPlaylists };
