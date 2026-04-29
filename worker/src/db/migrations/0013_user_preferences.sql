-- User-scoped UI / playback preferences. Used to roam settings
-- between devices: crossfade on/off + duration, infinite playback,
-- requested Tidal stream quality, and the equalizer band gains.
--
-- Stored as a single JSON blob rather than a column-per-flag so we
-- can add new preferences without a schema migration each time.
-- Worker validates the shape before writing, so nothing arbitrary
-- ends up in the column even though the storage is loose.

CREATE TABLE user_preferences (
    user_id    TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    prefs      TEXT NOT NULL DEFAULT '{}',
    updated_at INTEGER NOT NULL
);
