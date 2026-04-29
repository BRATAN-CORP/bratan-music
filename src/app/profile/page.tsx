import { useState } from 'react';
import { LogOut, Crown, Shield, Moon, Sun, KeyRound, Sliders, Music2 } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { AuthGuard } from '@/components/features/AuthGuard';
import { useAuthStore } from '@/store/auth';
import { useUiStore } from '@/store/ui';
import { useSettingsStore, TIDAL_QUALITY_LABELS, type TidalQuality } from '@/store/settings';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { UserLimits } from '@/types';
import { Button } from '@/components/ui/Button';
import { AdminTidalPanel } from '@/components/features/AdminTidalPanel';
import { AdminUserPurgePanel } from '@/components/features/AdminUserPurgePanel';
import { AdminAdminFlagPanel } from '@/components/features/AdminAdminFlagPanel';
import { ResetRecommendationsPanel } from '@/components/features/ResetRecommendationsPanel';

interface GrantResponse {
  ok: boolean;
  user?: { id: string; username: string | null; name: string | null };
  subscription?: { id: string; expiresAt: number; days: number };
}

function AdminGrantPanel() {
  const [target, setTarget] = useState('');
  const [days, setDays] = useState('30');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const submit = async () => {
    const t = target.trim();
    if (!t) return;
    setBusy(true);
    setMsg(null);
    try {
      const payload: { userId?: string; tgUsername?: string; days: number } = { days: Number(days) || 30 };
      if (/^\d+$/.test(t)) payload.userId = t;
      else payload.tgUsername = t;
      const r = await api.post<GrantResponse>('/admin/grant', payload);
      if (r.ok && r.user && r.subscription) {
        const u = r.user.username ? '@' + r.user.username : (r.user.name ?? r.user.id);
        const exp = new Date(r.subscription.expiresAt * 1000).toLocaleDateString('ru-RU');
        setMsg({ kind: 'ok', text: `Выдано ${u} на ${r.subscription.days} дн. (до ${exp})` });
        setTarget('');
      } else {
        setMsg({ kind: 'err', text: 'Не удалось выдать доступ' });
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
        <KeyRound size={14} className="text-muted-foreground" />
        Выдача доступа (admin)
      </h2>
      <p className="mt-2 text-xs text-muted-foreground">
        Введи ID или @username и количество дней.
      </p>
      <div className="mt-3 flex flex-col gap-2">
        <input
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          placeholder="user id или @username"
          className="w-full rounded-[var(--radius-sm)] border border-border bg-background px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
        />
        <div className="flex items-center gap-2">
          <input
            value={days}
            onChange={(e) => setDays(e.target.value.replace(/[^\d]/g, ''))}
            placeholder="дней"
            className="w-20 rounded-[var(--radius-sm)] border border-border bg-background px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
          />
          <Button onClick={submit} disabled={busy || !target.trim()} className="flex-1">
            {busy ? 'Выдаём…' : 'Выдать доступ'}
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

interface UserProfile {
  id: string;
  username: string | null;
  name: string | null;
  isAdmin: boolean;
  subscription: { status: string; expiresAt: number } | null;
}

export function ProfilePage() {
  const { user, logout } = useAuthStore();
  const { theme, toggleTheme, openSubscriptionPrompt } = useUiStore();
  const {
    crossfade, crossfadeDuration, tidalQuality, infinitePlayback,
    setCrossfade, setCrossfadeDuration, setTidalQuality, setInfinitePlayback,
  } = useSettingsStore();
  const { data: profile } = useQuery({
    queryKey: ['profile'],
    queryFn: () => api.get<UserProfile>('/user/me'),
    enabled: !!user,
  });
  const { data: limits } = useQuery({
    queryKey: ['limits'],
    queryFn: () => api.get<UserLimits>('/user/limits'),
    enabled: !!user,
  });

  return (
    <AuthGuard>
      <div className="mx-auto flex max-w-5xl flex-col gap-6 p-4 sm:p-6 lg:p-10">
        <div className="flex flex-col gap-1 border-b border-border pb-4">
          <span className="text-xs font-medium uppercase tracking-[0.25em] text-muted-foreground">Аккаунт</span>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Профиль</h1>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
        <section className="rounded-[var(--radius-md)] border border-border bg-card p-5">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-full border border-border bg-background text-base font-semibold">
              {(user?.name ?? user?.username ?? '?')[0]?.toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{user?.name ?? user?.username ?? 'Пользователь'}</p>
              {user?.username && <p className="truncate text-xs text-muted-foreground">@{user.username}</p>}
            </div>
          </div>
          {profile?.isAdmin && (
            <div className="mt-4 flex items-center gap-2 border-t border-border pt-4 text-xs font-medium text-foreground">
              <Shield size={14} /> Администратор
            </div>
          )}
        </section>

        <section className="rounded-[var(--radius-md)] border border-border bg-card p-5">
          <h2 className="flex items-center gap-2 text-sm font-medium">
            <Crown size={14} className="text-muted-foreground" />
            Подписка
          </h2>
          {profile?.subscription ? (
            <>
              <p className="mt-3 text-sm font-medium">Активна</p>
              <p className="mt-1 text-xs text-muted-foreground">
                До {new Date(profile.subscription.expiresAt * 1000).toLocaleDateString('ru-RU')}
              </p>
            </>
          ) : (
            <>
              <p className="mt-3 text-sm text-muted-foreground">
                Не активна. 3 трека в день бесплатно.
              </p>
              <Button
                type="button"
                onClick={() => openSubscriptionPrompt()}
                size="sm"
                className="mt-4"
              >
                <Crown size={14} />
                Оформить за 99 ⭐
              </Button>
            </>
          )}
        </section>

        {limits && (
          <section className="rounded-[var(--radius-md)] border border-border bg-card p-5">
            <h2 className="text-sm font-medium">Лимиты</h2>
            {limits.daily.unlimited ? (
              <p className="mt-3 text-sm font-medium">Безлимитный доступ</p>
            ) : (
              <p className="mt-3 text-sm text-muted-foreground">
                Использовано: {limits.daily.used} / {limits.daily.limit}
              </p>
            )}
          </section>
        )}

        <section className="rounded-[var(--radius-md)] border border-border bg-card p-5">
          <h2 className="flex items-center gap-2 text-sm font-medium">
            <Sliders size={14} className="text-muted-foreground" />
            Воспроизведение
          </h2>
          <label className="mt-4 flex items-center justify-between gap-3 text-sm">
            <span className="flex flex-col">
              <span>Плавное переключение</span>
              <span className="text-xs text-muted-foreground">
                Микширует следующий трек поверх текущего
              </span>
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={crossfade}
              onClick={() => setCrossfade(!crossfade)}
              className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
                crossfade ? 'bg-[var(--color-accent)]' : 'bg-secondary'
              }`}
            >
              <motion.span
                animate={{ x: crossfade ? 24 : 4 }}
                transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                className="inline-block h-4 w-4 rounded-full bg-white shadow"
              />
            </button>
          </label>
          {crossfade && (
            <div className="mt-3">
              <label className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Длительность</span>
                <span className="tabular-nums">{crossfadeDuration} с</span>
              </label>
              <input
                type="range"
                min={1}
                max={12}
                step={1}
                value={crossfadeDuration}
                onChange={(e) => setCrossfadeDuration(Number(e.target.value))}
                className="mt-1 w-full accent-[var(--color-accent)]"
              />
            </div>
          )}

          <label className="mt-5 flex items-center justify-between gap-3 border-t border-border pt-4 text-sm">
            <span className="flex flex-col">
              <span>Бесконечная музыка</span>
              <span className="text-xs text-muted-foreground">
                Когда очередь почти пуста, добавляем рекомендации на основе того, что играет. Если выключено — плеер остановится на последнем треке.
              </span>
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={infinitePlayback}
              onClick={() => setInfinitePlayback(!infinitePlayback)}
              className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
                infinitePlayback ? 'bg-[var(--color-accent)]' : 'bg-secondary'
              }`}
            >
              <motion.span
                animate={{ x: infinitePlayback ? 24 : 4 }}
                transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                className="inline-block h-4 w-4 rounded-full bg-white shadow"
              />
            </button>
          </label>
        </section>

        <section className="rounded-[var(--radius-md)] border border-border bg-card p-5">
          <h2 className="flex items-center gap-2 text-sm font-medium">
            <Music2 size={14} className="text-muted-foreground" />
            Качество (Tidal)
          </h2>
          <p className="mt-2 text-xs text-muted-foreground">
            Зависит от прокси-аккаунта Tidal — недоступные качества будут урезаны до доступного уровня.
          </p>
          <div className="mt-3 flex flex-col gap-1.5">
            {(Object.keys(TIDAL_QUALITY_LABELS) as TidalQuality[]).map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => setTidalQuality(q)}
                className={`flex items-center justify-between gap-2 rounded-[var(--radius-sm)] border px-3 py-2 text-left text-sm transition-colors ${
                  tidalQuality === q
                    ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-foreground'
                    : 'border-border hover:bg-secondary'
                }`}
              >
                <span>{TIDAL_QUALITY_LABELS[q]}</span>
                {tidalQuality === q && (
                  <span className="h-2 w-2 rounded-full bg-[var(--color-accent)]" />
                )}
              </button>
            ))}
          </div>
        </section>

        <section className="rounded-[var(--radius-md)] border border-border bg-card p-5">
          <h2 className="text-sm font-medium">Внешний вид</h2>
          <button
            onClick={toggleTheme}
            className="mt-3 flex w-full items-center justify-between rounded-[var(--radius-sm)] px-2 py-2 text-sm transition-colors hover:bg-secondary"
          >
            <span>Тема</span>
            <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">
              <AnimatePresence mode="wait" initial={false}>
                <motion.span
                  key={theme}
                  initial={{ rotate: -45, opacity: 0 }}
                  animate={{ rotate: 0, opacity: 1 }}
                  exit={{ rotate: 45, opacity: 0 }}
                  transition={{ duration: 0.25 }}
                  className="inline-flex"
                >
                  {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
                </motion.span>
              </AnimatePresence>
              {theme === 'dark' ? 'Тёмная' : 'Светлая'}
            </span>
          </button>
        </section>

        <ResetRecommendationsPanel />

        {profile?.isAdmin && <AdminGrantPanel />}
        {profile?.isAdmin && <AdminAdminFlagPanel />}
        {profile?.isAdmin && (
          <div className="md:col-span-2">
            <AdminTidalPanel />
          </div>
        )}
        {profile?.isAdmin && <AdminUserPurgePanel />}

        </div>

        <Button onClick={logout} variant="danger" className="w-full md:max-w-xs md:self-end">
          <LogOut size={14} />
          Выйти
        </Button>
      </div>
    </AuthGuard>
  );
}
