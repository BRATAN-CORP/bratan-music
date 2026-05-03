import type { Env } from './types/env';
import { TasteService } from './services/TasteService';
import { DailyPlaylistService } from './services/DailyPlaylistService';
import { HealthService } from './services/HealthService';

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
  const health = new HealthService(env);
  const runId = await health.recordCronStart('scheduled');
  let processedCount = 0;
  let errorCount = 0;
  let firstError: string | null = null;
  const recordError = (msg: string) => {
    errorCount++;
    if (firstError === null) firstError = msg;
  };

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
      processedCount++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[cron] user', userId, msg);
      recordError(`user ${userId}: ${msg}`);
      await health.log('error', 'cron.user', msg, { userId });
    }
  }

  // 2. GC: drop daily-playlists older than 7 days, recommendation_seen
  // older than 14 days.
  try {
    await daily.gc();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[cron] gc daily', msg);
    recordError(`gc daily: ${msg}`);
    await health.log('error', 'cron.gc.daily', msg);
  }

  try {
    const seenCutoff = start - 14 * 24 * 60 * 60 * 1000;
    await env.DB
      .prepare(`DELETE FROM recommendation_seen WHERE last_seen_at < ?`)
      .bind(seenCutoff)
      .run();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[cron] gc seen', msg);
    recordError(`gc seen: ${msg}`);
    await health.log('error', 'cron.gc.seen', msg);
  }

  // GC expired auth_nonces. The deeplink-login flow inserts a row per
  // /start with a 5-minute TTL and the polling endpoint deletes it on
  // first claim, but unclaimed rows (user opens /start, never opens the
  // app) accumulate forever. Sweep anything past expiry on every cron
  // tick — `expires_at` is in unix seconds.
  try {
    const nowSec = Math.floor(Date.now() / 1000);
    await env.DB
      .prepare(`DELETE FROM auth_nonces WHERE expires_at < ?`)
      .bind(nowSec)
      .run();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[cron] gc auth_nonces', msg);
    recordError(`gc auth_nonces: ${msg}`);
    await health.log('error', 'cron.gc.auth_nonces', msg);
  }

  try {
    // GC closes rooms whose host has been silent for too long. Result
    // is intentionally not logged — it's operational, not an error.
    const { RoomService } = await import('./services/RoomService');
    await new RoomService(env).gc();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[cron] gc rooms', msg);
    recordError(`gc rooms: ${msg}`);
    await health.log('error', 'cron.gc.rooms', msg);
  }

  // GC the service log ring + old cron_runs rows. Keep ~30 days of logs
  // and 90 days of cron rows so the admin can spot regressions.
  try {
    const logCutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    await health.gc(logCutoff);
    const cronCutoff = Date.now() - 90 * 24 * 60 * 60 * 1000;
    await env.DB
      .prepare(`DELETE FROM cron_runs WHERE started_at < ?`)
      .bind(cronCutoff)
      .run();
  } catch (err) {
    console.error('[cron] gc logs', err instanceof Error ? err.message : err);
  }

  if (runId !== null) {
    await health.recordCronFinish(runId, errorCount === 0, processedCount, errorCount, firstError ?? undefined);
  }
  void start;
}
