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
  // Trust the JWT first (no DB hit on the hot path), but fall back to a
  // fresh DB lookup when the claim is false — JWTs issued before the user
  // was granted admin would otherwise lock them out until they log in again.
  if (!c.get('isAdmin')) {
    const userService = new UserService(c.env);
    const fresh = await userService.isAdmin(c.get('userId'));
    if (!fresh) {
      return c.json({ error: 'Доступ запрещён' }, 403);
    }
    c.set('isAdmin', true);
  }
  await next();
});
