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
import { useSettingsStore, TIDAL_QUALITY_LABEL_KEYS, type TidalQuality } from '@/store/settings';
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
import { ClearHistoryPanel } from '@/components/features/ClearHistoryPanel';
import { ResetTourPanel } from '@/components/features/ResetTourPanel';
import { BannedListPanel } from '@/components/features/BannedListPanel';
import { AdminDashboard } from '@/app/admin/page';
import { useT, useI18n } from '@/i18n';

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

const SUBSCRIPTION_BENEFITS: { icon: typeof Check; key: 'lossless' | 'hifi' | 'noads' }[] = [
  { icon: Sparkles, key: 'lossless' },
  { icon: Music2, key: 'hifi' },
  { icon: Shield, key: 'noads' },
];

export function ProfilePage() {
  const t = useT();
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
          <SettingsCard title={t('settings.playback')} icon={Sliders}>
            <SwitchRow
              title={t('settings.crossfade')}
              hint={t('settings.crossfadeHint')}
              checked={crossfade}
              onCheckedChange={setCrossfade}
            />
            {crossfade && (
              <div className="mt-3">
                <label className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{t('settings.crossfadeDuration')}</span>
                  <span className="tabular-nums text-foreground">{t('profile.crossfadeSeconds', { value: crossfadeDuration })}</span>
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
              title={t('settings.infinitePlayback')}
              hint={t('settings.infinitePlaybackHint')}
              checked={infinitePlayback}
              onCheckedChange={setInfinitePlayback}
            />
          </SettingsCard>

          <SettingsCard title={t('profile.tidalQualityTitle')} icon={Music2} hint={t('profile.tidalQualityHint')}>
            <div className="mt-1 grid grid-cols-2 gap-2">
              {(Object.keys(TIDAL_QUALITY_LABEL_KEYS) as TidalQuality[]).map((q) => {
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
                    <span className="truncate">{t(TIDAL_QUALITY_LABEL_KEYS[q])}</span>
                    {active && <span className="h-2 w-2 shrink-0 rounded-full bg-[var(--color-accent)]" />}
                  </button>
                );
              })}
            </div>
          </SettingsCard>
        </div>

        <SettingsCard
          title={t('profile.languageTitle')}
          icon={Languages}
          hint={t('settings.languageHint')}
        >
          <LanguageSwitcher />
        </SettingsCard>

        {/* Reset/maintenance row — three sibling self-service actions
            sharing one visual rhythm with the SettingsCard family
            (same radius, same accent-soft icon swatch, same body
            density). Layout fans out from one column on mobile through
            two on tablets to three on desktop so we never end up with
            a single card stranded on its own row. */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <ResetRecommendationsPanel />
          <ClearHistoryPanel />
          <ResetTourPanel />
        </div>

        <BannedListPanel />

        {/* Sign-out lives in its own thin card so the page closes on the
            same visual rhythm as the surrounding settings/maintenance
            panels (matching radius, accent-soft icon swatch) instead of
            an orphaned button floating between sections. */}
        <section className="flex flex-wrap items-center justify-between gap-4 rounded-[var(--radius-xl)] border border-border bg-card p-5 sm:p-6">
          <div className="flex items-start gap-3 min-w-0">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]">
              <LogOut size={16} />
            </span>
            <div className="min-w-0">
              <h2 className="text-sm font-medium leading-tight">{t('profile.logout')}</h2>
              <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                {t('auth_more.logoutHint')}
              </p>
            </div>
          </div>
          <Button
            onClick={logout}
            variant="outline"
            className="w-full sm:w-auto"
          >
            <LogOut size={14} />
            {t('profile.logout')}
          </Button>
        </section>

        {isAdmin && (
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-3 pt-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-[var(--color-surface-elevated)] px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground backdrop-blur">
                <Lock size={11} className="text-[var(--color-accent)]" />
                {t('profile.adminGate')}
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
  const t = useT();
  return (
    <TiltCard
      intensity={6}
      hoverScale={1}
      glareStrength={0.4}
      className="rounded-[var(--radius-2xl)]"
    >
      <Link
        to="/rooms"
        className="group relative flex flex-col gap-3 overflow-hidden rounded-[var(--radius-2xl)] border border-border bg-card p-4 transition-all hover:border-[var(--color-border-strong)] hover:shadow-[var(--shadow-md)] sm:flex-row sm:items-center sm:justify-between sm:p-5"
      >
        {/* Static idle gradient — same two-corner signature shared with
            WaveHero, AiPlaylistPromo, AI prompt and the rooms-list hero
            so the entry-point cards read as one premium family. */}
        <div
          className="pointer-events-none absolute inset-0"
          aria-hidden
          style={{
            background:
              'radial-gradient(110% 70% at 100% 0%, var(--color-accent-soft) 0%, transparent 55%), radial-gradient(80% 60% at 0% 100%, color-mix(in oklab, var(--color-sub-accent) 14%, transparent) 0%, transparent 60%)',
          }}
        />
        {/* Existing hover-only halo, kept so the lift reads stronger
            than the idle baseline. */}
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
          {/* Icon swatch matches the AI-Playlist promo on /home: a clean
              accent-soft tint instead of the previous accent→fuchsia
              gradient, so the entry-point cards across home / profile
              read as one family in a single accent palette. */}
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]">
            <Headphones size={18} />
          </div>
          <div className="min-w-0">
            <div className="text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground">
              {t('rooms.shortcutLabel')}
            </div>
            <div className="mt-0.5 text-sm font-semibold tracking-tight sm:text-base">
              {t('rooms.shortcutTitle')}
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              {t('rooms.shortcutHint')}
            </div>
          </div>
        </div>
        <span className="relative inline-flex w-fit items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground transition-colors group-hover:border-[var(--color-accent)]/40">
          {t('rooms.shortcutCta')}
          <ArrowRight size={12} className="transition-transform group-hover:translate-x-0.5" />
        </span>
      </Link>
    </TiltCard>
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
  const t = useT();
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
              {t('profile.label')}
            </span>
            <h1 className="mt-0.5 truncate text-2xl font-semibold tracking-tight sm:text-3xl">
              {name ?? username ?? t('profile.fallbackName')}
            </h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              {username && <span className="truncate">@{username}</span>}
              {isAdmin && (
                <span className="inline-flex items-center gap-1 rounded-full border border-border bg-[var(--color-surface-elevated)] px-2 py-0.5 font-medium text-foreground backdrop-blur">
                  <Shield size={11} />
                  {t('profile.adminBadge')}
                </span>
              )}
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={onToggleTheme}
          className="inline-flex h-10 items-center gap-2 rounded-full border border-border bg-[var(--color-surface-elevated)] px-3.5 text-sm font-medium text-foreground transition-colors hover:bg-secondary"
          aria-label={t('profile.themeToggleAria')}
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
          <span className="tabular-nums">{theme === 'dark' ? t('settings.themeDark') : t('settings.themeLight')}</span>
        </button>
      </div>
    </section>
    </TiltCard>
  );
}

// ────────────────────────────────────────────────────────────────────
// Subscription
// ────────────────────────────────────────────────────────────────────

/**
 * Splits the localized premium headline around the emphasized phrase
 * (`profile.premiumHeadlineEmphasis`) so the italic accent stays in
 * the right spot regardless of locale word order. Falls back to plain
 * text if the emphasis phrase isn't found in the headline.
 */
function PremiumHeadline() {
  const t = useT();
  const headline = t('profile.premiumHeadline');
  const emphasis = t('profile.premiumHeadlineEmphasis');
  const idx = headline.indexOf(emphasis);
  if (idx < 0) return <>{headline}</>;
  const before = headline.slice(0, idx);
  const after = headline.slice(idx + emphasis.length);
  return (
    <>
      {before}
      <span className="font-serif italic text-muted-foreground">{emphasis}</span>
      {after}
    </>
  );
}

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
  const t = useT();
  const { locale } = useI18n();
  const dateLocale = locale === 'en' ? 'en-US' : 'ru-RU';
  if (isSubscribed && expiresAt) {
    // Active-subscription card mirrors the RoomsShortcut treatment
    // exactly: TiltCard wrapper, idle two-corner gradient signature
    // shared with WaveHero / AiPlaylistPromo / RoomsShortcut, hover
    // halo + accent-glow blob fade-in, and the same icon-swatch +
    // label/title/hint stack with a pill on the right. That keeps
    // every entry-point card on the profile page in one premium
    // family — the user explicitly asked for this parity.
    return (
      <TiltCard
        intensity={6}
        hoverScale={1}
        glareStrength={0.4}
        className="rounded-[var(--radius-2xl)]"
      >
        <section className="group relative flex flex-col gap-3 overflow-hidden rounded-[var(--radius-2xl)] border border-border bg-card p-4 transition-all hover:border-[var(--color-border-strong)] hover:shadow-[var(--shadow-md)] sm:flex-row sm:items-center sm:justify-between sm:p-5">
          {/* Static idle gradient — same two-corner signature as the
              RoomsShortcut / AI promo. */}
          <div
            className="pointer-events-none absolute inset-0"
            aria-hidden
            style={{
              background:
                'radial-gradient(110% 70% at 100% 0%, var(--color-accent-soft) 0%, transparent 55%), radial-gradient(80% 60% at 0% 100%, color-mix(in oklab, var(--color-sub-accent) 14%, transparent) 0%, transparent 60%)',
            }}
          />
          {/* Hover-only intensified gradient pass — adds depth to the
              lift so the hover state reads stronger than the idle. */}
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
              background:
                'radial-gradient(circle, var(--color-accent-glow) 0%, transparent 70%)',
            }}
          />
          <div className="relative flex items-center gap-4">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]">
              <Crown size={18} />
            </div>
            <div className="min-w-0">
              <div className="text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground">
                {t('profile.premiumTag')}
              </div>
              <div className="mt-0.5 text-sm font-semibold tracking-tight sm:text-base">
                {t('profile.subscriptionActive')}
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                {t('profile.subscriptionRenewsBy', {
                  date: new Date(expiresAt * 1000).toLocaleDateString(dateLocale),
                })}
              </div>
            </div>
          </div>
          <span className="relative inline-flex w-fit items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground transition-colors group-hover:border-[var(--color-accent)]/40">
            <Sparkles size={11} className="text-[var(--color-accent)]" />
            {t('profile.subscriptionUnlimited')}
          </span>
        </section>
      </TiltCard>
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
            {t('profile.premiumTag')}
          </span>
          <h2 className="max-w-xl text-2xl font-semibold leading-tight tracking-tight sm:text-4xl">
            <PremiumHeadline />
          </h2>
          <p className="max-w-xl text-sm text-muted-foreground sm:text-base">
            {t('profile.premiumTagline')}
          </p>

          <ul className="flex flex-col gap-2 pt-1 text-sm">
            {SUBSCRIPTION_BENEFITS.map(({ icon: Icon, key }) => (
              <li key={key} className="flex items-center gap-2.5">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--color-accent)]/12 text-[var(--color-accent)]">
                  <Icon size={12} />
                </span>
                <span>{t(`profile.benefits.${key}` as const)}</span>
              </li>
            ))}
          </ul>

          {limits && !limits.daily.unlimited && (
            <div className="mt-2">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{t('profile.playedToday')}</span>
                <span className="tabular-nums text-foreground">{t('profile.playedRatio', { used, limit })}</span>
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
            <span className="text-base text-muted-foreground">{t('profile.perMonth')}</span>
          </div>
          <Button
            type="button"
            size="lg"
            onClick={onSubscribe}
            className="w-full gap-2 px-7 sm:w-auto"
          >
            <Crown size={16} />
            {t('profile.subscribeCta')}
          </Button>
          <p className="text-[11px] text-muted-foreground">
            {t('profile.cancelHint')}
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
    <section className="flex h-full flex-col rounded-[var(--radius-xl)] border border-border bg-card p-5 sm:p-6">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]">
          <Icon size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-medium leading-tight">{title}</h2>
          {hint && (
            <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
              {hint}
            </p>
          )}
        </div>
      </div>
      <div className="mt-4 flex flex-1 flex-col">{children}</div>
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
  const t = useT();
  const { locale } = useI18n();
  const [target, setTarget] = useState('');
  const [days, setDays] = useState('30');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const submit = async () => {
    const value = target.trim();
    if (!value) return;
    setBusy(true);
    setMsg(null);
    try {
      const payload: { userId?: string; tgUsername?: string; days: number } = { days: Number(days) || 30 };
      if (/^\d+$/.test(value)) payload.userId = value;
      else payload.tgUsername = value;
      const r = await api.post<GrantResponse>('/admin/grant', payload);
      if (r.ok && r.user && r.subscription) {
        const u = r.user.username ? '@' + r.user.username : (r.user.name ?? r.user.id);
        const exp = new Date(r.subscription.expiresAt * 1000).toLocaleDateString(locale === 'en' ? 'en-US' : 'ru-RU');
        setMsg({
          kind: 'ok',
          text: t('admin_panels.grant.success', { user: u, days: r.subscription.days, date: exp }),
        });
        setTarget('');
      } else {
        setMsg({ kind: 'err', text: t('admin_panels.grant.failed') });
      }
    } catch (err) {
      setMsg({ kind: 'err', text: err instanceof Error ? err.message : t('admin_panels.grant.genericError') });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="flex h-full flex-col rounded-[var(--radius-xl)] border border-border bg-card p-5 sm:p-6">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]">
          <Wand2 size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-medium leading-tight">
            {t('admin_panels.grant.title')}
          </h2>
          <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
            {t('admin_panels.grant.hint')}
          </p>
        </div>
      </div>
      <div className="mt-4 flex flex-1 flex-col gap-2">
        <input
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          placeholder={t('admin_panels.grant.targetPlaceholder')}
          className="w-full rounded-[var(--radius-sm)] border border-border bg-background px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
        />
        <div className="flex items-center gap-2">
          <input
            value={days}
            onChange={(e) => setDays(e.target.value.replace(/[^\d]/g, ''))}
            placeholder={t('admin_panels.grant.daysPlaceholder')}
            className="w-20 rounded-[var(--radius-sm)] border border-border bg-background px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
          />
          <Button onClick={submit} disabled={busy || !target.trim()} className="flex-1">
            {busy ? t('admin_panels.grant.submitting') : t('admin_panels.grant.submit')}
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
