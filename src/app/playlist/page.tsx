import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Reorder } from 'motion/react';
import { ChevronLeft } from 'lucide-react';
import { AuthGuard } from '@/components/features/AuthGuard';
import { PlaylistTrackItem } from '@/components/features/PlaylistTrackItem';
import { usePlaylist, useReorderPlaylistTracks } from '@/hooks/useLibrary';
import { usePlayerStore } from '@/store/player';
import type { Track } from '@/types';

export function PlaylistPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: playlist, isLoading } = usePlaylist(id ?? '');
  const reorderMutation = useReorderPlaylistTracks();
  const setTrack = usePlayerStore((s) => s.setTrack);
  const setQueue = usePlayerStore((s) => s.setQueue);

  const tracks = useMemo(() => playlist?.tracks ?? [], [playlist?.tracks]);
  const [localTracks, setLocalTracks] = useState<Track[]>([]);
  const ownPlaylist = useMemo(() => Boolean(playlist && id), [playlist, id]);
  const hideRemoveMenu = Boolean(playlist?.isLiked);

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
      coverUrl: track.coverUrl,
      duration: track.duration,
    });
    setQueue(
      localTracks.map((t) => ({
        id: t.id,
        title: t.title,
        artist: t.artist,
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

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Загрузка...</p>
        ) : playlist ? (
          <>
            <div className="mb-8 flex flex-col gap-2 border-b border-border pb-6">
              <span className="text-xs font-medium uppercase tracking-[0.25em] text-muted-foreground">Плейлист</span>
              <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{playlist.name}</h1>
              <p className="text-xs text-muted-foreground">
                {playlist.trackCount} {playlist.trackCount === 1 ? 'трек' : 'треков'}
              </p>
            </div>
            {ownPlaylist && !hideRemoveMenu ? (
              <Reorder.Group
                axis="y"
                values={localTracks}
                onReorder={setLocalTracks}
                className="overflow-hidden rounded-[var(--radius-md)] border border-border"
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
              <div className="overflow-hidden rounded-[var(--radius-md)] border border-border">
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
