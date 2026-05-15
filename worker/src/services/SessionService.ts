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
 *   - `revoke(userId, sessionId)` — single-device logout. Just drops
 *     the refresh-token row; the corresponding access token (if any)
 *     is left to expire on its own one-hour TTL.
 *   - `revokeAllExcept(userId, keepSessionId)` — "kill every device
 *     except this one". Drops all sessions except the kept one AND
 *     bumps `users.min_token_iat` so the access tokens that haven't
 *     expired yet ALSO forfeit. The kept session's access token is
 *     unaffected (its iat will already be >= the bump value because
 *     it was issued strictly after we read the current time).
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
   * in, AND bump the user's `min_token_iat` so any access token still
   * within its 1h TTL also forfeits. The kept session's access token
   * is safe because the bump value (current epoch) is strictly less
   * than its `iat` for any session newer than 1 second old; in
   * practice the caller will refresh shortly after this returns
   * anyway, so any race window is < 1 RTT.
   *
   * Returns the new `min_token_iat` so the route can echo it back in
   * the response (useful for debugging / future audit log).
   */
  async revokeAllExcept(userId: string, keepSessionId: string | null): Promise<number> {
    const now = Math.floor(Date.now() / 1000);
    if (keepSessionId) {
      await this.env.DB
        .prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?')
        .bind(userId, keepSessionId)
        .run();
    } else {
      // No "current" id supplied — purge everything. Used by an
      // explicit "выйти со всех устройств" path (not the default).
      await this.env.DB
        .prepare('DELETE FROM sessions WHERE user_id = ?')
        .bind(userId)
        .run();
    }
    // Bumping min_token_iat to `now` means any access token issued
    // BEFORE this exact second is rejected on its next use. The kept
    // session's access token has `iat <= now` though, so we'd kill
    // it too. To avoid that, bump to `now - 1`: anything signed at
    // or after the previous second survives, which is fine because
    // we just rotated the kept session anyway and the caller will
    // typically have already refreshed. The 1-second window is also
    // why we don't expose this method to the API directly without a
    // companion token refresh — handlers MUST refresh before calling.
    const cutoff = now - 1;
    await this.env.DB
      .prepare('UPDATE users SET min_token_iat = ? WHERE id = ?')
      .bind(cutoff, userId)
      .run();
    return cutoff;
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
