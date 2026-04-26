import { Hono } from 'hono';
import type { Env, Variables } from '../types/env';
import { UserService } from '../services/UserService';
import { jwtAuth } from '../middleware/auth';

const user = new Hono<{ Bindings: Env; Variables: Variables }>();

user.use('/*', jwtAuth);

user.get('/me', async (c) => {
  const userId = c.get('userId');
  const userService = new UserService(c.env);
  const userData = await userService.findById(userId);

  if (!userData) {
    return c.json({ error: 'Пользователь не найден' }, 404);
  }

  const now = Math.floor(Date.now() / 1000);
  const subscription = await c.env.DB.prepare(
    'SELECT * FROM subscriptions WHERE user_id = ? AND status = ? AND expires_at > ? ORDER BY expires_at DESC LIMIT 1'
  ).bind(userId, 'active', now).first();

  return c.json({
    id: userData.id,
    username: userData.tg_username,
    name: userData.tg_name,
    isAdmin: userData.is_admin === 1,
    subscription: subscription
      ? {
          status: 'active' as const,
          expiresAt: subscription.expires_at as number,
        }
      : null,
  });
});

user.get('/limits', async (c) => {
  const userId = c.get('userId');
  const isAdmin = c.get('isAdmin');

  if (isAdmin) {
    return c.json({ daily: { used: 0, limit: -1, unlimited: true } });
  }

  const now = Math.floor(Date.now() / 1000);
  const subscription = await c.env.DB.prepare(
    'SELECT id FROM subscriptions WHERE user_id = ? AND status = ? AND expires_at > ? LIMIT 1'
  ).bind(userId, 'active', now).first();

  if (subscription) {
    return c.json({ daily: { used: 0, limit: -1, unlimited: true } });
  }

  const today = new Date().toISOString().split('T')[0];
  const listen = await c.env.DB.prepare(
    'SELECT count FROM daily_listens WHERE user_id = ? AND date = ?'
  ).bind(userId, today).first<{ count: number }>();

  const used = listen?.count ?? 0;

  return c.json({
    daily: { used, limit: 3, unlimited: false, remaining: Math.max(0, 3 - used) },
  });
});

export { user };
