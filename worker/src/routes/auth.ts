import { Hono } from 'hono';
import type { Env, Variables } from '../types/env';
import { AuthService } from '../services/AuthService';
import { UserService } from '../services/UserService';

const auth = new Hono<{ Bindings: Env; Variables: Variables }>();

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
  const user = await userService.upsert({
    id: String(tgUser.id),
    tgUsername: tgUser.username,
    tgName: [tgUser.first_name, tgUser.last_name].filter(Boolean).join(' ') || undefined,
  });

  const tokens = await authService.generateTokens(user.id, user.is_admin === 1);

  return c.json({
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresIn: tokens.expiresIn,
    user: {
      id: user.id,
      username: user.tg_username,
      name: user.tg_name,
      isAdmin: user.is_admin === 1,
    },
  });
});

auth.get('/nonce/:nonce', async (c) => {
  const nonce = c.req.param('nonce');
  const userId = await c.env.SESSIONS.get(`auth_nonce:${nonce}`);

  if (!userId) {
    return c.json({ status: 'pending' });
  }

  await c.env.SESSIONS.delete(`auth_nonce:${nonce}`);

  const userService = new UserService(c.env);
  const user = await userService.findById(userId);
  if (!user) {
    return c.json({ error: 'Пользователь не найден' }, 404);
  }

  const authService = new AuthService(c.env);
  const tokens = await authService.generateTokens(user.id, user.is_admin === 1);

  return c.json({
    status: 'confirmed',
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresIn: tokens.expiresIn,
    user: {
      id: user.id,
      username: user.tg_username,
      name: user.tg_name,
      isAdmin: user.is_admin === 1,
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
  const tokens = await authService.generateTokens(payload.sub, isAdmin);

  return c.json({
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresIn: tokens.expiresIn,
  });
});

export { auth };
