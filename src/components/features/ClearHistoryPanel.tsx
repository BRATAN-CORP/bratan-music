import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, History } from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { useT } from '@/i18n';

interface ClearResponse {
  ok: boolean;
  deleted?: number;
}

/**
 * Self-service "wipe my play history" panel.
 *
 * The DELETE endpoint always operates on the authenticated user
 * (server pulls the id from the JWT, ignores body), so there's no
 * way to abuse this to delete somebody else's rows.
 *
 * Touches the play_history table only — taste profile, dislikes,
 * daily playlists are NOT affected. The recommendation engine will
 * keep its existing signal until the user also runs
 * `<ResetRecommendationsPanel />`. Splitting the two operations is
 * intentional: clearing history is the lighter, more common action
 * (e.g. shared device, didn't mean to keep the last few plays);
 * full reset is the bigger reset for when the feed has drifted.
 *
 * Mirror of `<ResetRecommendationsPanel />` so the two sit
 * symmetrically next to each other in the profile grid.
 */
export function ClearHistoryPanel() {
  const t = useT();
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const [receipt, setReceipt] = useState<ClearResponse | null>(null);

  const clear = useMutation({
    mutationFn: () => api.delete<ClearResponse>('/history'),
    onSuccess: (data) => {
      setReceipt(data);
      setConfirm(false);
      // The home-page "Recently played" strip reads ['history','recent'];
      // wave / continue sometimes seed from history too. Drop both so
      // the next render fetches fresh state and instantly reflects
      // the empty list.
      qc.invalidateQueries({ queryKey: ['history', 'recent'] });
      qc.invalidateQueries({ queryKey: ['recommendations'] });
    },
  });

  return (
    <section className="flex h-full flex-col rounded-[var(--radius-xl)] border border-border bg-card p-5 sm:p-6">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--color-accent)]/25 bg-[var(--color-accent-soft)] text-[var(--color-accent)]">
          <History size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-medium leading-tight">
            {t('reset.historyTitle')}
          </h2>
          <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
            {t('reset.historyHint')}
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-1 flex-col justify-end gap-2">
        {!confirm ? (
          <Button
            variant="outline"
            onClick={() => {
              setConfirm(true);
              setReceipt(null);
            }}
          >
            {t('reset.historyCta')}
          </Button>
        ) : (
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              variant="danger"
              className="flex-1"
              disabled={clear.isPending}
              onClick={() => clear.mutate()}
            >
              {clear.isPending ? (
                <>
                  <Loader2 size={14} className="animate-spin" /> {t('reset.historyClearing')}
                </>
              ) : (
                <>{t('reset.historyConfirm')}</>
              )}
            </Button>
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => setConfirm(false)}
              disabled={clear.isPending}
            >
              {t('reset.historyCancel')}
            </Button>
          </div>
        )}

        {clear.error && (
          <p className="text-xs text-[var(--color-danger)]">
            {clear.error instanceof Error ? clear.error.message : t('reset.historyFailed')}
          </p>
        )}

        {receipt?.ok && (
          <p className="text-xs text-[var(--color-accent)]">
            {t('reset.historyResultLine', { count: receipt.deleted ?? 0 })}
          </p>
        )}
      </div>
    </section>
  );
}
