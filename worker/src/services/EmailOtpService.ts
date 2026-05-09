import type { Env } from '../types/env';

export type OtpPurpose = 'login' | 'link';

interface OtpRow {
  email: string;
  code_hash: string;
  purpose: OtpPurpose;
  user_id: string | null;
  attempts: number;
  expires_at: number;
  created_at: number;
}

/** Lifetime of a freshly-issued OTP (unix seconds). */
const OTP_TTL_SECONDS = 10 * 60;

/** Min seconds between two `request` calls for the same email — keeps
 *  the SMTP-bill predictable AND removes the trivial e-mail spam
 *  vector (one POST per second per address would ship 86k/day on the
 *  300/day free plan). */
const OTP_RESEND_COOLDOWN_SECONDS = 60;

/** Max wrong code attempts before the row is invalidated. After this
 *  the user has to request a new code. */
const OTP_MAX_ATTEMPTS = 5;

export class EmailOtpService {
  constructor(private env: Env) {}

  /**
   * Generate a fresh 6-digit code, store its hash, return the plaintext
   * code (caller is responsible for sending it via email). If the email
   * already has an in-flight code that was issued less than the resend
   * cooldown ago, returns `null` — caller should respond with a generic
   * "we just sent you a code, try again in a minute" without telling
   * the user the cooldown actually exists.
   */
  async issueCode(opts: {
    email: string;
    purpose: OtpPurpose;
    /** Set when issuing a "link this email to my Telegram account"
     *  code so the verify path can refuse if the row drifted to the
     *  wrong user. Always `null` for fresh logins. */
    userId: string | null;
  }): Promise<{ code: string; expiresAt: number } | null> {
    const email = normalizeEmail(opts.email);
    const now = Math.floor(Date.now() / 1000);

    const existing = await this.env.DB
      .prepare('SELECT created_at, expires_at FROM email_otps WHERE email = ?')
      .bind(email)
      .first<{ created_at: number; expires_at: number }>();

    if (existing && existing.created_at + OTP_RESEND_COOLDOWN_SECONDS > now && existing.expires_at > now) {
      return null;
    }

    const code = generateCode();
    const codeHash = await sha256Hex(code);
    const expiresAt = now + OTP_TTL_SECONDS;

    // UPSERT — re-issuing for the same email replaces the row (and
    // resets `attempts`). Single-row-per-email keeps the verify path
    // O(1) and prevents an attacker from drowning the table with
    // codes for random addresses.
    await this.env.DB.prepare(
      `INSERT INTO email_otps (email, code_hash, purpose, user_id, attempts, expires_at, created_at)
         VALUES (?, ?, ?, ?, 0, ?, ?)
         ON CONFLICT(email) DO UPDATE SET
           code_hash = excluded.code_hash,
           purpose = excluded.purpose,
           user_id = excluded.user_id,
           attempts = 0,
           expires_at = excluded.expires_at,
           created_at = excluded.created_at`,
    )
      .bind(email, codeHash, opts.purpose, opts.userId, expiresAt, now)
      .run();

    return { code, expiresAt };
  }

  /**
   * Verify a code against the stored hash. Returns the matched row's
   * purpose + user_id on success so the caller can branch (issue
   * tokens for `login`, attach email for `link`). Wrong codes
   * increment `attempts`; after `OTP_MAX_ATTEMPTS` the row is
   * deleted and verify returns `null` until a fresh code is issued.
   *
   * Constant-time compares the hex-digest hash to defeat timing
   * side-channels.
   */
  async verifyCode(opts: {
    email: string;
    code: string;
    /** Required: the verify endpoint must match the issued purpose
     *  exactly. A `login` row submitted to the `link` endpoint (or
     *  vice-versa) is rejected without bumping `attempts`, since
     *  the user could not influence the purpose mismatch from the
     *  client. */
    purpose: OtpPurpose;
  }): Promise<{ ok: true; userId: string | null } | { ok: false; reason: 'expired' | 'wrong' | 'missing' | 'purpose' }> {
    const email = normalizeEmail(opts.email);
    const now = Math.floor(Date.now() / 1000);

    const row = await this.env.DB
      .prepare('SELECT email, code_hash, purpose, user_id, attempts, expires_at, created_at FROM email_otps WHERE email = ?')
      .bind(email)
      .first<OtpRow>();

    if (!row) return { ok: false, reason: 'missing' };
    if (row.expires_at <= now) {
      await this.env.DB.prepare('DELETE FROM email_otps WHERE email = ?').bind(email).run();
      return { ok: false, reason: 'expired' };
    }
    if (row.purpose !== opts.purpose) {
      return { ok: false, reason: 'purpose' };
    }

    const submittedHash = await sha256Hex(opts.code);
    if (!constantTimeEqualHex(submittedHash, row.code_hash)) {
      const next = row.attempts + 1;
      if (next >= OTP_MAX_ATTEMPTS) {
        await this.env.DB.prepare('DELETE FROM email_otps WHERE email = ?').bind(email).run();
      } else {
        await this.env.DB.prepare('UPDATE email_otps SET attempts = ? WHERE email = ?').bind(next, email).run();
      }
      return { ok: false, reason: 'wrong' };
    }

    // Single-use — drop the row before issuing tokens / attaching
    // the email so the same code can never be replayed.
    await this.env.DB.prepare('DELETE FROM email_otps WHERE email = ?').bind(email).run();

    return { ok: true, userId: row.user_id };
  }

  /**
   * Best-effort GC of expired rows. Called opportunistically from the
   * request endpoint (before issuing) so the table doesn't bloat
   * with rows nobody verified — there's no cron entry for it
   * because the volume is tiny and an explicit sweep job would be
   * overkill. `LIMIT 100` keeps the operation predictable on the
   * D1 free tier.
   */
  async sweep(): Promise<void> {
    const now = Math.floor(Date.now() / 1000);
    await this.env.DB
      .prepare('DELETE FROM email_otps WHERE email IN (SELECT email FROM email_otps WHERE expires_at <= ? LIMIT 100)')
      .bind(now)
      .run();
  }
}

/**
 * Lowercase + trim. Brevo doesn't care about case in the local part of
 * a Gmail address but most SMTP servers do — we normalise on store so
 * "Foo@Bar.Com" and "foo@bar.com" map to the same row. Conservative
 * spec-wise (the local part is technically case-sensitive per RFC
 * 5321) but matches user expectations and how every major provider
 * actually behaves.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Lightweight email validator. RFC 5322 is gnarly; we only need to
 * reject things that are obviously not addresses (no "@", control
 * chars, > RFC 5321 length cap). The canonical "did the email reach
 * the user" check is whether the OTP code returns — anything that
 * passes Brevo's relay accept gate is good enough for this surface.
 */
export function isPlausibleEmail(email: string): boolean {
  if (typeof email !== 'string') return false;
  const trimmed = email.trim();
  if (trimmed.length === 0 || trimmed.length > 254) return false;
  // No control chars, no whitespace, exactly one '@', dot in the
  // domain part. RFC technically allows quoted local parts with
  // spaces — they're vanishingly rare in real-world signups, so we
  // refuse them to keep parsing simple.
  if (/\s/.test(trimmed)) return false;
  const at = trimmed.indexOf('@');
  if (at <= 0 || at !== trimmed.lastIndexOf('@') || at === trimmed.length - 1) return false;
  const domain = trimmed.slice(at + 1);
  if (!domain.includes('.') || domain.startsWith('.') || domain.endsWith('.')) return false;
  return true;
}

/**
 * Hand-curated set of disposable / temp-mail provider domains. These
 * are the providers that ship random inboxes with no signup, free
 * via API, and would otherwise let an attacker fan out across N
 * "fresh" addresses to rack up the per-account daily free-listen
 * quota. The list trades coverage for false-positive safety: only
 * domains we've actually seen as scraper-grade temp-mail surface
 * make it in. Real users on Gmail / Yandex / Outlook / iCloud are
 * never affected.
 *
 * If a real provider sneaks onto this list, the user-facing failure
 * is "Одноразовые ящики не поддерживаются. Используйте свою
 * основную почту." — they pick another address and move on, no
 * data loss.
 *
 * Curated against current top temp-mail providers (Dec 2024) — the
 * long tail is endless but these are the ones surfaced in
 * "best free temp mail 2024" results that any farming script
 * would discover first.
 */
const DISPOSABLE_EMAIL_DOMAINS = new Set<string>([
  // mail.tm + sister domains (free API, used in /auth/email/verify
  // smoke-test ourselves so we know the API is real).
  'mail.tm', 'wshu.net', 'edny.net', 'rover.info', 'tiden.org',
  'tippsy.org', 'oranek.com', 'wireconnected.com', 'bingobongoo.fun',
  // Mailinator family.
  'mailinator.com', 'mailinator.net', 'mailinator.org', 'mailinator2.com',
  'binkmail.com', 'safetymail.info', 'sogetthis.com', 'spamherelots.com',
  'spamhereplease.com', 'thisisnotmyrealemail.com', 'tradermail.info',
  'veryrealemail.com', 'zippymail.info', 'mailinator.gq', 'reallymymail.com',
  // GuerrillaMail family.
  'guerrillamail.com', 'guerrillamail.org', 'guerrillamail.net',
  'guerrillamail.biz', 'guerrillamailblock.com', 'sharklasers.com',
  'grr.la', 'spam4.me', 'pokemail.net', 'guerrillamail.de',
  // 10minutemail / variants.
  '10minutemail.com', '10minutemail.net', '10minemail.com',
  '20minutemail.com', '30minutemail.com', '60minutemail.com',
  // tempmail / temp-mail family.
  'tempmail.com', 'temp-mail.org', 'temp-mail.io', 'tempmail.dev',
  'tempmailer.com', 'tempmailo.com', 'tempr.email', 'temp-link.net',
  'discard.email', 'discardmail.com', 'discardmail.de',
  // YOPmail family.
  'yopmail.com', 'yopmail.fr', 'yopmail.net', 'cool.fr.nf', 'jetable.fr.nf',
  'nospam.ze.tc', 'nomail.xl.cx', 'mega.zik.dj', 'speed.1s.fr',
  'courriel.fr.nf', 'moncourrier.fr.nf', 'monemail.fr.nf', 'monmail.fr.nf',
  // throwawaymail / fakeinbox.
  'throwawaymail.com', 'fakeinbox.com', 'mintemail.com', 'mt2014.com',
  'mt2015.com', 'mytemp.email', 'smashmail.de', 'spamgourmet.com',
  // dispostable / others.
  'dispostable.com', 'mailnesia.com', 'mailcatch.com', 'maildrop.cc',
  'getairmail.com', 'spambox.us', 'mvrht.net', 'mvrht.com',
  // emailondeck / muleemail / mohmal / inboxbear.
  'emailondeck.com', 'muleemail.com', 'mohmal.com', 'inboxbear.com',
  'mohmal.in', 'inboxkitten.com', 'rcpt.at',
  // burnermail.io + family.
  'burnermail.io', 'tmpmail.org', 'tmpmail.net', 'tmpeml.com',
  // simpleinbox / luxusmail / fakemail / generator.email.
  'simpleinbox.com', 'fakemail.fr', 'fakemail.net', 'generator.email',
  'mailfa.tk', 'getnada.com', 'nada.email', 'getmail.tools',
]);

/**
 * Reject obvious disposable / temp-mail domains. The free-listen
 * quota is per-user, so without this gate an attacker who wants to
 * bypass the 3-tracks/day paywall just spins through random temp
 * addresses and creates one account per code. Combined with the
 * per-IP signup cap (`signup_log` table) and Brevo's own
 * deliverability filters this closes the cheap end of the bypass
 * funnel — VPN-rotating attackers can still get through, but the
 * cost is no longer "open browser → click → free account".
 */
export function isDisposableEmail(email: string): boolean {
  if (typeof email !== 'string') return false;
  const at = email.lastIndexOf('@');
  if (at <= 0) return false;
  const domain = email.slice(at + 1).trim().toLowerCase();
  if (!domain) return false;
  if (DISPOSABLE_EMAIL_DOMAINS.has(domain)) return true;
  // Catch obvious sub-domain variants (e.g. "foo.mail.tm" from
  // mail.tm's pool). We only suffix-match against bases that
  // consist of two-or-more labels so single-label TLDs aren't
  // accidentally caught.
  for (const base of DISPOSABLE_EMAIL_DOMAINS) {
    if (base.includes('.') && domain.endsWith('.' + base)) return true;
  }
  return false;
}

function generateCode(): string {
  // Six independent decimal digits drawn from crypto.getRandomValues —
  // the previous "Math.floor(Math.random() * 1e6)" version produced
  // distinguishable bias on V8 (insecure RNG). With six fresh draws we
  // get a flat 1-in-10⁶ guess probability, which combined with
  // OTP_MAX_ATTEMPTS=5 caps brute-force at 1-in-2 × 10⁵ per issued
  // code — fine for a 10-minute TTL.
  const buf = new Uint8Array(6);
  crypto.getRandomValues(buf);
  let out = '';
  for (let i = 0; i < 6; i++) {
    // Modulo bias is negligible at modulus 10 over a uniform u8.
    out += (buf[i]! % 10).toString();
  }
  return out;
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Constant-time compare for two hex strings of the same length. Both
 * inputs are SHA-256 digests in this codebase so they're guaranteed
 * 64 chars; the length check is defence-in-depth in case a future
 * caller passes raw input.
 */
function constantTimeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
