-- Tidal proxy account session — one row, id=1. Lived in KV (binding SESSIONS)
-- but every refresh + every device-flow poll wrote to KV, and the free KV
-- plan caps puts at 1000/day for the whole worker. Once the quota burned,
-- the entire app went down with "KV put() limit exceeded for the day".
-- D1 has a 5M-writes/day free quota — comfortably enough.
CREATE TABLE IF NOT EXISTS tidal_session (
    id              INTEGER PRIMARY KEY,
    access_token    TEXT NOT NULL,
    refresh_token   TEXT NOT NULL,
    expires_at      INTEGER NOT NULL,
    user_id         INTEGER NOT NULL,
    country_code    TEXT NOT NULL,
    client_id       TEXT,
    client_secret   TEXT,
    updated_at      INTEGER NOT NULL
);

-- Pending device-flow codes — short-lived (5min), used during the auth dance
-- to remember which client_id minted a given device code so the matching
-- poll uses the same id.
CREATE TABLE IF NOT EXISTS tidal_device_codes (
    device_code   TEXT PRIMARY KEY,
    client_id     TEXT NOT NULL,
    client_secret TEXT NOT NULL,
    expires_at    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tidal_device_codes_expires_at ON tidal_device_codes(expires_at);
