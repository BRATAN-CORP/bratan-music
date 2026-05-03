/**
 * AES-GCM helpers for the Tidal session secrets stored in D1.
 *
 * Why this exists:
 * - The `tidal_session` D1 row holds long-lived `access_token` /
 *   `refresh_token` values that grant the worker its only Tidal
 *   foothold. Anyone who lifts those (compromised CF account, leaked
 *   D1 dump, accidental log) can mint an indefinite Tidal session.
 * - `SESSION_ENCRYPTION_KEY` was already declared in the env schema and
 *   in deploy docs but was never actually used anywhere — this file
 *   wires it up.
 *
 * Format: `enc:v1:<base64url-iv>:<base64url-ciphertext>` (12-byte IV).
 * Reads transparently fall back to plaintext for legacy rows written
 * before this change so we never lose an existing session over the
 * deploy boundary.
 *
 * If `SESSION_ENCRYPTION_KEY` is missing or unparseable in dev we log
 * once and store plaintext so a fresh local checkout still works. In
 * production we hard-fail instead — silently writing Tidal tokens in
 * plaintext to D1 when the operator clearly meant to encrypt them is
 * the kind of "fail open" that gets you on a vendor's incident report.
 */

const ENC_PREFIX = 'enc:v1:';

let warnedMissingKey = false;

function base64UrlEncode(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + pad;
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function deriveKey(rawKey: string): Promise<CryptoKey | null> {
  if (!rawKey || rawKey.length < 16) return null;
  // Hash whatever the operator supplied to a fixed 32-byte AES-256 key.
  // Accepting hex/base64/raw secrets without forcing a specific format
  // keeps the integration friction low.
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(rawKey));
  return crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export async function encryptSecret(
  plaintext: string,
  rawKey: string | undefined,
  environment?: string,
): Promise<string> {
  if (!plaintext) return plaintext;
  const isProduction = environment === 'production';
  if (!rawKey) {
    if (isProduction) {
      throw new Error(
        'SESSION_ENCRYPTION_KEY is required in production — refusing to write Tidal tokens to D1 in plaintext',
      );
    }
    if (!warnedMissingKey) {
      console.error('[sessionCrypto] SESSION_ENCRYPTION_KEY not set — Tidal tokens stored in plaintext');
      warnedMissingKey = true;
    }
    return plaintext;
  }
  const key = await deriveKey(rawKey);
  if (!key) {
    if (isProduction) {
      throw new Error('SESSION_ENCRYPTION_KEY too short / invalid — must be ≥16 chars');
    }
    return plaintext;
  }
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(plaintext),
  );
  return `${ENC_PREFIX}${base64UrlEncode(iv)}:${base64UrlEncode(new Uint8Array(ct))}`;
}

export async function decryptSecret(stored: string | null | undefined, rawKey: string | undefined): Promise<string> {
  if (!stored) return '';
  if (!stored.startsWith(ENC_PREFIX)) {
    // Legacy plaintext row written before encryption was wired up.
    return stored;
  }
  if (!rawKey) {
    // Encrypted row but no key — treat as a hard error so we don't
    // accidentally serve garbage as a token.
    throw new Error('SESSION_ENCRYPTION_KEY is required to decrypt stored Tidal tokens');
  }
  const key = await deriveKey(rawKey);
  if (!key) {
    throw new Error('SESSION_ENCRYPTION_KEY too short / invalid');
  }
  // Stored format is `enc:v1:<iv>:<ct>` — split produces 4 parts:
  // ['enc', 'v1', '<iv>', '<ct>']. Slice past the prefix and split on
  // the single remaining colon so we always pick up the iv and ct
  // even if the version string ever grows extra colons in the future.
  const rest = stored.slice(ENC_PREFIX.length);
  const sep = rest.indexOf(':');
  if (sep <= 0) {
    throw new Error('Malformed encrypted Tidal token blob');
  }
  const ivPart = rest.slice(0, sep);
  const ctPart = rest.slice(sep + 1);
  if (!ivPart || !ctPart) {
    throw new Error('Malformed encrypted Tidal token blob');
  }
  const iv = base64UrlDecode(ivPart);
  const ct = base64UrlDecode(ctPart);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  return new TextDecoder().decode(pt);
}
