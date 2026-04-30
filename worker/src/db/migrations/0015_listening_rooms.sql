-- Shared listening rooms (PR #214).
--
-- Three tables:
--   listening_rooms        — room metadata, owner, short join code, lifecycle.
--   listening_room_state   — single-row-per-room playback snapshot the
--                            polling clients reconcile against. We keep a
--                            monotonic `version` so the frontend can
--                            cheaply skip no-op updates and a tracked
--                            `controller_id` so the UI can attribute the
--                            last action ("Маша поставила на паузу").
--                            The track is stored as a JSON snapshot
--                            (`track_json`) instead of a foreign key
--                            because the room can play either Tidal
--                            tracks (string id), uploads or arbitrary
--                            user-supplied overrides — the snapshot
--                            mirrors what the player store keeps client-
--                            side and lets us replay a room state without
--                            re-resolving via Tidal.
--   listening_room_members — membership + per-member liveness heartbeat
--                            so the UI can render only "currently
--                            connected" listeners and the host has a way
--                            to evict abandoned members.

CREATE TABLE listening_rooms (
    id              TEXT PRIMARY KEY,
    code            TEXT NOT NULL UNIQUE,
    host_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name            TEXT NOT NULL DEFAULT 'Комната',
    status          TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','closed')),
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL,
    last_activity_at INTEGER NOT NULL
);
CREATE INDEX idx_listening_rooms_host ON listening_rooms(host_id, status);
CREATE INDEX idx_listening_rooms_activity ON listening_rooms(status, last_activity_at);

CREATE TABLE listening_room_state (
    room_id          TEXT PRIMARY KEY REFERENCES listening_rooms(id) ON DELETE CASCADE,
    track_json       TEXT,
    track_id         TEXT,
    track_source     TEXT,
    -- Server epoch (ms) anchoring a "playing" state. While `is_paused = 0`
    -- the client position is `Date.now() - started_at_ms + position_ms`.
    -- While `is_paused = 1` the position is frozen at `position_ms`.
    started_at_ms    INTEGER NOT NULL DEFAULT 0,
    position_ms      INTEGER NOT NULL DEFAULT 0,
    is_paused        INTEGER NOT NULL DEFAULT 1,
    controller_id    TEXT,
    version          INTEGER NOT NULL DEFAULT 0,
    updated_at_ms    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE listening_room_members (
    room_id      TEXT NOT NULL REFERENCES listening_rooms(id) ON DELETE CASCADE,
    user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role         TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('host','member')),
    joined_at    INTEGER NOT NULL,
    last_seen_ms INTEGER NOT NULL,
    PRIMARY KEY (room_id, user_id)
);
CREATE INDEX idx_listening_room_members_user ON listening_room_members(user_id);
CREATE INDEX idx_listening_room_members_seen ON listening_room_members(room_id, last_seen_ms);
