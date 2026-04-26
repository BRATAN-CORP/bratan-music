import type { Env } from '../../types/env';

interface TidalTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  userId: number;
  countryCode: string;
}

const KV_KEY = 'tidal:session';
const AUTH_URL = 'https://auth.tidal.com/v1/oauth2/token';
const DEFAULT_COUNTRY_CODE = 'BR';
const DEFAULT_LOCALE = 'en_US';
const DEFAULT_CLIENT_VERSION = '2026.4.23';
// Mobile client (works without web cookies). See bratan-muzonchik / tidalapi.
const DEFAULT_CLIENT_ID = 'fX2JxdmntZWK0ixT';
const DEFAULT_CLIENT_SECRET = '1Nn9AfDAjxrgJFJbKNWLeAyKGVGmINuXPPLHVXAvxAg=';

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

  private async refreshSession(refreshToken: string): Promise<TidalTokens | null> {
    try {
      const body = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: this.clientId(),
        client_secret: this.clientSecret(),
        scope: 'r_usr w_usr w_sub',
      });

      const res = await fetch(AUTH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });

      if (!res.ok) {
        const t = await res.text().catch(() => '');
        console.error(`[tidal] refresh failed ${res.status}: ${t.slice(0, 200)}`);
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
    const body = new URLSearchParams({
      client_id: this.clientId(),
      scope: 'r_usr w_usr w_sub',
    });
    const res = await fetch('https://auth.tidal.com/v1/oauth2/device_authorization', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`tidal device_authorization ${res.status}: ${text.slice(0, 300)}`);
    const data = JSON.parse(text) as {
      deviceCode: string;
      userCode: string;
      verificationUri: string;
      verificationUriComplete: string;
      expiresIn: number;
      interval: number;
    };
    return data;
  }

  async pollDeviceAuth(deviceCode: string): Promise<
    | { ok: true; refreshToken: string; accessToken: string; expiresIn: number }
    | { ok: false; error: string; pending: boolean }
  > {
    const body = new URLSearchParams({
      client_id: this.clientId(),
      client_secret: this.clientSecret(),
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
      };
      await this.cacheSession(tokens);
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

  private async getCachedSession(): Promise<TidalTokens | null> {
    const raw = await this.env.SESSIONS.get(KV_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as TidalTokens;
  }

  private async cacheSession(tokens: TidalTokens): Promise<void> {
    await this.env.SESSIONS.put(KV_KEY, JSON.stringify(tokens), {
      expirationTtl: 60 * 60 * 24 * 30,
    });
  }
}
