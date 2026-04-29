-- Follow-ups to migration 0011_recommendations.sql:
--
--   1. `daily_playlists.saved_to_playlist_id` — when a user promotes a
--      daily playlist into their library, we record the resulting
--      playlists.id here. The home-page card uses this to render a
--      persistent "Сохранено" state across reloads (the previous version
--      kept it only in component state and forgot on refresh).
--
--   2. `user_taste_profile.seed_artist_ids` — cold-start onboarding now
--      asks for ARTIST seeds instead of (or in addition to) genre seeds.
--      Stored as a JSON array of Tidal artist IDs. The legacy
--      `genre_seeds` column stays for backwards compatibility and as a
--      last-resort fallback when seed_artist_ids is empty too.

ALTER TABLE daily_playlists ADD COLUMN saved_to_playlist_id TEXT;

ALTER TABLE user_taste_profile ADD COLUMN seed_artist_ids TEXT NOT NULL DEFAULT '[]';
