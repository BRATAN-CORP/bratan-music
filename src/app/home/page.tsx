import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import {
  Play,
  Pause,
  Sparkles,
  Library,
  History as HistoryIcon,
  RefreshCw,
  ListMusic,
  ArrowRight,
  Disc3,
  Check,
  Wand2,
  Moon,
  Flame,
  Target,
  PartyPopper,
  Rewind,
  SlidersHorizontal,
  RotateCcw,
  X,
  Repeat,
  Compass,
  TrendingUp,
} from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { Button } from '@/components/ui/Button';
import { Aurora } from '@/components/ui/Aurora';
import { Reveal, Stagger } from '@/components/ui/Reveal';
import { Skeleton } from '@/components/ui/Skeleton';
import { TiltCard } from '@/components/ui/TiltCard';
import { TrackItem } from '@/components/features/TrackItem';
import { ArtistPicker } from '@/components/features/ArtistPicker';

import {
  fetchWave,
  fetchDailyPlaylists,
  fetchSeedArtists,
  fetchRecentPlays,
  saveDailyPlaylist,
  WAVE_MOODS,
  WAVE_CHARACTERS,
  type DailyPlaylist,
  type RecentTrack,
  type WaveMood,
  type WaveCharacter,
} from '@/lib/recommendations';
import { DAILY_VARIANT_THEME, dailyTrackUnitKey } from '@/lib/dailyVariant';
import { startMyWave } from '@/lib/wave';
import { usePlayerStore } from '@/store/player';
import { useTrackPlayback, useCollectionPlayback } from '@/hooks/usePlaybackSync';
import { useAuthStore } from '@/store/auth';
import { EASE_SPRING as EASE, staggerItem } from '@/lib/motion';
import { cn } from '@/lib/utils';
import type { Track } from '@/types';
import { useT, type TranslationKey } from '@/i18n';
import { toast } from '@/store/toast';

type Translate = ReturnType<typeof useT>;

/**
 * Home dashboard for authenticated users. Three sections:
 *
 *   1. **Hero "Моя волна"** — the headline element. One-tap personal
 *      stream. If the user has no taste signal yet (no history, no
 *      seed artists) we render the ArtistPicker inline instead so the
 *      first-time experience is "pick artists → listen", not "see an
 *      empty page → figure out what to do".
 *
 *   2. **Плейлисты дня** — three variants (Знакомое / Открытия /
 *      Под настроение). Each one playable as a queue and savable to
 *      the library as a permanent snapshot.
 *
 *   3. **Недавно слушал** — last ~12 tracks from history. Tapping any
 *      row resumes that track. The last row is a link to the full
 *      "library" or just expands into more rows if needed.
 *
 * Uses TanStack Query throughout so revisiting the page reuses
 * cached data and re-fetches only when explicitly invalidated (e.g.
 * after a wave save or genre-seed change).
 */
export function HomePage() {
  const t = useT();
  const user = useAuthStore((s) => s.user);
  const reduce = useReducedMotion();

  const seedsQ = useQuery({
    queryKey: ['recommendations', 'seed-artists'],
    queryFn: fetchSeedArtists,
    staleTime: 60_000,
  });

  const needsOnboarding = !!seedsQ.data && !seedsQ.data.hasHistory && seedsQ.data.artistIds.length === 0;
  const [forceShowPicker, setForceShowPicker] = useState(false);

  return (
    <div className="relative w-full">
      {/*
       * Hero clipping. Same reasoning as the landing hero — see
       * comment in `src/app/landing/page.tsx`. `clip-path: inset(0 0
       * -240px 0)` keeps horizontal clipping while letting the bottom
       * Aurora blob bleed 240px below the section, so the hero
       * transitions softly into the daily-playlists grid instead of
       * ending with a hard horizontal cut.
       */}
      <section className="relative pb-10 pt-12 sm:pt-16 lg:pb-14 [clip-path:inset(0_0_-240px_0)]">
        <Aurora variant="hero" />
        <div className="grid-bg absolute inset-0 opacity-20" aria-hidden />

        <div className="relative mx-auto flex max-w-6xl flex-col gap-8 px-4 sm:px-6 lg:px-10">
          <motion.div
            initial={reduce ? false : { opacity: 0, y: 12 }}
            animate={reduce ? undefined : { opacity: 1, y: 0 }}
            transition={{ duration: 0.7, ease: EASE }}
            className="flex flex-col gap-2"
          >
            <span className="inline-flex w-fit items-center gap-2 rounded-full border border-border bg-[var(--color-surface-elevated)] px-3 py-1.5 text-xs font-medium text-muted-foreground backdrop-blur">
              <Sparkles size={12} className="text-[var(--color-accent)]" />
              <span>
                {greeting(t)}{user?.name ? ',' : ''}
                {user?.name ? <span className="ml-1 text-foreground">{user.name}</span> : null}
              </span>
            </span>

            <h1 className="max-w-3xl text-[clamp(2rem,5vw,3.6rem)] font-semibold leading-[1.04] tracking-tight">
              {t('home.heroLine1')}{' '}<span className="font-serif italic text-muted-foreground">{t('home.heroLine1Italic')}</span>{t('home.heroLine1End')}
              <br className="hidden sm:block" /> {t('home.heroLine2Start')}{' '}<span className="shine-text">{t('home.heroLine2Highlight')}</span>.
            </h1>
          </motion.div>

          {needsOnboarding || forceShowPicker ? (
            <ArtistPicker
              onComplete={() => {
                setForceShowPicker(false);
                seedsQ.refetch();
              }}
              onSkip={forceShowPicker ? () => setForceShowPicker(false) : undefined}
            />
          ) : (
            <WaveHero
              onChangeArtists={() => setForceShowPicker(true)}
              hasSeedArtists={!!seedsQ.data && seedsQ.data.artistIds.length > 0}
            />
          )}
        </div>
      </section>

      <AiPlaylistPromo />

      <DailyPlaylistsSection />

      <RecentSection />
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// AI playlist promo
// ────────────────────────────────────────────────────────────────────

/**
 * Compact entry-point card sitting between the wave hero and the
 * daily playlists. Lives only on the authenticated home — gives the
 * AI-playlist feature a permanent, on-route visual anchor instead
 * of relying entirely on the sidebar nav item. The card mirrors
 * the wave hero's hover treatment (border-glow + accent halo) so
 * the two read as a related family at the top of the page.
 */
function AiPlaylistPromo() {
  const t = useT();
  // Hover treatment matched to the daily-playlist cards directly
  // below this on /home: clean idle (no decorative layer visible),
  // and on hover the card lifts via border-strong + shadow-md while
  // the Sparkles badge scales 1.05 over 700ms — same physics as the
  // album cover scaling inside daily cards. Decorative glow lives
  // on `pointer-events-none` layers so the "Попробовать" pill stays
  // fully interactive throughout the hover.
  return (
    <Reveal>
      <section className="relative mx-auto w-full max-w-6xl px-4 pt-2 sm:px-6 lg:px-10" data-tour-id="tour-ai">
        <TiltCard
          intensity={6}
          hoverScale={1}
          glareStrength={0.45}
          className="rounded-[var(--radius-xl)]"
        >
        <Link
          to="/ai"
          className="group relative flex flex-col gap-4 overflow-hidden rounded-[var(--radius-xl)] border border-border bg-card p-5 transition-all hover:border-[var(--color-border-strong)] hover:shadow-[var(--shadow-md)] sm:flex-row sm:items-center sm:justify-between sm:p-6"
        >
          {/* Static idle gradient — same two-corner signature as the
              SubscriptionCard reference in /profile. Lives below the
              hover-only halo on the same `pointer-events-none` layer
              so the "Попробовать" pill stays interactive. */}
          <div
            className="pointer-events-none absolute inset-0"
            aria-hidden
            style={{
              background:
                'radial-gradient(110% 70% at 100% 0%, var(--color-accent-soft) 0%, transparent 55%), radial-gradient(80% 60% at 0% 100%, color-mix(in oklab, var(--color-sub-accent) 14%, transparent) 0%, transparent 60%)',
            }}
          />
          <div
            className="pointer-events-none absolute -right-24 -top-24 h-48 w-48 rounded-full opacity-0 blur-3xl transition-opacity duration-500 group-hover:opacity-90"
            aria-hidden
            style={{
              background:
                'radial-gradient(circle, var(--color-accent-glow) 0%, transparent 70%)',
            }}
          />
          <div className="relative flex items-center gap-4">
            {/* Icon swatch — was a fuchsia-to-accent gradient with a Sparkles
                glyph, which read as a third accent palette grafted onto the
                page. Now uses the same accent-soft tint family as the rest of
                the eyebrow chips (Premium tag, daily-mood pills) and a clean
                Wand2 glyph that telegraphs "AI generation" without needing a
                rainbow. The hover scale is preserved so the lift physics
                still match the daily-playlist cards directly below. */}
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-accent-soft)] text-[var(--color-accent)] transition-transform duration-700 group-hover:scale-105">
              <Wand2 size={20} />
            </div>
            <div className="min-w-0">
              <div className="text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground">
                {t('home.aiPlaylistEyebrow')}
              </div>
              <div className="mt-1 text-base font-semibold tracking-tight sm:text-lg">
                {t('home.aiPlaylistTitle')}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {t('home.aiPlaylistHint')}
              </div>
            </div>
          </div>
          <span className="relative inline-flex w-fit items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground transition-colors group-hover:border-[var(--color-accent)]/40">
            {t('home.aiPlaylistCta')}
            <ArrowRight size={12} className="transition-transform group-hover:translate-x-0.5" />
          </span>
        </Link>
        </TiltCard>
      </section>
    </Reveal>
  );
}

// ────────────────────────────────────────────────────────────────────
// Hero
// ────────────────────────────────────────────────────────────────────

function WaveHero({
  onChangeArtists,
  hasSeedArtists,
}: {
  onChangeArtists: () => void;
  hasSeedArtists: boolean;
}) {
  const t = useT();
  const [starting, setStarting] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // null = "сбалансированная" волна без биаса. Mood управляет
  // содержанием candidate-pool на бэке (mood_<slug> explore-page +
  // +0.30 в rerank), character — наклоном novelty/familiar gates
  // ("чаще что я уже знаю" vs "чаще что не слышал" vs "что сейчас
  // популярно").
  const [mood, setMood] = useState<WaveMood | null>(null);
  const [character, setCharacter] = useState<WaveCharacter | null>(null);

  // Подкачиваем превью под выбранные настройки — covers + previewStrip
  // мгновенно дают юзеру понять как изменится волна до клика
  // "Включить волну".
  const previewQ = useQuery({
    queryKey: ['recommendations', 'wave-preview', mood ?? 'default', character ?? 'default'],
    queryFn: () => fetchWave(8, { mood, character }),
    // Preview is just a teaser — let it go stale quickly so the user
    // sees a fresh feel after they navigate away and come back.
    staleTime: 60_000,
  });

  // Treat any preview track being currently active as "the wave is on
  // air" — let the CTA collapse to play/pause behaviour instead of
  // re-spawning a fresh wave (which would replace the user's queue).
  const previewIds = useMemo(() => (previewQ.data ?? []).map((tr) => tr.id), [previewQ.data]);
  const togglePlay = usePlayerStore((s) => s.togglePlay);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const currentTrackId = usePlayerStore((s) => s.currentTrack?.id);
  const waveOnAir = !!currentTrackId && previewIds.includes(currentTrackId);

  const start = async () => {
    if (waveOnAir) {
      togglePlay();
      return;
    }
    setStarting(true);
    try {
      await startMyWave({ mood, character });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('home.waveError'));
    } finally {
      setStarting(false);
    }
  };

  // Hero card without TiltCard wrapping: the 3D rotation kept eating
  // clicks on the secondary CTA even at minimal intensity, because
  // any non-zero parent transform shifts the buttons' bounding boxes
  // between mousedown and mouseup. The hover treatment is now matched
  // to the daily-playlist cards below this hero — clean idle, gentle
  // border-strong + shadow-md lift on hover, and the CoverStack on
  // the right scales 1.05 over 700ms (the daily cards' album image
  // does the same). All decorative layers stay on
  // `pointer-events-none` so the "Включить волну" / "Поменять
  // артистов" buttons sit on a stable, fully clickable pixel grid.
  return (
    <Reveal>
      <TiltCard
        intensity={6}
        hoverScale={1}
        glareStrength={0.45}
        className="rounded-[var(--radius-xl)]"
      >
      <div className="group isolate min-w-0 rounded-[var(--radius-xl)]" data-tour-id="tour-wave">
        <div className="relative isolate overflow-hidden rounded-[var(--radius-xl)] border border-border bg-card transition-all hover:border-[var(--color-border-strong)] hover:shadow-[var(--shadow-md)]">
          {/* Static idle gradient — same two-corner signature as the
              SubscriptionCard reference in /profile. */}
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

          <div className="relative grid gap-6 p-5 sm:gap-8 sm:p-10 lg:grid-cols-[minmax(0,1fr)_auto] lg:gap-10">
            <div className="flex min-w-0 flex-col justify-between gap-6">
              <div className="flex min-w-0 flex-col gap-3">
                <div className="inline-flex w-fit items-center gap-2 rounded-full border border-border bg-[var(--color-surface-elevated)] px-2.5 py-1 text-xs font-medium text-muted-foreground backdrop-blur">
                  <Disc3 size={12} className="text-[var(--color-accent)]" />
                  {t('home.waveBadge')}
                </div>
                <h2 className="text-2xl font-semibold tracking-tight [overflow-wrap:anywhere] sm:text-5xl">
                  {t('home.waveTitleA')}{' '}
                  <span className="font-serif italic text-muted-foreground">{t('home.waveTitleItalic')}</span> {t('home.waveTitleB')}
                </h2>
                <p className="max-w-xl text-sm text-muted-foreground sm:text-base">
                  {t('home.waveSubtitle')}
                </p>
              </div>

              {/* CTA layout split across breakpoints:
                    - mobile: primary button takes the full row so the
                      "Включить волну" / Pause / Continue verb is the
                      first thing the thumb hits, secondary actions
                      sit in their own row underneath as 50/50 tiles
                      (no awkward third-button-on-its-own-line wrap).
                    - sm+: everything inline, gap-3, primary keeps its
                      generous horizontal padding for visual weight. */}
              <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
                <Button
                  size="lg"
                  onClick={start}
                  disabled={starting}
                  className="w-full min-w-0 gap-2 sm:w-auto sm:px-7"
                >
                  {starting ? (
                    <>
                      <RefreshCw size={16} className="animate-spin" />
                      {t('home.waveStarting')}
                    </>
                  ) : waveOnAir && isPlaying ? (
                    <>
                      <Pause size={16} fill="currentColor" />
                      {t('home.wavePause')}
                    </>
                  ) : waveOnAir ? (
                    <>
                      <Play size={16} fill="currentColor" />
                      {t('home.waveContinue')}
                    </>
                  ) : (
                    <>
                      <Play size={16} fill="currentColor" />
                      {t('home.waveStart')}
                    </>
                  )}
                </Button>

                <div className="flex min-w-0 items-stretch gap-2 sm:contents">
                  <Button
                    variant="outline"
                    size="lg"
                    onClick={onChangeArtists}
                    className="min-w-0 flex-1 gap-2 sm:flex-none"
                  >
                    <Sparkles size={16} className="shrink-0" />
                    <span className="truncate">
                      {hasSeedArtists ? t('home.waveChangeArtists') : t('home.wavePickArtists')}
                    </span>
                  </Button>

                  {/* Configurator button — opens the Yandex-Music-style
                      sheet (mood + character). Active settings show a
                      dot indicator so the state is visible without
                      opening the sheet. */}
                  <Button
                    variant="outline"
                    size="lg"
                    onClick={() => setSettingsOpen(true)}
                    data-tour-id="tour-wave-settings"
                    className="relative min-w-0 flex-1 gap-2 sm:flex-none"
                    aria-label={t('home.waveSettingsOpen')}
                  >
                    <SlidersHorizontal size={16} className="shrink-0" />
                    <span className="truncate">{t('home.waveSettingsOpen')}</span>
                    {(mood || character) && (
                      <span
                        aria-hidden
                        className="absolute -right-1 -top-1 inline-flex h-2.5 w-2.5 rounded-full bg-[var(--color-accent)] ring-2 ring-card"
                      />
                    )}
                  </Button>
                </div>
              </div>

            </div>

            <div className="hidden lg:block transition-transform duration-700 group-hover:scale-105">
              <CoverStack tracks={previewQ.data ?? []} loading={previewQ.isLoading} />
            </div>
          </div>

          {/* Compact horizontal track-strip BELOW the hero copy, so on
              mobile users still see what's coming up before the daily
              playlists. Tapping a row plays from that track and seeds
              the wave from it (useful when one of the previews really
              catches the user's ear). */}
          <div className="relative border-t border-border">
            <PreviewStrip tracks={previewQ.data ?? []} loading={previewQ.isLoading} />
          </div>
        </div>
      </div>
      </TiltCard>

      <WaveSettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        mood={mood}
        character={character}
        onMoodChange={setMood}
        onCharacterChange={setCharacter}
      />
    </Reveal>
  );
}

/**
 * Wave configurator — Yandex-Music-flavoured sheet that slides up on
 * mobile and centres on desktop. Reuses the same `liquid-glass` panel
 * + `liquid-glass-scrim` backdrop combo as `QueueDialog` /
 * `AddToPlaylistDialog` so the visual vocabulary is consistent. Lets
 * the user pick exactly two things:
 *
 *  - **Mood** — biases the candidate pool toward a Tidal `mood_<slug>`
 *    explore page and gives those tracks a +0.30 rerank bonus.
 *  - **Character** — biases the rerank gates: `familiar` boosts the
 *    "stuff I know" weight, `discover` flips it negative so the wave
 *    skews unfamiliar, `popular` pulls from a popularity-weighted
 *    explore page.
 *
 * Both are nullable — clicking an already-active option deselects it,
 * matching the deselect pattern from the artist picker. The dialog
 * itself is non-modal in the data sense: changes apply live to the
 * preview / next wave start, no "Apply" button needed (just a Reset
 * + Close pair).
 */
const MOOD_ICON: Record<WaveMood, typeof Moon> = {
  chill: Moon,
  workout: Flame,
  focus: Target,
  party: PartyPopper,
  throwback: Rewind,
};

const CHARACTER_ICON: Record<WaveCharacter, typeof Repeat> = {
  familiar: Repeat,
  discover: Compass,
  popular: TrendingUp,
};

function WaveSettingsDialog({
  open,
  onClose,
  mood,
  character,
  onMoodChange,
  onCharacterChange,
}: {
  open: boolean;
  onClose: () => void;
  mood: WaveMood | null;
  character: WaveCharacter | null;
  onMoodChange: (m: WaveMood | null) => void;
  onCharacterChange: (c: WaveCharacter | null) => void;
}) {
  const t = useT();
  const reduce = useReducedMotion();
  const hasAny = mood !== null || character !== null;

  const handleReset = () => {
    onMoodChange(null);
    onCharacterChange(null);
  };

  // Render through a portal anchored at <body>. Without this, the
  // `position: fixed` scrim + panel would be size-constrained to the
  // first ancestor with a `transform` / `filter` / `perspective` —
  // and the WaveHero is wrapped in <Reveal /> (a motion.div that
  // keeps an inline `transform: translateY(0)` even after its enter
  // animation settles). With Reveal as the containing block the
  // "fixed" scrim was actually pinned to the WaveHero card's box,
  // which is why the page heading + AI banner stayed sharp behind it
  // ("не всю блюрит за собой" — they were never under the scrim in
  // the first place). Portalling out of the transform tree means the
  // viewport is the containing block, the scrim covers everything,
  // and the backdrop-filter blurs the entire home page.
  const dialog = (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="wave-settings-backdrop"
            initial={reduce ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            // Scrim sits at z-[100] — above the mobile bottom dock
            // (z-40), the AI-playlist banner and the floating mini
            // player so the whole home page reads as blurred-out when
            // the configurator is up. z-[60] (the QueueDialog default)
            // wasn't enough on mobile because the dock + player share
            // the bottom of the viewport with the dialog's panel.
            className="liquid-glass-scrim fixed inset-0 z-[100]"
            onClick={onClose}
            aria-hidden
          />

          <div className="fixed inset-0 z-[100] flex items-center justify-center px-3 pointer-events-none">
            <motion.div
              key="wave-settings-panel"
              role="dialog"
              aria-modal="true"
              aria-label={t('home.waveSettingsTitle')}
              initial={{ opacity: 0, y: 24, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 24, scale: 0.97, transition: { duration: 0.18 } }}
              transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
              // Centred on every breakpoint so the panel can't be
              // covered by the mini-player / mobile dock that live at
              // the bottom of the viewport. The max-height keeps the
              // dialog clear of system UI on the very smallest
              // devices.
              style={{ maxHeight: 'calc(100dvh - 4rem - var(--pwa-safe-bottom))' }}
              className="liquid-glass pointer-events-auto flex w-[min(560px,100%)] flex-col overflow-hidden rounded-[var(--radius-xl)] md:rounded-[var(--radius-lg)]"
            >
              <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
                <div className="flex min-w-0 items-center gap-2">
                  <SlidersHorizontal size={15} className="text-muted-foreground" />
                  <span className="truncate text-sm font-medium">
                    {t('home.waveSettingsTitle')}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={handleReset}
                    disabled={!hasAny}
                    aria-label={t('home.waveSettingsReset')}
                    className="inline-flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-40"
                  >
                    <RotateCcw size={13} />
                  </button>
                  <button
                    type="button"
                    onClick={onClose}
                    aria-label={t('common.close')}
                    className="inline-flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:py-5">
                <div className="space-y-5 sm:space-y-6">
                  <SettingsGroup label={t('home.waveSettingsMoodLabel')}>
                    <ChipRow
                      ariaLabel={t('home.waveSettingsMoodLabel')}
                      items={[
                        {
                          key: 'default',
                          icon: Sparkles,
                          label: t('home.waveMoodDefault'),
                          active: mood === null,
                          onClick: () => onMoodChange(null),
                        },
                        ...WAVE_MOODS.map((m) => ({
                          key: m,
                          icon: MOOD_ICON[m],
                          label: t(`home.waveMood.${m}` as TranslationKey),
                          active: mood === m,
                          onClick: () => onMoodChange(mood === m ? null : m),
                        })),
                      ]}
                    />
                  </SettingsGroup>

                  <SettingsGroup label={t('home.waveSettingsCharacterLabel')}>
                    {/* 1-col on the smallest screens (each tile lays
                        the icon left of label+hint so the line still
                        looks dense), 3-col on sm+ where width is
                        comfortable enough for the stacked variant. */}
                    <div
                      role="radiogroup"
                      aria-label={t('home.waveSettingsCharacterLabel')}
                      className="grid grid-cols-1 gap-2 sm:grid-cols-3"
                    >
                      {WAVE_CHARACTERS.map((c) => (
                        <CharacterTile
                          key={c}
                          active={character === c}
                          onClick={() => onCharacterChange(character === c ? null : c)}
                          icon={CHARACTER_ICON[c]}
                          label={t(`home.waveCharacter.${c}` as TranslationKey)}
                          hint={t(`home.waveCharacterHint.${c}` as TranslationKey)}
                        />
                      ))}
                    </div>
                  </SettingsGroup>
                </div>
              </div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );

  if (typeof document === 'undefined') return dialog;
  return createPortal(dialog, document.body);
}

function SettingsGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      {children}
    </div>
  );
}

function ChipRow({
  ariaLabel,
  items,
}: {
  ariaLabel: string;
  items: Array<{
    key: string;
    icon: typeof Moon;
    label: string;
    active: boolean;
    onClick: () => void;
  }>;
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="flex flex-wrap gap-2">
      {items.map((it) => (
        <SettingChip
          key={it.key}
          active={it.active}
          onClick={it.onClick}
          icon={it.icon}
          label={it.label}
        />
      ))}
    </div>
  );
}

function SettingChip({
  active,
  onClick,
  icon: Icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof Moon;
  label: string;
}) {
  return (
    <motion.button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      whileTap={{ scale: 0.96 }}
      transition={{ type: 'spring', stiffness: 600, damping: 30 }}
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        active
          ? 'border-transparent bg-[var(--color-accent)] text-[var(--color-text-on-accent)] shadow-[0_6px_18px_-6px_var(--color-accent-glow)]'
          : 'border-border bg-[var(--color-surface-elevated)]/60 text-foreground/80 backdrop-blur hover:border-[var(--color-border-strong)] hover:text-foreground',
      )}
    >
      <Icon size={12} />
      {label}
    </motion.button>
  );
}

function CharacterTile({
  active,
  onClick,
  icon: Icon,
  label,
  hint,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof Repeat;
  label: string;
  hint: string;
}) {
  return (
    <motion.button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      whileTap={{ scale: 0.97 }}
      transition={{ type: 'spring', stiffness: 600, damping: 30 }}
      // Mobile: horizontal row (icon left, label/hint right) so a
      // single-column 1-col grid still reads dense and tappable.
      // sm+: stacked column (icon top, then label, then hint) — same
      // shape as the daily-playlist cards a few rows below this.
      className={cn(
        'group relative flex items-center gap-3 rounded-2xl border px-3 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:flex-col sm:items-start sm:gap-1.5',
        active
          ? 'border-[var(--color-accent)]/60 bg-[var(--color-accent)]/12'
          : 'border-border bg-[var(--color-surface-elevated)]/40 hover:border-[var(--color-border-strong)]',
      )}
    >
      <div
        className={cn(
          'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border transition-colors sm:h-7 sm:w-7',
          active
            ? 'border-transparent bg-[var(--color-accent)] text-[var(--color-text-on-accent)]'
            : 'border-border bg-[var(--color-surface-elevated)]/60 text-foreground/70',
        )}
      >
        <Icon size={14} />
      </div>
      <div className="flex min-w-0 flex-col gap-0.5 sm:contents">
        <span className="text-xs font-medium text-foreground">{label}</span>
        <span className="text-[10px] leading-snug text-muted-foreground">{hint}</span>
      </div>
      {active && (
        <span
          aria-hidden
          className="absolute right-2 top-2 inline-flex h-4 w-4 items-center justify-center rounded-full bg-[var(--color-accent)] text-[var(--color-text-on-accent)]"
        >
          <Check size={10} />
        </span>
      )}
    </motion.button>
  );
}

/**
 * Stacked-cover decoration: 3 layered album covers rotating slightly,
 * pulled from the user's wave preview. Replaces a static hero image
 * with something that actually reflects the user's taste.
 */
function CoverStack({ tracks, loading }: { tracks: Track[]; loading: boolean }) {
  const covers = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const t of tracks) {
      if (!t.coverUrl) continue;
      if (seen.has(t.coverUrl)) continue;
      seen.add(t.coverUrl);
      out.push(t.coverUrl);
      if (out.length >= 3) break;
    }
    return out;
  }, [tracks]);

  if (loading) return <Skeleton className="h-[320px] w-[320px] rounded-[var(--radius-xl)]" />;

  return (
    <div className="relative h-[320px] w-[320px]">
      {covers.length === 0 ? (
        <div
          className="flex h-full w-full items-center justify-center rounded-[var(--radius-xl)] border border-border bg-[var(--color-bg-subtle)]"
          aria-hidden
        >
          <Disc3 className="h-16 w-16 text-muted-foreground/40" />
        </div>
      ) : (
        covers.map((url, i) => {
          const offset = i - (covers.length - 1) / 2;
          return (
            <motion.div
              key={url}
              initial={{ opacity: 0, scale: 0.92, rotate: offset * 6 }}
              animate={{ opacity: 1, scale: 1, rotate: offset * 6 }}
              transition={{ duration: 0.7, ease: EASE, delay: i * 0.08 }}
              className="absolute inset-0 overflow-hidden rounded-[var(--radius-xl)] border border-border bg-card shadow-[var(--shadow-lg)]"
              style={{
                transform: `translate(${offset * 24}px, ${offset * 8}px)`,
                zIndex: i + 1,
              }}
            >
              <img
                src={url}
                alt=""
                className="h-full w-full object-cover"
                loading="lazy"
              />
            </motion.div>
          );
        })
      )}
    </div>
  );
}

/** A row of 6 quick previews of the wave under the hero copy. */
function PreviewStrip({ tracks, loading }: { tracks: Track[]; loading: boolean }) {
  if (loading) {
    return (
      <div className="grid grid-cols-2 gap-2 p-4 sm:grid-cols-3 sm:p-5 lg:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-16 rounded-[var(--radius-md)]" />
        ))}
      </div>
    );
  }

  if (tracks.length === 0) return null;

  return (
    <div className="grid grid-cols-2 gap-2 p-4 sm:grid-cols-3 sm:p-5 lg:grid-cols-6">
      {tracks.slice(0, 6).map((t, i) => (
        <PreviewStripRow key={`${t.id}:${i}`} track={t} index={i} tracks={tracks} />
      ))}
    </div>
  );
}

function PreviewStripRow({ track, index, tracks }: { track: Track; index: number; tracks: Track[] }) {
  const { isActive, isActivePlaying, playOrToggle } = useTrackPlayback(track.id);
  const onClick = () => {
    // Active row → toggle pause / resume in place. Inactive row →
    // restart the wave starting at this preview, with the rest of
    // the strip seeded as the queue tail.
    if (isActive) {
      playOrToggle(track);
      return;
    }
    const reordered = [...tracks.slice(index), ...tracks.slice(0, index)];
    playOrToggle(track, reordered);
  };
  return (
    <button
      onClick={onClick}
      className={cn(
        'group flex items-center gap-2.5 overflow-hidden rounded-[var(--radius-md)] border p-2 text-left transition-colors',
        isActive
          ? 'border-[var(--color-accent)]/40 bg-[var(--color-accent)]/8'
          : 'border-transparent hover:border-border hover:bg-[var(--color-hover-overlay)]',
      )}
    >
      <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-md bg-[var(--color-bg-muted)]">
        {track.coverUrl ? (
          <img src={track.coverUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <Disc3 className="m-auto h-5 w-5 text-muted-foreground/40" />
        )}
        <div
          className={cn(
            'absolute inset-0 flex items-center justify-center transition-opacity',
            isActive
              ? 'bg-black/55 opacity-100'
              : 'bg-black/0 opacity-0 group-hover:bg-black/40 group-hover:opacity-100',
          )}
        >
          {isActivePlaying ? (
            <Pause size={14} fill="currentColor" className="text-white" />
          ) : (
            <Play size={14} fill="currentColor" className="text-white" />
          )}
        </div>
      </div>
      <div className="min-w-0 flex-1">
        <div className={cn('truncate text-sm font-medium', isActive && 'text-[var(--color-accent)]')}>
          {track.title}
        </div>
        <div className="truncate text-xs text-muted-foreground">{track.artist}</div>
      </div>
    </button>
  );
}

// ────────────────────────────────────────────────────────────────────
// Daily playlists
// ────────────────────────────────────────────────────────────────────

function DailyPlaylistsSection() {
  const t = useT();
  const reduce = useReducedMotion();
  const dailyQ = useQuery({
    queryKey: ['daily-playlists', 'today'],
    queryFn: fetchDailyPlaylists,
    staleTime: 5 * 60_000,
  });

  return (
    <section className="relative mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 lg:px-10" data-tour-id="tour-daily">
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-border bg-[var(--color-surface-elevated)] px-2.5 py-1 text-xs font-medium text-muted-foreground backdrop-blur">
            <ListMusic size={12} className="text-[var(--color-accent)]" />
            {t('home.dailyBadge')}
          </div>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
            {t('home.dailyTitle')}
          </h2>
          <p className="mt-1 max-w-md text-sm text-muted-foreground">
            {t('home.dailyHint')}
          </p>
        </div>
      </div>

      {dailyQ.isLoading && (
        <div className="grid gap-5 md:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-72 rounded-[var(--radius-xl)]" />
          ))}
        </div>
      )}

      {dailyQ.isError && (
        <div className="rounded-[var(--radius-lg)] border border-border bg-card p-6 text-sm text-muted-foreground">
          {t('home.dailyError')}
        </div>
      )}

      {dailyQ.data && (
        <Stagger className="grid gap-5 md:grid-cols-3" stagger={reduce ? 0 : 0.08}>
          {dailyQ.data.map((p) => (
            <motion.div key={p.id} variants={staggerItem}>
              <DailyPlaylistCard playlist={p} />
            </motion.div>
          ))}
        </Stagger>
      )}
    </section>
  );
}

function DailyPlaylistCard({ playlist }: { playlist: DailyPlaylist }) {
  const t = useT();
  const theme = DAILY_VARIANT_THEME[playlist.variant];
  const VariantIcon = theme.icon;
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [savedJustNow, setSavedJustNow] = useState(false);
  // Persistent across reloads (server-side flag) OR set to true after a
  // local save click — both should disable the button and show the
  // "Сохранено" state.
  const isSaved = !!playlist.savedToPlaylistId || savedJustNow;

  // Sync the card's play CTAs with the global player. When a track
  // from this daily playlist is currently active the buttons swap
  // to a Pause icon and clicking pauses/resumes in place instead of
  // restarting the queue from the top.
  const trackIds = useMemo(() => playlist.tracks.map((tr) => tr.id), [playlist.tracks]);
  const { isCollectionActive, isCollectionPlaying, playCollection } = useCollectionPlayback(trackIds);

  const play = (e?: { preventDefault?: () => void; stopPropagation?: () => void }) => {
    e?.preventDefault?.();
    e?.stopPropagation?.();
    if (playlist.tracks.length === 0) return;
    playCollection(playlist.tracks);
  };

  const save = async (e?: { preventDefault?: () => void; stopPropagation?: () => void }) => {
    e?.preventDefault?.();
    e?.stopPropagation?.();
    if (isSaved) return;
    setSaving(true);
    try {
      await saveDailyPlaylist(playlist.id);
      setSavedJustNow(true);
      // Invalidate both the library list (sidebar / library page) and
      // the daily-playlists query so the persistent saved flag flows
      // back into other consumers of this card too.
      queryClient.invalidateQueries({ queryKey: ['playlists'] });
      queryClient.invalidateQueries({ queryKey: ['daily-playlists'] });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Link
      to={`/daily/${playlist.id}`}
      // The whole card navigates to /daily/:id where the user can preview
      // the full tracklist without committing to the library. Inner Play
      // and "В библиотеку" buttons swallow the click via preventDefault +
      // stopPropagation so their actions still work in place.
      className="group relative flex h-full flex-col overflow-hidden rounded-[var(--radius-xl)] border border-border bg-card transition-all hover:border-[var(--color-border-strong)] hover:shadow-[var(--shadow-md)]"
    >
      {/* Cover header: gradient + cover image overlay. */}
      <div
        className="relative aspect-[16/10] w-full overflow-hidden"
        style={{
          background: `linear-gradient(135deg, ${theme.hue}cc 0%, ${theme.hue}55 60%, transparent 100%)`,
        }}
      >
        {playlist.coverUrl && (
          <img
            src={playlist.coverUrl}
            alt=""
            className="absolute inset-0 h-full w-full object-cover opacity-70 mix-blend-overlay transition-transform duration-700 group-hover:scale-105"
            loading="lazy"
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />

        <div className="absolute left-4 top-4 inline-flex items-center gap-1.5 rounded-full bg-black/35 px-2.5 py-1 text-xs font-medium text-white backdrop-blur">
          <VariantIcon size={12} />
          {t(theme.labelKey)}
        </div>

        <button
          onClick={(e) => play(e)}
          aria-label={isCollectionPlaying ? t('home.dailyPause') : t('home.dailyPlayAria')}
          className={cn(
            'absolute bottom-4 right-4 inline-flex h-12 w-12 items-center justify-center rounded-full shadow-[var(--shadow-lg)]',
            'transition-all hover:scale-110 active:scale-95',
            isCollectionActive
              ? 'bg-[var(--color-accent)] text-white'
              : 'bg-foreground text-background',
          )}
        >
          {isCollectionPlaying ? (
            <Pause size={18} fill="currentColor" />
          ) : (
            <Play size={18} fill="currentColor" />
          )}
        </button>
      </div>

      <div className="flex flex-1 flex-col gap-3 p-5">
        <div>
          <h3 className="text-lg font-semibold tracking-tight">{t(theme.nameKey)}</h3>
          <p className="mt-0.5 text-sm text-muted-foreground">{t(theme.descKey)}</p>
        </div>

        <div className="text-xs text-muted-foreground">
          {t('home.dailyTracksCount', { count: playlist.tracks.length, form: t(dailyTrackUnitKey(playlist.tracks.length)) })}
        </div>

        <div className="mt-auto flex flex-wrap items-center gap-2 pt-2">
          <Button onClick={(e) => play(e)} size="sm" className="gap-1.5" disabled={playlist.tracks.length === 0}>
            {isCollectionPlaying ? (
              <>
                <Pause size={14} fill="currentColor" />
                {t('home.dailyPause')}
              </>
            ) : (
              <>
                <Play size={14} fill="currentColor" />
                {isCollectionActive ? t('home.dailyContinue') : t('home.dailyListen')}
              </>
            )}
          </Button>
          <Button
            onClick={(e) => save(e)}
            size="sm"
            variant="outline"
            className="gap-1.5"
            disabled={saving || isSaved}
          >
            {isSaved ? <Check size={14} /> : <Library size={14} />}
            {isSaved ? t('home.dailySaved') : saving ? t('home.dailySaving') : t('home.dailySave')}
          </Button>
        </div>
      </div>
    </Link>
  );
}

// ────────────────────────────────────────────────────────────────────
// Recent
// ────────────────────────────────────────────────────────────────────

function RecentSection() {
  const t = useT();
  const recentQ = useQuery({
    queryKey: ['history', 'recent'],
    queryFn: () => fetchRecentPlays(12),
    staleTime: 30_000,
  });
  // tour-recent target sits on the inner <section /> below — keeps the
  // spotlight off the early-return null branch when the user has no
  // recent plays yet.
  const setTrack = usePlayerStore((s) => s.setTrack);
  const setQueue = usePlayerStore((s) => s.setQueue);

  const items = recentQ.data ?? [];
  if (!recentQ.isLoading && items.length === 0) return null;

  const playFromIndex = (i: number) => {
    if (items.length === 0) return;
    const tail = items.slice(i).map((r: RecentTrack) => toTrack(r));
    const head = items.slice(0, i).map((r: RecentTrack) => toTrack(r));
    const queue = [...tail, ...head];
    setQueue(queue);
    const first = queue[0];
    if (first) setTrack(first);
  };

  return (
    <section className="relative mx-auto w-full max-w-6xl px-4 py-10 pb-16 sm:px-6 lg:px-10" data-tour-id="tour-recent">
      <div className="mb-5 flex items-end justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-border bg-[var(--color-surface-elevated)] px-2.5 py-1 text-xs font-medium text-muted-foreground backdrop-blur">
            <HistoryIcon size={12} className="text-[var(--color-accent)]" />
            {t('home.recentBadge')}
          </div>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
            {t('home.recentTitle')}
          </h2>
        </div>

        <Link
          to="/library"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          {t('home.recentLibraryLink')}
          <ArrowRight size={14} />
        </Link>
      </div>

      {recentQ.isLoading ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-14 rounded-[var(--radius-md)]" />
          ))}
        </div>
      ) : (
        <div className="rounded-[var(--radius-lg)] border border-border bg-background">
          {items.map((row, i) => (
            <TrackItem
              key={`${row.id}:${row.playedAt}`}
              track={toTrack(row)}
              index={i}
              onPlay={() => playFromIndex(i)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

// ────────────────────────────────────────────────────────────────────
// helpers
// ────────────────────────────────────────────────────────────────────

function toTrack(r: RecentTrack): Track {
  return {
    id: r.id,
    title: r.title,
    artist: r.artist,
    artistId: r.artistId,
    artists: r.artists,
    album: r.album,
    albumId: r.albumId,
    coverUrl: r.coverUrl,
    duration: r.duration,
    source: r.source,
  };
}

function greeting(t: Translate): string {
  const h = new Date().getHours();
  if (h < 5) return t('home.greetingNight');
  if (h < 12) return t('home.greetingMorning');
  if (h < 18) return t('home.greetingDay');
  return t('home.greetingEvening');
}

