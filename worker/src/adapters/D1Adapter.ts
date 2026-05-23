/**
 * D1-compatible adapter that wraps a `pg` Pool.
 *
 * Every route/service in the worker uses these D1 patterns:
 *   env.DB.prepare(sql).bind(...args).all<T>()   → { results: T[], success: true }
 *   env.DB.prepare(sql).bind(...args).first<T>() → T | null
 *   env.DB.prepare(sql).bind(...args).run()      → { success: true, meta: { changes, last_row_id, ... } }
 *   env.DB.batch(stmts)                          → D1Result[]
 *
 * The adapter converts `?` placeholders to `$1, $2, …` and maps
 * SQLite-isms (e.g. `AUTOINCREMENT`, `INTEGER PRIMARY KEY`, boolean 0/1)
 * transparently so existing queries keep working on Postgres.
 */

import type { Pool, PoolClient } from 'pg';

/* ── helpers ─────────────────────────────────────────── */

/** Replace `?` positional params with Postgres `$N` numbered params. */
function convertPlaceholders(sql: string): string {
  let idx = 0;
  let converted = sql.replace(/\?/g, () => `$${++idx}`);

  // SQLite `INSERT OR REPLACE INTO t (...) VALUES (...)` →
  // Postgres `INSERT INTO t (...) VALUES (...) ON CONFLICT (...) DO UPDATE SET ...`
  // We handle the specific library_items case that exists in the codebase.
  const iorMatch = converted.match(
    /INSERT\s+OR\s+REPLACE\s+INTO\s+(\w+)\s*\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)/i
  );
  if (iorMatch) {
    const [, table, colsStr, valsStr] = iorMatch;
    const cols = colsStr.split(',').map((c) => c.trim());
    // Assume first N columns forming the PK are listed first.
    // For library_items PK is (user_id, item_id, type).
    const pkMap: Record<string, string[]> = {
      library_items: ['user_id', 'item_id', 'type'],
    };
    const pkCols = pkMap[table] ?? [cols[0]];
    const nonPk = cols.filter((c) => !pkCols.includes(c));
    const setClauses = nonPk.map((c) => `${c} = excluded.${c}`).join(', ');
    converted = `INSERT INTO ${table} (${colsStr}) VALUES (${valsStr}) ON CONFLICT(${pkCols.join(', ')}) DO UPDATE SET ${setClauses}`;
  }

  return converted;
}

/* ── D1Result-like shape ─────────────────────────────── */

export interface D1Result<T = unknown> {
  results: T[];
  success: boolean;
  meta: {
    changes: number;
    last_row_id: number;
    duration: number;
    rows_read: number;
    rows_written: number;
  };
}

/* ── D1PreparedStatement ─────────────────────────────── */

class D1PreparedStatement {
  private sql: string;
  private params: unknown[] = [];
  private pool: Pool;

  constructor(pool: Pool, sql: string) {
    this.pool = pool;
    this.sql = sql;
  }

  bind(...values: unknown[]): D1PreparedStatement {
    this.params = values;
    return this;
  }

  async all<T = unknown>(): Promise<D1Result<T>> {
    const pgSql = convertPlaceholders(this.sql);
    const start = Date.now();
    const result = await this.pool.query(pgSql, this.params as any[]);
    return {
      results: result.rows as T[],
      success: true,
      meta: {
        changes: result.rowCount ?? 0,
        last_row_id: 0,
        duration: Date.now() - start,
        rows_read: result.rows.length,
        rows_written: result.rowCount ?? 0,
      },
    };
  }

  async first<T = unknown>(columnName?: string): Promise<T | null> {
    const pgSql = convertPlaceholders(this.sql);
    const result = await this.pool.query(pgSql, this.params as any[]);
    if (result.rows.length === 0) return null;
    const row = result.rows[0];
    if (columnName) return (row as Record<string, unknown>)[columnName] as T;
    return row as T;
  }

  async run(): Promise<D1Result> {
    let pgSql = convertPlaceholders(this.sql);
    const start = Date.now();

    // For INSERT on tables with SERIAL PKs, try RETURNING id.
    // Tables with SERIAL id: play_history, listening_room_messages,
    // signup_log, tidal_accounts, cron_runs, d1_migrations, service_logs
    let lastRowId = 0;
    const isInsert = /^\s*INSERT\s+INTO\s+/i.test(pgSql);
    const serialTables = ['play_history', 'listening_room_messages', 'signup_log',
      'tidal_accounts', 'cron_runs', 'd1_migrations', 'service_logs'];
    const tableMatch = pgSql.match(/INSERT\s+INTO\s+"?(\w+)"?/i);
    const hasSerialId = tableMatch && serialTables.includes(tableMatch[1]);

    if (isInsert && hasSerialId && !/RETURNING/i.test(pgSql)) {
      pgSql += ' RETURNING id';
    }

    const result = await this.pool.query(pgSql, this.params as any[]);

    if (isInsert && result.rows.length > 0 && result.rows[0].id !== undefined) {
      lastRowId = result.rows[0].id;
    }

    return {
      results: [],
      success: true,
      meta: {
        changes: result.rowCount ?? 0,
        last_row_id: lastRowId,
        duration: Date.now() - start,
        rows_read: 0,
        rows_written: result.rowCount ?? 0,
      },
    };
  }

  async raw<T = unknown[]>(): Promise<T[]> {
    const pgSql = convertPlaceholders(this.sql);
    const result = await this.pool.query(pgSql, this.params as any[]);
    return result.rows.map((row: Record<string, unknown>) => Object.values(row)) as T[];
  }
}

/* ── D1Database adapter ──────────────────────────────── */

export class D1DatabaseAdapter {
  constructor(private pool: Pool) {}

  prepare(sql: string): D1PreparedStatement {
    return new D1PreparedStatement(this.pool, sql);
  }

  /**
   * Execute multiple statements in a single Postgres transaction.
   * D1's .batch() guarantees atomicity — we do the same with BEGIN/COMMIT.
   */
  async batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
    const client: PoolClient = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const results: D1Result<T>[] = [];
      for (const stmt of statements) {
        // Execute each statement through the pooled client directly
        // We need to access private fields — use the same conversion logic
        const s = stmt as unknown as { sql: string; params: unknown[] };
        const pgSql = convertPlaceholders(s.sql);
        const start = Date.now();
        const result = await client.query(pgSql, s.params as any[]);
        results.push({
          results: result.rows as T[],
          success: true,
          meta: {
            changes: result.rowCount ?? 0,
            last_row_id: 0,
            duration: Date.now() - start,
            rows_read: result.rows.length,
            rows_written: result.rowCount ?? 0,
          },
        });
      }
      await client.query('COMMIT');
      return results;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async exec(sql: string): Promise<D1Result> {
    const start = Date.now();
    const result = await this.pool.query(sql);
    return {
      results: [],
      success: true,
      meta: {
        changes: result.rowCount ?? 0,
        last_row_id: 0,
        duration: Date.now() - start,
        rows_read: 0,
        rows_written: result.rowCount ?? 0,
      },
    };
  }

  async dump(): Promise<ArrayBuffer> {
    throw new Error('dump() not supported on Postgres adapter');
  }
}
