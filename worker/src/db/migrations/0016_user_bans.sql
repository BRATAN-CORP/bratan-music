-- Admin user grid (PR #215).
--
-- Adds a soft-ban surface on `users`. We keep the row (FK targets in
-- play_history, library_items etc. would explode otherwise) and just
-- mark the user blocked. `jwtAuth` rejects sessions whose user is
-- banned so the ban takes effect on the very next request without
-- waiting for the access token to rotate.

ALTER TABLE users ADD COLUMN is_banned     INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN banned_at     INTEGER;
ALTER TABLE users ADD COLUMN banned_by     TEXT;
ALTER TABLE users ADD COLUMN banned_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_users_is_banned ON users(is_banned);
