-- Email-first users need a way to link a Telegram identity post-signup
-- without changing their primary key (the FKs across `playlists`,
-- `playlist_tracks`, `daily_listens`, etc. all reference `users.id`,
-- so renaming the row would cascade everywhere).
--
-- Two changes:
--
--   1. `users.tg_id` — nullable, unique-when-set. Stores the numeric
--      Telegram user id as a string. For tg-first users (rows that
--      pre-date the email path) the column is back-filled to equal
--      `users.id` so the new "look up user by tg_id" path returns the
--      same row the legacy "look up by id" path did. Email-first
--      users start with NULL and flip to the bound numeric id once
--      they go through the link flow.
--
--   2. `tg_link_requests` — short-lived bot-mediated nonce table for
--      the "I'm an email-only user, attach my Telegram" flow. The
--      shape mirrors `auth_nonces` but stores `requester_id` (the
--      authenticated email-user's id) and the bot fills in `tg_id` /
--      `tg_username` / `tg_name` after it sees the deeplink. The
--      verify endpoint reads-and-deletes the row, so each nonce is
--      strictly one-shot. Expired rows are gc'd by the cron sweep.
ALTER TABLE users ADD COLUMN tg_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_tg_id_unique ON users(tg_id);

-- Backfill: every legacy tg-first row used the numeric Telegram id as
-- its primary key. Mirror that into `tg_id` so the new lookup path
-- (try `WHERE tg_id = ?` first) keeps resolving them. Email-first
-- rows have id like 'email_<hex>' and are excluded by the LIKE filter.
UPDATE users SET tg_id = id WHERE tg_id IS NULL AND id NOT LIKE 'email\_%' ESCAPE '\';

CREATE TABLE IF NOT EXISTS tg_link_requests (
    nonce        TEXT PRIMARY KEY,
    requester_id TEXT NOT NULL,
    tg_id        TEXT,
    tg_username  TEXT,
    tg_name      TEXT,
    expires_at   INTEGER NOT NULL,
    created_at   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tg_link_requests_expires_at ON tg_link_requests(expires_at);
