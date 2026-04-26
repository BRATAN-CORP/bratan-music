import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Reorder } from 'motion/react';
import { ChevronLeft, Pencil, ListMusic } from 'lucide-react';
import { AuthGuard } from '@/components/features/AuthGuard';
import { PlaylistTrackItem } from '@/components/features/PlaylistTrackItem';
import { PlaylistEditModal } from '@/components/features/PlaylistEditModal';
import { usePlaylist, useReorderPlaylistTracks } from '@/hooks/useLibrary';
import { usePlayerStore } from '@/store/player';
import { Button } from '@/components/ui/Button';
import { API_BASE } from '@/lib/api';
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
  const [editOpen, setEditOpen] = useState(false);
  const canEdit = Boolean(playlist && !playlist.isLiked);
  const coverHref = playlist?.coverUrl ? `${API_BASE}${playlist.coverUrl}` : null;

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
      coverUrl: track.coverUrl,
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

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Загрузка...</p>
        ) : playlist ? (
          <>
            <div className="mb-8 flex flex-col gap-4 border-b border-border pb-6 sm:flex-row sm:items-end">
              <div className="h-32 w-32 shrink-0 overflow-hidden rounded-[var(--radius-md)] border border-border bg-secondary sm:h-44 sm:w-44">
                {coverHref ? (
                  <img src={coverHref} alt={playlist.name} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                    <ListMusic size={36} />
                  </div>
                )}
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <span className="text-xs font-medium uppercase tracking-[0.25em] text-muted-foreground">Плейлист</span>
                <h1 className="break-words text-3xl font-semibold tracking-tight sm:text-4xl">{playlist.name}</h1>
                <p className="text-xs text-muted-foreground">
                  {playlist.trackCount} {playlist.trackCount === 1 ? 'трек' : 'треков'}
                </p>
                {canEdit && (
                  <div className="mt-1">
                    <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
                      <Pencil size={14} />
                      Редактировать
                    </Button>
                  </div>
                )}
              </div>
            </div>
            {canEdit && (
              <PlaylistEditModal
                open={editOpen}
                onClose={() => setEditOpen(false)}
                playlist={playlist}
              />
            )}
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
