import { Hono } from 'hono';
import type { Env, Variables } from '../types/env';
import { AuthService, type SessionMetadata } from '../services/AuthService';
import { UserService } from '../services/UserService';
import { BrevoEmailService } from '../services/BrevoEmailService';
import { EmailOtpService, isDisposableEmail, isPlausibleEmail, normalizeEmail } from '../services/EmailOtpService';
import { SignupLogService, extractIp } from '../services/SignupLogService';
import { clientLabelFromUa, hashIp } from '../services/SessionService';

/**
 * Build a `SessionMetadata` payload from the incoming request so the
 * row inserted by `AuthService.generateTokens` has user-readable
 * fields (`client_label`, `user_agent`, `ip_hash`) populated. Shared
 * across every signin entrypoint — Telegram, email OTP, nonce
 * confirmation, refresh rotation — so the new "Сессии" tab gets
 * consistent labels regardless of which code path created the row.
 */
async function sessionMetadataFromRequest(
  c: { req: { header: (k: string) => string | undefined; raw: Request } },
): Promise<SessionMetadata> {
  const ua = c.req.header('User-Agent') ?? '';
  const ip = extractIp(c.req.raw);
  return {
    userAgent: ua,
    ipHash: await hashIp(ip),
    clientLabel: clientLabelFromUa(ua),
  };
}

const auth = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * Pick the locale for the OTP email body. Defaults to Russian (the
 * primary user-base) and only switches when the client explicitly
 * sends `Accept-Language: en` or `?lang=en`. We deliberately don't
 * try to parse a quality-weighted accept-language list — the OTP is
 * a one-off transactional email and the only meaningful split is
 * RU vs EN.
 */
function pickLocale(c: { req: { header: (k: string) => string | undefined; query: (k: string) => string | undefined } }): 'ru' | 'en' {
  const q = c.req.query('lang');
  if (q === 'en') return 'en';
  if (q === 'ru') return 'ru';
  const al = (c.req.header('Accept-Language') ?? '').toLowerCase();
  if (al.startsWith('en')) return 'en';
  return 'ru';
}

auth.post('/telegram', async (c) => {
  const body = await c.req.json<{ initData: string }>();

  if (!body.initData) {
    return c.json({ error: 'initData обязателен' }, 400);
  }

  const authService = new AuthService(c.env);
  const verified = await authService.verifyTelegramAuth(body.initData);

  if (!verified) {
    return c.json({ error: 'Невалидные данные Telegram' }, 401);
  }

  const userRaw = verified.user;
  if (!userRaw) {
    return c.json({ error: 'Данные пользователя отсутствуют' }, 400);
  }

  const tgUser = JSON.parse(userRaw) as {
    id: number;
    username?: string;
    first_name?: string;
    last_name?: string;
  };

  const userService = new UserService(c.env);
  const userId = String(tgUser.id);
  // Was the user new before this upsert? Check before so we know to
  // log the signup (and apply the per-IP cap). The check has to
  // happen against the row state BEFORE upsert; doing it after would
  // always classify the user as existing. Look up by `tg_id` so a
  // user that linked their Telegram identity to an email-first row
  // resolves to that row (and is therefore *not* new), rather than
  // triggering a per-IP signup gate they shouldn't see.
  const isNew = !(await userService.findByTgId(userId));

  if (isNew) {
    // Per-IP cap on freshly-created accounts. Already-known Telegram
    // users keep logging in unimpeded — the gate only triggers when
    // the request would mint a new row. Without this, the email
    // disposable-blocklist alone wouldn't stop an attacker from
    // farming Telegram accounts off a single IP to multiply the
    // free-tier daily quota.
    const ip = extractIp(c.req.raw);
    const signupLog = new SignupLogService(c.env);
    if (!(await signupLog.canSignup(ip))) {
      return c.json({ error: 'Слишком много новых аккаунтов с этого устройства. Попробуйте позже.' }, 429);
    }
  }

  const user = await userService.upsert({
    id: userId,
    tgUsername: tgUser.username,
    tgName: [tgUser.first_name, tgUser.last_name].filter(Boolean).join(' ') || undefined,
  });

  if (isNew) {
    // Best-effort log; do not fail the login flow on a write hiccup
    // — the cap is a deterrent, not a hard auth gate.
    const ip = extractIp(c.req.raw);
    const signupLog = new SignupLogService(c.env);
    await signupLog.record({ userId: user.id, ip, source: 'telegram' }).catch(() => {});
  }

  const tokens = await authService.generateTokens(
    user.id,
    user.is_admin === 1,
    await sessionMetadataFromRequest(c),
  );

  return c.json({
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresIn: tokens.expiresIn,
    sessionId: tokens.sessionId,
    user: {
      id: user.id,
      username: user.tg_username,
      name: user.tg_name,
      isAdmin: user.is_admin === 1,
      tourCompletedAt: user.tour_completed_at ?? null,
    },
  });
});

auth.get('/nonce/:nonce', async (c) => {
  const nonce = c.req.param('nonce');
  // Auth nonces live in D1 (table `auth_nonces`). Previously KV, but the
  // free KV plan is 1000 writes/day for the whole worker which broke
  // login. D1 has plenty of headroom.
  const now = Math.floor(Date.now() / 1000);
  const row = await c.env.DB
    .prepare('SELECT user_id, expires_at FROM auth_nonces WHERE nonce = ?')
    .bind(nonce)
    .first<{ user_id: string; expires_at: number }>();

  if (!row || row.expires_at <= now) {
    return c.json({ status: 'pending' });
  }
  const userId = row.user_id;

  await c.env.DB.prepare('DELETE FROM auth_nonces WHERE nonce = ?').bind(nonce).run();

  const userService = new UserService(c.env);
  const user = await userService.findById(userId);
  if (!user) {
    return c.json({ error: 'Пользователь не найден' }, 404);
  }

  const authService = new AuthService(c.env);
  const tokens = await authService.generateTokens(
    user.id,
    user.is_admin === 1,
    await sessionMetadataFromRequest(c),
  );

  return c.json({
    status: 'confirmed',
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresIn: tokens.expiresIn,
    sessionId: tokens.sessionId,
    user: {
      id: user.id,
      username: user.tg_username,
      name: user.tg_name,
      isAdmin: user.is_admin === 1,
      tourCompletedAt: user.tour_completed_at ?? null,
    },
  });
});

/**
 * Step 1 of the email-OTP flow: caller submits an email, we issue a
 * 6-digit code, hash it into D1 (`email_otps`) and ship the plaintext
 * via Brevo.
 *
 * The response is intentionally generic ("if this address exists or
 * is well-formed we sent a code") so an attacker can't use the
 * endpoint to enumerate which addresses are bound to platform
 * accounts. The cooldown / rate-limit signals also collapse into the
 * same "ok" so timing the response gives no enumeration signal
 * either.
 */
auth.post('/email/request', async (c) => {
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

  // Reject obvious disposable / temp-mail providers up-front.
  // Otherwise an attacker can bypass the per-account daily play
  // ceiling by farming throwaway addresses, since each verified
  // address mints a fresh user row with its own quota. We surface a
  // dedicated 400 (not the generic "ok") so legitimate users on a
  // misclassified domain at least see a reason to try another address.
  if (isDisposableEmail(email)) {
    return c.json({ error: 'Одноразовые ящики не поддерживаются. Используйте свою основную почту.' }, 400);
  }

  const otpService = new EmailOtpService(c.env);
  // Best-effort GC; swallow any failure so a bloated table doesn't
  // surface as a user-visible 500 on the request endpoint.
  await otpService.sweep().catch(() => {});

  const issued = await otpService.issueCode({ email, purpose: 'login', userId: null });
  if (!issued) {
    // Cooldown still in effect from the previous request — pretend we
    // sent another one. The user already got the previous code; if
    // they need a fresh one they can wait out the 60s.
    return c.json({ ok: true });
  }

  const brevo = new BrevoEmailService(c.env);
  // The send happens synchronously so a verified failure returns to
  // the caller without misleading the UI. We don't surface the
  // upstream status code — the only externally-visible distinction
  // is "we accepted your email" vs "internal error".
  const sent = await brevo.sendOtp({ to: email, code: issued.code, locale: pickLocale(c) });
  if (!sent) {
    return c.json({ error: 'Не удалось отправить письмо. Попробуйте ещё раз через минуту.' }, 502);
  }

  return c.json({ ok: true });
});

/**
 * Step 2 of the email-OTP flow: caller submits the email + the
 * 6-digit code; we verify constant-time, drop the row, find/create
 * a user keyed by email and issue the same JWT pair the Telegram
 * flow does. Account-merging is one-directional in this endpoint:
 * the returned JWT is for the user owning this email, and Telegram
 * binding (if any) is preserved on the row. To attach an email to
 * an EXISTING Telegram account, use POST /user/me/email/request +
 * /user/me/email/verify (those are authenticated).
 */
auth.post('/email/verify', async (c) => {
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
  const result = await otpService.verifyCode({ email, code: rawCode, purpose: 'login' });
  if (!result.ok) {
    if (result.reason === 'expired') return c.json({ error: 'Срок действия кода истёк' }, 400);
    if (result.reason === 'missing') return c.json({ error: 'Код не найден. Запросите новый.' }, 400);
    if (result.reason === 'purpose') return c.json({ error: 'Несовпадение цели кода' }, 400);
    return c.json({ error: 'Неверный код' }, 400);
  }

  // Find existing email-bound user; if none, create one. We deliberately
  // generate the user id with a stable prefix so the bot/admin tools can
  // tell apart "Telegram-only" rows (numeric tg ids) from "email-first"
  // rows at a glance.
  const userService = new UserService(c.env);
  const existing = await c.env.DB
    .prepare('SELECT id FROM users WHERE email = ? LIMIT 1')
    .bind(email)
    .first<{ id: string }>();

  let userId: string;
  if (existing) {
    userId = existing.id;
    // Refresh updated_at so the row's "last login" is observable.
    await c.env.DB
      .prepare('UPDATE users SET updated_at = ? WHERE id = ?')
      .bind(Math.floor(Date.now() / 1000), userId)
      .run();
  } else {
    // Per-IP cap on freshly-created accounts. Disposable-email
    // blocklist already filters mail.tm / mailinator / etc; this
    // gate covers the residual case of an attacker farming real
    // Gmail / Outlook addresses from a single source IP. Both layers
    // together raise the cost of paywall bypass enough that it's no
    // longer the cheapest attack path against the free tier.
    const ip = extractIp(c.req.raw);
    const signupLog = new SignupLogService(c.env);
    if (!(await signupLog.canSignup(ip))) {
      return c.json({ error: 'Слишком много новых аккаунтов с этого устройства. Попробуйте позже.' }, 429);
    }
    userId = `email_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
    const now = Math.floor(Date.now() / 1000);
    await c.env.DB
      .prepare(
        'INSERT INTO users (id, tg_username, tg_name, email, is_admin, created_at, updated_at) VALUES (?, NULL, NULL, ?, 0, ?, ?)',
      )
      .bind(userId, email, now, now)
      .run();
    await signupLog.record({ userId, ip, source: 'email' }).catch(() => {});
  }

  const user = await userService.findById(userId);
  if (!user) {
    return c.json({ error: 'Не удалось создать пользователя' }, 500);
  }

  // Reject banned users at login, same gate as the JWT middleware applies
  // on every authenticated request — without it, a banned user could log
  // in and only get blocked on the next API call.
  if ((user as { is_banned?: number }).is_banned === 1) {
    return c.json({ error: 'Аккаунт заблокирован', banned: true }, 403);
  }

  const authService = new AuthService(c.env);
  const tokens = await authService.generateTokens(
    user.id,
    user.is_admin === 1,
    await sessionMetadataFromRequest(c),
  );

  return c.json({
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresIn: tokens.expiresIn,
    sessionId: tokens.sessionId,
    user: {
      id: user.id,
      username: user.tg_username,
      name: user.tg_name,
      email,
      isAdmin: user.is_admin === 1,
      tourCompletedAt: user.tour_completed_at ?? null,
    },
  });
});

auth.post('/refresh', async (c) => {
  const body = await c.req.json<{ refreshToken: string }>();

  if (!body.refreshToken) {
    return c.json({ error: 'refreshToken обязателен' }, 400);
  }

  const authService = new AuthService(c.env);
  const payload = await authService.verifyRefreshToken(body.refreshToken);

  if (!payload) {
    return c.json({ error: 'Недействительный refresh token' }, 401);
  }

  await authService.revokeRefreshToken(body.refreshToken);

  const userService = new UserService(c.env);
  const isAdmin = await userService.isAdmin(payload.sub);
  const tokens = await authService.generateTokens(
    payload.sub,
    isAdmin,
    await sessionMetadataFromRequest(c),
  );

  return c.json({
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresIn: tokens.expiresIn,
    sessionId: tokens.sessionId,
  });
});

export { auth };
