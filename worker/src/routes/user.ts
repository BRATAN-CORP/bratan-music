import { Hono } from 'hono';
import type { Env, Variables } from '../types/env';
import { UserService } from '../services/UserService';
import { SubscriptionService } from '../services/SubscriptionService';
import { jwtAuth } from '../middleware/auth';

const user = new Hono<{ Bindings: Env; Variables: Variables }>();

user.use('/*', jwtAuth);

user.get('/me', async (c) => {
  const userId = c.get('userId');
  const userService = new UserService(c.env);
  const userData = await userService.findById(userId);

  if (!userData) {
    return c.json({ error: 'Пользователь не найден' }, 404);
  }

  const subService = new SubscriptionService(c.env);
  const subscription = await subService.getActive(userId);

  return c.json({
    id: userData.id,
    username: userData.tg_username,
    name: userData.tg_name,
    isAdmin: userData.is_admin === 1,
    /**
     * Unix seconds when the user finished/skipped the spotlight
     * onboarding tour, or `null` if they haven't seen it yet. The
     * frontend uses this to decide whether to mount
     * `<OnboardingTour />` after login.
     */
    tourCompletedAt: userData.tour_completed_at ?? null,
    subscription: subscription
      ? {
          status: 'active' as const,
          expiresAt: subscription.expires_at,
        }
      : null,
  });
});

/**
 * Mark the onboarding tour as finished. Called by the frontend when
 * the user finishes the last spotlight step or hits "Пропустить".
 * Idempotent — a second POST keeps the original timestamp.
 */
user.post('/me/tour/complete', async (c) => {
  const userId = c.get('userId');
  const userService = new UserService(c.env);
  await userService.markTourCompleted(userId);
  return c.json({ ok: true });
});

/**
 * Re-arm the tour for the next login. Used by the profile screen's
 * "Пройти тур заново" affordance — clears the
 * `tour_completed_at` timestamp so `<OnboardingTour />` mounts again
 * on the next dashboard load.
 */
user.post('/me/tour/reset', async (c) => {
  const userId = c.get('userId');
  const userService = new UserService(c.env);
  await userService.resetTour(userId);
  return c.json({ ok: true });
});

user.get('/limits', async (c) => {
  const userId = c.get('userId');
  const isAdmin = c.get('isAdmin');

  if (isAdmin) {
    return c.json({ daily: { used: 0, limit: -1, unlimited: true } });
  }

  const subService = new SubscriptionService(c.env);
  const hasSub = await subService.hasActiveSubscription(userId);

  if (hasSub) {
    return c.json({ daily: { used: 0, limit: -1, unlimited: true } });
  }

  const today = new Date().toISOString().split('T')[0];
  const listen = await c.env.DB.prepare(
    'SELECT count FROM daily_listens WHERE user_id = ? AND date = ?'
  ).bind(userId, today).first<{ count: number }>();

  const used = listen?.count ?? 0;

  return c.json({
    daily: { used, limit: 3, unlimited: false, remaining: Math.max(0, 3 - used) },
  });
});

/**
 * Wipe everything that feeds the recommendation engine *for the
 * caller* — taste profile, recommendation_seen log, dislikes, and any
 * already-generated daily playlists. Listening history (`play_history`)
 * is intentionally left alone: it's a user-facing log, not part of the
 * recommendation state, and the user didn't ask to delete it.
 *
 * Pulls the user id from the JWT (`c.get('userId')`); there's no way
 * for the caller to specify someone else's id, so this can't be used
 * to reset another user's recommendations.
 */
/**
 * Roaming user preferences (crossfade on/off + duration, infinite
 * playback, requested Tidal stream quality, EQ band gains, etc.).
 * Stored as a single JSON blob in `user_preferences.prefs` so we
 * can add fields without churning the schema. The worker doesn't
 * coerce shape — it just persists whatever the client sent under
 * `prefs` after a sanity check that it's a plain object — and the
 * client is responsible for merging server-returned prefs over its
 * defaults on hydration.
 */
user.get('/preferences', async (c) => {
  const userId = c.get('userId');
  const row = await c.env.DB
    .prepare('SELECT prefs FROM user_preferences WHERE user_id = ?')
    .bind(userId)
    .first<{ prefs: string }>();
  if (!row) return c.json({ prefs: {} });
  let parsed: unknown = {};
  try {
    parsed = JSON.parse(row.prefs);
  } catch {
    parsed = {};
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return c.json({ prefs: {} });
  }
  return c.json({ prefs: parsed });
});

user.put('/preferences', async (c) => {
  const userId = c.get('userId');
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Некорректный JSON' }, 400);
  }
  const prefs =
    body && typeof body === 'object' && !Array.isArray(body) && 'prefs' in body
      ? (body as { prefs: unknown }).prefs
      : null;
  if (!prefs || typeof prefs !== 'object' || Array.isArray(prefs)) {
    return c.json({ error: 'prefs должен быть объектом' }, 400);
  }
  const now = Math.floor(Date.now() / 1000);
  await c.env.DB.prepare(
    `INSERT INTO user_preferences (user_id, prefs, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET prefs = excluded.prefs, updated_at = excluded.updated_at`,
  )
    .bind(userId, JSON.stringify(prefs), now)
    .run();
  return c.json({ ok: true });
});

user.post('/reset-recommendations', async (c) => {
  const userId = c.get('userId');
  const tables = [
    'recommendation_seen',
    'user_taste_profile',
    'user_dislikes',
    'daily_playlists',
  ];
  const deleted: Record<string, number> = {};
  for (const table of tables) {
    const result = await c.env.DB
      .prepare(`DELETE FROM ${table} WHERE user_id = ?`)
      .bind(userId)
      .run();
    deleted[table] = result.meta?.changes ?? 0;
  }
  return c.json({ ok: true, deleted });
});

export { user };
