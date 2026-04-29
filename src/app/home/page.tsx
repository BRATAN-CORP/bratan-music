import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion, useReducedMotion } from 'motion/react';
import {
  Play,
  Sparkles,
  Library,
  History as HistoryIcon,
  RefreshCw,
  ListMusic,
  ArrowRight,
  Heart,
  Disc3,
} from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { Button } from '@/components/ui/Button';
import { Aurora } from '@/components/ui/Aurora';
import { Reveal, Stagger } from '@/components/ui/Reveal';
import { TiltCard } from '@/components/ui/TiltCard';
import { Skeleton } from '@/components/ui/Skeleton';
import { TrackItem } from '@/components/features/TrackItem';
import { GenrePicker } from '@/components/features/GenrePicker';

import {
  fetchWave,
  fetchDailyPlaylists,
  fetchGenreSeeds,
  fetchRecentPlays,
  saveDailyPlaylist,
  type DailyPlaylist,
  type RecentTrack,
} from '@/lib/recommendations';
import { startMyWave } from '@/lib/wave';
import { usePlayerStore } from '@/store/player';
import { useAuthStore } from '@/store/auth';
import { EASE_SPRING as EASE, staggerItem } from '@/lib/motion';
import { cn } from '@/lib/utils';
import type { Track } from '@/types';

/**
 * Home dashboard for authenticated users. Three sections:
 *
 *   1. **Hero "Моя волна"** — the headline element. One-tap personal
 *      stream. If the user has no taste signal yet (no history, no
 *      genre seeds) we render the GenrePicker inline instead so the
 *      first-time experience is "pick what you like → listen", not
 *      "see an empty page → figure out what to do".
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
  const user = useAuthStore((s) => s.user);
  const reduce = useReducedMotion();

  const seedsQ = useQuery({
    queryKey: ['recommendations', 'genre-seeds'],
    queryFn: fetchGenreSeeds,
    staleTime: 60_000,
  });

  const needsOnboarding = !!seedsQ.data && !seedsQ.data.hasHistory && seedsQ.data.slugs.length === 0;
  const [forceShowPicker, setForceShowPicker] = useState(false);

  return (
    <div className="relative w-full">
      <section className="relative overflow-hidden pb-10 pt-12 sm:pt-16 lg:pb-14">
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
              {greeting()}
              {user?.name ? <span className="text-foreground">, {user.name}</span> : null}
            </span>

            <h1 className="max-w-3xl text-[clamp(2rem,5vw,3.6rem)] font-semibold leading-[1.04] tracking-tight">
              Слушай <span className="font-serif italic text-muted-foreground">так</span>, как
              <br className="hidden sm:block" /> подойдёт <span className="shine-text">только тебе</span>.
            </h1>
          </motion.div>

          {needsOnboarding || forceShowPicker ? (
            <GenrePicker
              onComplete={() => {
                setForceShowPicker(false);
                seedsQ.refetch();
              }}
              onSkip={forceShowPicker ? () => setForceShowPicker(false) : undefined}
            />
          ) : (
            <WaveHero
              onChangeGenres={() => setForceShowPicker(true)}
              hasGenreSeeds={!!seedsQ.data && seedsQ.data.slugs.length > 0}
            />
          )}
        </div>
      </section>

      <DailyPlaylistsSection />

      <RecentSection />
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Hero
// ────────────────────────────────────────────────────────────────────

function WaveHero({
  onChangeGenres,
  hasGenreSeeds,
}: {
  onChangeGenres: () => void;
  hasGenreSeeds: boolean;
}) {
  const reduce = useReducedMotion();
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const previewQ = useQuery({
    queryKey: ['recommendations', 'wave-preview'],
    queryFn: () => fetchWave(8),
    // Preview is just a teaser — let it go stale quickly so the user
    // sees a fresh feel after they navigate away and come back.
    staleTime: 60_000,
  });

  const start = async () => {
    setStarting(true);
    setError(null);
    try {
      await startMyWave();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось запустить волну');
    } finally {
      setStarting(false);
    }
  };

  return (
    <Reveal>
      <TiltCard intensity={6} hoverScale={1.01} glareStrength={0.35} className="rounded-[var(--radius-2xl)]">
        <div className="relative overflow-hidden rounded-[var(--radius-2xl)] border border-border bg-card">
          {/* Decorative animated gradient layer behind the content. The
              actual cover preview sits on the right and uses the user's
              wave seeds — so the visual is alive without being a
              static asset. */}
          <div className="pointer-events-none absolute inset-0" aria-hidden>
            <div
              className="absolute inset-0 opacity-80"
              style={{
                background:
                  'radial-gradient(120% 80% at 0% 0%, var(--color-accent-soft) 0%, transparent 55%), radial-gradient(80% 60% at 100% 100%, color-mix(in oklab, var(--color-sub-accent) 18%, transparent) 0%, transparent 60%)',
              }}
            />
          </div>

          <div className="relative grid gap-8 p-6 sm:p-10 lg:grid-cols-[1fr_auto] lg:gap-10">
            <div className="flex flex-col justify-between gap-6">
              <div className="flex flex-col gap-3">
                <div className="inline-flex w-fit items-center gap-2 rounded-full border border-border bg-[var(--color-surface-elevated)] px-2.5 py-1 text-xs font-medium text-muted-foreground backdrop-blur">
                  <Disc3 size={12} className="text-[var(--color-accent)]" />
                  Моя волна
                </div>
                <h2 className="text-3xl font-semibold tracking-tight sm:text-5xl">
                  Бесконечная музыка под{' '}
                  <span className="font-serif italic text-muted-foreground">твой</span> вкус.
                </h2>
                <p className="max-w-xl text-sm text-muted-foreground sm:text-base">
                  Один тап — и плеер не остановится. Подбираем по тому, что ты слушал, и подмешиваем близкое, чего ещё не слышал. Чем больше слушаешь, тем точнее.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <motion.div whileTap={reduce ? undefined : { scale: 0.97 }}>
                  <Button
                    size="lg"
                    onClick={start}
                    disabled={starting}
                    className="gap-2 px-7"
                  >
                    {starting ? (
                      <RefreshCw size={16} className="animate-spin" />
                    ) : (
                      <Play size={16} fill="currentColor" />
                    )}
                    {starting ? 'Запускаем…' : 'Включить волну'}
                  </Button>
                </motion.div>

                <Button variant="outline" size="lg" onClick={onChangeGenres} className="gap-2">
                  <Sparkles size={16} />
                  {hasGenreSeeds ? 'Поменять жанры' : 'Подобрать жанры'}
                </Button>
              </div>

              {error ? (
                <p className="text-sm text-[var(--color-danger)]">{error}</p>
              ) : null}
            </div>

            <div className="hidden lg:block">
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
      </TiltCard>
    </Reveal>
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
  const setTrack = usePlayerStore((s) => s.setTrack);
  const setQueue = usePlayerStore((s) => s.setQueue);

  const playFromIndex = (i: number) => {
    if (tracks.length === 0) return;
    const reordered = [...tracks.slice(i), ...tracks.slice(0, i)];
    setQueue(reordered);
    const head = reordered[0];
    if (head) setTrack(head);
  };

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
        <button
          key={`${t.id}:${i}`}
          onClick={() => playFromIndex(i)}
          className="group flex items-center gap-2.5 overflow-hidden rounded-[var(--radius-md)] border border-transparent p-2 text-left transition-colors hover:border-border hover:bg-[var(--color-hover-overlay)]"
        >
          <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-md bg-[var(--color-bg-muted)]">
            {t.coverUrl ? (
              <img src={t.coverUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
            ) : (
              <Disc3 className="m-auto h-5 w-5 text-muted-foreground/40" />
            )}
            <div className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition-opacity group-hover:bg-black/40 group-hover:opacity-100">
              <Play size={14} fill="currentColor" className="text-white" />
            </div>
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{t.title}</div>
            <div className="truncate text-xs text-muted-foreground">{t.artist}</div>
          </div>
        </button>
      ))}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Daily playlists
// ────────────────────────────────────────────────────────────────────

function DailyPlaylistsSection() {
  const reduce = useReducedMotion();
  const dailyQ = useQuery({
    queryKey: ['daily-playlists', 'today'],
    queryFn: fetchDailyPlaylists,
    staleTime: 5 * 60_000,
  });

  return (
    <section className="relative mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 lg:px-10">
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-border bg-[var(--color-surface-elevated)] px-2.5 py-1 text-xs font-medium text-muted-foreground backdrop-blur">
            <ListMusic size={12} className="text-[var(--color-accent)]" />
            Плейлисты дня
          </div>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
            Три варианта на сегодня
          </h2>
          <p className="mt-1 max-w-md text-sm text-muted-foreground">
            Знакомое, открытия и подборка под настроение. Обновляются каждое утро.
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
          Не удалось загрузить плейлисты дня. Попробуй обновить страницу.
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

const VARIANT_THEME: Record<DailyPlaylist['variant'], { hue: string; label: string; icon: typeof Sparkles }> = {
  familiar: { hue: '#5E6AD2', label: 'Знакомое', icon: Heart },
  discover: { hue: '#c2185b', label: 'Открытия', icon: Sparkles },
  mood: { hue: '#0ea5e9', label: 'Под настроение', icon: Disc3 },
};

function DailyPlaylistCard({ playlist }: { playlist: DailyPlaylist }) {
  const theme = VARIANT_THEME[playlist.variant];
  const VariantIcon = theme.icon;
  const setTrack = usePlayerStore((s) => s.setTrack);
  const setQueue = usePlayerStore((s) => s.setQueue);
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [savedName, setSavedName] = useState<string | null>(null);

  const play = () => {
    if (playlist.tracks.length === 0) return;
    setQueue(playlist.tracks);
    const head = playlist.tracks[0];
    if (head) setTrack(head);
  };

  const save = async () => {
    setSaving(true);
    try {
      const res = await saveDailyPlaylist(playlist.id);
      setSavedName(res.name);
      // Invalidate the library list so the sidebar / library page picks it up.
      queryClient.invalidateQueries({ queryKey: ['playlists'] });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
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
          {theme.label}
        </div>

        <button
          onClick={play}
          aria-label="Запустить плейлист"
          className={cn(
            'absolute bottom-4 right-4 inline-flex h-12 w-12 items-center justify-center rounded-full bg-foreground text-background shadow-[var(--shadow-lg)]',
            'transition-all hover:scale-110 active:scale-95',
          )}
        >
          <Play size={18} fill="currentColor" />
        </button>
      </div>

      <div className="flex flex-1 flex-col gap-3 p-5">
        <div>
          <h3 className="text-lg font-semibold tracking-tight">{playlist.name}</h3>
          <p className="mt-0.5 text-sm text-muted-foreground">{playlist.description}</p>
        </div>

        <div className="text-xs text-muted-foreground">
          {playlist.tracks.length} {pluralRu(playlist.tracks.length, ['трек', 'трека', 'треков'])}
        </div>

        <div className="mt-auto flex flex-wrap items-center gap-2 pt-2">
          <Button onClick={play} size="sm" className="gap-1.5" disabled={playlist.tracks.length === 0}>
            <Play size={14} fill="currentColor" />
            Слушать
          </Button>
          <Button
            onClick={save}
            size="sm"
            variant="outline"
            className="gap-1.5"
            disabled={saving || !!savedName}
          >
            <Library size={14} />
            {savedName ? 'Сохранено' : saving ? 'Сохраняем…' : 'В библиотеку'}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Recent
// ────────────────────────────────────────────────────────────────────

function RecentSection() {
  const recentQ = useQuery({
    queryKey: ['history', 'recent'],
    queryFn: () => fetchRecentPlays(12),
    staleTime: 30_000,
  });
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
    <section className="relative mx-auto w-full max-w-6xl px-4 py-10 pb-16 sm:px-6 lg:px-10">
      <div className="mb-5 flex items-end justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-border bg-[var(--color-surface-elevated)] px-2.5 py-1 text-xs font-medium text-muted-foreground backdrop-blur">
            <HistoryIcon size={12} className="text-[var(--color-accent)]" />
            Недавно
          </div>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
            Что ты слушал
          </h2>
        </div>

        <Link
          to="/library"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          Библиотека
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
    album: r.album,
    albumId: r.albumId,
    coverUrl: r.coverUrl,
    duration: r.duration,
    source: r.source,
  };
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 5) return 'Доброй ночи';
  if (h < 12) return 'Доброе утро';
  if (h < 18) return 'Привет';
  return 'Добрый вечер';
}

function pluralRu(n: number, forms: [string, string, string]): string {
  const m = Math.abs(n) % 100;
  const m1 = m % 10;
  if (m > 10 && m < 20) return forms[2];
  if (m1 > 1 && m1 < 5) return forms[1];
  if (m1 === 1) return forms[0];
  return forms[2];
}

