import { createMiddleware } from 'hono/factory';
import type { Env, Variables } from '../types/env';
import { AuthService } from '../services/AuthService';

export const jwtAuth = createMiddleware<{ Bindings: Env; Variables: Variables }>(async (c, next) => {
  const authorization = c.req.header('Authorization');
  if (!authorization?.startsWith('Bearer ')) {
    return c.json({ error: 'Требуется авторизация' }, 401);
  }

  const token = authorization.slice(7);
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
