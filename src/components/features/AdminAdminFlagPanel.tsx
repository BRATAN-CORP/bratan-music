import { useState } from 'react';
import { Shield } from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/Button';

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
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const submit = async (isAdmin: boolean) => {
    const t = target.trim();
    if (!t) return;
    setBusy(true);
    setMsg(null);
    try {
      const payload: { userId?: string; tgUsername?: string; isAdmin: boolean } = { isAdmin };
      if (/^\d+$/.test(t)) payload.userId = t;
      else payload.tgUsername = t;
      const r = await api.post<AdminFlagResponse>('/admin/admin-flag', payload);
      if (r.ok && r.user) {
        const u = r.user.username ? '@' + r.user.username : (r.user.name ?? r.user.id);
        setMsg({
          kind: 'ok',
          text: r.user.isAdmin ? `${u} теперь админ` : `${u} больше не админ`,
        });
        setTarget('');
      } else {
        setMsg({ kind: 'err', text: r.error ?? 'Не удалось обновить роль' });
      }
    } catch (err) {
      setMsg({ kind: 'err', text: err instanceof Error ? err.message : 'Ошибка' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-[var(--radius-md)] border border-border bg-card p-5">
      <h2 className="flex items-center gap-2 text-sm font-medium">
        <Shield size={14} className="text-muted-foreground" />
        Назначение админов (admin)
      </h2>
      <p className="mt-2 text-xs text-muted-foreground">
        Выдать или снять админку. Принимает TG user id или @username.
      </p>
      <div className="mt-3 flex flex-col gap-2">
        <input
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          placeholder="user id или @username"
          className="w-full rounded-[var(--radius-sm)] border border-border bg-background px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
        />
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button onClick={() => submit(true)} disabled={busy || !target.trim()} className="flex-1">
            {busy ? 'Применяем…' : 'Назначить админом'}
          </Button>
          <Button
            variant="outline"
            onClick={() => submit(false)}
            disabled={busy || !target.trim()}
            className="flex-1"
          >
            Снять админку
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
