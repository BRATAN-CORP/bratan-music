-- Stores a snapshot of track metadata (title/artist/coverUrl/duration) at the
-- moment it's added to a playlist or liked. Lets us render lists without
-- re-fetching from upstream services for every track.
ALTER TABLE playlist_tracks ADD COLUMN snapshot TEXT;
