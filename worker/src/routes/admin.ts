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

/**
 * Toggle the `is_admin` flag on any user. Accepts the same shape as
 * /admin/grant: either `userId` (TG numeric id stored as our PK) or
 * `tgUsername`. Refuses to demote the requesting admin themselves to
 * avoid a foot-gun where the only admin removes their own access.
 */
admin.post('/admin-flag', async (c) => {
  interface Body { userId?: string; tgUsername?: string; isAdmin?: boolean }
  const body = await c.req.json<Body>().catch(() => ({} as Body));
  const requesterId = c.get('userId');
  const isAdmin = body.isAdmin ?? true;

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
  if (!user) return c.json({ error: 'Пользователь не найден' }, 404);

  if (user.id === requesterId && !isAdmin) {
    return c.json({ error: 'Нельзя снять админку с самого себя' }, 400);
  }

  const now = Math.floor(Date.now() / 1000);
  await c.env.DB
    .prepare('UPDATE users SET is_admin = ?, updated_at = ? WHERE id = ?')
    .bind(isAdmin ? 1 : 0, now, user.id)
    .run();

  return c.json({
    ok: true,
    user: {
      id: user.id,
      username: user.tg_username,
      name: user.tg_name,
      isAdmin,
    },
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
// Admin user grid (PR #215). Paginated list of users with subscription
// status, ban status, role and play-history aggregates for the table.
// Filters: ?q=, ?role=admin|user, ?banned=1|0, ?sub=active|none.
// Sorts:   ?sort=created_at|last_played_at|tg_username (DESC default).
// ---------------------------------------------------------------------------

interface AdminUserRow {
  id: string;
  tg_username: string | null;
  tg_name: string | null;
  is_admin: number;
  is_banned: number;
  banned_at: number | null;
  banned_reason: string | null;
  created_at: number;
  sub_expires_at: number | null;
  sub_status: string | null;
  last_played_at: number | null;
  play_count: number;
}

admin.get('/users', async (c) => {
  const q = (c.req.query('q') ?? '').trim();
  const role = c.req.query('role');
  const banned = c.req.query('banned');
  const sub = c.req.query('sub');
  const sort = c.req.query('sort') ?? 'created_at';
  const limit = Math.min(100, Math.max(1, Number(c.req.query('limit') ?? 50) | 0));
  const offset = Math.max(0, Number(c.req.query('offset') ?? 0) | 0);

  // Whitelist sort columns to avoid SQL injection via the query string.
  // The JOIN against subscriptions+play_history is materialised via a
  // subquery so the sort is applied to the FINAL row (with the latest
  // sub + last play_history join) instead of joining first.
  const ALLOWED_SORTS: Record<string, string> = {
    created_at: 'u.created_at',
    last_played_at: 'last_played_at',
    tg_username: 'u.tg_username',
  };
  const orderCol = ALLOWED_SORTS[sort] ?? 'u.created_at';

  const where: string[] = [];
  const binds: Array<string | number> = [];
  if (q) {
    where.push('(LOWER(u.tg_username) LIKE ? OR LOWER(u.tg_name) LIKE ? OR u.id = ?)');
    const like = `%${q.toLowerCase()}%`;
    binds.push(like, like, q);
  }
  if (role === 'admin') where.push('u.is_admin = 1');
  if (role === 'user') where.push('u.is_admin = 0');
  if (banned === '1') where.push('u.is_banned = 1');
  if (banned === '0') where.push('u.is_banned = 0');
  if (sub === 'active') {
    where.push("EXISTS (SELECT 1 FROM subscriptions s WHERE s.user_id = u.id AND s.status = 'active' AND s.expires_at > ?)");
    binds.push(Math.floor(Date.now() / 1000));
  }
  if (sub === 'none') {
    where.push("NOT EXISTS (SELECT 1 FROM subscriptions s WHERE s.user_id = u.id AND s.status = 'active' AND s.expires_at > ?)");
    binds.push(Math.floor(Date.now() / 1000));
  }

  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const sql = `
    SELECT
      u.id, u.tg_username, u.tg_name, u.is_admin, u.is_banned,
      u.banned_at, u.banned_reason, u.created_at,
      (SELECT s.expires_at FROM subscriptions s
        WHERE s.user_id = u.id AND s.status = 'active'
        ORDER BY s.expires_at DESC LIMIT 1) AS sub_expires_at,
      (SELECT s.status FROM subscriptions s
        WHERE s.user_id = u.id
        ORDER BY s.expires_at DESC LIMIT 1) AS sub_status,
      (SELECT MAX(p.played_at) FROM play_history p WHERE p.user_id = u.id) AS last_played_at,
      (SELECT COUNT(1) FROM play_history p WHERE p.user_id = u.id) AS play_count
    FROM users u
    ${whereClause}
    ORDER BY ${orderCol} DESC
    LIMIT ? OFFSET ?
  `;
  const countSql = `SELECT COUNT(1) AS c FROM users u ${whereClause}`;

  const [usersRes, countRes] = await Promise.all([
    c.env.DB.prepare(sql).bind(...binds, limit, offset).all<AdminUserRow>(),
    c.env.DB.prepare(countSql).bind(...binds).first<{ c: number }>(),
  ]);

  const items = (usersRes.results ?? []).map((r) => ({
    id: r.id,
    username: r.tg_username,
    name: r.tg_name,
    isAdmin: r.is_admin === 1,
    isBanned: r.is_banned === 1,
    bannedAt: r.banned_at,
    bannedReason: r.banned_reason,
    subscription: r.sub_expires_at && r.sub_status === 'active' && r.sub_expires_at > Math.floor(Date.now() / 1000)
      ? { status: 'active' as const, expiresAt: r.sub_expires_at }
      : null,
    lastPlayedAt: r.last_played_at,
    playCount: r.play_count,
    createdAt: r.created_at,
  }));

  return c.json({ items, total: countRes?.c ?? 0, limit, offset });
});

interface BanBody { reason?: string }
admin.post('/users/:id/ban', async (c) => {
  const targetId = c.req.param('id');
  const requesterId = c.get('userId');
  if (targetId === requesterId) {
    return c.json({ error: 'Нельзя забанить самого себя' }, 400);
  }
  const body = await c.req.json<BanBody>().catch(() => ({} as BanBody));
  const reason = (body.reason ?? '').trim().slice(0, 280) || null;
  const now = Math.floor(Date.now() / 1000);
  const res = await c.env.DB.prepare(
    `UPDATE users SET is_banned = 1, banned_at = ?, banned_by = ?,
                       banned_reason = ?, updated_at = ?
     WHERE id = ?`
  ).bind(now, requesterId, reason, now, targetId).run();
  if (!res.meta?.changes) return c.json({ error: 'Пользователь не найден' }, 404);
  return c.json({ ok: true });
});

admin.post('/users/:id/unban', async (c) => {
  const targetId = c.req.param('id');
  const now = Math.floor(Date.now() / 1000);
  const res = await c.env.DB.prepare(
    `UPDATE users SET is_banned = 0, banned_at = NULL, banned_by = NULL,
                       banned_reason = NULL, updated_at = ?
     WHERE id = ?`
  ).bind(now, targetId).run();
  if (!res.meta?.changes) return c.json({ error: 'Пользователь не найден' }, 404);
  return c.json({ ok: true });
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
