import type { Env } from './types/env';
import { TasteService } from './services/TasteService';
import { DailyPlaylistService } from './services/DailyPlaylistService';

/**
 * Recompute per-user taste profiles, regenerate daily-playlists, GC
 * stale daily-playlists and the recommendation_seen window for users
 * who have been active in the last 14 days.
 *
 * "Active" = has a play_history row in the last 14 days. We don't waste
 * CF cron quota on users who haven't opened the app in weeks.
 *
 * Best-effort: per-user errors get swallowed and logged so one user's
 * Tidal hiccup doesn't cancel the whole batch.
 */
export async function runScheduledJobs(env: Env): Promise<void> {
  const start = Date.now();

  // 1. Find active users.
  const cutoff = start - 14 * 24 * 60 * 60 * 1000;
  const activeRes = await env.DB
    .prepare(
      `SELECT DISTINCT user_id FROM play_history WHERE played_at >= ? LIMIT 500`,
    )
    .bind(cutoff)
    .all<{ user_id: string }>();
  const activeIds = (activeRes.results ?? []).map((r) => r.user_id);

  // Also include users who manually picked genre seeds in onboarding,
  // even if they haven't listened yet — they expect their daily playlists
  // to materialise on first open without waiting another 24h.
  const seedRes = await env.DB
    .prepare(
      `SELECT user_id FROM user_taste_profile
        WHERE genre_seeds != '[]' AND user_id NOT IN
          (SELECT DISTINCT user_id FROM play_history WHERE played_at >= ?)
        LIMIT 500`,
    )
    .bind(cutoff)
    .all<{ user_id: string }>();
  const seedIds = (seedRes.results ?? []).map((r) => r.user_id);

  const userIds = Array.from(new Set([...activeIds, ...seedIds]));

  const taste = new TasteService(env);
  const daily = new DailyPlaylistService(env);

  for (const userId of userIds) {
    try {
      await taste.recompute(userId);
      await daily.regenerate(userId);
    } catch (err) {
      console.error('[cron] user', userId, err instanceof Error ? err.message : err);
    }
  }

  // 2. GC: drop daily-playlists older than 7 days, recommendation_seen
  // older than 14 days.
  try {
    await daily.gc();
  } catch (err) {
    console.error('[cron] gc daily', err instanceof Error ? err.message : err);
  }

  try {
    const seenCutoff = start - 14 * 24 * 60 * 60 * 1000;
    await env.DB
      .prepare(`DELETE FROM recommendation_seen WHERE last_seen_at < ?`)
      .bind(seenCutoff)
      .run();
  } catch (err) {
    console.error('[cron] gc seen', err instanceof Error ? err.message : err);
  }

  try {
    // GC closes rooms whose host has been silent for too long. Result
    // is intentionally not logged — it's operational, not an error.
    const { RoomService } = await import('./services/RoomService');
    await new RoomService(env).gc();
  } catch (err) {
    console.error('[cron] gc rooms', err instanceof Error ? err.message : err);
  }

  // cron summary intentionally not logged — operational signal.
  void start; void userIds;
}
