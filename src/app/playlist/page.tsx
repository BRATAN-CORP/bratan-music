import { useParams } from 'react-router-dom';
import { AuthGuard } from '@/components/features/AuthGuard';
import { TrackItem } from '@/components/features/TrackItem';
import { usePlaylist } from '@/hooks/useLibrary';
import { usePlayerStore } from '@/store/player';
import type { Track } from '@/types';
import { Card, CardContent } from '@/components/ui/Card';

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
      <div className="mx-auto max-w-5xl p-4 sm:p-6 lg:p-8">
        {isLoading ? (
          <p className="text-muted-foreground">Загрузка...</p>
        ) : playlist ? (
          <>
            <Card className="animate-enter mb-6 bg-card/70">
              <CardContent>
                <p className="text-xs font-bold uppercase tracking-[0.24em] text-primary">Плейлист</p>
                <h1 className="hero-gradient-text mt-1 text-4xl font-black">{playlist.name}</h1>
                <p className="mt-2 text-sm text-muted-foreground">
                  {playlist.trackCount} {playlist.trackCount === 1 ? 'трек' : 'треков'}
                </p>
              </CardContent>
            </Card>
            <div className="glass-panel animate-enter flex flex-col rounded-[var(--radius-xl)] p-2">
              {playlist.tracks.map((track, i) => (
                <TrackItem key={track.id} track={track} index={i} onPlay={handlePlayTrack} />
              ))}
            </div>
          </>
        ) : (
          <p className="text-muted-foreground">Плейлист не найден</p>
        )}
      </div>
    </AuthGuard>
  );
}
