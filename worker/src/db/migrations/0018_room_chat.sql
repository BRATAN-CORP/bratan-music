-- Per-room chat (spec quote: "также нужно сделать чат в этой руме").
--
-- Polling-based, like the room state itself. The frontend hits
-- GET /rooms/:id/chat?since=<id> on a 2.5s interval and only renders
-- new rows. We keep things narrow: no edit/delete, no reactions,
-- no attachments. The room is ephemeral — when it gets GC'd by
-- RoomService.gc() the FK cascade wipes its history with it.

CREATE TABLE listening_room_messages (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id     TEXT NOT NULL REFERENCES listening_rooms(id) ON DELETE CASCADE,
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body        TEXT NOT NULL,
    created_at_ms INTEGER NOT NULL
);

-- Most reads are "everything new since X for this room", so an index
-- on (room_id, id) gives us a covered range scan for the polling
-- endpoint. id is monotonic (AUTOINCREMENT) so we can use it as the
-- cursor without needing a separate sequence column.
CREATE INDEX idx_listening_room_messages_poll
    ON listening_room_messages(room_id, id);
