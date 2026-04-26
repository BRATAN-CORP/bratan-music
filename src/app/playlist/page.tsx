import { useParams } from 'react-router-dom';
import { AuthGuard } from '@/components/features/AuthGuard';
import { TrackItem } from '@/components/features/TrackItem';
import { usePlaylist } from '@/hooks/useLibrary';
import { usePlayerStore } from '@/store/player';
import type { Track } from '@/types';

export function PlaylistPage() {
  const { id } = useParams<{ id: string }>();
  const { data: playlist, isLoading } = usePlaylist(id ?? '');
  const setTrack = usePlayerStore((s) => s.setTrack);
  const setQueue = usePlayerStore((s) => s.setQueue);

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
      <div className="p-6">
        {isLoading ? (
          <p style={{ color: 'var(--color-text-muted)' }}>Загрузка...</p>
        ) : playlist ? (
          <>
            <h1 className="text-2xl font-bold mb-1">{playlist.name}</h1>
            <p className="text-sm mb-6" style={{ color: 'var(--color-text-muted)' }}>
              {playlist.trackCount} {playlist.trackCount === 1 ? 'трек' : 'треков'}
            </p>
            <div className="flex flex-col">
              {playlist.tracks.map((track, i) => (
                <TrackItem key={track.id} track={track} index={i} onPlay={handlePlayTrack} />
              ))}
            </div>
          </>
        ) : (
          <p style={{ color: 'var(--color-text-muted)' }}>Плейлист не найден</p>
        )}
      </div>
    </AuthGuard>
  );
}
