import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Reorder, motion } from 'motion/react';
import { ChevronLeft, Heart, ListMusic, Pencil, Pin, PinOff } from 'lucide-react';
import { AuthGuard } from '@/components/features/AuthGuard';
import { PlaylistTrackItem } from '@/components/features/PlaylistTrackItem';
import { RenamePlaylistDialog } from '@/components/features/RenamePlaylistDialog';
import { PlaylistCoverButton } from '@/components/features/PlaylistCoverButton';
import { usePlaylist, useReorderPlaylistTracks, usePinPlaylist } from '@/hooks/useLibrary';
import { usePlayerStore } from '@/store/player';
import type { Track } from '@/types';

export function PlaylistPage() {
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

  const tracks = useMemo(() => playlist?.tracks ?? [], [playlist?.tracks]);
  const [localTracks, setLocalTracks] = useState<Track[]>([]);
  const [renameOpen, setRenameOpen] = useState(false);
  const ownPlaylist = useMemo(() => Boolean(playlist && id), [playlist, id]);
  const hideRemoveMenu = Boolean(playlist?.isLiked);
  const canRename = Boolean(playlist && !playlist.isLiked);

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
      coverUrl: track.coverUrl, coverVideoUrl: track.coverVideoUrl,
      duration: track.duration,
    });
    setQueue(
      localTracks.map((t) => ({
        id: t.id,
        title: t.title,
        artist: t.artist,
        artistId: t.artistId,
        coverUrl: t.coverUrl,
        duration: t.duration,
      }))
    );
  };

  const handleReorderEnd = () => {
    if (!id) return;
    const originalOrder = tracks.map((t) => t.id).join(',');
    const newOrder = localTracks.map((t) => t.id).join(',');
    if (originalOrder === newOrder) return;
    reorderMutation.mutate({ playlistId: id, trackIds: localTracks.map((t) => t.id) });
  };

  return (
    <AuthGuard>
      <div className="mx-auto max-w-5xl p-4 sm:p-6 lg:p-10">
        <button
          type="button"
          onClick={handleBack}
          className="mb-4 inline-flex h-9 items-center gap-1 rounded-[var(--radius-md)] px-2 -ml-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground active:scale-[0.98] lg:hidden"
          aria-label="Назад"
        >
          <ChevronLeft size={18} />
          <span>Назад</span>
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
            <p className="text-sm text-muted-foreground">Не удалось загрузить плейлист.</p>
            <button
              type="button"
              onClick={() => refetch()}
              className="inline-flex h-9 items-center gap-1 rounded-[var(--radius-md)] bg-secondary px-3 text-sm font-medium transition-colors hover:bg-secondary/80"
            >
              Повторить
            </button>
          </div>
        ) : playlist ? (
          <>
            <div className="mb-8 flex flex-col gap-4 border-b border-border pb-6 sm:flex-row sm:items-end sm:gap-6">
              <div className="flex h-32 w-32 shrink-0 items-center justify-center overflow-hidden rounded-[var(--radius-md)] border border-border bg-card text-muted-foreground sm:h-40 sm:w-40">
                {playlist.coverUrl ? (
                  <img
                    src={playlist.coverUrl}
                    alt={`Обложка плейлиста ${playlist.name}`}
                    className="h-full w-full object-cover"
                  />
                ) : playlist.isLiked ? (
                  <Heart size={42} fill="currentColor" />
                ) : (
                  <ListMusic size={42} />
                )}
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <span className="text-xs font-medium uppercase tracking-[0.25em] text-muted-foreground">Плейлист</span>
                <div className="flex items-start gap-3">
                  <h1 className="flex-1 text-3xl font-semibold tracking-tight sm:text-4xl">{playlist.name}</h1>
                  {canRename && (
                    <button
                      type="button"
                      onClick={() => setRenameOpen(true)}
                      className="mt-1 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                      aria-label="Переименовать плейлист"
                      title="Переименовать"
                    >
                      <Pencil size={16} />
                    </button>
                  )}
                  {playlist && !playlist.isLiked && (
                    <motion.button
                      type="button"
                      onClick={() => pinPlaylist.mutate({ id: playlist.id, pinned: !isPinned })}
                      whileTap={{ scale: 0.82 }}
                      transition={{ type: 'spring', stiffness: 400, damping: 17 }}
                      className={`mt-1 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-sm)] transition-colors ${
                        isPinned
                          ? 'bg-[var(--color-accent)]/15 text-[var(--color-accent)] hover:bg-[var(--color-accent)]/25'
                          : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
                      }`}
                      aria-label={isPinned ? 'Открепить' : 'Закрепить на панели'}
                      title={isPinned ? 'Открепить с панели' : 'Закрепить на панели'}
                    >
                      {isPinned ? <PinOff size={16} /> : <Pin size={16} />}
                    </motion.button>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  {playlist.trackCount} {playlist.trackCount === 1 ? 'трек' : 'треков'}
                </p>
                {canRename && (
                  <PlaylistCoverButton
                    playlistId={playlist.id}
                    hasCover={Boolean(playlist.coverUrl)}
                    className="pt-1"
                  />
                )}
              </div>
            </div>
            {playlist && (
              <RenamePlaylistDialog
                open={renameOpen}
                onClose={() => setRenameOpen(false)}
                playlistId={playlist.id}
                initialName={playlist.name}
              />
            )}
            {ownPlaylist && !hideRemoveMenu ? (
              <Reorder.Group
                axis="y"
                values={localTracks}
                onReorder={setLocalTracks}
                className="overflow-visible rounded-[var(--radius-md)] border border-border"
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
              <div className="overflow-visible rounded-[var(--radius-md)] border border-border">
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
          </>
        ) : (
          <p className="text-sm text-muted-foreground">Плейлист не найден</p>
        )}
      </div>
    </AuthGuard>
  );
}
