import type { Env } from '../types/env';

interface TokenPayload {
  sub: string;
  iat: number;
  exp: number;
  admin: boolean;
}

interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

const ACCESS_TOKEN_TTL = 3600;
const REFRESH_TOKEN_TTL = 60 * 60 * 24 * 30;

export class AuthService {
  constructor(private env: Env) {}

  async generateTokens(userId: string, isAdmin: boolean): Promise<TokenPair> {
    const now = Math.floor(Date.now() / 1000);

    const accessPayload: TokenPayload = {
      sub: userId,
      iat: now,
      exp: now + ACCESS_TOKEN_TTL,
      admin: isAdmin,
    };

    const refreshPayload: TokenPayload = {
      sub: userId,
      iat: now,
      exp: now + REFRESH_TOKEN_TTL,
      admin: isAdmin,
    };

    const accessToken = await this.signJwt(accessPayload, this.env.JWT_SECRET);
    const refreshToken = await this.signJwt(refreshPayload, this.env.JWT_REFRESH_SECRET);

    const tokenHash = await this.hashToken(refreshToken);
    await this.env.DB.prepare(
      'INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)'
    ).bind(crypto.randomUUID(), userId, tokenHash, now + REFRESH_TOKEN_TTL, now).run();

    return { accessToken, refreshToken, expiresIn: ACCESS_TOKEN_TTL };
  }

  async verifyAccessToken(token: string): Promise<TokenPayload | null> {
    return this.verifyJwt(token, this.env.JWT_SECRET);
  }

  async verifyRefreshToken(token: string): Promise<TokenPayload | null> {
    const payload = await this.verifyJwt(token, this.env.JWT_REFRESH_SECRET);
    if (!payload) return null;

    const tokenHash = await this.hashToken(token);
    const session = await this.env.DB.prepare(
      'SELECT id FROM sessions WHERE user_id = ? AND token_hash = ? AND expires_at > ?'
    ).bind(payload.sub, tokenHash, Math.floor(Date.now() / 1000)).first();

    if (!session) return null;
    return payload;
  }

  async revokeRefreshToken(token: string): Promise<void> {
    const tokenHash = await this.hashToken(token);
    await this.env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(tokenHash).run();
  }

  async verifyTelegramAuth(initData: string): Promise<Record<string, string> | null> {
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) return null;

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
