import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, FileUp, Loader2, ListMusic, CircleCheck, CircleAlert } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { AuthGuard } from '@/components/features/AuthGuard';
import { Button } from '@/components/ui/Button';
import { Eyebrow } from '@/components/ui/SectionHeading';
import { api } from '@/lib/api';
import { parseImportCsv, type ImportTrackRow } from '@/lib/importCsv';
import { useT } from '@/i18n';
import { toast } from '@/store/toast';

interface ImportFailure {
  title: string;
  artist: string;
  reason: 'not_found' | 'error';
}

interface ImportStatus {
  total: number;
  processed: number;
  matched: number;
  failed: ImportFailure[];
  done: boolean;
}

const POLL_INTERVAL_MS = 1500;

/**
 * Likes import: upload a CSV exported from another service (Yandex
 * Music / Spotify / … via TuneMyMusic, Soundiiz, MusConv), the backend
 * matches every row against the catalogue (ISRC first, then
 * artist+title+duration) and likes the confident matches. The page is
 * a thin state machine: pick → parsed preview → running (poll) → report.
 */
export function ImportPage() {
  const t = useT();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [rows, setRows] = useState<ImportTrackRow[] | null>(null);
  const [fileName, setFileName] = useState('');
  const [jobId, setJobId] = useState<string | null>(null);
  const [status, setStatus] = useState<ImportStatus | null>(null);
  const [starting, setStarting] = useState(false);

  const running = jobId != null && !(status?.done ?? false);

  const onPicked = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      setRows(parseImportCsv(text));
      setFileName(file.name);
      setJobId(null);
      setStatus(null);
    } catch (e) {
      const code = e instanceof Error ? e.message : '';
      toast.error(t(code === 'no_columns' ? 'importLikes.errorColumns' : 'importLikes.errorParse'));
    }
  };

  const start = async () => {
    if (!rows || rows.length === 0) return;
    setStarting(true);
    try {
      const r = await api.post<{ jobId: string; total: number }>('/import/likes', { tracks: rows });
      setStatus(null);
      setJobId(r.jobId);
    } catch {
      toast.error(t('importLikes.errorStart'));
    } finally {
      setStarting(false);
    }
  };

  // Poll job progress while running; refresh the library on completion.
  useEffect(() => {
    if (!jobId) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const s = await api.get<ImportStatus>(`/import/likes/${jobId}`);
        if (cancelled) return;
        setStatus(s);
        if (s.done) {
          qc.invalidateQueries({ queryKey: ['liked'] });
          qc.invalidateQueries({ queryKey: ['playlists'] });
          return;
        }
      } catch {
        // transient poll error — keep trying
      }
      if (!cancelled) timer = window.setTimeout(tick, POLL_INTERVAL_MS);
    };
    let timer = window.setTimeout(tick, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [jobId, qc]);

  const notFound = (status?.failed ?? []).filter((f) => f.reason === 'not_found');
  const errored = (status?.failed ?? []).filter((f) => f.reason === 'error');
  const progress = status && status.total > 0 ? status.processed / status.total : 0;

  return (
    <AuthGuard>
      <div className="mx-auto flex max-w-6xl flex-col gap-6 p-4 sm:p-6 lg:p-10">
        <button
          onClick={() => navigate(-1)}
          className="flex w-fit items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronLeft size={14} />
          {t('importLikes.back')}
        </button>

        <div className="flex items-end justify-between gap-4 border-b border-border pb-4">
          <div className="flex flex-col gap-1">
            <Eyebrow>{t('importLikes.libraryLabel')}</Eyebrow>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{t('importLikes.pageTitle')}</h1>
            <p className="text-xs text-muted-foreground">{t('importLikes.pageHint')}</p>
          </div>
          <Button onClick={() => fileInputRef.current?.click()} disabled={running || starting}>
            <FileUp size={14} />
            {t('importLikes.pickFile')}
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              void onPicked(e.target.files);
              e.target.value = '';
            }}
          />
        </div>

        {/* How-to: where the CSV comes from. */}
        {!rows && !jobId && (
          <div className="rounded-[var(--radius-md)] border border-border bg-card p-5 text-sm text-muted-foreground">
            <p className="mb-2 font-medium text-foreground">{t('importLikes.howTitle')}</p>
            <ol className="flex list-decimal flex-col gap-1 pl-5">
              <li>{t('importLikes.howStep1')}</li>
              <li>{t('importLikes.howStep2')}</li>
              <li>{t('importLikes.howStep3')}</li>
            </ol>
          </div>
        )}

        {/* Parsed preview → start. */}
        {rows && !jobId && (
          <div className="flex flex-col gap-4 rounded-[var(--radius-md)] border border-border bg-card p-5">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border border-border bg-background text-[var(--color-accent)]">
                <ListMusic size={16} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{fileName}</p>
                <p className="text-xs text-muted-foreground">
                  {t('importLikes.parsedSummary', { count: rows.length })}
                </p>
              </div>
              <Button onClick={() => void start()} disabled={starting}>
                {starting ? <Loader2 size={14} className="animate-spin" /> : null}
                {t('importLikes.start')}
              </Button>
            </div>
            <div className="flex flex-col gap-1 text-xs text-muted-foreground">
              {rows.slice(0, 5).map((r, i) => (
                <p key={i} className="truncate">
                  {r.artist} — {r.title}
                </p>
              ))}
              {rows.length > 5 && <p>{t('importLikes.andMore', { count: rows.length - 5 })}</p>}
            </div>
          </div>
        )}

        {/* Progress. */}
        {jobId && status && !status.done && (
          <div className="flex flex-col gap-3 rounded-[var(--radius-md)] border border-border bg-card p-5">
            <div className="flex items-center gap-2 text-sm">
              <Loader2 size={14} className="animate-spin text-[var(--color-accent)]" />
              {t('importLikes.running', { processed: status.processed, total: status.total })}
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
              <div
                className="h-full rounded-full bg-[var(--color-accent)] transition-[width] duration-500"
                style={{ width: `${Math.round(progress * 100)}%` }}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              {t('importLikes.matchedSoFar', { count: status.matched })}
            </p>
          </div>
        )}
        {jobId && !status && (
          <div className="flex items-center gap-2 rounded-[var(--radius-md)] border border-border bg-card p-5 text-sm text-muted-foreground">
            <Loader2 size={14} className="animate-spin" />
            {t('importLikes.starting')}
          </div>
        )}

        {/* Final report. */}
        {status?.done && (
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-3 rounded-[var(--radius-md)] border border-border bg-card p-5">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border border-border bg-background text-[var(--color-accent)]">
                <CircleCheck size={16} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">
                  {t('importLikes.doneSummary', { matched: status.matched, total: status.total })}
                </p>
                <p className="text-xs text-muted-foreground">{t('importLikes.doneHint')}</p>
              </div>
              <Button variant="secondary" onClick={() => navigate('/library')}>
                {t('importLikes.toLibrary')}
              </Button>
            </div>

            {notFound.length > 0 && (
              <div className="rounded-[var(--radius-md)] border border-border bg-card p-5">
                <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                  <CircleAlert size={14} className="text-muted-foreground" />
                  {t('importLikes.notFoundTitle', { count: notFound.length })}
                </div>
                <div className="flex max-h-64 flex-col gap-1 overflow-y-auto text-xs text-muted-foreground">
                  {notFound.map((f, i) => (
                    <p key={i} className="truncate">
                      {f.artist} — {f.title}
                    </p>
                  ))}
                </div>
              </div>
            )}
            {errored.length > 0 && (
              <p className="text-xs text-muted-foreground">
                {t('importLikes.errorRows', { count: errored.length })}
              </p>
            )}
          </div>
        )}
      </div>
    </AuthGuard>
  );
}
