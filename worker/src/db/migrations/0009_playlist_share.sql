-- Public-share + linked-playlist plumbing.
--
-- `is_public` is the owner's "publish" toggle; toggling it on lazily
-- generates a `share_token` so the owner gets a stable, opaque URL
-- distinct from the playlist id (so we can revoke a leaked token by
-- regenerating it without breaking the playlist itself).
--
-- `source_*` columns carry the "saved reference" semantics: when one
-- user saves another user's public playlist (or a Tidal editorial
-- playlist) into their library, we insert a *new* playlists row owned
-- by them, with `source_kind` set and `source_playlist_id` pointing at
-- the original. Reading such a row resolves tracks from the source on
-- demand (Tidal API or the original `playlist_tracks`), so changes to
-- the original automatically propagate. The user can pin/unpin or
-- delete this row from their library — but cannot rename / reorder /
-- mutate tracks (enforced both server-side and in the UI).
ALTER TABLE playlists ADD COLUMN is_public INTEGER NOT NULL DEFAULT 0;
ALTER TABLE playlists ADD COLUMN share_token TEXT;

ALTER TABLE playlists ADD COLUMN source_kind TEXT; -- NULL | 'user' | 'tidal'
ALTER TABLE playlists ADD COLUMN source_playlist_id TEXT;
ALTER TABLE playlists ADD COLUMN source_user_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_playlists_share_token
  ON playlists(share_token) WHERE share_token IS NOT NULL;
