import type { Env } from '../../types/env';
import { encryptSecret, decryptSecret } from './sessionCrypto';

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
  constructor(private env: Env) {}

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
   * first success. */
  private async refreshSession(refreshToken: string): Promise<TidalTokens | null> {
    const candidates = await this.candidateClients();
    for (const c of candidates) {
      const tokens = await this.refreshWithClient(refreshToken, c);
      if (tokens) return tokens;
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

  /** Public wrapper around the cached KV session, used by the admin UI. */
  async readSession(): Promise<TidalTokens | null> {
    return this.getCachedSession();
  }

  /** Wipes the cached Tidal session (admin "logout"). */
  async clearSession(): Promise<void> {
    await this.env.DB.prepare('DELETE FROM tidal_session WHERE id = 1').run().catch(() => null);
    // Best-effort KV cleanup so legacy data doesn't shadow D1.
    await this.env.SESSIONS.delete(KV_KEY).catch(() => {});
  }

  /**
   * Stores a refresh token (and optional access token) and validates by
   * refreshing immediately. Used by the admin "swap account" form.
   */
  async installRefreshToken(refreshToken: string): Promise<TidalTokens> {
    const refreshed = await this.refreshSession(refreshToken);
    if (!refreshed) {
      throw new Error('Tidal отверг refresh token. Проверьте корректность или client_id/secret.');
    }
    return refreshed;
  }

  private async getCachedSession(): Promise<TidalTokens | null> {
    // Primary: D1. Fallback: legacy KV blob from before the migration.
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
          // client_secret stays plaintext-or-encrypted via the same path —
          // it's not as sensitive as the access/refresh pair (you also
          // need the matching client_id and a *valid* refresh to use it),
          // but the data is in the same row so we treat it the same way.
          clientSecret: row.client_secret
            ? await decryptSecret(row.client_secret, key)
            : undefined,
        };
      } catch (err) {
        // If decryption fails the row is unusable. Log and fall through
        // to KV so a stale-but-valid legacy session can still rescue us;
        // the next refresh will overwrite the bad row.
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

  private async cacheSession(tokens: TidalTokens): Promise<void> {
    const updatedAt = Math.floor(Date.now() / 1000);
    const key = this.env.SESSION_ENCRYPTION_KEY;
    const [accessToken, refreshToken, clientSecret] = await Promise.all([
      encryptSecret(tokens.accessToken, key),
      encryptSecret(tokens.refreshToken, key),
      tokens.clientSecret ? encryptSecret(tokens.clientSecret, key) : Promise.resolve(null),
    ]);
    await this.env.DB
      .prepare(
        `INSERT INTO tidal_session (id, access_token, refresh_token, expires_at, user_id, country_code, client_id, client_secret, updated_at)
         VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           access_token = excluded.access_token,
           refresh_token = excluded.refresh_token,
           expires_at = excluded.expires_at,
           user_id = excluded.user_id,
           country_code = excluded.country_code,
           client_id = excluded.client_id,
           client_secret = excluded.client_secret,
           updated_at = excluded.updated_at`
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
      .run();
  }
}
