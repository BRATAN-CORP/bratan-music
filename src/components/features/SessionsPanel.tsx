import { useState } from 'react';
import { Loader2, LogOut, Monitor, Smartphone, Globe } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/Button';
import { api, ApiError } from '@/lib/api';
import { toast } from '@/store/toast';
import { useT, useI18n } from '@/i18n';

interface SessionItem {
  id: string;
  createdAt: number;
  lastUsedAt: number;
  expiresAt: number;
  label: string;
  current: boolean;
}

interface SessionListResponse {
  sessions: SessionItem[];
  currentSessionId: string | null;
}

interface LogoutAllResponse {
  ok: boolean;
  revoked: number;
  keptSessionId: string | null;
}

/**
 * Profile-page panel that renders the user's active sessions and
 * exposes per-row "log out" + a bulk "log out from every other
 * device" CTA. Source-of-truth is the React-Query cache key
 * `['sessions']`, which the worker `/user/sessions` endpoint
 * populates from the `sessions` table.
 *
 * Each row shows:
 *   - human-readable device label (Chrome · Windows, Safari · iPhone, …)
 *   - last-active timestamp (sorted desc by the server)
 *   - "Текущая" badge for the row matching the access token's `sid`
 *
 * The current device gets no per-row revoke button — using the bulk
 * CTA instead is the safer pattern (revoking the row you're sitting
 * on requires an immediate refresh roundtrip and the user usually
 * just wants to log out via the existing /profile/logout button
 * anyway).
 */
export function SessionsPanel() {
  const t = useT();
  const { locale } = useI18n();
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery<SessionListResponse>({
    queryKey: ['sessions'],
    queryFn: () => api.get<SessionListResponse>('/user/sessions'),
    // The list is read on each profile-page mount; we don't poll
    // because activity timestamps update on the server every time
    // the user refreshes a token (every <1h) and re-rendering on
    // every focus would be visually noisy. Manual invalidation
    // happens on revoke / logout-all (below).
    staleTime: 30_000,
  });

  const [pendingRevoke, setPendingRevoke] = useState<string | null>(null);

  const revoke = useMutation({
    mutationFn: async (sessionId: string) => {
      setPendingRevoke(sessionId);
      try {
        await api.delete(`/user/sessions/${encodeURIComponent(sessionId)}`);
      } finally {
        setPendingRevoke(null);
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['sessions'] });
      toast.success(t('profile.sessions.revokedToast'));
    },
    onError: (err) => {
      const msg =
        err instanceof ApiError ? err.message
        : err instanceof Error ? err.message
        : t('profile.sessions.revokeError');
      toast.error(msg);
    },
  });

  const logoutAll = useMutation({
    mutationFn: () => api.post<LogoutAllResponse>('/user/sessions/logout-all', {}),
    onSuccess: async (res) => {
      await queryClient.invalidateQueries({ queryKey: ['sessions'] });
      if (!res.revoked) {
        toast.success(t('profile.sessions.logoutAllNoOthers'));
      } else {
        toast.success(t('profile.sessions.logoutAllToast', { count: res.revoked }));
      }
    },
    onError: (err) => {
      const msg =
        err instanceof ApiError ? err.message
        : err instanceof Error ? err.message
        : t('profile.sessions.logoutAllError');
      toast.error(msg);
    },
  });

  const sessions = data?.sessions ?? [];
  const otherCount = sessions.filter((s) => !s.current).length;

  return (
    <section className="rounded-[var(--radius-xl)] border border-border bg-card p-5 sm:p-6">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]">
          <Monitor size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-medium leading-tight">{t('profile.sessions.title')}</h2>
          <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
            {t('profile.sessions.hint')}
          </p>
        </div>
      </div>

      <div className="mt-4 divide-y divide-border">
        {isLoading && (
          <div className="flex items-center gap-2 py-4 text-xs text-muted-foreground">
            <Loader2 size={14} className="animate-spin" />
            {t('profile.sessions.loading')}
          </div>
        )}
        {error && !isLoading && (
          <div className="py-4 text-xs text-[var(--color-danger)]">
            {error instanceof Error ? error.message : t('profile.sessions.loadError')}
          </div>
        )}
        {!isLoading && !error && sessions.length === 0 && (
          <div className="py-4 text-xs text-muted-foreground">{t('profile.sessions.empty')}</div>
        )}
        {sessions.map((s) => (
          <SessionRow
            key={s.id}
            s={s}
            locale={locale}
            revoking={pendingRevoke === s.id}
            onRevoke={() => revoke.mutate(s.id)}
            t={t}
          />
        ))}
      </div>

      {sessions.length > 0 && (
        <div className="mt-4 flex justify-end">
          <Button
            variant="outline"
            size="sm"
            onClick={() => logoutAll.mutate()}
            disabled={logoutAll.isPending || otherCount === 0}
          >
            {logoutAll.isPending ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <LogOut size={14} />
            )}
            {t('profile.sessions.logoutAll')}
          </Button>
        </div>
      )}
    </section>
  );
}

function SessionRow({
  s,
  locale,
  revoking,
  onRevoke,
  t,
}: {
  s: SessionItem;
  locale: 'ru' | 'en';
  revoking: boolean;
  onRevoke: () => void;
  t: ReturnType<typeof useT>;
}) {
  const lastWhen = s.lastUsedAt
    ? formatWhen(s.lastUsedAt, locale)
    : formatWhen(s.createdAt, locale);
  const isMobile = /iphone|ipad|android/i.test(s.label);
  const Icon = isMobile ? Smartphone : /telegram/i.test(s.label) ? Globe : Monitor;

  return (
    <div className="flex items-center justify-between gap-3 py-3">
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]">
          <Icon size={16} />
        </span>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <div className="truncate text-sm font-medium text-foreground">
              {s.label || t('profile.sessions.unknownDevice')}
            </div>
            {s.current && (
              <span className="rounded-full bg-[var(--color-accent-soft)] px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.16em] text-[var(--color-accent)]">
                {t('profile.sessions.currentBadge')}
              </span>
            )}
          </div>
          <div className="mt-0.5 truncate text-xs text-muted-foreground">
            {t('profile.sessions.lastUsed', { when: lastWhen })}
          </div>
        </div>
      </div>
      {!s.current && (
        <Button onClick={onRevoke} variant="ghost" size="sm" disabled={revoking}>
          {revoking ? <Loader2 size={14} className="animate-spin" /> : <LogOut size={14} />}
          {t('profile.sessions.logoutOne')}
        </Button>
      )}
    </div>
  );
}

/**
 * Compact "5 минут назад / 14 фев в 12:34" formatter. Uses
 * `Intl.RelativeTimeFormat` for sub-7-day deltas and falls back to
 * `Intl.DateTimeFormat` past that so older sessions still get a
 * useful absolute label.
 */
function formatWhen(unixSeconds: number, locale: 'ru' | 'en'): string {
  if (!unixSeconds) return locale === 'ru' ? 'недавно' : 'recently';
  const now = Date.now() / 1000;
  const delta = now - unixSeconds;
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  if (delta < 60) return rtf.format(-Math.round(delta), 'second');
  if (delta < 3600) return rtf.format(-Math.round(delta / 60), 'minute');
  if (delta < 86_400) return rtf.format(-Math.round(delta / 3600), 'hour');
  if (delta < 7 * 86_400) return rtf.format(-Math.round(delta / 86_400), 'day');
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(unixSeconds * 1000);
}
