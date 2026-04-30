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
  const tokens = await authService.generateTokens(payload.sub, isAdmin);

  return c.json({
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresIn: tokens.expiresIn,
  });
});

export { auth };
