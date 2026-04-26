-- Playlist cover image stored as a data URL (data:image/jpeg;base64,...).
-- We keep it inline in the row to avoid signing R2 URLs for <img> tags.
-- The frontend resizes covers client-side before upload (target ~512x512,
-- JPEG q70) so the column stays small (typically 30–100 KB per row).
ALTER TABLE playlists ADD COLUMN cover_url TEXT;
