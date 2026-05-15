import { createMiddleware } from 'hono/factory';
import type { Env, Variables } from '../types/env';
import { AuthService } from '../services/AuthService';
import { UserService } from '../services/UserService';

export const jwtAuth = createMiddleware<{ Bindings: Env; Variables: Variables }>(async (c, next) => {
  const authorization = c.req.header('Authorization');
  // Fall back to ?token=... so endpoints used by <audio>/<video> elements
  // (which can't attach custom Authorization headers) can still be auth'd.
  const queryToken = c.req.query('token');
  let token: string | undefined;
  if (authorization?.startsWith('Bearer ')) {
    token = authorization.slice(7);
  } else if (queryToken) {
    token = queryToken;
  } else {
    return c.json({ error: 'Требуется авторизация' }, 401);
  }

  const authService = new AuthService(c.env);
  const payload = await authService.verifyAccessToken(token);

  if (!payload) {
    return c.json({ error: 'Недействительный или истёкший токен' }, 401);
  }

  c.set('userId', payload.sub);
  c.set('isAdmin', payload.admin);
  if (payload.sid) {
    c.set('sessionId', payload.sid);
  }

  // Reject banned users AND access tokens issued before the user's
  // `min_token_iat` cutoff on every request. The access token itself
  // doesn't know about either signal (it's signed once and lives for
  // an hour) so we confirm against the row each call. Both checks
  // collapse into one PK lookup so this isn't a perf regression vs.
  // the previous ban-only gate.
  //
  // `min_token_iat` semantics: any access token whose `iat` is older
  // than this value forfeits — backs both the per-user "выйти со всех
  // других устройств" button (bumps min_token_iat in a way that
  // invalidates everything except the freshly-rotated current pair)
  // AND the one-off "global re-login" sweep that migration 0028
  // performed at apply time.
  const row = await c.env.DB
    .prepare('SELECT is_banned, min_token_iat FROM users WHERE id = ? LIMIT 1')
    .bind(payload.sub)
    .first<{ is_banned: number; min_token_iat: number }>();
  if (row && row.is_banned === 1) {
    return c.json({ error: 'Аккаунт заблокирован', banned: true }, 403);
  }
  if (row && payload.iat < (row.min_token_iat ?? 0)) {
    return c.json({ error: 'Сессия завершена. Войдите снова.' }, 401);
  }
  // Per-session revoke gate: an access token whose `sid` no longer
  // points to a `sessions` row is dead immediately. This is what
  // makes the "Завершить" button on the Sessions tab actually take
  // effect on OTHER devices — the deleted row drops their token's
  // sid out of existence, and the next request comes back 401
  // instead of riding out the 1h TTL. `payload.sid` is required
  // for every token minted on or after PR #443 (migration 0028 +
  // global logout sweep guarantee no live token without sid), so
  // an absent sid means a stale pre-migration token and forfeits.
  if (!payload.sid) {
    return c.json({ error: 'Сессия завершена. Войдите снова.' }, 401);
  }
  const sess = await c.env.DB
    .prepare('SELECT 1 AS ok FROM sessions WHERE id = ? AND user_id = ? LIMIT 1')
    .bind(payload.sid, payload.sub)
    .first<{ ok: number }>();
  if (!sess) {
    return c.json({ error: 'Сессия завершена. Войдите снова.' }, 401);
  }
  await next();
});

export const adminOnly = createMiddleware<{ Bindings: Env; Variables: Variables }>(async (c, next) => {
  // Always confirm admin status against the DB. The JWT carries an
  // `admin` claim cached at issue-time, but trusting it for an entire
  // hour means a freshly-revoked admin keeps full access until their
  // token rotates. Admin endpoints are low-traffic, so the extra
  // SELECT per call is essentially free.
  const userService = new UserService(c.env);
  const fresh = await userService.isAdmin(c.get('userId'));
  if (!fresh) {
    return c.json({ error: 'Доступ запрещён' }, 403);
  }
  c.set('isAdmin', true);
  await next();
});
