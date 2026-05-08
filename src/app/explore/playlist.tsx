import { useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ListMusic, Loader2, Pause, Play, Plus } from 'lucide-react';
import { AuthGuard } from '@/components/features/AuthGuard';
import { TrackItem } from '@/components/features/TrackItem';
import { Eyebrow } from '@/components/ui/SectionHeading';
import { useExplorePlaylistTracks } from '@/hooks/useExplore';
import { useSaveTidalPlaylist } from '@/hooks/useShare';
import { usePlaylistsList } from '@/hooks/useLibrary';
import { usePlayerStore } from '@/store/player';
import { useCollectionPlayback } from '@/hooks/usePlaybackSync';
import type { ExplorePage, ExplorePlaylist, Track } from '@/types';
import { useT } from '@/i18n';

/**
 * Detail page for a Tidal editorial playlist (curated by Tidal, not
 * owned by the user). Reachable from explore-playlist tiles in the
 * /search and /explore/:slug rows. Reads cached metadata from the
 * react-query cache (the parent explore page already fetched it),
 * fetches tracks via the dedicated `/explore/playlists/:uuid/tracks`
 * worker endpoint, and offers a one-tap "Сохранить в библиотеку"
 * action that uses the existing linked-playlist save flow.
 */
export function TidalPlaylistPage() {
  const t = useT();
  const { uuid } = useParams<{ uuid: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const setTrack = usePlayerStore((s) => s.setTrack);
  const setQueue = usePlayerStore((s) => s.setQueue);

  const { data, isLoading, isError, refetch } = useExplorePlaylistTracks(uuid);
  const { data: ownPlaylists } = usePlaylistsList();
  const saveMutation = useSaveTidalPlaylist();

  // Look up the playlist's metadata (title / cover / curator) in any
  // cached ExplorePage — both the top-level /explore feed and any
  // /explore/page/:slug feed are valid sources because they all
  // share the same `ExplorePlaylist` shape. Falls back to a generic
  // "Плейлист Tidal" header if we got here via a deep link without
  // having visited the parent feed first.
  const meta = useMemo<ExplorePlaylist | null>(() => {
    if (!uuid) return null;
    const all = qc.getQueriesData<ExplorePage>({ predicate: () => true });
    for (const [, page] of all) {
      if (!page || typeof page !== 'object' || !('modules' in page)) continue;
      for (const m of page.modules) {
        if (m.type !== 'playlists') continue;
        const hit = m.items.find((p) => p.id === uuid);
        if (hit) return hit;
      }
    }
    return null;
  }, [qc, uuid]);

  const tracks: Track[] = useMemo(() => data?.items ?? [], [data?.items]);
  // If the user already saved this playlist, the linked copy lives
  // in their library — surface "Открыть" instead of "Сохранить" to
  // avoid duplicate-saving the same Tidal id.
  const linkedCopy = useMemo(
    () => ownPlaylists?.find((p) => p.sourceKind === 'tidal' && p.sourcePlaylistId === uuid) ?? null,
    [ownPlaylists, uuid],
  );

  const handleBack = () => {
    if (window.history.length > 1) navigate(-1);
    else navigate('/search');
  };

  const trackIds = useMemo(() => tracks.map((tr) => tr.id), [tracks]);
  const { isCollectionActive, isCollectionPlaying, playCollection } = useCollectionPlayback(trackIds);

  const handlePlayAll = () => {
    if (tracks.length === 0) return;
    playCollection(tracks);
  };

  const handlePlayTrack = (track: Track) => {
    setQueue(tracks);
    setTrack({
      id: track.id,
      title: track.title,
      artist: track.artist,
      artistId: track.artistId,
      artists: track.artists,
      coverUrl: track.coverUrl,
      coverVideoUrl: track.coverVideoUrl,
      duration: track.duration,
    });
  };

  const handleSave = () => {
    if (!uuid || saveMutation.isPending) return;
    if (linkedCopy) {
      navigate(`/playlist/${linkedCopy.id}`);
      return;
    }
    // Seed the cached count from the explore tile (`meta.trackCount`)
    // when available, falling back to the live result we already
    // fetched. Lets the library list show the right number on the
    // very first load after saving, instead of "0 треков".
    const seedCount = meta?.trackCount ?? tracks.length;
    saveMutation.mutate(
      {
        tidalId: uuid,
        name: meta?.title ?? t('explorePlaylist.fallbackTitle'),
        coverUrl: meta?.coverUrl ?? null,
        curator: meta?.curator ?? null,
        trackCount: typeof seedCount === 'number' ? seedCount : null,
      },
      {
        onSuccess: (created) => navigate(`/playlist/${created.id}`),
      },
    );
  };

  return (
    <AuthGuard>
      <div className="mx-auto max-w-6xl p-4 sm:p-6 lg:p-10">
        <button
          type="button"
          onClick={handleBack}
          className="mb-4 inline-flex h-9 items-center gap-1 rounded-[var(--radius-md)] px-2 -ml-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground active:scale-[0.98] lg:hidden"
          aria-label={t('explorePlaylist.back')}
        >
          <ChevronLeft size={18} />
          <span>{t('explorePlaylist.back')}</span>
        </button>

        {isLoading ? (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-4 border-b border-border pb-6 sm:flex-row sm:items-end sm:gap-6">
              <div className="h-32 w-32 shrink-0 animate-pulse rounded-[var(--radius-md)] bg-secondary/50 sm:h-40 sm:w-40" />
              <div className="flex flex-1 flex-col gap-3">
                <div className="h-3 w-24 animate-pulse rounded bg-secondary/50" />
                <div className="h-9 w-2/3 animate-pulse rounded bg-secondary/50" />
                <div className="h-3 w-20 animate-pulse rounded bg-secondary/50" />
              </div>
            </div>
            <div className="flex flex-col gap-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-12 animate-pulse rounded-[var(--radius-md)] bg-secondary/30" />
              ))}
            </div>
          </div>
        ) : isError ? (
          <div className="flex flex-col items-start gap-3 py-12">
            <p className="text-sm text-muted-foreground">{t('explorePlaylist.failedLoad')}</p>
            <button
              type="button"
              onClick={() => refetch()}
              className="inline-flex h-9 items-center gap-1 rounded-[var(--radius-md)] bg-secondary px-3 text-sm font-medium transition-colors hover:bg-secondary/80"
            >
              {t('explorePlaylist.retry')}
            </button>
          </div>
        ) : (
          <>
            <div className="mb-8 flex flex-col gap-4 border-b border-border pb-6 sm:flex-row sm:items-end sm:gap-6">
              <div className="flex h-32 w-32 shrink-0 items-center justify-center overflow-hidden rounded-[var(--radius-md)] border border-border bg-card text-muted-foreground sm:h-40 sm:w-40">
                {meta?.coverUrl ? (
                  <img
                    src={meta.coverUrl}
                    alt={t('explorePlaylist.coverAlt', { title: meta.title })}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <ListMusic size={42} />
                )}
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <Eyebrow>{t('explorePlaylist.subtitleTidal')}</Eyebrow>
                <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
                  {meta?.title ?? t('explorePlaylist.fallbackTitle')}
                </h1>
                <p className="text-sm text-muted-foreground">
                  {meta?.curator ?? 'Tidal'}
                  {tracks.length > 0 ? ` · ${t('explorePlaylist.tracksCount', { count: tracks.length })}` : ''}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={handlePlayAll}
                    disabled={tracks.length === 0}
                    className="inline-flex h-10 items-center gap-2 rounded-full bg-[var(--color-accent)] px-4 text-sm font-semibold text-[var(--color-text-on-accent)] shadow-sm transition-all hover:brightness-110 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isCollectionPlaying ? (
                      <>
                        <Pause size={16} fill="currentColor" />
                        {t('explorePlaylist.pause')}
                      </>
                    ) : (
                      <>
                        <Play size={16} fill="currentColor" />
                        {isCollectionActive ? t('explorePlaylist.continue') : t('explorePlaylist.listen')}
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={handleSave}
                    disabled={saveMutation.isPending}
                    className="inline-flex h-10 items-center gap-2 rounded-full border border-border bg-secondary px-4 text-sm font-medium transition-colors hover:bg-secondary/80 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {saveMutation.isPending ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <Plus size={16} />
                    )}
                    {linkedCopy ? t('explorePlaylist.openInLibrary') : t('explorePlaylist.save')}
                  </button>
                </div>
              </div>
            </div>

            {tracks.length === 0 ? (
              <p className="py-12 text-center text-sm text-muted-foreground">
                {t('explorePlaylist.empty')}
              </p>
            ) : (
              <div className="flex flex-col gap-1">
                {tracks.map((track, idx) => (
                  <TrackItem
                    key={track.id}
                    track={track}
                    index={idx}
                    onPlay={handlePlayTrack}
                    hideRemoveMenu
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </AuthGuard>
  );
}
