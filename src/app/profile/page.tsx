import { useState } from 'react';
import {
  LogOut, Crown, Shield, Moon, Sun, Sliders, Music2, Languages,
  Sparkles, Check, Lock, Wand2, Headphones, ArrowRight,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { AuthGuard } from '@/components/features/AuthGuard';
import { TiltCard } from '@/components/ui/TiltCard';
import { UserAvatar } from '@/components/ui/UserAvatar';
import { useAuthStore } from '@/store/auth';
import { useUiStore } from '@/store/ui';
import { useSettingsStore, TIDAL_QUALITY_LABELS, type TidalQuality } from '@/store/settings';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { UserLimits } from '@/types';
import { Button } from '@/components/ui/Button';
import { Switch } from '@/components/ui/Switch';
import { AdminTidalPanel } from '@/components/features/AdminTidalPanel';
import { AdminHealthPanel } from '@/components/features/AdminHealthPanel';
import { LanguageSwitcher } from '@/components/features/LanguageSwitcher';
import { AdminUserPurgePanel } from '@/components/features/AdminUserPurgePanel';
import { AdminAdminFlagPanel } from '@/components/features/AdminAdminFlagPanel';
import { ResetRecommendationsPanel } from '@/components/features/ResetRecommendationsPanel';
import { ResetTourPanel } from '@/components/features/ResetTourPanel';
import { AdminDashboard } from '@/app/admin/page';

interface GrantResponse {
  ok: boolean;
  user?: { id: string; username: string | null; name: string | null };
  subscription?: { id: string; expiresAt: number; days: number };
}

interface UserProfile {
  id: string;
  username: string | null;
  name: string | null;
  isAdmin: boolean;
  subscription: { status: string; expiresAt: number } | null;
}

/**
 * Profile page is structured as four stacked blocks:
 *
 *   1. **Identity hero** — avatar + name + admin chip + theme toggle.
 *      Sets the "this is YOU" tone.
 *   2. **Subscription / paywall** — when not subscribed, this is the
 *      headline card with the daily-limit progress bar, benefits list
 *      and a primary 99⭐ CTA. When subscribed, it shrinks to a status
 *      strip showing the renewal date.
 *   3. **Settings** — three cards (Воспроизведение / Качество /
 *      Внешний вид) sharing the same `<Switch />` and segmented-button
 *      contract so toggles read identically across the page.
 *   4. **Admin** — gated behind a visible "Только для администраторов"
 *      divider so the user-facing profile doesn't bleed into ops UI.
 */

const SUBSCRIPTION_BENEFITS: { icon: typeof Check; text: string }[] = [
  { icon: Sparkles, text: 'Безлимитные прослушивания' },
  { icon: Music2, text: 'HiFi и lossless без ограничений по очереди' },
  { icon: Shield, text: 'Без рекламы и троттлинга' },
];

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

  const isSubscribed = !!profile?.subscription && profile.subscription.status === 'active';
  const isAdmin = !!profile?.isAdmin;

  return (
    <AuthGuard>
      <div className="mx-auto flex max-w-6xl flex-col gap-8 p-4 sm:p-6 lg:p-10">
        <IdentityHero
          id={user?.id ?? null}
          name={user?.name ?? null}
          username={user?.username ?? null}
          isAdmin={isAdmin}
          theme={theme}
          onToggleTheme={toggleTheme}
        />

        <SubscriptionCard
          isSubscribed={isSubscribed}
          expiresAt={profile?.subscription?.expiresAt ?? null}
          limits={limits}
          onSubscribe={() => openSubscriptionPrompt()}
        />

        <RoomsShortcut />

        <div className="grid gap-4 md:grid-cols-2">
          <SettingsCard title="Воспроизведение" icon={Sliders}>
            <SwitchRow
              title="Плавное переключение"
              hint="Микширует следующий трек поверх текущего"
              checked={crossfade}
              onCheckedChange={setCrossfade}
            />
            {crossfade && (
              <div className="mt-3">
                <label className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>Длительность</span>
                  <span className="tabular-nums text-foreground">{crossfadeDuration} с</span>
                </label>
                <input
                  type="range"
                  min={1}
                  max={12}
                  step={1}
                  value={crossfadeDuration}
                  onChange={(e) => setCrossfadeDuration(Number(e.target.value))}
                  className="mt-2 w-full accent-[var(--color-accent)]"
                />
              </div>
            )}
            <SettingsDivider />
            <SwitchRow
              title="Бесконечная музыка"
              hint="Когда очередь почти пуста, добавляем рекомендации на основе того, что играет."
              checked={infinitePlayback}
              onCheckedChange={setInfinitePlayback}
            />
          </SettingsCard>

          <SettingsCard title="Качество (Tidal)" icon={Music2} hint="Зависит от прокси-аккаунта Tidal — недоступные качества будут урезаны до доступного уровня.">
            <div className="mt-1 grid grid-cols-2 gap-2">
              {(Object.keys(TIDAL_QUALITY_LABELS) as TidalQuality[]).map((q) => {
                const active = tidalQuality === q;
                return (
                  <button
                    key={q}
                    type="button"
                    onClick={() => setTidalQuality(q)}
                    className={`flex h-10 items-center justify-between gap-2 rounded-[var(--radius-md)] border px-3 text-left text-sm transition-colors ${
                      active
                        ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-foreground'
                        : 'border-border hover:bg-secondary'
                    }`}
                  >
                    <span className="truncate">{TIDAL_QUALITY_LABELS[q]}</span>
                    {active && <span className="h-2 w-2 shrink-0 rounded-full bg-[var(--color-accent)]" />}
                  </button>
                );
              })}
            </div>
          </SettingsCard>
        </div>

        <SettingsCard title="Язык" icon={Languages}>
          <LanguageSwitcher />
        </SettingsCard>

        <div className="grid gap-4 md:grid-cols-2">
          <ResetRecommendationsPanel />
          <ResetTourPanel />
        </div>

        <Button
          onClick={logout}
          variant="outline"
          className="w-full md:max-w-xs md:self-start"
        >
          <LogOut size={14} />
          Выйти
        </Button>

        {isAdmin && (
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-3 pt-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-[var(--color-surface-elevated)] px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground backdrop-blur">
                <Lock size={11} className="text-[var(--color-accent)]" />
                Только для администраторов
              </span>
              <span className="h-px flex-1 bg-border" aria-hidden />
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <AdminGrantPanel />
              <AdminAdminFlagPanel />
              <div className="md:col-span-2">
                <AdminHealthPanel />
              </div>
              <div className="md:col-span-2">
                <AdminTidalPanel />
              </div>
              <AdminUserPurgePanel />
            </div>
            {/* Full user grid lives under the same divider — used to be
                a dedicated /admin route, now consolidated here so admins
                only have one place to look for moderation tools. */}
            {profile?.id && (
              <div className="-mx-4 sm:-mx-6 lg:-mx-10">
                <AdminDashboard meId={profile.id} />
              </div>
            )}
          </div>
        )}
      </div>
    </AuthGuard>
  );
}

// ────────────────────────────────────────────────────────────────────
// Rooms shortcut
// ────────────────────────────────────────────────────────────────────

/**
 * Single-line link card pointing into the Rooms section. The sidebar
 * already exposes /rooms on desktop, but on mobile the sidebar
 * collapses behind a hamburger and the user has to dig for it — so
 * the profile page (which is the de-facto "menu" surface on mobile)
 * surfaces a direct shortcut. Visual treatment matches the AI promo
 * card on home: same hover formula (border-strong + soft shadow lift
 * + accent halo fade-in) so the two cards read as a related family
 * across the app.
 */
function RoomsShortcut() {
  return (
    <Link
      to="/rooms"
      className="group relative flex flex-col gap-3 overflow-hidden rounded-[var(--radius-2xl)] border border-border bg-card p-4 transition-all hover:border-[var(--color-border-strong)] hover:shadow-[var(--shadow-md)] sm:flex-row sm:items-center sm:justify-between sm:p-5"
    >
      <div
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-500 group-hover:opacity-80"
        aria-hidden
        style={{
          background:
            'radial-gradient(120% 80% at 0% 0%, var(--color-accent-soft) 0%, transparent 55%), radial-gradient(80% 60% at 100% 100%, color-mix(in oklab, var(--color-sub-accent) 18%, transparent) 0%, transparent 60%)',
        }}
      />
      <div
        className="pointer-events-none absolute -right-32 -top-32 h-64 w-64 rounded-full opacity-0 blur-3xl transition-opacity duration-500 group-hover:opacity-100"
        aria-hidden
        style={{
          background: 'radial-gradient(circle, var(--color-accent-glow) 0%, transparent 70%)',
        }}
      />
      <div className="relative flex items-center gap-4">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-gradient-to-br from-[var(--color-accent)] to-fuchsia-500 text-white shadow-[0_4px_20px_-4px_var(--color-accent-glow)]">
          <Headphones size={18} />
        </div>
        <div className="min-w-0">
          <div className="text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground">
            Комнаты
          </div>
          <div className="mt-0.5 text-sm font-semibold tracking-tight sm:text-base">
            Слушать вместе с друзьями
          </div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            Создай свою комнату или подключись по приглашению.
          </div>
        </div>
      </div>
      <span className="relative inline-flex w-fit items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground transition-colors group-hover:border-[var(--color-accent)]/40">
        Открыть
        <ArrowRight size={12} className="transition-transform group-hover:translate-x-0.5" />
      </span>
    </Link>
  );
}

// ────────────────────────────────────────────────────────────────────
// Hero
// ────────────────────────────────────────────────────────────────────

function IdentityHero({
  id,
  name,
  username,
  isAdmin,
  theme,
  onToggleTheme,
}: {
  id: string | null;
  name: string | null;
  username: string | null;
  isAdmin: boolean;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
}) {
  // Same low-intensity tilt + glare wrapper used by the WaveHero on /home
  // and the landing feature grid — gives the identity card the
  // "alive on hover" feel without rotating the theme-toggle button so
  // far that it loses pointer capture between mousedown and mouseup.
  return (
    <TiltCard intensity={6} hoverScale={1} glareStrength={0.4} className="rounded-[var(--radius-2xl)]">
    <section
      className="group relative overflow-hidden rounded-[var(--radius-2xl)] border border-border bg-card p-6 transition-colors hover:border-[var(--color-border-strong)] sm:p-8"
      data-tour-id="tour-profile"
    >
      <div
        className="pointer-events-none absolute inset-0 opacity-80"
        aria-hidden
        style={{
          background:
            'radial-gradient(120% 80% at 0% 0%, var(--color-accent-soft) 0%, transparent 55%), radial-gradient(80% 60% at 100% 100%, color-mix(in oklab, var(--color-sub-accent) 18%, transparent) 0%, transparent 60%)',
        }}
      />
      <div
        className="pointer-events-none absolute -right-32 -top-32 h-64 w-64 rounded-full opacity-0 blur-3xl transition-opacity duration-500 group-hover:opacity-100"
        aria-hidden
        style={{
          background:
            'radial-gradient(circle, var(--color-accent-glow) 0%, transparent 70%)',
        }}
      />
      <div className="relative flex flex-wrap items-center justify-between gap-6">
        <div className="flex items-center gap-4">
          <UserAvatar
            name={name}
            username={username}
            id={id}
            className="h-16 w-16 rounded-full border border-border shadow-[var(--shadow-sm)]"
            initialsClassName="text-2xl"
          />
          <div className="min-w-0">
            <span className="text-xs font-medium uppercase tracking-[0.25em] text-muted-foreground">
              Профиль
            </span>
            <h1 className="mt-0.5 truncate text-2xl font-semibold tracking-tight sm:text-3xl">
              {name ?? username ?? 'Пользователь'}
            </h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              {username && <span className="truncate">@{username}</span>}
              {isAdmin && (
                <span className="inline-flex items-center gap-1 rounded-full border border-border bg-[var(--color-surface-elevated)] px-2 py-0.5 font-medium text-foreground backdrop-blur">
                  <Shield size={11} />
                  Admin
                </span>
              )}
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={onToggleTheme}
          className="inline-flex h-10 items-center gap-2 rounded-full border border-border bg-[var(--color-surface-elevated)] px-3.5 text-sm font-medium text-foreground transition-colors hover:bg-secondary"
          aria-label="Переключить тему"
        >
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
          <span className="tabular-nums">{theme === 'dark' ? 'Тёмная' : 'Светлая'}</span>
        </button>
      </div>
    </section>
    </TiltCard>
  );
}

// ────────────────────────────────────────────────────────────────────
// Subscription
// ────────────────────────────────────────────────────────────────────

function SubscriptionCard({
  isSubscribed,
  expiresAt,
  limits,
  onSubscribe,
}: {
  isSubscribed: boolean;
  expiresAt: number | null;
  limits: UserLimits | undefined;
  onSubscribe: () => void;
}) {
  if (isSubscribed && expiresAt) {
    return (
      <section className="relative overflow-hidden rounded-[var(--radius-xl)] border border-[var(--color-accent)]/40 bg-[var(--color-accent)]/8 p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-[var(--color-accent)]/15 text-[var(--color-accent)]">
              <Crown size={18} />
            </span>
            <div>
              <p className="text-base font-semibold tracking-tight">Подписка активна</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Продлится до {new Date(expiresAt * 1000).toLocaleDateString('ru-RU')}
              </p>
            </div>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-accent)]/40 bg-background/60 px-3 py-1 text-xs font-medium text-foreground backdrop-blur">
            <Sparkles size={11} className="text-[var(--color-accent)]" />
            Без лимитов
          </span>
        </div>
      </section>
    );
  }

  const used = limits?.daily.used ?? 0;
  const limit = limits?.daily.limit ?? 3;
  const ratio = limit > 0 ? Math.min(1, used / limit) : 0;

  // Same tilt + glow signature as IdentityHero / WaveHero. The CTA
  // button lives inside; intensity 6 keeps its hit-box stable.
  return (
    <TiltCard intensity={6} hoverScale={1} glareStrength={0.45} className="rounded-[var(--radius-2xl)]">
    <section className="group relative overflow-hidden rounded-[var(--radius-2xl)] border border-border bg-card p-6 transition-colors hover:border-[var(--color-border-strong)] sm:p-10">
      <div
        className="pointer-events-none absolute inset-0"
        aria-hidden
        style={{
          background:
            'radial-gradient(110% 70% at 100% 0%, var(--color-accent-soft) 0%, transparent 55%), radial-gradient(80% 60% at 0% 100%, color-mix(in oklab, var(--color-sub-accent) 14%, transparent) 0%, transparent 60%)',
        }}
      />
      <div
        className="pointer-events-none absolute -right-32 -top-32 h-64 w-64 rounded-full opacity-0 blur-3xl transition-opacity duration-500 group-hover:opacity-100"
        aria-hidden
        style={{
          background:
            'radial-gradient(circle, var(--color-accent-glow) 0%, transparent 70%)',
        }}
      />
      <div className="relative grid gap-8 lg:grid-cols-[1fr_auto] lg:items-center">
        <div className="flex flex-col gap-4">
          <span className="inline-flex w-fit items-center gap-2 rounded-full border border-border bg-[var(--color-surface-elevated)] px-2.5 py-1 text-xs font-medium text-muted-foreground backdrop-blur">
            <Crown size={12} className="text-[var(--color-accent)]" />
            Premium
          </span>
          <h2 className="max-w-xl text-2xl font-semibold leading-tight tracking-tight sm:text-4xl">
            Сними потолок{' '}
            <span className="font-serif italic text-muted-foreground">3-х треков</span>{' '}
            в день.
          </h2>
          <p className="max-w-xl text-sm text-muted-foreground sm:text-base">
            Безлимитный lossless-стриминг и full HiFi за 99 ⭐ в месяц. Оплата прямо в Telegram, без карт и сайтов.
          </p>

          <ul className="flex flex-col gap-2 pt-1 text-sm">
            {SUBSCRIPTION_BENEFITS.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-2.5">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--color-accent)]/12 text-[var(--color-accent)]">
                  <Icon size={12} />
                </span>
                <span>{text}</span>
              </li>
            ))}
          </ul>

          {limits && !limits.daily.unlimited && (
            <div className="mt-2">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Сегодня прослушано</span>
                <span className="tabular-nums text-foreground">{used} / {limit}</span>
              </div>
              <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-bg-muted)]">
                <motion.div
                  initial={{ scaleX: 0 }}
                  animate={{ scaleX: ratio }}
                  transition={{ duration: 0.6, ease: 'easeOut' }}
                  style={{ originX: 0 }}
                  className="h-full bg-[var(--color-accent)]"
                />
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-col items-start gap-3 lg:items-end">
          <div className="flex items-baseline gap-2">
            <span className="text-4xl font-semibold tracking-tight">99</span>
            <span className="text-base text-muted-foreground">⭐ / мес</span>
          </div>
          <Button
            type="button"
            size="lg"
            onClick={onSubscribe}
            className="w-full gap-2 px-7 sm:w-auto"
          >
            <Crown size={16} />
            Оформить подписку
          </Button>
          <p className="text-[11px] text-muted-foreground">
            Можно отменить в любой момент в Telegram.
          </p>
        </div>
      </div>
    </section>
    </TiltCard>
  );
}

// ────────────────────────────────────────────────────────────────────
// Settings building blocks
// ────────────────────────────────────────────────────────────────────

function SettingsCard({
  title,
  icon: Icon,
  hint,
  children,
}: {
  title: string;
  icon: typeof Sliders;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[var(--radius-xl)] border border-border bg-card p-5 sm:p-6">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Icon size={14} className="text-muted-foreground" />
        {title}
      </div>
      {hint && <p className="mt-2 text-xs text-muted-foreground">{hint}</p>}
      <div className={hint ? 'mt-4' : 'mt-3'}>{children}</div>
    </section>
  );
}

function SwitchRow({
  title,
  hint,
  checked,
  onCheckedChange,
}: {
  title: string;
  hint?: string;
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-3 text-sm">
      <span className="flex flex-col">
        <span>{title}</span>
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      </span>
      <Switch checked={checked} onCheckedChange={onCheckedChange} ariaLabel={title} />
    </label>
  );
}

function SettingsDivider() {
  return <div className="my-4 h-px w-full bg-border" aria-hidden />;
}

// ────────────────────────────────────────────────────────────────────
// Admin: grant subscription
// ────────────────────────────────────────────────────────────────────

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
    <section className="rounded-[var(--radius-xl)] border border-border bg-card p-5">
      <h2 className="flex items-center gap-2 text-sm font-medium">
        <Wand2 size={14} className="text-muted-foreground" />
        Выдача подписки
      </h2>
      <p className="mt-2 text-xs text-muted-foreground">
        ID или @username и количество дней.
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
