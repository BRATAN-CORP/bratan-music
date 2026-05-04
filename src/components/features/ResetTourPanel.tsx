import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Loader2, Compass } from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { useAuthStore } from '@/store/auth';
import { useT } from '@/i18n';

/**
 * Replay the spotlight onboarding tour on next page load.
 *
 * Calls `POST /user/me/tour/reset` which clears `users.tour_completed_at`
 * server-side, then patches the in-memory auth user so
 * `<OnboardingTour />` sees `tourCompletedAt: null` and re-mounts.
 *
 * Pairs with `<ResetRecommendationsPanel />` visually — both are
 * "self-service reset" affordances and live in the same Settings
 * column on the profile page.
 */
export function ResetTourPanel() {
  const t = useT();
  const patchUser = useAuthStore((s) => s.patchUser);
  const [done, setDone] = useState(false);

  const reset = useMutation({
    mutationFn: () => api.post<{ ok: boolean }>('/user/me/tour/reset', {}),
    onSuccess: () => {
      patchUser({ tourCompletedAt: null });
      setDone(true);
    },
  });

  return (
    <section className="flex h-full flex-col rounded-[var(--radius-xl)] border border-border bg-card p-5 sm:p-6">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]">
          <Compass size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-medium leading-tight">
            {t('reset.tourTitleLong')}
          </h2>
          <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
            {t('reset.tourHintLong')}
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-1 flex-col justify-end gap-2">
        <Button
          variant="outline"
          disabled={reset.isPending}
          onClick={() => reset.mutate()}
        >
          {reset.isPending ? (
            <>
              <Loader2 size={14} className="animate-spin" /> {t('reset.recommendationsResetting')}
            </>
          ) : (
            <>{t('reset.tourCtaLong')}</>
          )}
        </Button>

        {reset.error && (
          <p className="text-xs text-[var(--color-danger)]">
            {reset.error instanceof Error ? reset.error.message : t('reset.recommendationsFailed')}
          </p>
        )}

        {done && !reset.isPending && (
          <p className="text-xs text-[var(--color-accent)]">
            {t('reset.tourDoneLine')}
          </p>
        )}
      </div>
    </section>
  );
}
