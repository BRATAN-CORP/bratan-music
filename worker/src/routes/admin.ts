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

// ---------------------------------------------------------------------------
// Dangerous: purge a user's data from the service.
//
// Deletes everything that user has ever produced: their uploads (R2 + DB
// rows), their playlists, their library items, their listening history,
// their auth sessions, and finally the user row itself. Most tables already
// cascade on `users.id`, so we only have to clean up the few that don't
// (`auth_nonces`, `recommendation_seen`) plus the R2 blobs that aren't
// covered by the DB cascade.
//
// The endpoint refuses to delete the requesting admin themselves to avoid a
// foot-gun where an admin accidentally locks themselves out.
// ---------------------------------------------------------------------------

interface UserTrackRow {
  r2_key: string;
}

admin.delete('/users/:id/data', async (c) => {
  const targetId = c.req.param('id');
  const requesterId = c.get('userId');
  if (!targetId) return c.json({ error: 'id обязателен' }, 400);
  if (targetId === requesterId) {
    return c.json({ error: 'Нельзя удалить собственные данные через эту ручку' }, 400);
  }

  const userService = new UserService(c.env);
  const user = await userService.findById(targetId);
  if (!user) return c.json({ error: 'Пользователь не найден' }, 404);

  // 1. Collect every R2 key associated with the user (uploads + per-user
  //    track overrides) so we can drop the blobs out-of-band.
  const r2Keys = new Set<string>();
  const collect = async (sql: string) => {
    const rows = await c.env.DB.prepare(sql).bind(targetId).all<UserTrackRow>();
    for (const row of rows.results ?? []) if (row.r2_key) r2Keys.add(row.r2_key);
  };
  await collect('SELECT r2_key FROM user_tracks WHERE user_id = ?');
  await collect('SELECT r2_key FROM track_overrides WHERE user_id = ?');

  // 2. Best-effort R2 deletion. We don't fail the whole purge if a single
  //    object can't be removed — the DB cascade still wipes references and
  //    the orphan blob is invisible to the app.
  let r2Deleted = 0;
  let r2Failed = 0;
  for (const key of r2Keys) {
    try {
      await c.env.TRACKS.delete(key);
      r2Deleted += 1;
    } catch (err) {
      console.error('[admin/purge] R2 delete failed', key, err);
      r2Failed += 1;
    }
  }

  // 3. Manual cleanup for tables that don't have a CASCADE FK on user_id.
  await c.env.DB.prepare('DELETE FROM auth_nonces WHERE user_id = ?').bind(targetId).run();
  await c.env.DB.prepare('DELETE FROM recommendation_seen WHERE user_id = ?').bind(targetId).run();

  // 4. Finally drop the user row — cascades to playlists, library_items,
  //    user_tracks, sessions, subscriptions, daily_*, play_history,
  //    track_overrides, user_taste_profile, user_dislikes, etc.
  const result = await c.env.DB.prepare('DELETE FROM users WHERE id = ?').bind(targetId).run();

  return c.json({
    ok: true,
    user: { id: user.id, username: user.tg_username, name: user.tg_name },
    deleted: {
      userRow: result.meta?.changes ?? 0,
      r2Objects: r2Deleted,
      r2Failed,
    },
  });
});

export { admin };
