import { Hono } from 'hono';
import type { Env, Variables } from '../types/env';
import { UserService } from '../services/UserService';
import { SubscriptionService } from '../services/SubscriptionService';
import { BrevoEmailService } from '../services/BrevoEmailService';
import { EmailOtpService, isDisposableEmail, isPlausibleEmail, normalizeEmail } from '../services/EmailOtpService';
import { jwtAuth } from '../middleware/auth';

const user = new Hono<{ Bindings: Env; Variables: Variables }>();

user.use('/*', jwtAuth);

function pickLocale(c: { req: { header: (k: string) => string | undefined; query: (k: string) => string | undefined } }): 'ru' | 'en' {
  const q = c.req.query('lang');
  if (q === 'en') return 'en';
  if (q === 'ru') return 'ru';
  const al = (c.req.header('Accept-Language') ?? '').toLowerCase();
  if (al.startsWith('en')) return 'en';
  return 'ru';
}

user.get('/me', async (c) => {
  const userId = c.get('userId');
  const userService = new UserService(c.env);
  const userData = await userService.findById(userId);

  if (!userData) {
    return c.json({ error: 'Пользователь не найден' }, 404);
  }

  const subService = new SubscriptionService(c.env);
  const subscription = await subService.getActive(userId);

  // Pull the email column with a one-off SELECT — UserService.findById
  // returns the historical shape (no `email`) so callers that already
  // depend on `User` don't shift; settings page is the only consumer
  // that needs the email and it can ride this endpoint.
  const emailRow = await c.env.DB
    .prepare('SELECT email FROM users WHERE id = ? LIMIT 1')
    .bind(userId)
    .first<{ email: string | null }>();

  return c.json({
    id: userData.id,
    username: userData.tg_username,
    name: userData.tg_name,
    email: emailRow?.email ?? null,
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
 * Link-an-email to the currently signed-in user, step 1: caller posts
 * the address, we issue an OTP with `purpose='link'` and ship it to
 * Brevo. Refuses to issue if the email is already attached to a
 * different user — the verify path would 409 anyway, but failing
 * fast saves the user a 60-second cooldown on a doomed code.
 *
 * The link is one-way and permanent: once an email is bound to the
 * caller's account, this endpoint refuses further /request calls
 * with a 409. Re-binding (or unlinking) is intentionally not
 * supported — the email is the recovery handle for the account, and
 * letting it drift would silently break the recovery flow on a
 * server-side state we can't reconstruct.
 */
user.post('/me/email/request', async (c) => {
  const userId = c.get('userId');
  let body: { email?: unknown };
  try {
    body = await c.req.json<{ email?: unknown }>();
  } catch {
    return c.json({ error: 'Некорректный JSON' }, 400);
  }
  const rawEmail = typeof body.email === 'string' ? body.email : '';
  if (!isPlausibleEmail(rawEmail)) {
    return c.json({ error: 'Некорректный email' }, 400);
  }
  const email = normalizeEmail(rawEmail);

  // Reject disposable / temp-mail providers — we don't want the
  // recovery handle for a real account to live on a 10-minute
  // throwaway inbox.
  if (isDisposableEmail(email)) {
    return c.json({ error: 'Одноразовые ящики не поддерживаются. Используйте свою основную почту.' }, 400);
  }

  // Refuse re-binding: once the user has an email on file, this
  // endpoint is a no-op. The caller already knows the address
  // (`/user/me` exposes it); attempts to swap it route through a
  // dedicated support path instead of an automated UI surface.
  const current = await c.env.DB
    .prepare('SELECT email FROM users WHERE id = ? LIMIT 1')
    .bind(userId)
    .first<{ email: string | null }>();
  if (current?.email) {
    return c.json({ error: 'К аккаунту уже привязан email и его нельзя сменить.' }, 409);
  }

  // Block linking an email that another user already owns. SQLite's
  // UNIQUE INDEX on `users.email` would also catch this on the
  // verify-side INSERT, but we reject early so the user sees a
  // dedicated message instead of a generic conflict.
  const owner = await c.env.DB
    .prepare('SELECT id FROM users WHERE email = ? LIMIT 1')
    .bind(email)
    .first<{ id: string }>();
  if (owner && owner.id !== userId) {
    return c.json({ error: 'Этот email уже привязан к другому аккаунту' }, 409);
  }

  const otpService = new EmailOtpService(c.env);
  await otpService.sweep().catch(() => {});

  const issued = await otpService.issueCode({ email, purpose: 'link', userId });
  if (!issued) {
    return c.json({ ok: true });
  }

  const brevo = new BrevoEmailService(c.env);
  const sent = await brevo.sendOtp({ to: email, code: issued.code, locale: pickLocale(c) });
  if (!sent) {
    return c.json({ error: 'Не удалось отправить письмо. Попробуйте ещё раз через минуту.' }, 502);
  }
  return c.json({ ok: true });
});

/**
 * Link-an-email step 2: verify the code and bind the email column on
 * the caller's user row. Refuses if the row was meant for a
 * different user (paranoia — the OTP service stamps `user_id` at
 * issue time, so this only triggers if a row was hand-edited).
 */
user.post('/me/email/verify', async (c) => {
  const userId = c.get('userId');
  let body: { email?: unknown; code?: unknown };
  try {
    body = await c.req.json<{ email?: unknown; code?: unknown }>();
  } catch {
    return c.json({ error: 'Некорректный JSON' }, 400);
  }
  const rawEmail = typeof body.email === 'string' ? body.email : '';
  const rawCode = typeof body.code === 'string' ? body.code.trim() : '';
  if (!isPlausibleEmail(rawEmail)) {
    return c.json({ error: 'Некорректный email' }, 400);
  }
  if (!/^\d{6}$/.test(rawCode)) {
    return c.json({ error: 'Код должен содержать 6 цифр' }, 400);
  }
  const email = normalizeEmail(rawEmail);

  const otpService = new EmailOtpService(c.env);
  const result = await otpService.verifyCode({ email, code: rawCode, purpose: 'link' });
  if (!result.ok) {
    if (result.reason === 'expired') return c.json({ error: 'Срок действия кода истёк' }, 400);
    if (result.reason === 'missing') return c.json({ error: 'Код не найден. Запросите новый.' }, 400);
    if (result.reason === 'purpose') return c.json({ error: 'Несовпадение цели кода' }, 400);
    return c.json({ error: 'Неверный код' }, 400);
  }
  if (result.userId && result.userId !== userId) {
    return c.json({ error: 'Код выдан другому пользователю' }, 409);
  }

  // Race-aware UPDATE — if some other user beat us to UNIQUE on email,
  // the constraint will throw and we surface a 409. The earlier
  // pre-check on /request prevents the common path; this catches the
  // race where two users issued link-codes for the same email
  // concurrently.
  try {
    await c.env.DB
      .prepare('UPDATE users SET email = ?, updated_at = ? WHERE id = ?')
      .bind(email, Math.floor(Date.now() / 1000), userId)
      .run();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('UNIQUE') || msg.includes('constraint')) {
      return c.json({ error: 'Этот email уже привязан к другому аккаунту' }, 409);
    }
    console.error('[email/link] UPDATE failed:', msg);
    return c.json({ error: 'Не удалось привязать email' }, 500);
  }

  return c.json({ ok: true, email });
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
  // Source of truth for the daily quota is the dedup table — same as
  // the gate in `tracks/:id/stream`. The legacy `daily_listens.count`
  // overcounted (every quality-fallback retry incremented it), so we
  // can't trust its rows for the user-facing "сколько осталось"
  // counter either.
  const listen = await c.env.DB.prepare(
    'SELECT COUNT(*) AS cnt FROM daily_listen_tracks WHERE user_id = ? AND date = ?'
  ).bind(userId, today).first<{ cnt: number }>();

  const used = listen?.cnt ?? 0;

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
  // Stamp a reset checkpoint so the next TasteService.recompute() ignores
  // play_history rows from before this moment. Without this, the wave
  // would still feel unchanged immediately after reset because recompute
  // rebuilds the taste vector from preserved play_history. With it, the
  // wave / continue / daily playlists all start from a genuinely fresh
  // signal until the user listens to new things post-reset.
  await c.env.DB
    .prepare(`UPDATE users SET recommendations_reset_at = ?, updated_at = ? WHERE id = ?`)
    .bind(Date.now(), Math.floor(Date.now() / 1000), userId)
    .run();
  return c.json({ ok: true, deleted });
});

export { user };
