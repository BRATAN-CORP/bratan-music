-- Health monitoring + service log infrastructure for the admin console.
--
-- `cron_runs` tracks every invocation of runScheduledJobs() so the admin
-- can answer "did the cron run today?" at a glance without grepping CF
-- logs. We keep at most ~30 rows per cron name (the GC happens in cron
-- itself) which is enough to show recent reliability.
--
-- `service_logs` is a bounded ring of structured error records used by
-- the admin /admin/logs feed. Worker-side helpers write into it on
-- catch so admins can see "user X hit a Tidal 502 at 12:35" without
-- digging through CF dashboards. We keep at most a few thousand rows
-- (cron GCs older entries) so the table stays cheap to scan.
CREATE TABLE IF NOT EXISTS cron_runs (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT NOT NULL,                   -- e.g. "scheduled"
    started_at      INTEGER NOT NULL,                -- unix ms
    finished_at     INTEGER,                         -- unix ms, null if crashed
    ok              INTEGER NOT NULL DEFAULT 0,      -- 1 = clean, 0 = errored
    processed_count INTEGER NOT NULL DEFAULT 0,
    error_count     INTEGER NOT NULL DEFAULT 0,
    error_message   TEXT
);

CREATE INDEX IF NOT EXISTS idx_cron_runs_recent
    ON cron_runs(name, started_at DESC);

CREATE TABLE IF NOT EXISTS service_logs (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    level           TEXT NOT NULL,                   -- "error" | "warn" | "info"
    source          TEXT NOT NULL,                   -- e.g. "tidal.refresh"
    message         TEXT NOT NULL,
    context         TEXT,                            -- optional JSON blob
    user_id         TEXT,                            -- optional, helps cross-link
    created_at      INTEGER NOT NULL                 -- unix ms
);

CREATE INDEX IF NOT EXISTS idx_service_logs_recent
    ON service_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_service_logs_filter
    ON service_logs(level, source, created_at DESC);
