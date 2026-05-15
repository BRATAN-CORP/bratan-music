-- Session management surface for the new "Профиль → Сессии" tab.
--
-- The session table existed before (id, user_id, token_hash,
-- expires_at, created_at) but had no per-row metadata, which made it
-- impossible to render a useful "your active sessions" list. Same row
-- count, same FK to users — we just enrich each row with:
--
--   * `last_used_at`     — bumped by AuthService.verifyRefreshToken
--                          on every successful refresh; used to sort
--                          the "Сессии" list newest-first AND to
--                          surface stale sessions to the user.
--   * `user_agent`       — raw UA header at signin time. Server-side
--                          parser turns it into the human-readable
--                          `client_label` below. We persist the raw
--                          string too so we can re-parse later if we
--                          improve the heuristic without forcing a
--                          re-login.
--   * `ip_hash`          — SHA-256 of the signin IP. Hashed (not the
--                          raw IP) for the same reason we hash refresh
--                          tokens — minimise the blast radius of a DB
--                          leak. We don't surface this anywhere user-
--                          facing yet but it'll let us flag obviously-
--                          suspicious sessions (sudden country jump)
--                          in a follow-up.
--   * `client_label`     — best-effort parsed display name, e.g.
--                          "Telegram WebApp · iOS", "Chrome · Mac",
--                          "Safari · iPhone". The Сессии UI shows
--                          this column verbatim.
--
-- All four columns default to '' / 0 so the migration is safe to
-- apply on a populated table — existing rows pick up the defaults
-- and the next login refreshes them with real metadata. We rely on
-- the auth path to start writing the new columns on the next deploy.
ALTER TABLE sessions ADD COLUMN last_used_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN user_agent   TEXT    NOT NULL DEFAULT '';
ALTER TABLE sessions ADD COLUMN ip_hash      TEXT    NOT NULL DEFAULT '';
ALTER TABLE sessions ADD COLUMN client_label TEXT    NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_sessions_user_last_used
  ON sessions(user_id, last_used_at DESC);

-- `users.min_token_iat` — global revocation epoch (in seconds, same
-- units as the `iat` claim inside JWT). Any access token whose `iat`
-- is older than this value is rejected by the jwtAuth middleware.
-- Two reasons this column exists:
--
--   1. The new "Выйти со всех других устройств" button (PR #4 of
--      this batch) needs to invalidate access tokens that haven't
--      expired yet — refreshing the sessions table is enough for
--      refresh tokens but does nothing about access tokens already
--      in flight. We can't track every access token in DB (the whole
--      point of JWT is stateless verification) so we use a per-user
--      "anything issued before this timestamp is forfeit" cutoff.
--
--   2. The one-time global logout the user asked for (in the same
--      message that requested this PR) — running the migration is
--      itself the logout event. The bottom of this file UPDATEs
--      every existing row so on the very next deploy every active
--      session forfeits its access token and has to re-login via
--      Telegram WebApp. Refresh tokens are revoked in the same
--      sweep so the old TokenPair really is dead end-to-end.
ALTER TABLE users ADD COLUMN min_token_iat INTEGER NOT NULL DEFAULT 0;

-- One-off global logout: bump every user's `min_token_iat` to the
-- migration apply time so every existing access token (issued before
-- this point) is rejected on its next use, AND delete every existing
-- refresh-token row so refresh attempts fail too. Combined effect:
-- every Devin / user / admin in the system is fully logged out and
-- has to sign in fresh through the normal Telegram / email flow.
UPDATE users SET min_token_iat = (strftime('%s', 'now')) WHERE 1;
DELETE FROM sessions;
