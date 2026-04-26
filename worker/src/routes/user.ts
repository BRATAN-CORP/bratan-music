import { Hono } from 'hono';
import type { Env, Variables } from '../types/env';
import { UserService } from '../services/UserService';
import { SubscriptionService } from '../services/SubscriptionService';
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

  const subService = new SubscriptionService(c.env);
  const subscription = await subService.getActive(userId);

  return c.json({
    id: userData.id,
    username: userData.tg_username,
    name: userData.tg_name,
    isAdmin: userData.is_admin === 1,
    subscription: subscription
      ? {
          status: 'active' as const,
          expiresAt: subscription.expires_at,
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

  const subService = new SubscriptionService(c.env);
  const hasSub = await subService.hasActiveSubscription(userId);

  if (hasSub) {
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
