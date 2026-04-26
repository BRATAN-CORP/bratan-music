import { Hono } from 'hono';
import type { Env, Variables } from '../types/env';
import { jwtAuth, adminOnly } from '../middleware/auth';
import { UserService } from '../services/UserService';
import { SubscriptionService } from '../services/SubscriptionService';

const admin = new Hono<{ Bindings: Env; Variables: Variables }>();

admin.use('/*', jwtAuth, adminOnly);

interface GrantBody {
  userId?: string;
  tgUsername?: string;
  days?: number;
}

admin.post('/grant', async (c) => {
  const body = await c.req.json<GrantBody>().catch(() => ({} as GrantBody));
  const days = Math.max(1, Math.min(3650, Number(body.days ?? 30)));

  if (!body.userId && !body.tgUsername) {
    return c.json({ error: 'userId или tgUsername обязателен' }, 400);
  }

  const userService = new UserService(c.env);
  let user = body.userId ? await userService.findById(body.userId) : null;
  if (!user && body.tgUsername) {
    user = await c.env.DB.prepare(
      'SELECT * FROM users WHERE LOWER(tg_username) = LOWER(?) LIMIT 1'
    ).bind(body.tgUsername.replace(/^@/, '')).first();
  }
  if (!user) {
    return c.json({ error: 'Пользователь не найден' }, 404);
  }

  const subService = new SubscriptionService(c.env);
  const sub = await subService.activateManual(user.id, days);

  return c.json({
    ok: true,
    user: { id: user.id, username: user.tg_username, name: user.tg_name },
    subscription: { id: sub.id, expiresAt: sub.expires_at, days },
  });
});

admin.get('/users/search', async (c) => {
  const q = (c.req.query('q') ?? '').trim();
  if (!q) return c.json({ items: [] });
  const like = `%${q.toLowerCase()}%`;
  const rows = await c.env.DB.prepare(
    `SELECT id, tg_username, tg_name, is_admin, created_at
     FROM users
     WHERE LOWER(tg_username) LIKE ? OR LOWER(tg_name) LIKE ? OR id = ?
     ORDER BY created_at DESC LIMIT 20`
  ).bind(like, like, q).all();
  return c.json({ items: rows.results ?? [] });
});

export { admin };
