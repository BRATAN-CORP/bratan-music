import { Hono } from 'hono';
import type { Env, Variables } from '../types/env';
import { jwtAuth, adminOnly } from '../middleware/auth';
import { UserService } from '../services/UserService';
import { SubscriptionService } from '../services/SubscriptionService';
import { TidalAuth } from '../services/tidal/TidalAuth';

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

// ---------------------------------------------------------------------------
// Tidal account management
//
// The Tidal proxy account is stored as a single KV-backed session shared by
// every user of this worker. These endpoints let an admin swap that account
// without redeploying the worker.
// ---------------------------------------------------------------------------

function maskToken(token: string | undefined | null): string | null {
  if (!token) return null;
  if (token.length <= 12) return token;
  return `${token.slice(0, 6)}…${token.slice(-4)}`;
}

admin.get('/tidal/status', async (c) => {
  const auth = new TidalAuth(c.env);
  const session = await auth.readSession();
  return c.json({
    hasSession: Boolean(session),
    userId: session?.userId ?? null,
    countryCode: session?.countryCode ?? null,
    expiresAt: session?.expiresAt ?? null,
    accessTokenPreview: maskToken(session?.accessToken),
    refreshTokenPreview: maskToken(session?.refreshToken),
  });
});

admin.post('/tidal/refresh-token', async (c) => {
  const body = await c.req.json<{ refreshToken?: string }>().catch(() => ({} as { refreshToken?: string }));
  const refreshToken = body.refreshToken?.trim();
  if (!refreshToken) {
    return c.json({ error: 'refreshToken обязателен' }, 400);
  }
  try {
    const auth = new TidalAuth(c.env);
    const tokens = await auth.installRefreshToken(refreshToken);
    return c.json({
      ok: true,
      userId: tokens.userId,
      countryCode: tokens.countryCode,
      expiresAt: tokens.expiresAt,
      accessTokenPreview: maskToken(tokens.accessToken),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Ошибка установки токена';
    return c.json({ error: message }, 400);
  }
});

admin.post('/tidal/device/start', async (c) => {
  try {
    const auth = new TidalAuth(c.env);
    const data = await auth.startDeviceAuth();
    return c.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Не удалось начать device auth';
    return c.json({ error: message }, 502);
  }
});

admin.post('/tidal/device/poll', async (c) => {
  const body = await c.req.json<{ deviceCode?: string }>().catch(() => ({} as { deviceCode?: string }));
  const deviceCode = body.deviceCode?.trim();
  if (!deviceCode) {
    return c.json({ error: 'deviceCode обязателен' }, 400);
  }
  try {
    const auth = new TidalAuth(c.env);
    const result = await auth.pollDeviceAuth(deviceCode);
    return c.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Ошибка опроса device auth';
    return c.json({ error: message, ok: false, pending: false }, 502);
  }
});

admin.post('/tidal/logout', async (c) => {
  const auth = new TidalAuth(c.env);
  await auth.clearSession();
  return c.json({ ok: true });
});

export { admin };
