import { useParams, useNavigate } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import { AuthGuard } from '@/components/features/AuthGuard';
import { TrackItem } from '@/components/features/TrackItem';
import { usePlaylist } from '@/hooks/useLibrary';
import { usePlayerStore } from '@/store/player';
import type { Track } from '@/types';

export function PlaylistPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: playlist, isLoading } = usePlaylist(id ?? '');
  const setTrack = usePlayerStore((s) => s.setTrack);
  const setQueue = usePlayerStore((s) => s.setQueue);

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
    if (playlist?.tracks) {
      setQueue(
        playlist.tracks.map((t) => ({
          id: t.id,
          title: t.title,
          artist: t.artist,
          coverUrl: t.coverUrl,
          duration: t.duration,
        }))
      );
    }
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
            <div className="overflow-hidden rounded-[var(--radius-md)] border border-border">
              {playlist.tracks.map((track, i) => (
                <TrackItem key={track.id} track={track} index={i} onPlay={handlePlayTrack} />
              ))}
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">Плейлист не найден</p>
        )}
      </div>
    </AuthGuard>
  );
}
