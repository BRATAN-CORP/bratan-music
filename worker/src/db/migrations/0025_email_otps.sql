-- Email-based passwordless login.
--
-- Two changes:
--
--   1. `users.email` — optional, nullable, unique-when-set so a Telegram-only
--      user keeps the row layout they had before. NULL is allowed (Telegram
--      stays the only login surface for them); a UNIQUE INDEX on the column
--      enforces "one email per account, one account per email" without
--      blocking the multi-NULL case (SQLite ignores NULL in UNIQUE
--      indexes by default).
--
--   2. `email_otps` — short-lived 6-digit codes hashed at rest. Keyed by
--      email so a single row per email is in flight; the verify path
--      bumps `attempts` on each wrong code and drops the row after 5
--      failures (constant-time compared, see EmailOtpService).
--      `expires_at` is unix seconds; the request endpoint sets it
--      ~10 minutes ahead. `purpose` distinguishes a fresh-login OTP
--      from a "link this email to my existing Telegram account" OTP
--      so the verify path can refuse cross-purpose replay.
ALTER TABLE users ADD COLUMN email TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_unique ON users(email);

CREATE TABLE IF NOT EXISTS email_otps (
    email      TEXT PRIMARY KEY,
    code_hash  TEXT NOT NULL,
    purpose    TEXT NOT NULL DEFAULT 'login' CHECK(purpose IN ('login','link')),
    user_id    TEXT,
    attempts   INTEGER NOT NULL DEFAULT 0,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_email_otps_expires_at ON email_otps(expires_at);
