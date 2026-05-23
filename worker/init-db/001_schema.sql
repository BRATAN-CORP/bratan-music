-- Bratan Music — Postgres schema
-- Converted from D1 (SQLite) schema. All 33 tables.
-- Timestamps are stored as INTEGER (epoch seconds/ms) matching the original.

CREATE TABLE IF NOT EXISTS users (
    id          TEXT PRIMARY KEY,
    tg_username TEXT,
    tg_name     TEXT,
    is_admin    INTEGER NOT NULL DEFAULT 0,
    created_at  BIGINT NOT NULL,
    updated_at  BIGINT NOT NULL,
    tour_completed_at BIGINT,
    is_banned     INTEGER NOT NULL DEFAULT 0,
    banned_at     BIGINT,
    banned_by     TEXT,
    banned_reason TEXT,
    recommendations_reset_at BIGINT NOT NULL DEFAULT 0,
    email TEXT,
    tg_id TEXT,
    min_token_iat BIGINT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS subscriptions (
    id              TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status          TEXT NOT NULL CHECK(status IN ('active','expired','manual')),
    expires_at      BIGINT NOT NULL,
    payment_method  TEXT,
    stars_tx_id     TEXT,
    created_at      BIGINT NOT NULL,
    updated_at      BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS daily_listens (
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    date        TEXT NOT NULL,
    count       INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, date)
);

CREATE TABLE IF NOT EXISTS daily_listen_tracks (
    user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    date     TEXT NOT NULL,
    track_id TEXT NOT NULL,
    PRIMARY KEY (user_id, date, track_id)
);

CREATE TABLE IF NOT EXISTS playlists (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    is_liked    INTEGER NOT NULL DEFAULT 0,
    created_at  BIGINT NOT NULL,
    updated_at  BIGINT NOT NULL,
    cover_r2_key TEXT,
    cover_updated_at BIGINT,
    cover_url TEXT,
    pinned_at BIGINT,
    is_public INTEGER NOT NULL DEFAULT 0,
    share_token TEXT,
    source_kind TEXT,
    source_playlist_id TEXT,
    source_user_id TEXT,
    source_track_count INTEGER,
    description TEXT
);

CREATE TABLE IF NOT EXISTS playlist_tracks (
    playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
    track_id    TEXT NOT NULL,
    source      TEXT NOT NULL DEFAULT 'tidal',
    position    INTEGER NOT NULL,
    added_at    BIGINT NOT NULL,
    snapshot    TEXT,
    PRIMARY KEY (playlist_id, track_id)
);

CREATE TABLE IF NOT EXISTS track_overrides (
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    track_id    TEXT NOT NULL,
    source      TEXT NOT NULL DEFAULT 'tidal',
    r2_key      TEXT NOT NULL,
    mime_type   TEXT NOT NULL,
    size_bytes  BIGINT NOT NULL,
    created_at  BIGINT NOT NULL,
    PRIMARY KEY (user_id, track_id, source)
);

CREATE TABLE IF NOT EXISTS sessions (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash  TEXT NOT NULL,
    expires_at  BIGINT NOT NULL,
    created_at  BIGINT NOT NULL,
    last_used_at BIGINT NOT NULL DEFAULT 0,
    user_agent   TEXT    NOT NULL DEFAULT '',
    ip_hash      TEXT    NOT NULL DEFAULT '',
    client_label TEXT    NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS service_accounts (
    id          TEXT PRIMARY KEY,
    service     TEXT NOT NULL DEFAULT 'tidal',
    label       TEXT NOT NULL,
    credentials TEXT NOT NULL,
    is_active   INTEGER NOT NULL DEFAULT 1,
    created_at  BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_nonces (
    nonce      TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL,
    expires_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS tidal_session (
    id              INTEGER PRIMARY KEY,
    access_token    TEXT NOT NULL,
    refresh_token   TEXT NOT NULL,
    expires_at      BIGINT NOT NULL,
    user_id         INTEGER NOT NULL,
    country_code    TEXT NOT NULL,
    client_id       TEXT,
    client_secret   TEXT,
    updated_at      BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS tidal_device_codes (
    device_code   TEXT PRIMARY KEY,
    client_id     TEXT NOT NULL,
    client_secret TEXT NOT NULL,
    expires_at    BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_tracks (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    artist      TEXT NOT NULL DEFAULT '',
    album       TEXT NOT NULL DEFAULT '',
    cover_url   TEXT,
    duration    INTEGER NOT NULL DEFAULT 0,
    r2_key      TEXT NOT NULL,
    mime_type   TEXT NOT NULL,
    size_bytes  BIGINT NOT NULL DEFAULT 0,
    created_at  BIGINT NOT NULL,
    updated_at  BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS library_items (
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    item_id     TEXT NOT NULL,
    type        TEXT NOT NULL CHECK(type IN ('album','artist')),
    snapshot    TEXT,
    added_at    BIGINT NOT NULL,
    PRIMARY KEY (user_id, item_id, type)
);

-- play_history: Use SERIAL instead of INTEGER PRIMARY KEY AUTOINCREMENT
CREATE TABLE IF NOT EXISTS play_history (
    id               SERIAL PRIMARY KEY,
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
    played_at        BIGINT NOT NULL,
    artists_json     TEXT,
    explicit         INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS user_taste_profile (
    user_id      TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    profile      TEXT NOT NULL,
    genre_seeds  TEXT NOT NULL DEFAULT '[]',
    computed_at  BIGINT NOT NULL,
    updated_at   BIGINT NOT NULL,
    seed_artist_ids TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS user_dislikes (
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    item_id    TEXT NOT NULL,
    kind       TEXT NOT NULL CHECK(kind IN ('track','artist')),
    source     TEXT NOT NULL DEFAULT 'tidal',
    created_at BIGINT NOT NULL,
    PRIMARY KEY (user_id, item_id, kind)
);

CREATE TABLE IF NOT EXISTS daily_playlists (
    id           TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    date         TEXT NOT NULL,
    variant      TEXT NOT NULL CHECK(variant IN ('familiar','discover','mood')),
    name         TEXT NOT NULL,
    description  TEXT NOT NULL DEFAULT '',
    cover_url    TEXT,
    tracks       TEXT NOT NULL,
    generated_at BIGINT NOT NULL,
    saved_to_playlist_id TEXT
);

CREATE TABLE IF NOT EXISTS recommendation_seen (
    user_id      TEXT NOT NULL,
    track_id     TEXT NOT NULL,
    source       TEXT NOT NULL DEFAULT 'tidal',
    last_seen_at BIGINT NOT NULL,
    PRIMARY KEY (user_id, track_id, source)
);

CREATE TABLE IF NOT EXISTS user_preferences (
    user_id    TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    prefs      TEXT NOT NULL DEFAULT '{}',
    updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS listening_rooms (
    id              TEXT PRIMARY KEY,
    code            TEXT NOT NULL UNIQUE,
    host_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name            TEXT NOT NULL DEFAULT 'Комната',
    status          TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','closed')),
    created_at      BIGINT NOT NULL,
    updated_at      BIGINT NOT NULL,
    last_activity_at BIGINT NOT NULL,
    host_only_control INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS listening_room_members (
    room_id      TEXT NOT NULL REFERENCES listening_rooms(id) ON DELETE CASCADE,
    user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role         TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('host','member')),
    joined_at    BIGINT NOT NULL,
    last_seen_ms BIGINT NOT NULL,
    PRIMARY KEY (room_id, user_id)
);

CREATE TABLE IF NOT EXISTS listening_room_messages (
    id          SERIAL PRIMARY KEY,
    room_id     TEXT NOT NULL REFERENCES listening_rooms(id) ON DELETE CASCADE,
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body        TEXT NOT NULL,
    created_at_ms BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS listening_room_state (
    room_id          TEXT PRIMARY KEY REFERENCES listening_rooms(id) ON DELETE CASCADE,
    track_json       TEXT,
    track_id         TEXT,
    track_source     TEXT,
    started_at_ms    BIGINT NOT NULL DEFAULT 0,
    position_ms      BIGINT NOT NULL DEFAULT 0,
    is_paused        INTEGER NOT NULL DEFAULT 1,
    controller_id    TEXT,
    version          INTEGER NOT NULL DEFAULT 0,
    updated_at_ms    BIGINT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS email_otps (
    email      TEXT PRIMARY KEY,
    code_hash  TEXT NOT NULL,
    purpose    TEXT NOT NULL DEFAULT 'login' CHECK(purpose IN ('login','link')),
    user_id    TEXT,
    attempts   INTEGER NOT NULL DEFAULT 0,
    expires_at BIGINT NOT NULL,
    created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS signup_log (
    id          SERIAL PRIMARY KEY,
    user_id     TEXT NOT NULL,
    ip          TEXT NOT NULL,
    source      TEXT NOT NULL CHECK(source IN ('email','telegram')),
    created_at  BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS tg_link_requests (
    nonce        TEXT PRIMARY KEY,
    requester_id TEXT NOT NULL,
    tg_id        TEXT,
    tg_username  TEXT,
    tg_name      TEXT,
    expires_at   BIGINT NOT NULL,
    created_at   BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS tidal_accounts (
    id              SERIAL PRIMARY KEY,
    label           TEXT,
    access_token    TEXT NOT NULL,
    refresh_token   TEXT NOT NULL,
    expires_at      BIGINT NOT NULL,
    user_id         INTEGER NOT NULL UNIQUE,
    country_code    TEXT NOT NULL,
    client_id       TEXT,
    client_secret   TEXT,
    subscription_type TEXT,
    subscription_valid_until INTEGER,
    enabled         INTEGER NOT NULL DEFAULT 1,
    last_used_at    BIGINT NOT NULL DEFAULT 0,
    usage_count     INTEGER NOT NULL DEFAULT 0,
    last_error      TEXT,
    last_error_at   BIGINT,
    consecutive_errors INTEGER NOT NULL DEFAULT 0,
    created_at      BIGINT NOT NULL,
    updated_at      BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS cron_runs (
    id              SERIAL PRIMARY KEY,
    name            TEXT NOT NULL,
    started_at      BIGINT NOT NULL,
    finished_at     BIGINT,
    ok              INTEGER NOT NULL DEFAULT 0,
    processed_count INTEGER NOT NULL DEFAULT 0,
    error_count     INTEGER NOT NULL DEFAULT 0,
    error_message   TEXT
);

CREATE TABLE IF NOT EXISTS d1_migrations (
    id         SERIAL PRIMARY KEY,
    name       TEXT UNIQUE,
    applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS service_logs (
    id              SERIAL PRIMARY KEY,
    level           TEXT NOT NULL,
    source          TEXT NOT NULL,
    message         TEXT NOT NULL,
    context         TEXT,
    user_id         TEXT,
    created_at      BIGINT NOT NULL
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_subs_user ON subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subs_expires ON subscriptions(expires_at);
CREATE INDEX IF NOT EXISTS idx_pt_playlist ON playlist_tracks(playlist_id, position);
CREATE INDEX IF NOT EXISTS idx_ovr_user ON track_overrides(user_id);
CREATE INDEX IF NOT EXISTS idx_sess_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_dl_user_date ON daily_listens(user_id, date);
CREATE INDEX IF NOT EXISTS idx_auth_nonces_expires_at ON auth_nonces(expires_at);
CREATE INDEX IF NOT EXISTS idx_tidal_device_codes_expires_at ON tidal_device_codes(expires_at);
CREATE INDEX IF NOT EXISTS idx_playlists_user_pinned ON playlists(user_id, pinned_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_playlists_share_token ON playlists(share_token) WHERE share_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_user_tracks_user ON user_tracks(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_library_items_user_type ON library_items(user_id, type, added_at DESC);
CREATE INDEX IF NOT EXISTS idx_play_history_user_played ON play_history(user_id, played_at DESC);
CREATE INDEX IF NOT EXISTS idx_play_history_user_artist ON play_history(user_id, artist_id);
CREATE INDEX IF NOT EXISTS idx_user_dislikes_user ON user_dislikes(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_daily_playlists_user_date ON daily_playlists(user_id, date);
CREATE INDEX IF NOT EXISTS idx_recommendation_seen_user ON recommendation_seen(user_id, last_seen_at);
CREATE INDEX IF NOT EXISTS idx_listening_rooms_code ON listening_rooms(code);
CREATE INDEX IF NOT EXISTS idx_listening_room_messages_room ON listening_room_messages(room_id, id);
CREATE INDEX IF NOT EXISTS idx_signup_log_user ON signup_log(user_id);
CREATE INDEX IF NOT EXISTS idx_cron_runs_name ON cron_runs(name, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_service_logs_source ON service_logs(source, created_at DESC);
