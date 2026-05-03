import type { Env } from '../../types/env';
import { encryptSecret, decryptSecret } from './sessionCrypto';
import { TidalPool, fetchSubscriptionInfo } from './TidalPool';

interface TidalTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  userId: number;
  countryCode: string;
  /** Client id + secret used to mint these tokens. Stored so future
   * refreshes use the right pair (otherwise refresh fails with
   * "invalid_client"). Optional — falls back to env defaults when missing. */
  clientId?: string;
  clientSecret?: string;
}

const KV_KEY = 'tidal:session';
const AUTH_URL = 'https://auth.tidal.com/v1/oauth2/token';
const DEFAULT_COUNTRY_CODE = 'BR';
const DEFAULT_LOCALE = 'en_US';
const DEFAULT_CLIENT_VERSION = '2026.4.23';
// Mobile client (works without web cookies). See bratan-muzonchik / tidalapi.
const DEFAULT_CLIENT_ID = 'fX2JxdmntZWK0ixT';
const DEFAULT_CLIENT_SECRET = '1Nn9AfDAjxrgJFJbKNWLeAyKGVGmINuXPPLHVXAvxAg=';

// Known Tidal OAuth clients used for fallbacks. We try them in order when the
// configured TIDAL_CLIENT_ID rejects a refresh-token exchange or device-flow
// authorization. The TV client supports device authorization on every account
// type — handy when the configured client is a web client (cid 8049) that
// doesn't.
interface ClientPair { id: string; secret: string; supportsDevice: boolean }
const KNOWN_CLIENTS: ClientPair[] = [
  { id: 'aR7gUaTK1ihpXOEP', secret: 'oKOXfJW371cX6xaZ0PyhgGNBdNLlBZd4AKKYougMjik=', supportsDevice: true },
  { id: 'fX2JxdmntZWK0ixT', secret: '1Nn9AfDAjxrgJFJbKNWLeAyKGVGmINuXPPLHVXAvxAg=', supportsDevice: true },
  { id: 'zU4XHVVkc2tDPo4t', secret: 'VJKhDFqJPqvsPVNBV6ukXTJmwlvbttP7wlMlrc72se4=', supportsDevice: true },
];

interface TidalJwtPayload {
  uid?: number;
  cc?: string;
  exp?: number;
}

export class TidalAuth {
  /**
   * Per-instance memo of the loaded session. CF Workers re-instantiate
   * this class on every request, so the memo's lifetime is bounded by
   * the request and there's no risk of serving a stale token across
   * users. Within a single request we get hit 3+ times (`getAccessToken`,
   * `candidateClients`, `getCountryCode`, etc.); without this each call
   * was issuing a D1 read + AES-GCM decrypt + KV fallback, costing
   * ~50-100 ms per repeat.
   */
  private sessionPromise: Promise<TidalTokens | null> | null = null;
  /** Once set, every subsequent read/write on this instance is
   *  scoped to this pool account. `null` means "legacy singleton row".
   *  We pin the picked account on first load so a single request
   *  doesn't fan out to multiple Tidal accounts mid-search. */
  private boundAccountId: number | null = null;
  private pool: TidalPool;

  constructor(private env: Env) {
    this.pool = new TidalPool(env);
  }

  /** Drop the per-instance session memo. Call after writes
   *  (`cacheSession`, `clearCachedSession`) so the next reader sees the
   *  fresh row instead of the cached one. */
  private invalidateSessionCache(): void {
    this.sessionPromise = null;
  }

  /** Pin this instance to a specific pool account. Used by admin
   *  endpoints that target a single account (e.g. swap tokens for
   *  account #3). Default is the picker. */
  bindAccount(id: number | null): void {
    this.boundAccountId = id;
    this.invalidateSessionCache();
  }

  private clientId(): string {
    return this.env.TIDAL_CLIENT_ID || DEFAULT_CLIENT_ID;
  }

  private clientSecret(): string {
    return this.env.TIDAL_CLIENT_SECRET || DEFAULT_CLIENT_SECRET;
  }

  async getAccessToken(opts: { force?: boolean } = {}): Promise<string> {
    const force = opts.force === true;

    if (!force) {
      const cached = await this.getCachedSession();
      if (cached && cached.expiresAt > Date.now() / 1000 + 60) {
        return cached.accessToken;
      }
    }

    const cached = await this.getCachedSession();
    const refreshToken = cached?.refreshToken ?? this.env.TIDAL_REFRESH_TOKEN;
    let refreshError: string | null = null;
    if (refreshToken) {
      const refreshed = await this.refreshSession(refreshToken);
      if (refreshed) return refreshed.accessToken;
      refreshError = 'refresh failed (token revoked or invalid client_id/secret)';
    }

    if (this.env.TIDAL_SESSION_TOKEN) {
      const payload = this.decodeJwtPayload(this.env.TIDAL_SESSION_TOKEN);
      if (payload?.exp && payload.exp <= Date.now() / 1000 + 60) {
        throw new Error(
          'Сессия Tidal истекла. Установите TIDAL_REFRESH_TOKEN (предпочтительно) или обновите TIDAL_SESSION_TOKEN.'
            + (refreshError ? ` (${refreshError})` : '')
        );
      }
      return this.env.TIDAL_SESSION_TOKEN;
    }

    throw new Error(
      'Нет активной сессии Tidal. Установите TIDAL_REFRESH_TOKEN или TIDAL_SESSION_TOKEN.'
        + (refreshError ? ` (${refreshError})` : '')
    );
  }

  async getCountryCode(): Promise<string> {
    const cached = await this.getCachedSession();
    const tokenCountry = this.decodeJwtPayload(cached?.accessToken ?? this.env.TIDAL_SESSION_TOKEN)?.cc;
    return cached?.countryCode ?? tokenCountry ?? this.env.TIDAL_COUNTRY_CODE ?? DEFAULT_COUNTRY_CODE;
  }

  getLocale(): string {
    return this.env.TIDAL_LOCALE ?? DEFAULT_LOCALE;
  }

  getClientVersion(): string {
    return this.env.TIDAL_CLIENT_VERSION ?? DEFAULT_CLIENT_VERSION;
  }

  async initSession(accessToken: string, refreshToken: string): Promise<TidalTokens> {
    const sessionInfo = await this.fetchSessionInfo(accessToken);

    const tokens: TidalTokens = {
      accessToken,
      refreshToken,
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
      userId: sessionInfo.userId,
      countryCode: sessionInfo.countryCode,
    };

    await this.cacheSession(tokens);
    return tokens;
  }

  /** Build the ordered list of client_id/secret pairs to try. The cached
   * session's stored client (if any) goes first, then the env-configured
   * one, then the well-known fallbacks (de-duplicated by client id). */
  private async candidateClients(): Promise<ClientPair[]> {
    const out: ClientPair[] = [];
    const seen = new Set<string>();
    const push = (id: string, secret: string, supportsDevice = false) => {
      if (!id || seen.has(id)) return;
      seen.add(id);
      out.push({ id, secret, supportsDevice });
    };
    const cached = await this.getCachedSession();
    if (cached?.clientId && cached?.clientSecret) {
      push(cached.clientId, cached.clientSecret, true);
    }
    push(this.clientId(), this.clientSecret(), true);
    for (const c of KNOWN_CLIENTS) push(c.id, c.secret, c.supportsDevice);
    return out;
  }

  /** Tries the given refresh token against every candidate client. Returns
   * the freshly minted tokens (with clientId/secret stamped on them) on the
   * first success. Records failure on the bound pool account so it can be
   * auto-disabled after enough strikes. */
  private async refreshSession(refreshToken: string): Promise<TidalTokens | null> {
    const candidates = await this.candidateClients();
    let lastError: string | null = null;
    for (const c of candidates) {
      const tokens = await this.refreshWithClient(refreshToken, c);
      if (tokens) return tokens;
      lastError = `refresh failed for client ${c.id}`;
    }
    if (this.boundAccountId !== null && lastError) {
      await this.pool.markError(this.boundAccountId, lastError).catch(() => null);
    }
    return null;
  }

  private async refreshWithClient(refreshToken: string, client: ClientPair): Promise<TidalTokens | null> {
    try {
      const body = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: client.id,
        client_secret: client.secret,
        scope: 'r_usr w_usr w_sub',
      });

      const res = await fetch(AUTH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });

      if (!res.ok) {
        const t = await res.text().catch(() => '');
        console.error(`[tidal] refresh failed cid=${client.id} ${res.status}: ${t.slice(0, 200)}`);
        return null;
      }

      const data = await res.json<{
        access_token: string;
        refresh_token?: string;
        expires_in: number;
      }>();

      const sessionInfo = await this.fetchSessionInfo(data.access_token);

      const tokens: TidalTokens = {
        accessToken: data.access_token,
        refreshToken: data.refresh_token ?? refreshToken,
        expiresAt: Math.floor(Date.now() / 1000) + data.expires_in,
        userId: sessionInfo.userId,
        countryCode: sessionInfo.countryCode,
        clientId: client.id,
        clientSecret: client.secret,
      };

      await this.cacheSession(tokens);
      return tokens;
    } catch {
      return null;
    }
  }

  async startDeviceAuth(): Promise<{
    deviceCode: string;
    userCode: string;
    verificationUri: string;
    verificationUriComplete: string;
    expiresIn: number;
    interval: number;
  }> {
    // Try the configured client first, then fall back to known TV clients.
    // Web clients (cid 8049) reject device_authorization with
    // "Client is not a Limited Input Device client". We need to remember
    // which client minted the code so the matching poll uses the same id.
    const candidates = await this.candidateClients();
    let lastError: string | null = null;
    for (const c of candidates) {
      const body = new URLSearchParams({
        client_id: c.id,
        scope: 'r_usr w_usr w_sub',
      });
      const res = await fetch('https://auth.tidal.com/v1/oauth2/device_authorization', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });
      const text = await res.text();
      if (!res.ok) {
        lastError = `${res.status}: ${text.slice(0, 200)}`;
        continue;
      }
      const data = JSON.parse(text) as {
        deviceCode: string;
        userCode: string;
        verificationUri: string;
        verificationUriComplete: string;
        expiresIn: number;
        interval: number;
      };
      // Remember which client minted this device code so poll can use it.
      // We use D1 here instead of KV because the free KV plan caps writes at
      // 1000/day for the whole worker, and a polling device-flow can burn
      // through that quickly.
      const expiresAt = Math.floor(Date.now() / 1000) + Math.max(60, data.expiresIn || 300);
      await this.env.DB
        .prepare(
          `INSERT INTO tidal_device_codes (device_code, client_id, client_secret, expires_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(device_code) DO UPDATE SET
             client_id = excluded.client_id,
             client_secret = excluded.client_secret,
             expires_at = excluded.expires_at`
        )
        .bind(data.deviceCode, c.id, c.secret, expiresAt)
        .run();
      // Opportunistic GC of stale device codes (keeps the table small).
      await this.env.DB
        .prepare('DELETE FROM tidal_device_codes WHERE expires_at < ?')
        .bind(Math.floor(Date.now() / 1000))
        .run()
        .catch(() => null);
      return data;
    }
    throw new Error(`tidal device_authorization failed: ${lastError ?? 'no candidate clients'}`);
  }

  async pollDeviceAuth(deviceCode: string): Promise<
    | { ok: true; refreshToken: string; accessToken: string; expiresIn: number }
    | { ok: false; error: string; pending: boolean }
  > {
    // Look up which client minted this device code (saved by startDeviceAuth).
    // Fall back to the configured client when the lookup is missing.
    const row = await this.env.DB
      .prepare('SELECT client_id, client_secret FROM tidal_device_codes WHERE device_code = ?')
      .bind(deviceCode)
      .first<{ client_id: string; client_secret: string }>()
      .catch(() => null);
    let client: ClientPair | null = null;
    if (row?.client_id && row?.client_secret) {
      client = { id: row.client_id, secret: row.client_secret, supportsDevice: true };
    }
    if (!client) {
      client = { id: this.clientId(), secret: this.clientSecret(), supportsDevice: true };
    }

    const body = new URLSearchParams({
      client_id: client.id,
      client_secret: client.secret,
      device_code: deviceCode,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      scope: 'r_usr w_usr w_sub',
    });
    const res = await fetch(AUTH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    const raw = await res.json<unknown>().catch(() => ({}));
    const data = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const accessToken = typeof data.access_token === 'string' ? data.access_token : null;
    const refreshToken = typeof data.refresh_token === 'string' ? data.refresh_token : null;
    if (res.ok && accessToken && refreshToken) {
      const expiresIn = typeof data.expires_in === 'number' ? data.expires_in : 3600;
      const tokens: TidalTokens = {
        accessToken,
        refreshToken,
        expiresAt: Math.floor(Date.now() / 1000) + expiresIn,
        userId: this.decodeJwtPayload(accessToken)?.uid ?? 0,
        countryCode: this.decodeJwtPayload(accessToken)?.cc ?? DEFAULT_COUNTRY_CODE,
        clientId: client.id,
        clientSecret: client.secret,
      };
      await this.cacheSession(tokens);
      await this.env.DB
        .prepare('DELETE FROM tidal_device_codes WHERE device_code = ?')
        .bind(deviceCode)
        .run()
        .catch(() => null);
      return { ok: true, refreshToken, accessToken, expiresIn };
    }
    const err = typeof data.error === 'string' ? data.error : `http ${res.status}`;
    return { ok: false, error: err, pending: err === 'authorization_pending' || err === 'slow_down' };
  }

  private async fetchSessionInfo(accessToken: string): Promise<{ userId: number; countryCode: string }> {
    const fallback = this.decodeJwtPayload(accessToken);
    const fallbackCountry = fallback?.cc ?? this.env.TIDAL_COUNTRY_CODE ?? DEFAULT_COUNTRY_CODE;
    const res = await fetch('https://api.tidal.com/v1/sessions', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
        'User-Agent': 'TIDAL/2026.4.23 CFNetwork/1494.0.7 Darwin/23.4.0',
        'x-tidal-client-version': this.getClientVersion(),
      },
    });

    if (!res.ok) {
      return { userId: fallback?.uid ?? 0, countryCode: fallbackCountry };
    }

    const data = await res.json<{ userId: number; countryCode: string }>();
    return { userId: data.userId, countryCode: data.countryCode };
  }

  private decodeJwtPayload(token?: string): TidalJwtPayload | null {
    if (!token) return null;
    const [, payload] = token.split('.');
    if (!payload) return null;

    try {
      const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
      const padded = normalized.padEnd(normalized.length + (4 - normalized.length % 4) % 4, '=');
      const parsed = JSON.parse(atob(padded)) as unknown;
      if (typeof parsed !== 'object' || parsed === null) return null;
      const record = parsed as Record<string, unknown>;
      return {
        uid: typeof record.uid === 'number' ? record.uid : undefined,
        cc: typeof record.cc === 'string' ? record.cc : undefined,
        exp: typeof record.exp === 'number' ? record.exp : undefined,
      };
    } catch {
      return null;
    }
  }

  /** Public wrapper around the cached session, used by the legacy
   *  admin UI. Reads from whichever pool account this instance is
   *  pinned to (or the picker default). */
  async readSession(): Promise<TidalTokens | null> {
    return this.getCachedSession();
  }

  /** Wipes the bound pool account (admin "logout"). When no account is
   *  pinned this clears the entire pool plus the legacy singleton row,
   *  preserving the existing one-shot semantics that callers rely on. */
  async clearSession(): Promise<void> {
    if (this.boundAccountId !== null) {
      await this.pool.remove(this.boundAccountId);
      this.boundAccountId = null;
    } else {
      // Legacy "logout everything" path. Wipe the singleton row and the
      // KV blob; the pool stays untouched so admins manage it through
      // the dedicated /admin/tidal/accounts endpoints.
      await this.env.DB.prepare('DELETE FROM tidal_session WHERE id = 1').run().catch(() => null);
      await this.env.SESSIONS.delete(KV_KEY).catch(() => {});
    }
    this.invalidateSessionCache();
  }

  /**
   * Stores a refresh token (and optional access token) and validates by
   * refreshing immediately. The freshly minted tokens are persisted as a
   * pool account (UNIQUE on Tidal user id — duplicate logins update in
   * place). Subscription metadata is fetched best-effort and stored on
   * the same row.
   */
  async installRefreshToken(refreshToken: string, label?: string): Promise<TidalTokens> {
    const refreshed = await this.refreshSession(refreshToken);
    if (!refreshed) {
      throw new Error('Tidal отверг refresh token. Проверьте корректность или client_id/secret.');
    }
    // refreshSession already cached the tokens via cacheSession → upsert.
    // Now decorate the row with label + subscription info so the admin
    // UI can show them. Best effort — we don't want to fail the install
    // if Tidal is grumpy about /v1/users/.../subscription.
    const targetId = await this.findAccountIdByUserId(refreshed.userId);
    if (targetId !== null) {
      if (label) await this.pool.setLabel(targetId, label);
      const sub = await fetchSubscriptionInfo(refreshed.accessToken, refreshed.userId, refreshed.countryCode);
      await this.pool.setSubscription(targetId, sub.subscriptionType, sub.validUntil);
    }
    return refreshed;
  }

  /** Refresh subscription metadata for one account (admin "Проверить
   *  подписку" button). Returns the freshly-fetched info or null on
   *  failure. */
  async refreshSubscriptionInfo(accountId: number): Promise<{ subscriptionType: string | null; validUntil: number | null } | null> {
    const acc = await this.pool.getById(accountId);
    if (!acc) return null;
    this.bindAccount(accountId);
    let token: string;
    try {
      token = await this.getAccessToken();
    } catch {
      return null;
    }
    const sub = await fetchSubscriptionInfo(token, acc.userId, acc.countryCode);
    await this.pool.setSubscription(accountId, sub.subscriptionType, sub.validUntil);
    return sub;
  }

  private async findAccountIdByUserId(userId: number): Promise<number | null> {
    const row = await this.env.DB
      .prepare('SELECT id FROM tidal_accounts WHERE user_id = ?')
      .bind(userId)
      .first<{ id: number }>()
      .catch(() => null);
    return row?.id ?? null;
  }

  private async getCachedSession(): Promise<TidalTokens | null> {
    if (this.sessionPromise) return this.sessionPromise;
    this.sessionPromise = this.loadSessionFromStorage();
    return this.sessionPromise;
  }

  private async loadSessionFromStorage(): Promise<TidalTokens | null> {
    // Primary: pool account. The picker pins itself on first read so
    // every subsequent call on this instance hits the same account.
    if (this.boundAccountId !== null) {
      const acc = await this.pool.getById(this.boundAccountId).catch(() => null);
      if (acc) return this.tokensFromAccount(acc);
    }
    const picked = await this.pool.pickAccount().catch(() => null);
    if (picked) {
      this.boundAccountId = picked.id;
      // Fire-and-forget: bump the LRU pointer so the next request
      // picks a different account in the pool. We don't await — a D1
      // round trip on every request would defeat the per-instance
      // memo. The error-tracking path (markError) is sync because
      // wrong-pick consequences matter more than perfect LRU.
      this.env.DB
        .prepare('UPDATE tidal_accounts SET last_used_at = ? WHERE id = ?')
        .bind(Math.floor(Date.now() / 1000), picked.id)
        .run()
        .catch(() => null);
      return this.tokensFromAccount(picked);
    }

    // Legacy fallback: singleton `tidal_session` row + ancient KV blob.
    // Kept so a fresh deploy without any pool accounts still works
    // off the env-configured TIDAL_REFRESH_TOKEN.
    const row = await this.env.DB
      .prepare(
        `SELECT access_token, refresh_token, expires_at, user_id, country_code, client_id, client_secret
         FROM tidal_session WHERE id = 1`
      )
      .first<{
        access_token: string;
        refresh_token: string;
        expires_at: number;
        user_id: number;
        country_code: string;
        client_id: string | null;
        client_secret: string | null;
      }>()
      .catch(() => null);
    if (row) {
      try {
        const key = this.env.SESSION_ENCRYPTION_KEY;
        return {
          accessToken: await decryptSecret(row.access_token, key),
          refreshToken: await decryptSecret(row.refresh_token, key),
          expiresAt: row.expires_at,
          userId: row.user_id,
          countryCode: row.country_code,
          clientId: row.client_id ?? undefined,
          clientSecret: row.client_secret
            ? await decryptSecret(row.client_secret, key)
            : undefined,
        };
      } catch (err) {
        console.error('[TidalAuth] decrypt failed:', err instanceof Error ? err.message : err);
      }
    }
    const raw = await this.env.SESSIONS.get(KV_KEY).catch(() => null);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as TidalTokens;
    } catch {
      return null;
    }
  }

  private tokensFromAccount(acc: { accessToken: string; refreshToken: string; expiresAt: number; userId: number; countryCode: string; clientId?: string; clientSecret?: string }): TidalTokens {
    return {
      accessToken: acc.accessToken,
      refreshToken: acc.refreshToken,
      expiresAt: acc.expiresAt,
      userId: acc.userId,
      countryCode: acc.countryCode,
      clientId: acc.clientId,
      clientSecret: acc.clientSecret,
    };
  }

  private async cacheSession(tokens: TidalTokens): Promise<void> {
    // Drop the per-instance memo — the row is about to change and the
    // next reader needs the fresh data, not the version we loaded
    // earlier in the request.
    this.invalidateSessionCache();

    // Pool path: write to the bound account (or upsert by Tidal user id
    // if no account is bound, which happens during installRefreshToken).
    if (this.boundAccountId !== null) {
      await this.pool.updateTokens(this.boundAccountId, tokens);
      return;
    }
    const upserted = await this.pool.upsert(tokens);
    this.boundAccountId = upserted.id;

    // Also keep the legacy singleton row in sync IFF it already exists —
    // this is the safety net for the rare case where a fresh worker boots
    // with an empty pool (no rows in tidal_accounts) but the legacy row
    // is still around from before the migration. We don't create the
    // legacy row here; the migration is one-way.
    const updatedAt = Math.floor(Date.now() / 1000);
    const key = this.env.SESSION_ENCRYPTION_KEY;
    const envName = this.env.ENVIRONMENT;
    const [accessToken, refreshToken, clientSecret] = await Promise.all([
      encryptSecret(tokens.accessToken, key, envName),
      encryptSecret(tokens.refreshToken, key, envName),
      tokens.clientSecret ? encryptSecret(tokens.clientSecret, key, envName) : Promise.resolve(null),
    ]);
    await this.env.DB
      .prepare(
        `UPDATE tidal_session SET
           access_token = ?, refresh_token = ?, expires_at = ?,
           user_id = ?, country_code = ?,
           client_id = ?, client_secret = ?, updated_at = ?
         WHERE id = 1`
      )
      .bind(
        accessToken,
        refreshToken,
        tokens.expiresAt,
        tokens.userId,
        tokens.countryCode,
        tokens.clientId ?? null,
        clientSecret,
        updatedAt
      )
      .run()
      .catch(() => null);
  }
}
