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
