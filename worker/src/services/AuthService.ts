import type { Env } from '../types/env';

interface TokenPayload {
  sub: string;
  iat: number;
  exp: number;
  admin: boolean;
  /** Session row id this token was issued under. Lets middleware
   *  identify which `sessions` row the request belongs to without an
   *  extra DB lookup, and lets `/user/sessions` mark the active row
   *  in its list. Optional for backward compatibility with refresh
   *  tokens minted before the field existed (we'll just look those
   *  up by `token_hash` instead). */
  sid?: string;
}

export type AccessTokenPayload = TokenPayload;

interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  /** Server-issued session row id for the refresh token we just stored.
   *  The /me/sessions endpoint uses this to mark the currently-active
   *  session in the list (vs. the user's other devices). Surfaced to
   *  the client via the refresh response so it can be remembered. */
  sessionId: string;
}

/** Optional metadata captured at signin time and persisted on the new
 *  `sessions.{user_agent,ip_hash,client_label,last_used_at}` columns
 *  added by migration 0028. All fields are optional so the existing
 *  auth callers don't have to change shape — we feed in whatever the
 *  request gives us at signin via the helper in this file. */
export interface SessionMetadata {
  userAgent?: string;
  ipHash?: string;
  clientLabel?: string;
}

const ACCESS_TOKEN_TTL = 3600;
const REFRESH_TOKEN_TTL = 60 * 60 * 24 * 30;

export class AuthService {
  constructor(private env: Env) {}

  async generateTokens(
    userId: string,
    isAdmin: boolean,
    metadata: SessionMetadata = {},
  ): Promise<TokenPair> {
    const now = Math.floor(Date.now() / 1000);

    const sessionId = crypto.randomUUID();

    const accessPayload: TokenPayload = {
      sub: userId,
      iat: now,
      exp: now + ACCESS_TOKEN_TTL,
      admin: isAdmin,
      sid: sessionId,
    };

    const refreshPayload: TokenPayload = {
      sub: userId,
      iat: now,
      exp: now + REFRESH_TOKEN_TTL,
      admin: isAdmin,
      sid: sessionId,
    };

    const accessToken = await this.signJwt(accessPayload, this.env.JWT_SECRET);
    const refreshToken = await this.signJwt(refreshPayload, this.env.JWT_REFRESH_SECRET);

    const tokenHash = await this.hashToken(refreshToken);
    await this.env.DB.prepare(
      `INSERT INTO sessions
         (id, user_id, token_hash, expires_at, created_at,
          last_used_at, user_agent, ip_hash, client_label)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      sessionId,
      userId,
      tokenHash,
      now + REFRESH_TOKEN_TTL,
      now,
      now,
      metadata.userAgent ?? '',
      metadata.ipHash ?? '',
      metadata.clientLabel ?? '',
    ).run();

    return { accessToken, refreshToken, expiresIn: ACCESS_TOKEN_TTL, sessionId };
  }

  async verifyAccessToken(token: string): Promise<TokenPayload | null> {
    return this.verifyJwt(token, this.env.JWT_SECRET);
  }

  async verifyRefreshToken(token: string): Promise<TokenPayload | null> {
    const payload = await this.verifyJwt(token, this.env.JWT_REFRESH_SECRET);
    if (!payload) return null;

    const tokenHash = await this.hashToken(token);
    const now = Math.floor(Date.now() / 1000);
    const session = await this.env.DB.prepare(
      'SELECT id FROM sessions WHERE user_id = ? AND token_hash = ? AND expires_at > ?'
    ).bind(payload.sub, tokenHash, now).first<{ id: string }>();

    if (!session) return null;
    // Bump last_used_at on every successful refresh so the "Сессии" UI
    // sorts active devices newest-first. Cheap PK update, fire-and-forget
    // semantics (a write hiccup doesn't fail the refresh).
    await this.env.DB
      .prepare('UPDATE sessions SET last_used_at = ? WHERE id = ?')
      .bind(now, session.id)
      .run()
      .catch(() => { /* ignore */ });
    // Stamp the verified payload with the actual sessions.id we matched
    // against (refresh tokens minted before the `sid` claim shipped
    // won't carry one — keep them working by back-filling here).
    return { ...payload, sid: session.id };
  }

  /**
   * Rotate the access+refresh JWT pair for an EXISTING session row,
   * keeping the same `sid` so the access token's claim stays stable
   * across refreshes. Used by `/auth/refresh` instead of the
   * delete-then-create dance that used to mint a fresh sid every
   * hour — that broke the per-session revoke model added in PR #443
   * (middleware now gates on the sessions row existing, so a stale
   * `sid` would lock the user out immediately on first refresh).
   *
   * Caller has already verified the refresh token and knows the
   * `sessionId` it belongs to. We UPDATE token_hash / expires_at /
   * last_used_at / metadata on the row and return the new pair.
   */
  async rotateSession(
    sessionId: string,
    userId: string,
    isAdmin: boolean,
    metadata: SessionMetadata = {},
  ): Promise<TokenPair> {
    const now = Math.floor(Date.now() / 1000);
    const accessPayload: TokenPayload = {
      sub: userId,
      iat: now,
      exp: now + ACCESS_TOKEN_TTL,
      admin: isAdmin,
      sid: sessionId,
    };
    const refreshPayload: TokenPayload = {
      sub: userId,
      iat: now,
      exp: now + REFRESH_TOKEN_TTL,
      admin: isAdmin,
      sid: sessionId,
    };
    const accessToken = await this.signJwt(accessPayload, this.env.JWT_SECRET);
    const refreshToken = await this.signJwt(refreshPayload, this.env.JWT_REFRESH_SECRET);
    const tokenHash = await this.hashToken(refreshToken);
    // Set metadata only when the caller passed it — refreshes from
    // background tabs / service workers sometimes drop the
    // User-Agent, and we'd rather keep the last good label than
    // overwrite it with an empty string.
    if (metadata.userAgent || metadata.ipHash || metadata.clientLabel) {
      await this.env.DB.prepare(
        `UPDATE sessions
           SET token_hash = ?, expires_at = ?, last_used_at = ?,
               user_agent = ?, ip_hash = ?, client_label = ?
         WHERE id = ? AND user_id = ?`,
      ).bind(
        tokenHash,
        now + REFRESH_TOKEN_TTL,
        now,
        metadata.userAgent ?? '',
        metadata.ipHash ?? '',
        metadata.clientLabel ?? '',
        sessionId,
        userId,
      ).run();
    } else {
      await this.env.DB.prepare(
        `UPDATE sessions
           SET token_hash = ?, expires_at = ?, last_used_at = ?
         WHERE id = ? AND user_id = ?`,
      ).bind(
        tokenHash,
        now + REFRESH_TOKEN_TTL,
        now,
        sessionId,
        userId,
      ).run();
    }
    return { accessToken, refreshToken, expiresIn: ACCESS_TOKEN_TTL, sessionId };
  }

  /**
   * Look up the `sessions.id` for a given refresh token. Used by the
   * /auth/telegram and /auth/refresh handlers so the response can
   * echo the active session id back to the client (matches what's
   * displayed in the new "Сессии" tab).
   */
  async sessionIdForRefreshToken(token: string): Promise<string | null> {
    const tokenHash = await this.hashToken(token);
    const row = await this.env.DB.prepare(
      'SELECT id FROM sessions WHERE token_hash = ? LIMIT 1'
    ).bind(tokenHash).first<{ id: string }>();
    return row?.id ?? null;
  }

  async revokeRefreshToken(token: string): Promise<void> {
    const tokenHash = await this.hashToken(token);
    await this.env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(tokenHash).run();
  }

  async verifyTelegramAuth(initData: string): Promise<Record<string, string> | null> {
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) return null;

    // Reject stale or future-dated payloads. Telegram's spec mandates this
    // window for treating WebApp init data as authoritative; without the
    // check, captured initData replays indefinitely and mints fresh JWT
    // pairs forever. 24h is the documented upper bound.
    const authDateRaw = params.get('auth_date');
    if (!authDateRaw) return null;
    const authDate = Number(authDateRaw);
    if (!Number.isFinite(authDate) || authDate <= 0) return null;
    const ageSec = Math.floor(Date.now() / 1000) - authDate;
    const MAX_AUTH_AGE = 24 * 60 * 60;
    // Allow up to 5 minutes of clock skew on the "from the future" side
    // (NTP drift + user-device clocks) — beyond that, treat as forged.
    if (ageSec > MAX_AUTH_AGE || ageSec < -300) return null;

    params.delete('hash');
    const entries = Array.from(params.entries()).sort(([a], [b]) => a.localeCompare(b));
    const dataCheckString = entries.map(([k, v]) => `${k}=${v}`).join('\n');

    const secretKey = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode('WebAppData'),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );

    const secretHash = await crypto.subtle.sign(
      'HMAC',
      secretKey,
      new TextEncoder().encode(this.env.TELEGRAM_BOT_TOKEN)
    );

    const key = await crypto.subtle.importKey(
      'raw',
      secretHash,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );

    const signature = await crypto.subtle.sign(
      'HMAC',
      key,
      new TextEncoder().encode(dataCheckString)
    );

    const computedHash = Array.from(new Uint8Array(signature))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');

    if (computedHash !== hash) return null;

    return Object.fromEntries(params.entries());
  }

  private async signJwt(payload: TokenPayload, secret: string): Promise<string> {
    const header = { alg: 'HS256', typ: 'JWT' };
    const encodedHeader = this.base64url(JSON.stringify(header));
    const encodedPayload = this.base64url(JSON.stringify(payload));
    const signingInput = `${encodedHeader}.${encodedPayload}`;

    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );

    const signature = await crypto.subtle.sign(
      'HMAC',
      key,
      new TextEncoder().encode(signingInput)
    );

    const encodedSignature = this.base64urlFromBuffer(signature);
    return `${signingInput}.${encodedSignature}`;
  }

  private async verifyJwt(token: string, secret: string): Promise<TokenPayload | null> {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const [header, payload, signature] = parts;
    const signingInput = `${header}.${payload}`;

    // Defense-in-depth: reject any token whose header advertises an algorithm
    // other than HS256 before we even touch the signature. We always sign
    // with HS256 and the verify path is wired to HMAC-SHA256, so an
    // alg=none / alg=RS256 forgery would already fail signature check, but
    // refusing to look at non-HS256 headers eliminates a whole class of
    // future regressions if the verifier ever grows alg dispatch.
    let parsedHeader: { alg?: unknown; typ?: unknown };
    try {
      parsedHeader = JSON.parse(atob(header.replace(/-/g, '+').replace(/_/g, '/'))) as {
        alg?: unknown;
        typ?: unknown;
      };
    } catch {
      return null;
    }
    if (parsedHeader.alg !== 'HS256') return null;

    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );

    const signatureBuffer = this.base64urlToBuffer(signature);
    const valid = await crypto.subtle.verify(
      'HMAC',
      key,
      signatureBuffer,
      new TextEncoder().encode(signingInput)
    );

    if (!valid) return null;

    const decoded = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))) as TokenPayload;

    if (decoded.exp < Math.floor(Date.now() / 1000)) return null;

    return decoded;
  }

  private async hashToken(token: string): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
    return Array.from(new Uint8Array(digest))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  private base64url(str: string): string {
    return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  private base64urlFromBuffer(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  private base64urlToBuffer(str: string): ArrayBuffer {
    const padded = str.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
  }
}
