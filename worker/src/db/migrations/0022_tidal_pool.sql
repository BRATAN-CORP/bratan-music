-- Tidal proxy account pool. Replaces the singleton `tidal_session` row with
-- a pool of accounts that the worker rotates through, so a single banned /
-- expired account doesn't take the whole service down. The legacy
-- `tidal_session` row is migrated into this table on upgrade and stays
-- around as a deprecated read-only fallback (see migration step at the
-- bottom).
--
-- Tokens are stored AES-GCM encrypted under SESSION_ENCRYPTION_KEY, same
-- format as the legacy table (`encryptSecret`/`decryptSecret`).
CREATE TABLE IF NOT EXISTS tidal_accounts (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    label           TEXT,                  -- human-friendly name (admin-set)
    access_token    TEXT NOT NULL,         -- encrypted
    refresh_token   TEXT NOT NULL,         -- encrypted
    expires_at      INTEGER NOT NULL,      -- access_token expiry, unix sec
    user_id         INTEGER NOT NULL,      -- Tidal user id (uid in JWT)
    country_code    TEXT NOT NULL,
    client_id       TEXT,
    client_secret   TEXT,                  -- encrypted (or null)
    subscription_type TEXT,                -- "HIFI_PLUS"/"HIFI"/"FREE"/null
    subscription_valid_until INTEGER,      -- unix sec, null = unknown
    enabled         INTEGER NOT NULL DEFAULT 1,
    -- Round-robin tracking. `last_used_at` is updated on every checkout,
    -- and the picker prefers the row with the OLDEST last_used_at among
    -- enabled rows so traffic spreads evenly.
    last_used_at    INTEGER NOT NULL DEFAULT 0,
    usage_count     INTEGER NOT NULL DEFAULT 0,
    -- Error tracking. If `consecutive_errors` crosses a threshold the
    -- picker auto-disables the account so the next pick skips it.
    last_error      TEXT,
    last_error_at   INTEGER,
    consecutive_errors INTEGER NOT NULL DEFAULT 0,
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL,
    UNIQUE(user_id)
);

CREATE INDEX IF NOT EXISTS idx_tidal_accounts_pick
    ON tidal_accounts(enabled, last_used_at);

-- Migrate the legacy single-account row into the pool so the upgrade is
-- a no-op for traffic. We use INSERT OR IGNORE — if the migration is
-- re-run (e.g. wrangler retries), the UNIQUE(user_id) constraint
-- prevents a duplicate.
INSERT OR IGNORE INTO tidal_accounts
    (label, access_token, refresh_token, expires_at, user_id, country_code,
     client_id, client_secret, enabled, last_used_at, usage_count,
     created_at, updated_at)
SELECT
    'legacy', access_token, refresh_token, expires_at, user_id, country_code,
    client_id, client_secret, 1, 0, 0,
    updated_at, updated_at
FROM tidal_session WHERE id = 1;
