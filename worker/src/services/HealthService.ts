import type { Env } from '../types/env';

/**
 * Health + service-log facade for the admin console.
 *
 * `logError` is the single entry point for the rest of the worker —
 * call it from a catch-handler with a stable `source` slug and a short
 * human message. The helper is best-effort and never throws, so a D1
 * outage during error reporting can't cascade. CF console logs still
 * receive the original error via `console.error` so we don't lose
 * fidelity.
 *
 * `getOverview` is the admin "health page" data fetch — it bundles
 * pool stats, D1 write probe, R2 reachability, and the most recent
 * cron run into a single payload so the UI renders without round
 * trips.
 */

export interface HealthOverview {
  generatedAt: number;
  tidal: {
    accountsTotal: number;
    accountsEnabled: number;
    accountsWithErrors: number;
    accountsExpired: number;
    /** Most-recent successful checkout (max(last_used_at) across enabled rows). */
    lastSuccessAt: number | null;
  };
  db: {
    ok: boolean;
    writeMs: number | null;
    error: string | null;
  };
  r2: {
    ok: boolean;
    sampledObjects: number | null;
    sampledBytes: number | null;
    truncated: boolean;
    error: string | null;
  };
  cron: {
    lastRunStartedAt: number | null;
    lastRunFinishedAt: number | null;
    lastRunOk: boolean | null;
    lastRunErrorCount: number;
    lastRunProcessedCount: number;
    lastRunErrorMessage: string | null;
    /** True if there's been a successful run within the last 24h. */
    ranToday: boolean;
  };
  recentErrors: number;
}

export interface ServiceLogRow {
  id: number;
  level: string;
  source: string;
  message: string;
  context: string | null;
  userId: string | null;
  createdAt: number;
}

interface CronRunRow {
  id: number;
  name: string;
  started_at: number;
  finished_at: number | null;
  ok: number;
  processed_count: number;
  error_count: number;
  error_message: string | null;
}

const LOG_RING_MAX = 5000;

export class HealthService {
  constructor(private env: Env) {}

  /**
   * Persist a structured error/warn/info row. Best-effort — failures are
   * swallowed and forwarded to console.error so the original error stays
   * visible in CF logs even if D1 is down.
   */
  async log(
    level: 'error' | 'warn' | 'info',
    source: string,
    message: string,
    opts?: { context?: unknown; userId?: string }
  ): Promise<void> {
    try {
      const ctx = opts?.context !== undefined
        ? JSON.stringify(opts.context).slice(0, 4000)
        : null;
      await this.env.DB
        .prepare(
          `INSERT INTO service_logs (level, source, message, context, user_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .bind(
          level,
          source.slice(0, 80),
          message.slice(0, 1000),
          ctx,
          opts?.userId ?? null,
          Date.now(),
        )
        .run();
    } catch (err) {
      console.error('[HealthService.log] failed:', err instanceof Error ? err.message : err);
    }
  }

  async listLogs(opts: {
    level?: string;
    source?: string;
    limit?: number;
    offset?: number;
  } = {}): Promise<ServiceLogRow[]> {
    const limit = Math.min(200, Math.max(1, opts.limit ?? 100));
    const offset = Math.max(0, opts.offset ?? 0);
    const where: string[] = [];
    const binds: unknown[] = [];
    if (opts.level) { where.push('level = ?'); binds.push(opts.level); }
    if (opts.source) { where.push('source = ?'); binds.push(opts.source); }
    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const rs = await this.env.DB
      .prepare(
        `SELECT id, level, source, message, context, user_id, created_at
         FROM service_logs ${whereSql}
         ORDER BY created_at DESC
         LIMIT ? OFFSET ?`
      )
      .bind(...binds, limit, offset)
      .all<{
        id: number; level: string; source: string; message: string;
        context: string | null; user_id: string | null; created_at: number;
      }>()
      .catch(() => null);
    if (!rs) return [];
    return (rs.results ?? []).map((r) => ({
      id: r.id,
      level: r.level,
      source: r.source,
      message: r.message,
      context: r.context,
      userId: r.user_id,
      createdAt: r.created_at,
    }));
  }

  /** Distinct source slugs for the log filter dropdown. */
  async listSources(): Promise<string[]> {
    const rs = await this.env.DB
      .prepare('SELECT DISTINCT source FROM service_logs ORDER BY source ASC LIMIT 50')
      .all<{ source: string }>()
      .catch(() => null);
    return (rs?.results ?? []).map((r) => r.source);
  }

  /** Wipe rows older than `cutoffMs` so the table stays bounded. */
  async gc(cutoffMs: number): Promise<void> {
    await this.env.DB
      .prepare(`DELETE FROM service_logs WHERE created_at < ?`)
      .bind(cutoffMs)
      .run()
      .catch(() => null);
    // Cap absolute row count too, in case error storms blow past the
    // time-based cutoff. Delete the oldest rows down to LOG_RING_MAX.
    await this.env.DB
      .prepare(
        `DELETE FROM service_logs
         WHERE id IN (
           SELECT id FROM service_logs ORDER BY created_at DESC LIMIT -1 OFFSET ?
         )`
      )
      .bind(LOG_RING_MAX)
      .run()
      .catch(() => null);
  }

  async recordCronStart(name: string): Promise<number | null> {
    const r = await this.env.DB
      .prepare(`INSERT INTO cron_runs (name, started_at) VALUES (?, ?)`)
      .bind(name, Date.now())
      .run()
      .catch(() => null);
    if (!r) return null;
    // D1 .meta.last_row_id gives us the AUTOINCREMENT id.
    return (r.meta?.last_row_id as number | undefined) ?? null;
  }

  async recordCronFinish(id: number, ok: boolean, processedCount: number, errorCount: number, errorMessage?: string): Promise<void> {
    await this.env.DB
      .prepare(
        `UPDATE cron_runs SET
           finished_at = ?, ok = ?, processed_count = ?, error_count = ?, error_message = ?
         WHERE id = ?`
      )
      .bind(
        Date.now(),
        ok ? 1 : 0,
        processedCount,
        errorCount,
        errorMessage?.slice(0, 1000) ?? null,
        id,
      )
      .run()
      .catch(() => null);
  }

  /** Bundled overview for the admin health page. */
  async getOverview(): Promise<HealthOverview> {
    const generatedAt = Date.now();
    const [tidal, db, r2, cron, recentErrors] = await Promise.all([
      this.tidalSummary(),
      this.dbProbe(),
      this.r2Probe(),
      this.cronSummary(),
      this.recentErrorCount(),
    ]);
    return { generatedAt, tidal, db, r2, cron, recentErrors };
  }

  private async tidalSummary(): Promise<HealthOverview['tidal']> {
    const now = Math.floor(Date.now() / 1000);
    const row = await this.env.DB
      .prepare(
        `SELECT
           COUNT(*) AS total,
           SUM(CASE WHEN enabled = 1 THEN 1 ELSE 0 END) AS enabled_count,
           SUM(CASE WHEN consecutive_errors > 0 THEN 1 ELSE 0 END) AS errored,
           SUM(CASE WHEN expires_at < ? THEN 1 ELSE 0 END) AS expired,
           MAX(CASE WHEN enabled = 1 THEN last_used_at ELSE 0 END) AS last_success
         FROM tidal_accounts`
      )
      .bind(now)
      .first<{ total: number; enabled_count: number; errored: number; expired: number; last_success: number }>()
      .catch(() => null);
    if (!row) {
      return {
        accountsTotal: 0, accountsEnabled: 0, accountsWithErrors: 0,
        accountsExpired: 0, lastSuccessAt: null,
      };
    }
    return {
      accountsTotal: row.total ?? 0,
      accountsEnabled: row.enabled_count ?? 0,
      accountsWithErrors: row.errored ?? 0,
      accountsExpired: row.expired ?? 0,
      lastSuccessAt: row.last_success && row.last_success > 0 ? row.last_success : null,
    };
  }

  private async dbProbe(): Promise<HealthOverview['db']> {
    // Cheap write probe: insert + delete a sentinel row in service_logs.
    // We use service_logs because it's already write-bounded and has a
    // dedicated index, so the probe doesn't touch any user-facing
    // table. SUCCESS proves D1 routing + writes + indexes are healthy.
    const start = Date.now();
    try {
      const insert = await this.env.DB
        .prepare(
          `INSERT INTO service_logs (level, source, message, created_at)
           VALUES ('info', 'health.probe', 'ping', ?)`
        )
        .bind(Date.now())
        .run();
      const probeId = insert.meta?.last_row_id as number | undefined;
      if (probeId) {
        await this.env.DB
          .prepare('DELETE FROM service_logs WHERE id = ?')
          .bind(probeId)
          .run()
          .catch(() => null);
      }
      return { ok: true, writeMs: Date.now() - start, error: null };
    } catch (err) {
      return {
        ok: false,
        writeMs: null,
        error: err instanceof Error ? err.message.slice(0, 200) : 'D1 probe failed',
      };
    }
  }

  private async r2Probe(): Promise<HealthOverview['r2']> {
    // Cheap reachability probe: list up to 1000 keys and aggregate
    // their sizes. CF R2's `list` returns size per object so we don't
    // need to HEAD each one. We don't paginate the full bucket — that
    // would be expensive and "is R2 alive" is the actual question.
    try {
      const result = await this.env.TRACKS.list({ limit: 1000 });
      let bytes = 0;
      for (const obj of result.objects) bytes += obj.size;
      return {
        ok: true,
        sampledObjects: result.objects.length,
        sampledBytes: bytes,
        truncated: result.truncated,
        error: null,
      };
    } catch (err) {
      return {
        ok: false,
        sampledObjects: null,
        sampledBytes: null,
        truncated: false,
        error: err instanceof Error ? err.message.slice(0, 200) : 'R2 probe failed',
      };
    }
  }

  private async cronSummary(): Promise<HealthOverview['cron']> {
    const row = await this.env.DB
      .prepare(
        `SELECT id, name, started_at, finished_at, ok,
                processed_count, error_count, error_message
         FROM cron_runs
         WHERE name = 'scheduled'
         ORDER BY started_at DESC
         LIMIT 1`
      )
      .first<CronRunRow>()
      .catch(() => null);
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
    if (!row) {
      return {
        lastRunStartedAt: null,
        lastRunFinishedAt: null,
        lastRunOk: null,
        lastRunErrorCount: 0,
        lastRunProcessedCount: 0,
        lastRunErrorMessage: null,
        ranToday: false,
      };
    }
    return {
      lastRunStartedAt: row.started_at,
      lastRunFinishedAt: row.finished_at,
      lastRunOk: row.ok === 1,
      lastRunErrorCount: row.error_count,
      lastRunProcessedCount: row.processed_count,
      lastRunErrorMessage: row.error_message,
      ranToday: row.started_at >= oneDayAgo && row.finished_at !== null && row.ok === 1,
    };
  }

  private async recentErrorCount(): Promise<number> {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const row = await this.env.DB
      .prepare(
        `SELECT COUNT(*) AS c FROM service_logs
         WHERE level = 'error' AND created_at >= ?`
      )
      .bind(cutoff)
      .first<{ c: number }>()
      .catch(() => null);
    return row?.c ?? 0;
  }
}

/**
 * Convenience wrapper used by routes that want to record an error
 * without needing to construct a HealthService instance themselves.
 * Best-effort — the original error is also forwarded to console.error
 * so CF logs always have the truth.
 */
export async function logServiceError(
  env: Env,
  source: string,
  err: unknown,
  opts?: { userId?: string; context?: unknown }
): Promise<void> {
  const message = err instanceof Error ? err.message : typeof err === 'string' ? err : 'unknown error';
  console.error(`[${source}]`, message, opts?.context);
  await new HealthService(env).log('error', source, message, opts);
}
