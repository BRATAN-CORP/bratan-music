-- Auth nonces are short-lived tokens used during the Telegram-deeplink login
-- flow. They used to live in Cloudflare KV (binding SESSIONS), but the free
-- KV plan caps writes at 1000/day for the whole worker, which combined with
-- the per-request rate-limit middleware quickly burned the quota and broke
-- login for everyone. D1 has a far more generous write quota.
CREATE TABLE IF NOT EXISTS auth_nonces (
    nonce      TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL,
    expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_auth_nonces_expires_at ON auth_nonces(expires_at);
