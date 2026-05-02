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
    <section className="rounded-[var(--radius-md)] border border-border bg-card p-5">
      <h2 className="flex items-center gap-2 text-sm font-medium">
        <Compass size={14} className="text-muted-foreground" />
        {t('reset.tourTitle')}
      </h2>
      <p className="mt-2 text-xs text-muted-foreground">
        {t('reset.tourHint')}
      </p>

      <div className="mt-3 flex flex-col gap-2">
        <Button
          variant="outline"
          disabled={reset.isPending}
          onClick={() => reset.mutate()}
        >
          {reset.isPending ? (
            <>
              <Loader2 size={14} className="animate-spin" /> {t('reset.tourResetting')}
            </>
          ) : (
            <>{t('reset.tourCta')}</>
          )}
        </Button>

        {reset.error && (
          <p className="text-xs text-[var(--color-danger)]">
            {reset.error instanceof Error ? reset.error.message : t('common.error')}
          </p>
        )}

        {done && !reset.isPending && (
          <p className="text-xs text-[var(--color-accent)]">
            {t('reset.tourDone')}
          </p>
        )}
      </div>
    </section>
  );
}
