/**
 * "Загруженное" — service playlist that auto-aggregates every track
 * the user has saved offline (whether individually or as part of a
 * saved album/playlist).
 *
 * It mimics the visual structure of the regular `PlaylistPage` so it
 * reads as a first-class playlist in the library, but it is
 * deliberately read-only: no rename, no cover-edit, no reorder, no
 * "remove from playlist" affordance per row. The only way to
 * remove a track from this view is to un-save it via its kebab menu
 * or to un-save the parent collection.
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { ChevronLeft, ArrowDownToLine, Pause, Play } from 'lucide-react';
import { AuthGuard } from '@/components/features/AuthGuard';
import { TrackItem } from '@/components/features/TrackItem';
import { useOfflineHydration } from '@/hooks/useOfflineActions';
import { useOfflineStore } from '@/store/offline';
import { listSavedTracks } from '@/lib/offline/storage';
import { toPlayerTrack } from '@/lib/playerTrack';
import type { OfflineTrack } from '@/lib/offline/types';
import type { Track } from '@/types';
import { Button } from '@/components/ui/Button';
import { usePlayerStore } from '@/store/player';
import { useCollectionPlayback } from '@/hooks/usePlaybackSync';
import { useT } from '@/i18n';

export function DownloadedPlaylistPage() {
  const t = useT();
  const navigate = useNavigate();
  const hydrated = useOfflineHydration();
  const version = useOfflineStore((s) => s.version);
  const setTrack = usePlayerStore((s) => s.setTrack);
  const setQueue = usePlayerStore((s) => s.setQueue);
  const togglePlay = usePlayerStore((s) => s.togglePlay);

  const [offlineTracks, setOfflineTracks] = useState<OfflineTrack[]>([]);

  useEffect(() => {
    if (!hydrated) return;
    let cancelled = false;
    void (async () => {
      const list = await listSavedTracks();
      if (!cancelled) {
        // Newest-first, mirroring the "Liked" playlist's UX
        list.sort((a, b) => b.savedAt - a.savedAt);
        setOfflineTracks(list);
      }
    })();
    return () => { cancelled = true; };
  }, [hydrated, version]);

  const tracks: Track[] = useMemo(
    () => offlineTracks.map((ot) => ({
      id: ot.id,
      title: ot.title,
      artist: ot.artist,
      artistId: ot.artistId,
      artists: ot.artists,
      album: ot.album,
      albumId: ot.albumId,
      duration: ot.duration,
      coverUrl: ot.coverUrl,
      coverVideoUrl: ot.coverVideoUrl,
      source: ot.source,
    })),
    [offlineTracks],
  );

  const trackIds = tracks.map((tr) => tr.id);
  const { isCollectionActive, isCollectionPlaying, playCollection } = useCollectionPlayback(trackIds);

  const handlePlayTrack = (track: Track) => {
    setTrack(toPlayerTrack(track));
    setQueue(tracks.map(toPlayerTrack));
  };

  const handlePlayAll = () => {
    if (isCollectionActive) {
      togglePlay();
      return;
    }
    if (tracks.length) {
      playCollection(tracks);
    }
  };

  return (
    <AuthGuard>
      <div className="mx-auto max-w-6xl p-4 sm:p-6 lg:p-10">
        <button
          type="button"
          onClick={() => navigate('/library')}
          className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft size={16} /> {t('library.title')}
        </button>

        <div className="relative isolate -mx-4 mb-10 overflow-hidden border-b border-border px-4 pb-10 pt-6 sm:-mx-6 sm:px-6 sm:pt-10 lg:-mx-10 lg:px-10">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(60%_80%_at_25%_15%,var(--color-accent-glow),transparent_75%)] opacity-40"
          />
          <div className="flex flex-col gap-6 sm:flex-row">
            <div className="flex h-48 w-48 items-center justify-center rounded-[var(--radius-md)] border border-white/10 bg-[var(--color-accent)]/15 text-[var(--color-accent)] shadow-[0_18px_48px_-16px_rgba(0,0,0,0.55)]">
              <ArrowDownToLine size={48} />
            </div>
            <div className="flex flex-col justify-end gap-3">
              <span className="text-xs font-medium uppercase tracking-[0.25em] text-muted-foreground">
                {t('library.serviceLabel')}
              </span>
              <h1 className="text-3xl font-semibold tracking-tight sm:text-5xl">
                {t('library.downloadedPlaylist')}
              </h1>
              <p className="text-xs text-muted-foreground">
                {tracks.length} {tracks.length === 1 ? t('library.trackUnit1') : t('library.trackUnit5plus')}
              </p>
              {tracks.length > 0 && (
                <div className="flex items-center gap-2 pt-2">
                  <Button onClick={handlePlayAll}>
                    {isCollectionPlaying ? (
                      <>
                        <Pause size={14} fill="currentColor" /> {t('albumPage.pause')}
                      </>
                    ) : (
                      <>
                        <Play size={14} fill="currentColor" /> {isCollectionActive ? t('albumPage.continue') : t('albumPage.listen')}
                      </>
                    )}
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>

        {tracks.length === 0 ? (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col items-center gap-3 rounded-[var(--radius-md)] border border-border bg-card py-16 text-center"
          >
            <ArrowDownToLine size={32} className="text-muted-foreground" />
            <p className="text-sm text-muted-foreground">{t('library.noDownloadsTitle')}</p>
            <p className="text-xs text-muted-foreground">{t('library.noDownloadsHint')}</p>
          </motion.div>
        ) : (
          <div className="overflow-visible rounded-[var(--radius-md)] border border-border">
            {tracks.map((track, i) => (
              <TrackItem key={track.id} track={track} index={i} onPlay={handlePlayTrack} />
            ))}
          </div>
        )}
      </div>
    </AuthGuard>
  );
}
