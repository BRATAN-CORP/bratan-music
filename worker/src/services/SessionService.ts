import type { Env } from '../types/env';

/**
 * Active-session bookkeeping for the new "Профиль → Сессии" tab.
 *
 * Refresh tokens have always lived as rows in the `sessions` table
 * (one row per signed-in device per signin). Migration 0028 added
 * per-row metadata — `last_used_at`, `user_agent`, `ip_hash`,
 * `client_label` — so we can render that table as a useful UI.
 *
 * Public surface:
 *
 *   - `list(userId)` — rows for the "Sessions" list. Sorted by
 *     `last_used_at DESC` so the freshest devices appear at the top.
 *   - `revoke(userId, sessionId)` — single-device logout. Drops the
 *     refresh-token row; the JWT middleware's per-session gate
 *     (`SELECT 1 FROM sessions WHERE id = sid`) makes the deleted
 *     row's access token 401 on its very next request, so the
 *     hour-long TTL doesn't keep the other device alive.
 *   - `revokeAllExcept(userId, keepSessionId)` — "kill every device
 *     except this one". Just deletes every row but `keepSessionId`;
 *     the per-session gate handles invalidation for every dropped
 *     row. The kept session is untouched.
 *
 * Notes on security:
 *   - Every method scopes by `user_id` so a compromised user can't
 *     reach into another user's sessions even if they spoof the id.
 *   - SHA-256 of the IP (not the IP itself) is what we'd store if we
 *     ever surface "session from a new country" UX. We don't render
 *     it in the UI yet, just persist it for future analysis.
 */
export class SessionService {
  constructor(private env: Env) {}

  async list(userId: string, currentSessionId: string | null): Promise<SessionListItem[]> {
    const now = Math.floor(Date.now() / 1000);
    // `expires_at > now` filters out refresh rows whose refresh
    // window already lapsed — they're effectively dead, even if a
    // cleanup cron hasn't pruned them yet. The Сессии UI should
    // only show signin events the user can still revoke.
    const res = await this.env.DB
      .prepare(
        `SELECT id, created_at, last_used_at, user_agent, client_label, expires_at
           FROM sessions
          WHERE user_id = ? AND expires_at > ?
          ORDER BY last_used_at DESC, created_at DESC`,
      )
      .bind(userId, now)
      .all<SessionRow>();
    const rows = res.results ?? [];
    return rows.map((r) => ({
      id: r.id,
      createdAt: r.created_at,
      lastUsedAt: r.last_used_at,
      expiresAt: r.expires_at,
      label: r.client_label || defaultLabel(r.user_agent),
      current: r.id === currentSessionId,
    }));
  }

  /**
   * Revoke one session. Returns whether the row was actually deleted
   * (false when the id didn't belong to this user — important so
   * callers can return 404 vs. silently succeeding).
   */
  async revoke(userId: string, sessionId: string): Promise<boolean> {
    const res = await this.env.DB
      .prepare('DELETE FROM sessions WHERE id = ? AND user_id = ?')
      .bind(sessionId, userId)
      .run();
    return (res.meta?.changes ?? 0) > 0;
  }

  /**
   * Drop every refresh-token row for this user except the one passed
   * in. The middleware's per-session gate (`SELECT 1 FROM sessions
   * WHERE id = payload.sid`) takes effect on the deleted rows'
   * access tokens immediately — they 401 on their next request even
   * though the JWT itself hasn't expired. The kept session is
   * untouched and continues to authenticate normally.
   *
   * Returns the number of rows that were revoked, for the response
   * payload that drives the success toast in the UI.
   */
  async revokeAllExcept(userId: string, keepSessionId: string | null): Promise<number> {
    let res;
    if (keepSessionId) {
      res = await this.env.DB
        .prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?')
        .bind(userId, keepSessionId)
        .run();
    } else {
      // No "current" id supplied — purge everything. Used by an
      // explicit "выйти со всех устройств" path (not the default).
      res = await this.env.DB
        .prepare('DELETE FROM sessions WHERE user_id = ?')
        .bind(userId)
        .run();
    }
    return res.meta?.changes ?? 0;
  }
}

interface SessionRow {
  id: string;
  created_at: number;
  last_used_at: number;
  user_agent: string;
  client_label: string;
  expires_at: number;
}

export interface SessionListItem {
  id: string;
  createdAt: number;
  lastUsedAt: number;
  expiresAt: number;
  label: string;
  current: boolean;
}

/**
 * Cheap UA → human-readable label heuristic. Runs at /me/sessions
 * read time as a fallback when `client_label` is empty (i.e. the
 * session was created before migration 0028 OR by an old code path
 * that didn't populate the column). Result format:
 *   "Browser · OS"
 * Examples:
 *   "Chrome · Windows"
 *   "Safari · iPhone"
 *   "Telegram WebApp · Android"
 *   "Неизвестное устройство" (when we can't parse anything)
 *
 * We deliberately keep this tiny — a full UA parser would balloon
 * the bundle and we don't need surgical accuracy for a list of
 * "your devices" labels. False positives are recoverable (the user
 * still recognises their own device from the timestamps), and the
 * proper fix is to capture `client_label` server-side via the same
 * heuristic at signin time (which we now do).
 */
export function clientLabelFromUa(ua: string): string {
  if (!ua) return 'Неизвестное устройство';
  const low = ua.toLowerCase();
  let browser = 'Браузер';
  if (low.includes('telegram')) browser = 'Telegram WebApp';
  else if (low.includes('edg/')) browser = 'Edge';
  else if (low.includes('opr/') || low.includes('opera')) browser = 'Opera';
  else if (low.includes('yabrowser')) browser = 'Yandex Browser';
  else if (low.includes('firefox')) browser = 'Firefox';
  else if (low.includes('chrome')) browser = 'Chrome';
  else if (low.includes('safari')) browser = 'Safari';

  let os = '';
  if (low.includes('iphone')) os = 'iPhone';
  else if (low.includes('ipad')) os = 'iPad';
  else if (low.includes('android')) os = 'Android';
  else if (low.includes('mac os')) os = 'Mac';
  else if (low.includes('windows')) os = 'Windows';
  else if (low.includes('linux')) os = 'Linux';

  return os ? `${browser} · ${os}` : browser;
}

function defaultLabel(ua: string): string {
  return clientLabelFromUa(ua);
}

/**
 * SHA-256 hex of the request IP — what we persist as `sessions.ip_hash`.
 * Hashed so a DB compromise doesn't leak signin IPs in plaintext; we
 * only need the value to do equality checks ("did this user just sign
 * in from a new IP?"), not to inspect the raw value.
 */
export async function hashIp(ip: string): Promise<string> {
  if (!ip) return '';
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ip));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
