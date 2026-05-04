import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Sparkles } from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { useT } from '@/i18n';

interface ResetResponse {
  ok: boolean;
  deleted?: Record<string, number>;
}

/**
 * Self-service "reset my recommendations" panel for the profile page.
 *
 * The endpoint always operates on the authenticated user (it pulls the
 * user id from the JWT, ignoring any client input), so there's no way
 * to abuse this to wipe somebody else's data.
 *
 * Wipes the taste profile, dislikes, recommendation_seen log and any
 * already-generated daily playlists. Play history is left alone —
 * it's a separate user-facing log.
 */
export function ResetRecommendationsPanel() {
  const t = useT();
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const [receipt, setReceipt] = useState<ResetResponse | null>(null);

  const reset = useMutation({
    mutationFn: () => api.post<ResetResponse>('/user/reset-recommendations', {}),
    onSuccess: (data) => {
      setReceipt(data);
      setConfirm(false);
      // Drop everything the recommendation engine has cached client-side
      // so the home page repopulates from the fresh state.
      qc.invalidateQueries({ queryKey: ['recommendations'] });
      qc.invalidateQueries({ queryKey: ['daily-playlists'] });
      qc.invalidateQueries({ queryKey: ['explore'] });
    },
  });

  const totalDeleted = receipt?.deleted
    ? Object.values(receipt.deleted).reduce((a, b) => a + b, 0)
    : 0;

  return (
    <section className="flex h-full flex-col rounded-[var(--radius-xl)] border border-border bg-card p-5 sm:p-6">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--color-accent)]/25 bg-[var(--color-accent-soft)] text-[var(--color-accent)]">
          <Sparkles size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-medium leading-tight">
            {t('reset.recommendationsTitle')}
          </h2>
          <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
            {t('reset.recommendationsHint')}
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
            {t('reset.recommendationsCta')}
          </Button>
        ) : (
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              variant="danger"
              className="flex-1"
              disabled={reset.isPending}
              onClick={() => reset.mutate()}
            >
              {reset.isPending ? (
                <>
                  <Loader2 size={14} className="animate-spin" /> {t('reset.recommendationsResetting')}
                </>
              ) : (
                <>{t('reset.recommendationsConfirm')}</>
              )}
            </Button>
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => setConfirm(false)}
              disabled={reset.isPending}
            >
              {t('reset.recommendationsCancel')}
            </Button>
          </div>
        )}

        {reset.error && (
          <p className="text-xs text-[var(--color-danger)]">
            {reset.error instanceof Error ? reset.error.message : t('reset.recommendationsFailed')}
          </p>
        )}

        {receipt?.ok && (
          <p className="text-xs text-[var(--color-accent)]">
            {t('reset.recommendationsResultLine', { count: totalDeleted })}
          </p>
        )}
      </div>
    </section>
  );
}
