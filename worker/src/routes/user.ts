import { Hono } from 'hono';
import type { Env, Variables } from '../types/env';
import { UserService } from '../services/UserService';
import { SubscriptionService } from '../services/SubscriptionService';
import { BrevoEmailService } from '../services/BrevoEmailService';
import { EmailOtpService, isDisposableEmail, isPlausibleEmail, normalizeEmail } from '../services/EmailOtpService';
import { SessionService } from '../services/SessionService';
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
 * Link-a-Telegram-account flow, step 1: caller (an email-first user)
 * mints a single-use, 5-minute-TTL nonce and stashes a row in
 * `tg_link_requests` keyed to their user id. We return the nonce so
 * the frontend can build a `t.me/<bot>?start=link_<nonce>` deeplink.
 *
 * The bot's `/start` handler picks the deeplink up, fills in
 * `tg_id` / `tg_username` / `tg_name` on the same row, and the
 * frontend then polls `/me/telegram/link/status/:nonce` to finalise
 * the binding under JWT.
 *
 * Refuses to mint a nonce if the caller already has a Telegram
 * identity bound — the link flow is one-shot per row.
 */
user.post('/me/telegram/link/start', async (c) => {
  const userId = c.get('userId');

  const current = await c.env.DB
    .prepare('SELECT tg_id FROM users WHERE id = ? LIMIT 1')
    .bind(userId)
    .first<{ tg_id: string | null }>();
  if (!current) {
    return c.json({ error: 'Пользователь не найден' }, 404);
  }
  if (current.tg_id) {
    return c.json({ error: 'К аккаунту уже привязан Telegram.' }, 409);
  }

  const nonce = crypto.randomUUID().replace(/-/g, '');
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + 5 * 60; // 5 minutes — same window as auth_nonces

  await c.env.DB
    .prepare(
      'INSERT INTO tg_link_requests (nonce, requester_id, expires_at, created_at) VALUES (?, ?, ?, ?)',
    )
    .bind(nonce, userId, expiresAt, now)
    .run();

  return c.json({ nonce, expiresAt });
});

/**
 * Link-a-Telegram-account flow, step 2: poll-and-finalise. Frontend
 * calls this every ~1s until the row's `tg_id` is non-NULL — i.e.
 * the bot has handled the deeplink and stamped the Telegram identity
 * onto the row. We then bind the identity to the caller's user row
 * and delete the link-request row so the nonce is strictly one-shot.
 *
 * Statuses:
 *   - `pending`: row exists, bot hasn't seen the deeplink yet
 *   - `expired`: TTL elapsed, row gc'd or about to be
 *   - `confirmed`: link applied — response includes the updated
 *     username/name so the frontend can refresh the profile card
 *   - `conflict`: tg_id is already bound to another user — surface to UI
 */
user.get('/me/telegram/link/status/:nonce', async (c) => {
  const userId = c.get('userId');
  const nonce = c.req.param('nonce');
  if (!/^[0-9a-f]{16,64}$/.test(nonce)) {
    return c.json({ error: 'Некорректный nonce' }, 400);
  }

  const row = await c.env.DB
    .prepare(
      'SELECT requester_id, tg_id, tg_username, tg_name, expires_at FROM tg_link_requests WHERE nonce = ? LIMIT 1',
    )
    .bind(nonce)
    .first<{
      requester_id: string;
      tg_id: string | null;
      tg_username: string | null;
      tg_name: string | null;
      expires_at: number;
    }>();

  if (!row) {
    return c.json({ status: 'expired' as const });
  }
  if (row.requester_id !== userId) {
    // Don't let one user finalise another user's link nonce.
    return c.json({ error: 'Nonce принадлежит другому пользователю' }, 403);
  }
  if (row.expires_at < Math.floor(Date.now() / 1000)) {
    await c.env.DB.prepare('DELETE FROM tg_link_requests WHERE nonce = ?').bind(nonce).run();
    return c.json({ status: 'expired' as const });
  }
  if (!row.tg_id) {
    return c.json({ status: 'pending' as const });
  }

  const userService = new UserService(c.env);
  try {
    await userService.linkTelegram(userId, {
      id: row.tg_id,
      username: row.tg_username,
      name: row.tg_name,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === 'tg_id_taken') {
      // Another user already owns this tg_id. Drop the link-request
      // row so a stale nonce doesn't keep returning a confirmable
      // status to the poller.
      await c.env.DB.prepare('DELETE FROM tg_link_requests WHERE nonce = ?').bind(nonce).run();
      return c.json({ status: 'conflict' as const }, 409);
    }
    console.error('[telegram/link] linkTelegram failed:', msg);
    return c.json({ error: 'Не удалось привязать Telegram' }, 500);
  }

  await c.env.DB.prepare('DELETE FROM tg_link_requests WHERE nonce = ?').bind(nonce).run();

  return c.json({
    status: 'confirmed' as const,
    telegram: {
      username: row.tg_username,
      name: row.tg_name,
    },
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

/**
 * Active sessions list. Shows every refresh-token row for this user
 * that hasn't expired yet, with the access token's `sid` (if present)
 * used to mark which entry is "this device". The Профиль → Сессии tab
 * renders the result; no admin override is required since user_id
 * scoping happens inside SessionService.
 */
user.get('/sessions', async (c) => {
  const userId = c.get('userId');
  const currentSessionId = c.get('sessionId') ?? null;
  const sessions = await new SessionService(c.env).list(userId, currentSessionId);
  return c.json({ sessions, currentSessionId });
});

/**
 * Revoke a specific session. Returns 404 if the id doesn't belong to
 * the caller — the SessionService.revoke already scopes by user_id so
 * a successful delete is proof of ownership.
 *
 * Note: if the user revokes their *current* session (id ===
 * sessionId from the access token), their access token is still
 * within its 1h TTL and would keep working. That's a defensible
 * behaviour for a self-initiated revoke (it's their own device), but
 * to mirror "Logout" semantics we ALSO bump `min_token_iat` to now
 * when the revoked row matches the caller's session.
 */
user.delete('/sessions/:id', async (c) => {
  const userId = c.get('userId');
  const sid = c.req.param('id');
  if (!sid) return c.json({ error: 'session id обязателен' }, 400);
  const svc = new SessionService(c.env);
  const ok = await svc.revoke(userId, sid);
  if (!ok) return c.json({ error: 'Сессия не найдена' }, 404);
  // If the user just killed their own active session, also forfeit
  // the access token immediately by bumping `min_token_iat`. Other
  // sessions are unaffected because they were minted with a later
  // iat than the bump value.
  if (c.get('sessionId') === sid) {
    const now = Math.floor(Date.now() / 1000);
    await c.env.DB
      .prepare('UPDATE users SET min_token_iat = ? WHERE id = ?')
      .bind(now, userId)
      .run();
  }
  return c.json({ ok: true });
});

/**
 * "Выйти со всех других устройств". Drops every refresh-token row
 * except the caller's current session AND bumps `min_token_iat` so
 * any access token issued for a different session forfeits on its
 * next request. The current session's access token survives because
 * SessionService.revokeAllExcept bumps to `now - 1` (the current
 * token's iat is >= now since it was issued at or after the same
 * second).
 *
 * Why we don't also rotate the current refresh token here:
 * - The refresh row is unchanged, so the next /auth/refresh call
 *   from this device will succeed and rotate normally.
 * - Forcing a rotation here would require sending the new pair back
 *   in the response, which couples this endpoint to refresh-token
 *   lifecycle. Cleaner to keep the two flows orthogonal.
 */
user.post('/sessions/logout-all', async (c) => {
  const userId = c.get('userId');
  const keep = c.get('sessionId') ?? null;
  const cutoff = await new SessionService(c.env).revokeAllExcept(userId, keep);
  return c.json({ ok: true, minTokenIat: cutoff, keptSessionId: keep });
});

export { user };
