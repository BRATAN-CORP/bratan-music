-- Per-IP signup tracking for paywall-bypass mitigation.
--
-- The free tier ships 3 plays/day per `user_id`, so an attacker who
-- creates N accounts gets N × 3 plays/day. Without a gate the cheapest
-- bypass is to script the email-OTP or Telegram-deeplink flow against
-- a list of fresh addresses. This table stamps every freshly-created
-- account row with the IP that requested it; the auth route checks the
-- count over the trailing 24 h window and rejects the (N+1)th signup
-- with a 429.
--
-- Existing accounts are unaffected — only the rows where the auth
-- route went through the "INSERT INTO users" branch are logged. The
-- combined `disposable email blocklist` (see EmailOtpService) closes
-- the cheap end of the funnel; this table closes the cheap-IP end.
--
-- Schema notes:
--   - `source`     : 'email' | 'telegram'. Lets us compute split
--                     signup pressure from each surface.
--   - `ip`         : best-effort string from CF-Connecting-IP /
--                     X-Forwarded-For, or 'unknown' when both are
--                     missing (which only happens off-edge).
--   - `created_at` : unix seconds.
--
-- The (ip, created_at) index is the one the rate-limit COUNT(*) hits
-- on every signup, so it has to be cheap to range-scan a 24 h window.
CREATE TABLE IF NOT EXISTS signup_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     TEXT NOT NULL,
    ip          TEXT NOT NULL,
    source      TEXT NOT NULL CHECK(source IN ('email','telegram')),
    created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_signup_log_ip_created_at ON signup_log(ip, created_at);
CREATE INDEX IF NOT EXISTS idx_signup_log_user ON signup_log(user_id);
