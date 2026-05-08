import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Reorder, motion, useReducedMotion } from 'motion/react';
import { ChevronLeft, Globe, Heart, ListMusic, Pencil, Pin, PinOff, Share2 } from 'lucide-react';
import { AuthGuard } from '@/components/features/AuthGuard';
import { PlaylistTrackItem } from '@/components/features/PlaylistTrackItem';
import { RenamePlaylistDialog } from '@/components/features/RenamePlaylistDialog';
import { SharePlaylistDialog } from '@/components/features/SharePlaylistDialog';
import { PlaylistCoverButton } from '@/components/features/PlaylistCoverButton';
import { PlaylistOfflineButton } from '@/components/features/OfflineActionButton';
import { usePlaylist, useReorderPlaylistTracks, usePinPlaylist } from '@/hooks/useLibrary';
import { useOfflineCoverUrl } from '@/hooks/useOfflineCoverUrl';
import { usePlayerStore } from '@/store/player';
import type { Track } from '@/types';
import { IconButton } from '@/components/ui/IconButton';
import { PageHero } from '@/components/ui/PageHero';
import { useT } from '@/i18n';

export function PlaylistPage() {
  const t = useT();
  const reduce = useReducedMotion();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: playlist, isLoading, isFetching, isError, refetch } = usePlaylist(id ?? '');
  // While react-router transitions and the URL is updating, `id` can be
  // briefly empty / falsy, which makes the query disabled and `isLoading`
  // false even though the page just opened — we'd flash "Плейлист не
  // найден" until the route param resolves. Treat "no id yet" as the
  // loading state so the page never bottoms out on the not-found copy
  // before we've actually tried to fetch.
  const showLoading = !id || isLoading || (isFetching && !playlist);
  const reorderMutation = useReorderPlaylistTracks();
  const pinPlaylist = usePinPlaylist();
  const isPinned = playlist ? (playlist.pinnedAt != null || playlist.isLiked) : false;
  const setTrack = usePlayerStore((s) => s.setTrack);
  const setQueue = usePlayerStore((s) => s.setQueue);

  // For the special "Liked" playlist the backend returns tracks in
  // insertion order (oldest first). The user expects newest-first both
  // in the visible list and in playback queue, so reverse client-side.
  // Custom playlists keep their explicit order.
  const tracks = useMemo(() => {
    const list = playlist?.tracks ?? [];
    return playlist?.isLiked ? [...list].reverse() : list;
  }, [playlist?.tracks, playlist?.isLiked]);
  const [localTracks, setLocalTracks] = useState<Track[]>([]);
  const [renameOpen, setRenameOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const ownPlaylist = useMemo(() => Boolean(playlist && id), [playlist, id]);
  // Linked (saved-reference) playlists are read-only: hide rename,
  // cover edit, reorder, per-track menu actions. Keep pin / delete
  // (those affect only the local copy and are explicitly allowed).
  const isLinked = Boolean(playlist?.sourceKind);
  // Liked is the one auto-created server playlist with a hard-coded
  // Russian name — swap to the locale-aware copy here so the page
  // header, share dialog and cover-alt all read correctly.
  const displayName = playlist
    ? (playlist.isLiked ? t('library.likedPlaylistName') : playlist.name)
    : '';
  const hideRemoveMenu = Boolean(playlist?.isLiked) || isLinked;
  const canRename = Boolean(playlist && !playlist.isLiked && !isLinked);
  const canShare = Boolean(playlist && !playlist.isLiked && !isLinked);
  // Resolve the hero cover from the offline cache when the playlist
  // is saved — keeps the iconic art visible on iOS Safari even when
  // the remote URL no longer reaches Tidal's CDN.
  const heroCoverUrl = useOfflineCoverUrl(
    'playlist',
    playlist?.id,
    playlist?.coverUrl,
  );

  useEffect(() => {
    setLocalTracks(tracks);
  }, [tracks]);

  const handleBack = () => {
    if (window.history.length > 1) {
      navigate(-1);
    } else {
      navigate('/library');
    }
  };

  const handlePlayTrack = (track: Track) => {
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
    setQueue(
      localTracks.map((tr) => ({
        id: tr.id,
        title: tr.title,
        artist: tr.artist,
        artistId: tr.artistId,
        artists: tr.artists,
        coverUrl: tr.coverUrl,
        coverVideoUrl: tr.coverVideoUrl,
        duration: tr.duration,
      })),
    );
  };

  const handleReorderEnd = () => {
    if (!id) return;
    const originalOrder = tracks.map((tr) => tr.id).join(',');
    const newOrder = localTracks.map((tr) => tr.id).join(',');
    if (originalOrder === newOrder) return;
    reorderMutation.mutate({ playlistId: id, trackIds: localTracks.map((tr) => tr.id) });
  };

  const ambience = heroCoverUrl ? (
    <div
      className="pointer-events-none absolute -inset-[15%] bg-cover bg-center blur-2xl saturate-150 opacity-60"
      style={{ backgroundImage: `url(${heroCoverUrl})` }}
    />
  ) : undefined;

  const cover = playlist ? (
    <motion.div
      className="flex h-40 w-40 shrink-0 items-center justify-center overflow-hidden rounded-[var(--radius-lg)] border border-white/10 bg-card text-muted-foreground shadow-[0_18px_48px_-16px_rgba(0,0,0,0.55)] sm:h-48 sm:w-48"
      initial={reduce ? false : { opacity: 0, scale: 0.96 }}
      animate={reduce ? undefined : { opacity: 1, scale: 1 }}
      transition={{ type: 'spring', stiffness: 220, damping: 28 }}
    >
      {heroCoverUrl ? (
        <img
          src={heroCoverUrl}
          alt={t('playlistPage.coverAlt', { name: displayName })}
          className="h-full w-full object-cover"
        />
      ) : playlist.isLiked ? (
        <Heart size={42} fill="currentColor" />
      ) : (
        <ListMusic size={42} />
      )}
    </motion.div>
  ) : null;

  return (
    <AuthGuard>
      <div className="mx-auto max-w-6xl p-4 sm:p-6 lg:p-10">
        <button
          type="button"
          onClick={handleBack}
          className="mb-4 inline-flex h-9 items-center gap-1 rounded-[var(--radius-md)] px-2 -ml-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground active:scale-[0.98] lg:hidden"
          aria-label={t('playlistPage.back')}
        >
          <ChevronLeft size={18} />
          <span>{t('playlistPage.back')}</span>
        </button>

        {showLoading ? (
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
            <p className="text-sm text-muted-foreground">{t('playlistPage.failedLoad')}</p>
            <button
              type="button"
              onClick={() => refetch()}
              className="inline-flex h-9 items-center gap-1 rounded-[var(--radius-md)] bg-secondary px-3 text-sm font-medium transition-colors hover:bg-secondary/80"
            >
              {t('playlistPage.retry')}
            </button>
          </div>
        ) : playlist ? (
          <>
            <PageHero
              ambience={ambience}
              cover={cover}
              eyebrow={t('playlistPage.eyebrow')}
              title={displayName}
              meta={
                <>
                  {playlist.trackCount}{' '}
                  {playlist.trackCount === 1
                    ? t('playlistPage.trackOne')
                    : t('playlistPage.trackMany')}
                  {isLinked && (
                    <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-secondary/60 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide">
                      {t('playlistPage.linkBadge')} ·{' '}
                      {playlist.sourceKind === 'tidal' ? 'Tidal' : t('playlistPage.linkUser')}
                    </span>
                  )}
                </>
              }
              actions={
                <>
                  {canRename && (
                    <IconButton
                      onClick={() => setRenameOpen(true)}
                      aria-label={t('playlistPage.renameAria')}
                      title={t('playlistPage.renameTitle')}
                    >
                      <Pencil size={16} />
                    </IconButton>
                  )}
                  {canShare && (
                    <IconButton
                      tone="accent"
                      active={Boolean(playlist?.isPublic)}
                      onClick={() => setShareOpen(true)}
                      aria-label={
                        playlist?.isPublic
                          ? t('playlistPage.shareAriaPublic')
                          : t('playlistPage.shareAriaPrivate')
                      }
                      title={
                        playlist?.isPublic
                          ? t('playlistPage.shareTitlePublic')
                          : t('playlistPage.shareTitlePrivate')
                      }
                    >
                      {playlist?.isPublic ? <Globe size={16} /> : <Share2 size={16} />}
                    </IconButton>
                  )}
                  {playlist && !playlist.isLiked && (
                    <IconButton
                      tone="accent"
                      active={isPinned}
                      onClick={() => pinPlaylist.mutate({ id: playlist.id, pinned: !isPinned })}
                      aria-label={isPinned ? t('playlistPage.unpinAria') : t('playlistPage.pinAria')}
                      title={isPinned ? t('playlistPage.unpinTitle') : t('playlistPage.pinTitle')}
                    >
                      {isPinned ? <PinOff size={16} /> : <Pin size={16} />}
                    </IconButton>
                  )}
                  {playlist && <PlaylistOfflineButton playlist={playlist} tracks={tracks} />}
                  {canRename && (
                    <PlaylistCoverButton
                      playlistId={playlist.id}
                      hasCover={Boolean(playlist.coverUrl)}
                    />
                  )}
                </>
              }
            />

            {playlist && (
              <>
                <RenamePlaylistDialog
                  open={renameOpen}
                  onClose={() => setRenameOpen(false)}
                  playlistId={playlist.id}
                  initialName={playlist.name}
                />
                <SharePlaylistDialog
                  open={shareOpen}
                  onClose={() => setShareOpen(false)}
                  playlist={playlist}
                />
              </>
            )}

            {/* Track list panel — adopts the mini-player's liquid-glass
                visual language so the album / artist / playlist pages
                share a single surface treatment. */}
            <motion.div
              initial={reduce ? false : { opacity: 0, y: 8 }}
              animate={reduce ? undefined : { opacity: 1, y: 0 }}
              transition={{ type: 'spring', stiffness: 240, damping: 28, delay: 0.05 }}
            >
              {ownPlaylist && !hideRemoveMenu ? (
                <Reorder.Group
                  axis="y"
                  values={localTracks}
                  onReorder={setLocalTracks}
                  className="liquid-glass overflow-visible rounded-[var(--radius-xl)] sm:rounded-[var(--radius-lg)]"
                >
                  {localTracks.map((track, i) => (
                    <PlaylistTrackItem
                      key={track.id}
                      track={track}
                      index={i}
                      playlistId={playlist.id}
                      reorderable
                      onPlay={handlePlayTrack}
                      onReorderEnd={handleReorderEnd}
                    />
                  ))}
                </Reorder.Group>
              ) : (
                <div className="liquid-glass overflow-visible rounded-[var(--radius-xl)] sm:rounded-[var(--radius-lg)]">
                  {localTracks.map((track, i) => (
                    <PlaylistTrackItem
                      key={track.id}
                      track={track}
                      index={i}
                      playlistId={playlist.id}
                      reorderable={false}
                      onPlay={handlePlayTrack}
                      hideRemoveMenu={hideRemoveMenu}
                    />
                  ))}
                </div>
              )}
            </motion.div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">{t('playlistPage.notFound')}</p>
        )}
      </div>
    </AuthGuard>
  );
}
