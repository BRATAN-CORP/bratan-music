-- Pinned playlists: NULL = not pinned. Non-null timestamp lets us order by
-- "most recently pinned" in the sidebar without an extra column. Indexed
-- because the sidebar query filters by user_id + pinned_at IS NOT NULL.
ALTER TABLE playlists ADD COLUMN pinned_at INTEGER;
CREATE INDEX IF NOT EXISTS idx_playlists_user_pinned ON playlists(user_id, pinned_at);
