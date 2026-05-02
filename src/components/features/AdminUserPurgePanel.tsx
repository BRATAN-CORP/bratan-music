import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Loader2, Search, Trash2, X } from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { useT } from '@/i18n';

interface AdminUser {
  id: string;
  tg_username: string | null;
  tg_name: string | null;
  is_admin: number;
  created_at: number;
}

interface PurgeResponse {
  ok: boolean;
  user?: { id: string; username: string | null; name: string | null };
  deleted?: {
    userRow: number;
    r2Objects: number;
    r2Failed: number;
  };
  error?: string;
}

// Accepts both the Russian and English confirm phrases regardless of
// the active locale so the user doesn't have to retype if they switch
// languages mid-flow. The localized phrase is used for the
// placeholder/help copy via i18n.
const CONFIRM_PHRASES = ['УДАЛИТЬ', 'DELETE'];

/**
 * Dangerous admin tool: search for any user of the service and purge
 * every piece of data tied to them — uploads (R2 + DB), playlists,
 * library items, listening history, sessions and subscriptions.
 *
 * The search uses the existing `/admin/users/search` endpoint. Once a
 * user is selected, the action requires the admin to type a confirm
 * phrase; only then does the destructive button enable. After the
 * server responds, we render a short receipt of what was deleted.
 */
export function AdminUserPurgePanel() {
  const t = useT();
  const qc = useQueryClient();
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [selected, setSelected] = useState<AdminUser | null>(null);
  const [confirmInput, setConfirmInput] = useState('');
  const [receipt, setReceipt] = useState<PurgeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Debounce typing into the search box so we don't hammer the worker
  // with a query for every keystroke.
  useDebouncedEffect(() => setDebounced(query.trim()), [query], 200);

  const search = useQuery({
    queryKey: ['admin-user-search', debounced],
    queryFn: () => api.get<{ items: AdminUser[] }>(`/admin/users/search?q=${encodeURIComponent(debounced)}`),
    enabled: debounced.length > 0,
    staleTime: 1000 * 30,
  });

  const purge = useMutation({
    mutationFn: (id: string) => api.delete<PurgeResponse>(`/admin/users/${id}/data`),
    onSuccess: (data) => {
      setReceipt(data);
      setSelected(null);
      setConfirmInput('');
      setError(null);
      qc.invalidateQueries({ queryKey: ['admin-user-search'] });
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : t('admin_panels.userPurge.genericError'));
    },
  });

  const canSubmit =
    Boolean(selected) &&
    CONFIRM_PHRASES.includes(confirmInput.trim().toUpperCase()) &&
    !purge.isPending;
  const localizedConfirmPhrase = t('admin_panels.userPurge.confirmPhrase');

  return (
    <section className="rounded-[var(--radius-md)] border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/5 p-5 md:col-span-2">
      <h2 className="flex items-center gap-2 text-sm font-medium text-[var(--color-danger)]">
        <AlertTriangle size={14} />
        {t('admin_panels.userPurge.titleLong')}
      </h2>
      <p className="mt-2 text-xs text-muted-foreground">
        {t('admin_panels.userPurge.hintLong')}
      </p>

      <div className="mt-4 flex flex-col gap-3">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('admin_panels.userPurge.searchPlaceholder')}
            className="w-full rounded-[var(--radius-sm)] border border-border bg-background py-2 pl-9 pr-3 text-sm outline-none focus:border-[var(--color-accent)]"
          />
        </div>

        {debounced && search.data?.items?.length ? (
          <div className="max-h-56 overflow-y-auto rounded-[var(--radius-sm)] border border-border bg-card">
            {search.data.items.map((u) => {
              const isSelected = selected?.id === u.id;
              const display = u.tg_username
                ? `@${u.tg_username}`
                : (u.tg_name ?? u.id);
              return (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => {
                    setSelected(u);
                    setReceipt(null);
                    setError(null);
                  }}
                  className={`flex w-full items-center justify-between gap-3 border-b border-border px-3 py-2 text-left text-xs last:border-b-0 transition-colors ${
                    isSelected ? 'bg-secondary' : 'hover:bg-secondary'
                  }`}
                >
                  <span className="flex flex-col">
                    <span className="font-medium">{display}</span>
                    <span className="text-muted-foreground">
                      id: {u.id}
                      {u.is_admin ? ' • admin' : ''}
                    </span>
                  </span>
                  {isSelected && <span className="text-[var(--color-accent)]">{t('admin_panels.userPurge.selectedTag')}</span>}
                </button>
              );
            })}
          </div>
        ) : null}

        {debounced && !search.isFetching && (search.data?.items?.length ?? 0) === 0 && (
          <p className="text-xs text-muted-foreground">{t('admin_panels.userPurge.searchEmpty')}</p>
        )}

        {selected && (
          <div className="rounded-[var(--radius-sm)] border border-[var(--color-danger)]/40 bg-background p-3 text-xs">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-medium">
                  {selected.tg_username ? `@${selected.tg_username}` : (selected.tg_name ?? selected.id)}
                </div>
                <div className="text-muted-foreground">id: {selected.id}</div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setSelected(null);
                  setConfirmInput('');
                }}
                className="text-muted-foreground hover:text-foreground"
                aria-label={t('admin_panels.userPurge.clearSelectionAria')}
              >
                <X size={14} />
              </button>
            </div>
            <p className="mt-3 text-muted-foreground">
              {t('admin_panels.userPurge.confirmHint')}{' '}
              <code className="rounded bg-secondary px-1">{localizedConfirmPhrase}</code>:
            </p>
            <input
              value={confirmInput}
              onChange={(e) => setConfirmInput(e.target.value)}
              placeholder={localizedConfirmPhrase}
              className="mt-2 w-full rounded-[var(--radius-sm)] border border-border bg-background px-3 py-2 text-sm outline-none focus:border-[var(--color-danger)]"
              autoComplete="off"
            />
            <Button
              variant="danger"
              className="mt-3 w-full"
              disabled={!canSubmit}
              onClick={() => purge.mutate(selected.id)}
            >
              {purge.isPending ? (
                <>
                  <Loader2 size={14} className="animate-spin" /> {t('admin_panels.userPurge.submitting')}
                </>
              ) : (
                <>
                  <Trash2 size={14} /> {t('admin_panels.userPurge.submitDestructive')}
                </>
              )}
            </Button>
          </div>
        )}

        {error && <p className="text-xs text-[var(--color-danger)]">{error}</p>}

        {receipt?.ok && receipt.deleted && (
          <div className="rounded-[var(--radius-sm)] border border-border bg-card p-3 text-xs">
            <div className="font-medium">{t('admin_panels.userPurge.receiptTitle')}</div>
            <ul className="mt-1 list-disc space-y-0.5 pl-4 text-muted-foreground">
              <li>{t('admin_panels.userPurge.receiptUserRow', { n: receipt.deleted.userRow })}</li>
              <li>{t('admin_panels.userPurge.receiptR2Ok', { n: receipt.deleted.r2Objects })}</li>
              {receipt.deleted.r2Failed > 0 && (
                <li className="text-[var(--color-danger)]">
                  {t('admin_panels.userPurge.receiptR2Failed', { n: receipt.deleted.r2Failed })}
                </li>
              )}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}

/**
 * Tiny inline debounce hook — extracted as a standalone helper so the
 * search input doesn't refetch on every keystroke.
 */
function useDebouncedEffect(fn: () => void, deps: unknown[], delay: number) {
  useEffect(() => {
    const t = setTimeout(fn, delay);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
