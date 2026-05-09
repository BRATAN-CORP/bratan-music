CREATE TABLE users (
    id                TEXT PRIMARY KEY,
    tg_username       TEXT,
    tg_name           TEXT,
    email             TEXT,
    is_admin          INTEGER NOT NULL DEFAULT 0,
    is_banned         INTEGER NOT NULL DEFAULT 0,
    banned_at         INTEGER,
    banned_by         TEXT,
    banned_reason     TEXT,
    tour_completed_at INTEGER,
    created_at        INTEGER NOT NULL,
    updated_at        INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_users_is_banned ON users(is_banned);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_unique ON users(email);

-- Email-based passwordless login. Codes are 6 digits hashed at rest;
-- `purpose` separates fresh-login OTPs from "link this email to an
-- existing Telegram account" OTPs so the verify path can refuse
-- cross-purpose replay. See migration 0025_email_otps.sql.
CREATE TABLE email_otps (
    email      TEXT PRIMARY KEY,
    code_hash  TEXT NOT NULL,
    purpose    TEXT NOT NULL DEFAULT 'login' CHECK(purpose IN ('login','link')),
    user_id    TEXT,
    attempts   INTEGER NOT NULL DEFAULT 0,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_email_otps_expires_at ON email_otps(expires_at);

-- Per-IP signup ledger — caps account-creation per source IP at the
-- auth route so the free-tier daily ceiling can't be trivially
-- multiplied by spinning up N accounts. See migration
-- 0026_signup_log.sql for the rationale.
CREATE TABLE IF NOT EXISTS signup_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     TEXT NOT NULL,
    ip          TEXT NOT NULL,
    source      TEXT NOT NULL CHECK(source IN ('email','telegram')),
    created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_signup_log_ip_created_at ON signup_log(ip, created_at);
CREATE INDEX IF NOT EXISTS idx_signup_log_user ON signup_log(user_id);

CREATE TABLE subscriptions (
    id              TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status          TEXT NOT NULL CHECK(status IN ('active','expired','manual')),
    expires_at      INTEGER NOT NULL,
    payment_method  TEXT,
    stars_tx_id     TEXT,
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL
);

CREATE TABLE daily_listens (
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    date        TEXT NOT NULL,
    count       INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, date)
);

CREATE TABLE playlists (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    is_liked    INTEGER NOT NULL DEFAULT 0,
    cover_url   TEXT,
    pinned_at   INTEGER,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_playlists_user_pinned ON playlists(user_id, pinned_at);

CREATE TABLE user_tracks (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    artist      TEXT NOT NULL DEFAULT '',
    album       TEXT NOT NULL DEFAULT '',
    cover_url   TEXT,
    duration    INTEGER NOT NULL DEFAULT 0,
    r2_key      TEXT NOT NULL,
    mime_type   TEXT NOT NULL,
    size_bytes  INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_user_tracks_user ON user_tracks(user_id, created_at DESC);

CREATE TABLE playlist_tracks (
    playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
    track_id    TEXT NOT NULL,
    source      TEXT NOT NULL DEFAULT 'tidal',
    position    INTEGER NOT NULL,
    added_at    INTEGER NOT NULL,
    PRIMARY KEY (playlist_id, track_id)
);

CREATE TABLE track_overrides (
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    track_id    TEXT NOT NULL,
    source      TEXT NOT NULL DEFAULT 'tidal',
    r2_key      TEXT NOT NULL,
    mime_type   TEXT NOT NULL,
    size_bytes  INTEGER NOT NULL,
    created_at  INTEGER NOT NULL,
    PRIMARY KEY (user_id, track_id, source)
);

CREATE TABLE sessions (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash  TEXT NOT NULL,
    expires_at  INTEGER NOT NULL,
    created_at  INTEGER NOT NULL
);

CREATE TABLE service_accounts (
    id          TEXT PRIMARY KEY,
    service     TEXT NOT NULL DEFAULT 'tidal',
    label       TEXT NOT NULL,
    credentials TEXT NOT NULL,
    is_active   INTEGER NOT NULL DEFAULT 1,
    created_at  INTEGER NOT NULL
);

CREATE INDEX idx_subs_user    ON subscriptions(user_id);
CREATE INDEX idx_subs_expires ON subscriptions(expires_at);
CREATE INDEX idx_pt_playlist  ON playlist_tracks(playlist_id, position);
CREATE INDEX idx_ovr_user     ON track_overrides(user_id);
CREATE INDEX idx_sess_user    ON sessions(user_id);
CREATE INDEX idx_dl_user_date ON daily_listens(user_id, date);

CREATE TABLE library_items (
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    item_id     TEXT NOT NULL,
    type        TEXT NOT NULL CHECK(type IN ('album','artist')),
    snapshot    TEXT,
    added_at    INTEGER NOT NULL,
    PRIMARY KEY (user_id, item_id, type)
);
CREATE INDEX IF NOT EXISTS idx_library_items_user_type ON library_items(user_id, type, added_at DESC);

CREATE TABLE tidal_session (
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

CREATE TABLE tidal_device_codes (
    device_code   TEXT PRIMARY KEY,
    client_id     TEXT NOT NULL,
    client_secret TEXT NOT NULL,
    expires_at    INTEGER NOT NULL
);

CREATE INDEX idx_tidal_device_codes_expires_at ON tidal_device_codes(expires_at);

-- Listening history (>=30s plays / completions) feeding the per-user
-- taste profile. See migration 0011 for the full design rationale.
CREATE TABLE play_history (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    track_id         TEXT NOT NULL,
    source           TEXT NOT NULL DEFAULT 'tidal',
    artist_id        TEXT,
    artist_name      TEXT NOT NULL DEFAULT '',
    title            TEXT NOT NULL DEFAULT '',
    album_id         TEXT,
    cover_url        TEXT,
    duration         INTEGER NOT NULL DEFAULT 0,
    listened_seconds INTEGER NOT NULL DEFAULT 0,
    completed        INTEGER NOT NULL DEFAULT 0,
    played_at        INTEGER NOT NULL
);
CREATE INDEX idx_play_history_user_played ON play_history(user_id, played_at DESC);
CREATE INDEX idx_play_history_user_artist ON play_history(user_id, artist_id);

CREATE TABLE user_taste_profile (
    user_id          TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    profile          TEXT NOT NULL,
    genre_seeds      TEXT NOT NULL DEFAULT '[]',
    seed_artist_ids  TEXT NOT NULL DEFAULT '[]',
    computed_at      INTEGER NOT NULL,
    updated_at       INTEGER NOT NULL
);

CREATE TABLE user_dislikes (
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    item_id    TEXT NOT NULL,
    kind       TEXT NOT NULL CHECK(kind IN ('track','artist')),
    source     TEXT NOT NULL DEFAULT 'tidal',
    created_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, item_id, kind)
);
CREATE INDEX idx_user_dislikes_user ON user_dislikes(user_id, created_at DESC);

CREATE TABLE daily_playlists (
    id                    TEXT PRIMARY KEY,
    user_id               TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    date                  TEXT NOT NULL,
    variant               TEXT NOT NULL CHECK(variant IN ('familiar','discover','mood')),
    name                  TEXT NOT NULL,
    description           TEXT NOT NULL DEFAULT '',
    cover_url             TEXT,
    tracks                TEXT NOT NULL,
    generated_at          INTEGER NOT NULL,
    saved_to_playlist_id  TEXT
);
CREATE UNIQUE INDEX idx_daily_playlists_user_date_variant ON daily_playlists(user_id, date, variant);
CREATE INDEX idx_daily_playlists_user_generated ON daily_playlists(user_id, generated_at DESC);

CREATE TABLE recommendation_seen (
    user_id      TEXT NOT NULL,
    track_id     TEXT NOT NULL,
    source       TEXT NOT NULL DEFAULT 'tidal',
    last_seen_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, track_id, source)
);
CREATE INDEX idx_recommendation_seen_user_seen ON recommendation_seen(user_id, last_seen_at DESC);

CREATE TABLE user_preferences (
    user_id    TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    prefs      TEXT NOT NULL DEFAULT '{}',
    updated_at INTEGER NOT NULL
);

CREATE TABLE listening_rooms (
    id              TEXT PRIMARY KEY,
    code            TEXT NOT NULL UNIQUE,
    host_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name            TEXT NOT NULL DEFAULT 'Комната',
    status          TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','closed')),
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL,
    last_activity_at INTEGER NOT NULL
);
CREATE INDEX idx_listening_rooms_host ON listening_rooms(host_id, status);
CREATE INDEX idx_listening_rooms_activity ON listening_rooms(status, last_activity_at);

CREATE TABLE listening_room_state (
    room_id          TEXT PRIMARY KEY REFERENCES listening_rooms(id) ON DELETE CASCADE,
    track_json       TEXT,
    track_id         TEXT,
    track_source     TEXT,
    started_at_ms    INTEGER NOT NULL DEFAULT 0,
    position_ms      INTEGER NOT NULL DEFAULT 0,
    is_paused        INTEGER NOT NULL DEFAULT 1,
    controller_id    TEXT,
    version          INTEGER NOT NULL DEFAULT 0,
    updated_at_ms    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE listening_room_members (
    room_id      TEXT NOT NULL REFERENCES listening_rooms(id) ON DELETE CASCADE,
    user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role         TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('host','member')),
    joined_at    INTEGER NOT NULL,
    last_seen_ms INTEGER NOT NULL,
    PRIMARY KEY (room_id, user_id)
);
CREATE INDEX idx_listening_room_members_user ON listening_room_members(user_id);
CREATE INDEX idx_listening_room_members_seen ON listening_room_members(room_id, last_seen_ms);
