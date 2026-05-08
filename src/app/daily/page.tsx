import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion, useReducedMotion } from 'motion/react';
import {
  ChevronLeft,
  Library,
  ListMusic,
  Loader2,
  Pause,
  Play,
  Check,
} from 'lucide-react';
import { AuthGuard } from '@/components/features/AuthGuard';
import { TrackItem } from '@/components/features/TrackItem';
import { Button } from '@/components/ui/Button';
import { CoverFallback } from '@/components/ui/CoverFallback';
import { MetaChip } from '@/components/ui/MetaChip';
import { fetchDailyPlaylists, saveDailyPlaylist } from '@/lib/recommendations';
import { DAILY_VARIANT_THEME, dailyTrackUnitKey } from '@/lib/dailyVariant';
import type { Track } from '@/types';
import { useCollectionPlayback } from '@/hooks/usePlaybackSync';
import { usePlayerStore } from '@/store/player';
import { useT } from '@/i18n';

/**
 * Read-only preview for one of the three "Плейлист дня" cards on /home.
 *
 * The home page used to give the user only two options on each daily
 * card — "Слушать" (start the queue) and "В библиотеку" (add to their
 * permanent library). Users wanted a way to *see* the contents of a
 * daily playlist before deciding whether to keep it. This route covers
 * that gap: tap the card → land here → scroll the full track list,
 * cherry-pick individual tracks, optionally promote the whole thing
 * into the library when satisfied.
 *
 * Backed entirely by the existing /daily-playlists/today response — the
 * tracks come back inline, so we don't need a separate endpoint. We
 * pluck "this id" out of the today list (cached or freshly fetched).
 */
export function DailyPlaylistPreviewPage() {
  const t = useT();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const reduce = useReducedMotion();
  const queryClient = useQueryClient();

  const dailyQ = useQuery({
    queryKey: ['daily-playlists', 'today'],
    queryFn: fetchDailyPlaylists,
    staleTime: 5 * 60_000,
  });

  const playlist = useMemo(
    () => dailyQ.data?.find((p) => p.id === id) ?? null,
    [dailyQ.data, id],
  );

  const tracks: Track[] = useMemo(() => playlist?.tracks ?? [], [playlist?.tracks]);
  const trackIds = useMemo(() => tracks.map((tr) => tr.id), [tracks]);
  const { isCollectionActive, isCollectionPlaying, playCollection } = useCollectionPlayback(trackIds);
  const setTrack = usePlayerStore((s) => s.setTrack);
  const setQueue = usePlayerStore((s) => s.setQueue);

  const [saving, setSaving] = useState(false);
  const [savedJustNow, setSavedJustNow] = useState(false);
  const isSaved = !!playlist?.savedToPlaylistId || savedJustNow;

  const playAll = () => {
    if (tracks.length === 0) return;
    playCollection(tracks);
  };

  const playFromIndex = (i: number) => {
    if (tracks.length === 0) return;
    const tail = tracks.slice(i);
    const head = tracks.slice(0, i);
    const next = [...tail, ...head];
    setQueue(next);
    const first = next[0];
    if (first) setTrack(first);
  };

  const save = async () => {
    if (!playlist || isSaved) return;
    setSaving(true);
    try {
      await saveDailyPlaylist(playlist.id);
      setSavedJustNow(true);
      queryClient.invalidateQueries({ queryKey: ['playlists'] });
      queryClient.invalidateQueries({ queryKey: ['daily-playlists'] });
    } finally {
      setSaving(false);
    }
  };

  const handleBack = () => {
    if (window.history.length > 1) navigate(-1);
    else navigate('/');
  };

  const theme = playlist ? DAILY_VARIANT_THEME[playlist.variant] : null;
  const VariantIcon = theme?.icon ?? ListMusic;
  const showLoading = dailyQ.isLoading;

  return (
    <AuthGuard>
      <div className="mx-auto max-w-6xl p-4 sm:p-6 lg:p-10">
        <button
          type="button"
          onClick={handleBack}
          className="mb-4 inline-flex h-9 items-center gap-1 rounded-[var(--radius-md)] px-2 -ml-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground active:scale-[0.98]"
          aria-label={t('dailyPage.back')}
        >
          <ChevronLeft size={18} />
          <span>{t('dailyPage.back')}</span>
        </button>

        {showLoading ? (
          <div className="flex flex-col gap-4">
            <div className="h-44 w-full animate-pulse rounded-[var(--radius-xl)] bg-secondary/50" />
            <div className="h-12 w-full animate-pulse rounded-[var(--radius-md)] bg-secondary/50" />
            <div className="h-12 w-full animate-pulse rounded-[var(--radius-md)] bg-secondary/50" />
          </div>
        ) : !playlist || !theme ? (
          <div className="flex flex-col items-center gap-4 rounded-[var(--radius-lg)] border border-border bg-card py-16 text-center">
            <p className="text-sm text-muted-foreground">
              {t('dailyPage.notFound')}
            </p>
            <Link
              to="/"
              className="inline-flex items-center gap-1 text-sm text-foreground underline-offset-4 hover:underline"
            >
              {t('dailyPage.goHome')}
            </Link>
          </div>
        ) : (
          <>
            {/* Hero header echoing the home-page card layout — same hue,
                same variant pill, same cover overlay treatment — so the
                tap from /home → /daily/:id feels like a continuation of
                the card, not a new context. */}
            <motion.section
              initial={reduce ? false : { opacity: 0, y: 10 }}
              animate={reduce ? undefined : { opacity: 1, y: 0 }}
              transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
              className="relative overflow-hidden rounded-[var(--radius-xl)] border border-border bg-card"
              style={{
                backgroundImage: `linear-gradient(135deg, ${theme.hue}33 0%, transparent 60%)`,
              }}
            >
              <div className="grid gap-6 p-5 sm:grid-cols-[160px_1fr] sm:p-7 sm:gap-7">
                <div className="relative aspect-square w-32 shrink-0 overflow-hidden rounded-[var(--radius-md)] border border-border sm:w-40">
                  <CoverFallback
                    src={playlist.coverUrl}
                    name={theme ? t(theme.nameKey) : playlist.name}
                    initialsClassName="text-2xl"
                  />
                </div>
                <div className="flex min-w-0 flex-col justify-end gap-3">
                  <MetaChip className="gap-1.5">
                    <VariantIcon size={12} style={{ color: theme.hue }} />
                    {t('dailyPage.eyebrow', { variant: t(theme.labelKey) })}
                  </MetaChip>
                  <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
                    {theme ? t(theme.nameKey) : playlist.name}
                  </h1>
                  <p className="text-sm text-muted-foreground">
                    {theme ? t(theme.descKey) : playlist.description}
                  </p>
                  <div className="text-xs text-muted-foreground">
                    {t('dailyPage.tracksCount', { count: tracks.length, form: t(dailyTrackUnitKey(tracks.length)) })}
                  </div>

                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <Button
                      onClick={playAll}
                      size="sm"
                      className="gap-1.5"
                      disabled={tracks.length === 0}
                    >
                      {isCollectionPlaying ? (
                        <>
                          <Pause size={14} fill="currentColor" />
                          {t('dailyPage.pause')}
                        </>
                      ) : (
                        <>
                          <Play size={14} fill="currentColor" />
                          {isCollectionActive ? t('dailyPage.continue') : t('dailyPage.listen')}
                        </>
                      )}
                    </Button>
                    <Button
                      onClick={save}
                      size="sm"
                      variant="outline"
                      className="gap-1.5"
                      disabled={saving || isSaved}
                    >
                      {isSaved ? (
                        <>
                          <Check size={14} />
                          {t('dailyPage.saved')}
                        </>
                      ) : saving ? (
                        <>
                          <Loader2 size={14} className="animate-spin" />
                          {t('dailyPage.saving')}
                        </>
                      ) : (
                        <>
                          <Library size={14} />
                          {t('dailyPage.save')}
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              </div>
            </motion.section>

            {/* Tracklist — re-uses the same TrackItem component as every
                other listing in the app, including the like / download /
                kebab menu actions. Users can preview-play any single
                track without committing to either the queue or the
                permanent library. */}
            <section className="mt-6 rounded-[var(--radius-lg)] border border-border bg-background">
              {tracks.length === 0 ? (
                <p className="px-3 py-8 text-center text-sm text-muted-foreground">
                  {t('dailyPage.empty')}
                </p>
              ) : (
                tracks.map((tr, i) => (
                  <TrackItem
                    key={`${tr.id}:${i}`}
                    track={tr}
                    index={i}
                    onPlay={() => playFromIndex(i)}
                  />
                ))
              )}
            </section>
          </>
        )}
      </div>
    </AuthGuard>
  );
}
