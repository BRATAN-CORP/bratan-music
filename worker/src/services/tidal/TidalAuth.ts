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

export class TidalAuth {
  constructor(private env: Env) {}

  async getAccessToken(): Promise<string> {
    const cached = await this.getCachedSession();
    if (cached && cached.expiresAt > Date.now() / 1000 + 60) {
      return cached.accessToken;
    }

    if (cached?.refreshToken) {
      const refreshed = await this.refreshSession(cached.refreshToken);
      if (refreshed) return refreshed.accessToken;
    }

    if (this.env.TIDAL_SESSION_TOKEN) {
      return this.env.TIDAL_SESSION_TOKEN;
    }

    throw new Error('Нет активной сессии Tidal');
  }

  async getCountryCode(): Promise<string> {
    const cached = await this.getCachedSession();
    return cached?.countryCode ?? 'US';
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
        client_id: this.env.TIDAL_CLIENT_ID,
        client_secret: this.env.TIDAL_CLIENT_SECRET,
      });

      const res = await fetch(AUTH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });

      if (!res.ok) return null;

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

  private async fetchSessionInfo(accessToken: string): Promise<{ userId: number; countryCode: string }> {
    const res = await fetch('https://api.tidal.com/v1/sessions', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!res.ok) {
      return { userId: 0, countryCode: 'US' };
    }

    const data = await res.json<{ userId: number; countryCode: string }>();
    return { userId: data.userId, countryCode: data.countryCode };
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
