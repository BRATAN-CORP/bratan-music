import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Activity, AlertCircle, AlertTriangle, CheckCircle2, Database, HardDrive,
  Loader2, RefreshCw, Server, Timer,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { api } from '@/lib/api';

/**
 * Admin health page — one screen, four checkboxes ("Раз в день взглянул —
 * спокойно"). Every section turns green/yellow/red based on a simple
 * threshold so the admin can ack the whole stack at a glance, then drill
 * into the service log feed at the bottom for actual user-visible
 * errors.
 */

interface HealthOverview {
  generatedAt: number;
  tidal: {
    accountsTotal: number;
    accountsEnabled: number;
    accountsWithErrors: number;
    accountsExpired: number;
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
    ranToday: boolean;
  };
  recentErrors: number;
}

interface ServiceLog {
  id: number;
  level: string;
  source: string;
  message: string;
  context: string | null;
  userId: string | null;
  createdAt: number;
}

interface LogsResponse {
  items: ServiceLog[];
  sources: string[];
}

type Severity = 'ok' | 'warn' | 'err' | 'idle';

function formatBytes(n: number | null): string {
  if (n === null) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatRel(unix: number | null, unitFactor = 1000): string {
  if (!unix) return 'никогда';
  const diffMs = Date.now() - unix * unitFactor;
  if (diffMs < 60_000) return 'только что';
  if (diffMs < 3_600_000) return `${Math.floor(diffMs / 60_000)} мин назад`;
  if (diffMs < 86_400_000) return `${Math.floor(diffMs / 3_600_000)} ч назад`;
  return `${Math.floor(diffMs / 86_400_000)} д назад`;
}

function formatDate(unix: number | null, unitFactor = 1000): string {
  if (!unix) return '—';
  return new Date(unix * unitFactor).toLocaleString('ru-RU');
}

const LEVELS: { value: string; label: string }[] = [
  { value: '', label: 'все уровни' },
  { value: 'error', label: 'error' },
  { value: 'warn', label: 'warn' },
  { value: 'info', label: 'info' },
];

export function AdminHealthPanel() {
  const [overview, setOverview] = useState<HealthOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [logs, setLogs] = useState<ServiceLog[]>([]);
  const [logSources, setLogSources] = useState<string[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logLevel, setLogLevel] = useState('error');
  const [logSource, setLogSource] = useState('');

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get<HealthOverview>('/admin/health');
      setOverview(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось загрузить health');
    } finally {
      setLoading(false);
    }
  };

  const loadLogs = useCallback(async () => {
    setLogsLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('limit', '100');
      if (logLevel) params.set('level', logLevel);
      if (logSource) params.set('source', logSource);
      const data = await api.get<LogsResponse>(`/admin/logs?${params.toString()}`);
      setLogs(data.items);
      setLogSources(data.sources);
    } catch {
      // surfaced via the empty state
    } finally {
      setLogsLoading(false);
    }
  }, [logLevel, logSource]);

  useEffect(() => { void load(); }, []);
  useEffect(() => { void loadLogs(); }, [loadLogs]);

  // Auto-refresh the overview every 30s while the page is open. We don't
  // poll the log feed because admins click a level to see fresh entries.
  useEffect(() => {
    const id = setInterval(() => { void load(); }, 30_000);
    return () => clearInterval(id);
  }, []);

  // Compute the four "checkbox" severities. Layered thresholds:
  // - Tidal:   no enabled accounts = red; any errors = yellow
  // - D1:      probe failed = red; >500ms = yellow
  // - R2:      probe failed = red
  // - Cron:    failed last run = red; didn't run today = yellow
  const severities = useMemo(() => {
    if (!overview) return null;
    const tidal: Severity = overview.tidal.accountsTotal === 0
      ? 'idle'
      : overview.tidal.accountsEnabled === 0
        ? 'err'
        : overview.tidal.accountsWithErrors > 0 || overview.tidal.accountsExpired > 0
          ? 'warn'
          : 'ok';
    const db: Severity = !overview.db.ok
      ? 'err'
      : overview.db.writeMs && overview.db.writeMs > 500
        ? 'warn'
        : 'ok';
    const r2: Severity = !overview.r2.ok ? 'err' : 'ok';
    const cron: Severity = overview.cron.lastRunStartedAt === null
      ? 'idle'
      : overview.cron.lastRunOk === false
        ? 'err'
        : !overview.cron.ranToday
          ? 'warn'
          : 'ok';
    return { tidal, db, r2, cron };
  }, [overview]);

  return (
    <section className="rounded-[var(--radius-md)] border border-border bg-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-medium">
            <Activity size={14} className="text-muted-foreground" />
            Health сервиса
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Один экран на все галочки: Tidal-пул жив, D1 пишет, R2 не переполнен, кроны отработали сегодня.
          </p>
        </div>
        <Button variant="ghost" size="icon" onClick={load} aria-label="Обновить" className="h-8 w-8">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </Button>
      </div>

      {error && (
        <p className="mt-3 inline-flex items-center gap-1 text-xs text-[var(--color-danger)]">
          <AlertCircle size={12} /> {error}
        </p>
      )}

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <HealthTile
          icon={Server}
          title="Tidal пул"
          severity={severities?.tidal ?? 'idle'}
          primary={overview ? `${overview.tidal.accountsEnabled}/${overview.tidal.accountsTotal} активны` : '—'}
          rows={overview ? [
            { label: 'с ошибками', value: String(overview.tidal.accountsWithErrors) },
            { label: 'просрочены', value: String(overview.tidal.accountsExpired) },
            { label: 'последний', value: formatRel(overview.tidal.lastSuccessAt) },
          ] : []}
        />
        <HealthTile
          icon={Database}
          title="D1 пишет"
          severity={severities?.db ?? 'idle'}
          primary={overview?.db.ok
            ? `${overview.db.writeMs ?? '?'} мс`
            : 'нет ответа'}
          rows={overview?.db.error ? [{ label: 'ошибка', value: overview.db.error }] : [
            { label: 'probe', value: 'INSERT/DELETE' },
          ]}
        />
        <HealthTile
          icon={HardDrive}
          title="R2 reachable"
          severity={severities?.r2 ?? 'idle'}
          primary={overview?.r2.ok
            ? `${overview.r2.sampledObjects ?? 0} объектов${overview.r2.truncated ? '+' : ''}`
            : 'нет ответа'}
          rows={overview?.r2.ok ? [
            { label: 'размер', value: formatBytes(overview.r2.sampledBytes) },
            { label: 'усечено', value: overview.r2.truncated ? 'да' : 'нет' },
          ] : overview?.r2.error ? [{ label: 'ошибка', value: overview.r2.error }] : []}
        />
        <HealthTile
          icon={Timer}
          title="Кроны"
          severity={severities?.cron ?? 'idle'}
          primary={overview?.cron.lastRunStartedAt
            ? formatRel(overview.cron.lastRunStartedAt, 1)
            : 'не запускался'}
          rows={overview ? [
            { label: 'обработано', value: String(overview.cron.lastRunProcessedCount) },
            { label: 'ошибок', value: String(overview.cron.lastRunErrorCount) },
            { label: 'старт', value: formatDate(overview.cron.lastRunStartedAt, 1) },
          ] : []}
        />
      </div>

      {/* Service logs */}
      <div className="mt-6 rounded-[var(--radius-sm)] border border-border bg-background">
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
          <span className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
            Логи сервиса
          </span>
          {overview && overview.recentErrors > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full border border-[var(--color-danger-muted)] bg-[var(--color-danger-muted)] px-2 py-0.5 text-[10px] text-[var(--color-danger)]">
              <AlertTriangle size={10} />
              {overview.recentErrors} за сутки
            </span>
          )}
          <div className="ml-auto flex items-center gap-2">
            <select
              value={logLevel}
              onChange={(e) => setLogLevel(e.target.value)}
              className="rounded-[var(--radius-sm)] border border-border bg-card px-2 py-1 text-xs outline-none focus:border-[var(--color-accent)]"
            >
              {LEVELS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
            </select>
            <select
              value={logSource}
              onChange={(e) => setLogSource(e.target.value)}
              className="rounded-[var(--radius-sm)] border border-border bg-card px-2 py-1 text-xs outline-none focus:border-[var(--color-accent)] max-w-[180px]"
            >
              <option value="">все источники</option>
              {logSources.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <Button variant="ghost" size="icon" onClick={loadLogs} aria-label="Обновить логи" className="h-7 w-7">
              <RefreshCw size={12} className={logsLoading ? 'animate-spin' : ''} />
            </Button>
          </div>
        </div>

        <div className="max-h-[480px] overflow-y-auto">
          {logsLoading && logs.length === 0 ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground">
              <Loader2 size={14} className="animate-spin" />
            </div>
          ) : logs.length === 0 ? (
            <p className="px-3 py-8 text-center text-xs text-muted-foreground">
              Тишина. Ни одного {logLevel || 'события'} {logSource ? `из ${logSource}` : ''} — это хорошо.
            </p>
          ) : (
            <ul className="divide-y divide-border text-xs">
              <AnimatePresence initial={false}>
                {logs.map((row) => <LogRow key={row.id} row={row} />)}
              </AnimatePresence>
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}

interface HealthTileProps {
  icon: typeof Server;
  title: string;
  severity: Severity;
  primary: string;
  rows: { label: string; value: string }[];
}

function HealthTile({ icon: Icon, title, severity, primary, rows }: HealthTileProps) {
  const accent = severity === 'ok'
    ? 'border-[var(--color-accent-soft)] bg-[var(--color-accent-soft)]/30'
    : severity === 'warn'
      ? 'border-[var(--color-warning,_#d97706)]/40 bg-[var(--color-warning,_#d97706)]/10'
      : severity === 'err'
        ? 'border-[var(--color-danger-muted)] bg-[var(--color-danger-muted)]/30'
        : 'border-border bg-background';
  return (
    <motion.div
      layout
      className={`flex flex-col gap-2 rounded-[var(--radius-sm)] border p-3 ${accent}`}
    >
      <div className="flex items-center justify-between">
        <span className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
          <Icon size={11} />
          {title}
        </span>
        <SeverityChip severity={severity} />
      </div>
      <div className="text-base font-medium tabular-nums">{primary}</div>
      <dl className="flex flex-col gap-0.5 text-[11px] text-muted-foreground">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between gap-3">
            <dt className="uppercase tracking-[0.14em]">{row.label}</dt>
            <dd className="truncate text-foreground">{row.value}</dd>
          </div>
        ))}
      </dl>
    </motion.div>
  );
}

function SeverityChip({ severity }: { severity: Severity }) {
  if (severity === 'ok') {
    return <CheckCircle2 size={14} className="text-[var(--color-accent)]" />;
  }
  if (severity === 'warn') {
    return <AlertTriangle size={14} className="text-amber-500" />;
  }
  if (severity === 'err') {
    return <AlertCircle size={14} className="text-[var(--color-danger)] animate-pulse" />;
  }
  return <span className="text-[10px] text-muted-foreground">—</span>;
}

function LogRow({ row }: { row: ServiceLog }) {
  const [expanded, setExpanded] = useState(false);
  const levelClass = row.level === 'error'
    ? 'text-[var(--color-danger)]'
    : row.level === 'warn'
      ? 'text-amber-500'
      : 'text-muted-foreground';
  return (
    <motion.li
      layout
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      className="px-3 py-2"
    >
      <button
        type="button"
        onClick={() => row.context && setExpanded((v) => !v)}
        className="flex w-full items-start gap-3 text-left"
        disabled={!row.context}
      >
        <span className={`mt-0.5 inline-block w-12 shrink-0 truncate text-[10px] uppercase tracking-[0.16em] ${levelClass}`}>
          {row.level}
        </span>
        <span className="mt-0.5 inline-block w-32 shrink-0 truncate text-[11px] text-muted-foreground">
          {row.source}
        </span>
        <span className="min-w-0 flex-1 break-words text-foreground">{row.message}</span>
        <span className="mt-0.5 shrink-0 text-[10px] text-muted-foreground">
          {formatRel(row.createdAt, 1)}
        </span>
      </button>
      <AnimatePresence initial={false}>
        {expanded && row.context && (
          <motion.pre
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.15 }}
            className="mt-1 ml-[180px] overflow-x-auto rounded-[var(--radius-sm)] border border-border bg-card p-2 font-mono text-[10px] text-muted-foreground"
          >
            {row.context}
            {row.userId && <div className="mt-1">user: {row.userId}</div>}
          </motion.pre>
        )}
      </AnimatePresence>
    </motion.li>
  );
}
