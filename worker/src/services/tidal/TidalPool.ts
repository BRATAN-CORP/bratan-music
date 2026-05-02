import type { Env } from '../../types/env';
import { encryptSecret, decryptSecret } from './sessionCrypto';

/**
 * Tidal proxy account pool.
 *
 * The worker rotates through every enabled account so a single banned /
 * expired / quota-throttled Tidal session doesn't drop the whole
 * service. The pool lives in the `tidal_accounts` D1 table; tokens are
 * AES-GCM encrypted under `SESSION_ENCRYPTION_KEY` (same format as the
 * legacy singleton).
 *
 * `TidalAuth` consults this service every time it needs to load a
 * session. Within a single CF Worker request the chosen account is
 * memoised on the `TidalAuth` instance so we don't fan out to multiple
 * accounts mid-search; across requests the picker picks the
 * least-recently-used enabled row.
 *
 * Errors get recorded back here via `markError`; if an account hits
 * `AUTO_DISABLE_THRESHOLD` consecutive failures the picker auto-disables
 * it so subsequent traffic skips it. `markUsed` clears the error
 * counter on a successful checkout so a single transient blip doesn't
 * accumulate towards auto-disable.
 */

export interface TidalAccountTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  userId: number;
  countryCode: string;
  clientId?: string;
  clientSecret?: string;
}

export interface TidalAccountRecord extends TidalAccountTokens {
  id: number;
  label: string | null;
  enabled: boolean;
  subscriptionType: string | null;
  subscriptionValidUntil: number | null;
  lastUsedAt: number;
  usageCount: number;
  lastError: string | null;
  lastErrorAt: number | null;
  consecutiveErrors: number;
  createdAt: number;
  updatedAt: number;
}

export interface TidalAccountSummary {
  id: number;
  label: string | null;
  userId: number;
  countryCode: string;
  enabled: boolean;
  subscriptionType: string | null;
  subscriptionValidUntil: number | null;
  expiresAt: number;
  lastUsedAt: number;
  usageCount: number;
  lastError: string | null;
  lastErrorAt: number | null;
  consecutiveErrors: number;
  createdAt: number;
  updatedAt: number;
  /** Last 6 + last 4 of access token, for visual confirmation. */
  accessTokenPreview: string | null;
  refreshTokenPreview: string | null;
}

interface RawAccountRow {
  id: number;
  label: string | null;
  access_token: string;
  refresh_token: string;
  expires_at: number;
  user_id: number;
  country_code: string;
  client_id: string | null;
  client_secret: string | null;
  subscription_type: string | null;
  subscription_valid_until: number | null;
  enabled: number;
  last_used_at: number;
  usage_count: number;
  last_error: string | null;
  last_error_at: number | null;
  consecutive_errors: number;
  created_at: number;
  updated_at: number;
}

const AUTO_DISABLE_THRESHOLD = 5;

function nowSec() { return Math.floor(Date.now() / 1000); }

function maskToken(token: string | undefined | null): string | null {
  if (!token) return null;
  if (token.length <= 12) return token;
  return `${token.slice(0, 6)}…${token.slice(-4)}`;
}

export class TidalPool {
  constructor(private env: Env) {}

  /**
   * Pick one enabled account using least-recently-used round-robin.
   * Returns null if the pool is empty (caller should fall back to the
   * legacy singleton path / env-configured refresh token).
   */
  async pickAccount(): Promise<TidalAccountRecord | null> {
    const row = await this.env.DB
      .prepare(
        `SELECT * FROM tidal_accounts
         WHERE enabled = 1
         ORDER BY last_used_at ASC, id ASC
         LIMIT 1`
      )
      .first<RawAccountRow>()
      .catch(() => null);
    if (!row) return null;
    return this.decode(row);
  }

  async getById(id: number): Promise<TidalAccountRecord | null> {
    const row = await this.env.DB
      .prepare('SELECT * FROM tidal_accounts WHERE id = ?')
      .bind(id)
      .first<RawAccountRow>()
      .catch(() => null);
    return row ? this.decode(row) : null;
  }

  async list(): Promise<TidalAccountSummary[]> {
    const rs = await this.env.DB
      .prepare('SELECT * FROM tidal_accounts ORDER BY id ASC')
      .all<RawAccountRow>()
      .catch(() => null);
    if (!rs) return [];
    const out: TidalAccountSummary[] = [];
    for (const row of rs.results ?? []) {
      // Decode tokens just to mask them — never return raw secrets to
      // the admin UI.
      try {
        const dec = await this.decode(row);
        out.push({
          id: dec.id,
          label: dec.label,
          userId: dec.userId,
          countryCode: dec.countryCode,
          enabled: dec.enabled,
          subscriptionType: dec.subscriptionType,
          subscriptionValidUntil: dec.subscriptionValidUntil,
          expiresAt: dec.expiresAt,
          lastUsedAt: dec.lastUsedAt,
          usageCount: dec.usageCount,
          lastError: dec.lastError,
          lastErrorAt: dec.lastErrorAt,
          consecutiveErrors: dec.consecutiveErrors,
          createdAt: dec.createdAt,
          updatedAt: dec.updatedAt,
          accessTokenPreview: maskToken(dec.accessToken),
          refreshTokenPreview: maskToken(dec.refreshToken),
        });
      } catch {
        // Skip undecryptable rows (encryption key rotated etc.) — the
        // admin will see the missing entry and can remove the row by id.
      }
    }
    return out;
  }

  /**
   * Insert a fresh account row. Unique on `user_id`: if an account
   * with the same Tidal user id already exists, its tokens are
   * refreshed in place rather than creating a duplicate.
   */
  async upsert(tokens: TidalAccountTokens, label?: string): Promise<TidalAccountRecord> {
    const key = this.env.SESSION_ENCRYPTION_KEY;
    const [accessToken, refreshToken, clientSecret] = await Promise.all([
      encryptSecret(tokens.accessToken, key),
      encryptSecret(tokens.refreshToken, key),
      tokens.clientSecret ? encryptSecret(tokens.clientSecret, key) : Promise.resolve(null),
    ]);
    const now = nowSec();
    await this.env.DB
      .prepare(
        `INSERT INTO tidal_accounts
           (label, access_token, refresh_token, expires_at, user_id, country_code,
            client_id, client_secret, enabled, last_used_at, usage_count,
            created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 0, 0, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
           label = COALESCE(excluded.label, tidal_accounts.label),
           access_token = excluded.access_token,
           refresh_token = excluded.refresh_token,
           expires_at = excluded.expires_at,
           country_code = excluded.country_code,
           client_id = excluded.client_id,
           client_secret = excluded.client_secret,
           enabled = 1,
           last_error = NULL,
           last_error_at = NULL,
           consecutive_errors = 0,
           updated_at = excluded.updated_at`
      )
      .bind(
        label ?? null,
        accessToken,
        refreshToken,
        tokens.expiresAt,
        tokens.userId,
        tokens.countryCode,
        tokens.clientId ?? null,
        clientSecret,
        now,
        now,
      )
      .run();
    const row = await this.env.DB
      .prepare('SELECT * FROM tidal_accounts WHERE user_id = ?')
      .bind(tokens.userId)
      .first<RawAccountRow>();
    if (!row) throw new Error('upsert succeeded but row not found');
    return this.decode(row);
  }

  /** Persist refreshed tokens for a specific account (called from TidalAuth on refresh). */
  async updateTokens(id: number, tokens: TidalAccountTokens): Promise<void> {
    const key = this.env.SESSION_ENCRYPTION_KEY;
    const [accessToken, refreshToken, clientSecret] = await Promise.all([
      encryptSecret(tokens.accessToken, key),
      encryptSecret(tokens.refreshToken, key),
      tokens.clientSecret ? encryptSecret(tokens.clientSecret, key) : Promise.resolve(null),
    ]);
    await this.env.DB
      .prepare(
        `UPDATE tidal_accounts SET
           access_token = ?, refresh_token = ?, expires_at = ?,
           user_id = ?, country_code = ?,
           client_id = ?, client_secret = ?,
           updated_at = ?
         WHERE id = ?`
      )
      .bind(
        accessToken,
        refreshToken,
        tokens.expiresAt,
        tokens.userId,
        tokens.countryCode,
        tokens.clientId ?? null,
        clientSecret,
        nowSec(),
        id,
      )
      .run();
  }

  async setEnabled(id: number, enabled: boolean): Promise<void> {
    await this.env.DB
      .prepare(
        `UPDATE tidal_accounts SET
           enabled = ?,
           ${enabled ? 'consecutive_errors = 0, last_error = NULL, last_error_at = NULL,' : ''}
           updated_at = ?
         WHERE id = ?`
      )
      .bind(enabled ? 1 : 0, nowSec(), id)
      .run();
  }

  async setLabel(id: number, label: string | null): Promise<void> {
    await this.env.DB
      .prepare('UPDATE tidal_accounts SET label = ?, updated_at = ? WHERE id = ?')
      .bind(label, nowSec(), id)
      .run();
  }

  async remove(id: number): Promise<void> {
    await this.env.DB
      .prepare('DELETE FROM tidal_accounts WHERE id = ?')
      .bind(id)
      .run();
  }

  async setSubscription(id: number, subscriptionType: string | null, validUntil: number | null): Promise<void> {
    await this.env.DB
      .prepare(
        `UPDATE tidal_accounts SET
           subscription_type = ?, subscription_valid_until = ?, updated_at = ?
         WHERE id = ?`
      )
      .bind(subscriptionType, validUntil, nowSec(), id)
      .run();
  }

  /** Bump usage counters + clear error counter. */
  async markUsed(id: number): Promise<void> {
    await this.env.DB
      .prepare(
        `UPDATE tidal_accounts SET
           last_used_at = ?,
           usage_count = usage_count + 1,
           consecutive_errors = 0,
           last_error = NULL,
           last_error_at = NULL
         WHERE id = ?`
      )
      .bind(nowSec(), id)
      .run();
  }

  /** Record a refresh / API failure; auto-disables after AUTO_DISABLE_THRESHOLD strikes. */
  async markError(id: number, message: string): Promise<void> {
    const trimmed = message.length > 240 ? message.slice(0, 240) + '…' : message;
    await this.env.DB
      .prepare(
        `UPDATE tidal_accounts SET
           consecutive_errors = consecutive_errors + 1,
           last_error = ?,
           last_error_at = ?,
           enabled = CASE WHEN consecutive_errors + 1 >= ? THEN 0 ELSE enabled END,
           updated_at = ?
         WHERE id = ?`
      )
      .bind(trimmed, nowSec(), AUTO_DISABLE_THRESHOLD, nowSec(), id)
      .run();
  }

  private async decode(row: RawAccountRow): Promise<TidalAccountRecord> {
    const key = this.env.SESSION_ENCRYPTION_KEY;
    return {
      id: row.id,
      label: row.label,
      accessToken: await decryptSecret(row.access_token, key),
      refreshToken: await decryptSecret(row.refresh_token, key),
      expiresAt: row.expires_at,
      userId: row.user_id,
      countryCode: row.country_code,
      clientId: row.client_id ?? undefined,
      clientSecret: row.client_secret
        ? await decryptSecret(row.client_secret, key)
        : undefined,
      subscriptionType: row.subscription_type,
      subscriptionValidUntil: row.subscription_valid_until,
      enabled: row.enabled === 1,
      lastUsedAt: row.last_used_at,
      usageCount: row.usage_count,
      lastError: row.last_error,
      lastErrorAt: row.last_error_at,
      consecutiveErrors: row.consecutive_errors,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

/** Fetch Tidal subscription metadata for the given access token. Best
 * effort — returns nulls if Tidal rejects or the response shape is
 * unfamiliar, so callers can persist whatever is available. */
export async function fetchSubscriptionInfo(accessToken: string, userId: number, countryCode: string)
  : Promise<{ subscriptionType: string | null; validUntil: number | null }>
{
  try {
    const url = `https://api.tidal.com/v1/users/${userId}/subscription?countryCode=${countryCode}`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
        'User-Agent': 'TIDAL/2026.4.23 CFNetwork/1494.0.7 Darwin/23.4.0',
      },
    });
    if (!res.ok) return { subscriptionType: null, validUntil: null };
    const data = await res.json<{
      subscription?: { type?: string; offlineGracePeriod?: number };
      validUntil?: string;
      status?: string;
      // The API also returns highestSoundQuality which is a useful proxy
      // when `subscription.type` isn't explicit.
      highestSoundQuality?: string;
    }>().catch(() => null);
    if (!data) return { subscriptionType: null, validUntil: null };
    const subType = data.subscription?.type
      ?? data.highestSoundQuality
      ?? data.status
      ?? null;
    const validUntil = data.validUntil ? Math.floor(new Date(data.validUntil).getTime() / 1000) : null;
    return {
      subscriptionType: subType,
      validUntil: Number.isFinite(validUntil) && validUntil ? validUntil : null,
    };
  } catch {
    return { subscriptionType: null, validUntil: null };
  }
}
