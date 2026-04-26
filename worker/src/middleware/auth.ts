import { createMiddleware } from 'hono/factory';
import type { Env, Variables } from '../types/env';
import { AuthService } from '../services/AuthService';

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
  if (!c.get('isAdmin')) {
    return c.json({ error: 'Доступ запрещён' }, 403);
  }
  await next();
});
