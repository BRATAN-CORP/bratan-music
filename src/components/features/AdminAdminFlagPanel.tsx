import { useState } from 'react';
import { Shield } from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { useT } from '@/i18n';

interface AdminFlagResponse {
  ok: boolean;
  user?: { id: string; username: string | null; name: string | null; isAdmin: boolean };
  error?: string;
}

/**
 * Admin tool for granting / revoking admin rights by TG user id (or
 * @username). Mirrors the shape of AdminGrantPanel — same input,
 * same look — but talks to /admin/admin-flag and toggles the
 * is_admin column on the target user. The server-side endpoint
 * refuses self-demotion so the only admin can't lock themselves out.
 */
export function AdminAdminFlagPanel() {
  const t = useT();
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const submit = async (isAdmin: boolean) => {
    const value = target.trim();
    if (!value) return;
    setBusy(true);
    setMsg(null);
    try {
      const payload: { userId?: string; tgUsername?: string; isAdmin: boolean } = { isAdmin };
      if (/^\d+$/.test(value)) payload.userId = value;
      else payload.tgUsername = value;
      const r = await api.post<AdminFlagResponse>('/admin/admin-flag', payload);
      if (r.ok && r.user) {
        const u = r.user.username ? '@' + r.user.username : (r.user.name ?? r.user.id);
        setMsg({
          kind: 'ok',
          text: r.user.isAdmin
            ? t('admin_panels.adminFlag.promoted', { user: u })
            : t('admin_panels.adminFlag.demoted', { user: u }),
        });
        setTarget('');
      } else {
        setMsg({ kind: 'err', text: r.error ?? t('admin_panels.adminFlag.failed') });
      }
    } catch (err) {
      setMsg({ kind: 'err', text: err instanceof Error ? err.message : t('admin_panels.adminFlag.genericError') });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="flex h-full flex-col rounded-[var(--radius-xl)] border border-border bg-card p-5 sm:p-6">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]">
          <Shield size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-medium leading-tight">
            {t('admin_panels.adminFlag.title')}
          </h2>
          <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
            {t('admin_panels.adminFlag.hint')}
          </p>
        </div>
      </div>
      <div className="mt-4 flex flex-1 flex-col gap-2">
        <input
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          placeholder={t('admin_panels.adminFlag.targetPlaceholder')}
          className="w-full rounded-[var(--radius-sm)] border border-border bg-background px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
        />
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button onClick={() => submit(true)} disabled={busy || !target.trim()} className="flex-1">
            {busy ? t('admin_panels.adminFlag.applying') : t('admin_panels.adminFlag.promote')}
          </Button>
          <Button
            variant="outline"
            onClick={() => submit(false)}
            disabled={busy || !target.trim()}
            className="flex-1"
          >
            {t('admin_panels.adminFlag.demote')}
          </Button>
        </div>
        {msg && (
          <p className={`text-xs ${msg.kind === 'ok' ? 'text-[var(--color-accent)]' : 'text-[var(--color-danger)]'}`}>
            {msg.text}
          </p>
        )}
      </div>
    </section>
  );
}
