-- Add the per-room "только хост ставит треки" toggle.
--
-- When `host_only_control` is 1 the worker rejects `kind:'track'`
-- control messages from non-host members (`/rooms/:id/control` 403)
-- and the frontend hides the search picker for everyone but the host.
-- Play/pause/seek stay available to whoever is currently controlling
-- the room — locking those down would defeat the listening-together
-- premise.
ALTER TABLE listening_rooms
ADD COLUMN host_only_control INTEGER NOT NULL DEFAULT 0;
