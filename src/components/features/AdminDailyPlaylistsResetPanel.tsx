import { useState } from 'react';
import { ListMusic, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { api } from '@/lib/api';
import { useT } from '@/i18n';

interface ResetResponse {
  ok: boolean;
  processed: number;
  errors: number;
  total?: number;
  variants?: { variant: string; name: string; trackCount: number }[];
}

export function AdminDailyPlaylistsResetPanel() {
  const t = useT();
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ResetResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const data = await api.post<ResetResponse>('/admin/daily-playlists/reset', {});
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('admin_panels.dailyReset.failed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="flex h-full flex-col rounded-[var(--radius-xl)] border border-border bg-card p-5 sm:p-6">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]">
          <ListMusic size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-medium leading-tight">
            {t('admin_panels.dailyReset.title')}
          </h2>
          <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
            {t('admin_panels.dailyReset.hint')}
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-1 flex-col justify-end gap-2">
        <Button
          variant="outline"
          onClick={run}
          disabled={loading}
          className="w-full"
        >
          {loading ? (
            <><Loader2 size={14} className="animate-spin" /> {t('admin_panels.dailyReset.running')}</>
          ) : (
            <><RefreshCw size={14} /> {t('admin_panels.dailyReset.cta')}</>
          )}
        </Button>

        {error && (
          <p className="text-xs text-[var(--color-danger)]">{error}</p>
        )}

        {result?.ok && (
          <p className="text-xs text-[var(--color-accent)]">
            {t('admin_panels.dailyReset.success', {
              processed: result.processed,
              errors: result.errors,
            })}
          </p>
        )}
      </div>
    </section>
  );
}
