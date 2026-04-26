CREATE TABLE users (
    id          TEXT PRIMARY KEY,
    tg_username TEXT,
    tg_name     TEXT,
    is_admin    INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
);

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
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
);

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
