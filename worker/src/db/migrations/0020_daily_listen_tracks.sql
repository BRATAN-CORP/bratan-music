-- Per-(user, day, track) dedup table for the free-listen quota.
--
-- Background:
--   The previous quota implementation incremented `daily_listens.count`
--   on every `/tracks/:id/stream` request. That was wrong on two
--   axes:
--     1) The frontend's quality fallback ladder retries the same
--        track at lower qualities on load failure (HI_RES_LOSSLESS
--        → LOSSLESS → HIGH → LOW), and each retry hits the worker
--        endpoint independently — so one user-perceived play could
--        cost 2-4 increments. Reports of "лимит 3, а отдаёт 2 трека"
--        all trace back to this.
--     2) Replaying a track the user already played today (refresh
--        the page, hit play again on a track they've heard once)
--        also incremented the counter. The free quota's product
--        intent is "3 unique tracks/day", not "3 stream-URL
--        resolutions/day".
--
--   Both behaviors are fixed by deduping at the (user, date, track)
--   level: a track only ever consumes one slot from the daily quota
--   no matter how many times it's resolved or how many qualities
--   the fallback ladder tries.
--
--   `daily_listens` is kept around for historical data — we just
--   stop using its `count` column for the quota check (the new
--   COUNT(*) query against this table is the source of truth).
CREATE TABLE IF NOT EXISTS daily_listen_tracks (
    user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    date     TEXT NOT NULL,
    track_id TEXT NOT NULL,
    PRIMARY KEY (user_id, date, track_id)
);

-- Cover the (user, date) lookup the quota check runs on every stream
-- request. Without it, COUNT(*) would scan every row owned by the
-- user across all days.
CREATE INDEX IF NOT EXISTS idx_dlt_user_date
  ON daily_listen_tracks(user_id, date);
