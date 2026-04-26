-- Per-user playlist cover images. Stored in the same R2 bucket as track
-- overrides (binding TRACKS) under the prefix `playlist-covers/`.
ALTER TABLE playlists ADD COLUMN cover_r2_key TEXT;
ALTER TABLE playlists ADD COLUMN cover_updated_at INTEGER;
