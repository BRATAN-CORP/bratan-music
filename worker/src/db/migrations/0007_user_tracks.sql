-- User-uploaded tracks. These live alongside Tidal tracks but their "source"
-- is "upload" and IDs are UUIDs. The frontend addresses them as
-- "upload:<uuid>" in playlists / queue / liked, so the same playlist_tracks
-- table works without schema changes.
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
