-- Liked albums and artists stored in a generic library_items table.
-- type: 'album' | 'artist'
CREATE TABLE IF NOT EXISTS library_items (
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    item_id     TEXT NOT NULL,
    type        TEXT NOT NULL CHECK(type IN ('album','artist')),
    snapshot    TEXT,
    added_at    INTEGER NOT NULL,
    PRIMARY KEY (user_id, item_id, type)
);
CREATE INDEX IF NOT EXISTS idx_library_items_user_type ON library_items(user_id, type, added_at DESC);
