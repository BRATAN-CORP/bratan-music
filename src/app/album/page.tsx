import { useParams, Link } from 'react-router-dom';
import { Play, Disc3 } from 'lucide-react';
import { AuthGuard } from '@/components/features/AuthGuard';
import { TrackItem } from '@/components/features/TrackItem';
import { useAlbum } from '@/hooks/useTrack';
import { usePlayerStore } from '@/store/player';
import type { Track } from '@/types';
import { Button } from '@/components/ui/Button';
import { Card, CardContent } from '@/components/ui/Card';

export function AlbumPage() {
  const { id } = useParams<{ id: string }>();
  const { data: album, isLoading } = useAlbum(id ?? '');
  const setTrack = usePlayerStore((s) => s.setTrack);
  const setQueue = usePlayerStore((s) => s.setQueue);

  const handlePlayTrack = (track: Track) => {
    setTrack({ id: track.id, title: track.title, artist: track.artist, coverUrl: track.coverUrl, duration: track.duration });
    if (album?.tracks) {
      setQueue(
        album.tracks.map((t) => ({ id: t.id, title: t.title, artist: t.artist, coverUrl: t.coverUrl, duration: t.duration }))
      );
    }
  };

  const handlePlayAll = () => {
    const first = album?.tracks?.[0];
    if (first) handlePlayTrack(first);
  };

  return (
    <AuthGuard>
      <div className="mx-auto max-w-7xl p-4 sm:p-6 lg:p-8">
        {isLoading ? (
          <p className="text-muted-foreground">Загрузка...</p>
        ) : album ? (
          <>
            <Card className="animate-enter mb-8 overflow-hidden border-primary/20 bg-card/70">
              <CardContent className="flex flex-col gap-6 p-6 sm:flex-row">
              {album.coverUrl ? (
                <img src={album.coverUrl} alt={album.title} className="h-56 w-56 rounded-[1.75rem] object-cover shadow-[var(--shadow-lg)]" />
              ) : (
                <div className="flex h-56 w-56 items-center justify-center rounded-[1.75rem] bg-secondary">
                  <Disc3 size={48} className="text-muted-foreground" />
                </div>
              )}
              <div className="flex flex-col justify-end gap-3">
                <p className="text-xs font-bold uppercase tracking-[0.24em] text-primary">Альбом</p>
                <h1 className="hero-gradient-text text-4xl font-black tracking-tight sm:text-6xl">{album.title}</h1>
                <Link
                  to={`/artist/${album.artistId}`}
                  className="text-lg text-muted-foreground hover:text-foreground"
                >
                  {album.artist}
                </Link>
                {album.releaseDate && (
                  <p className="text-xs text-muted-foreground">{album.releaseDate}</p>
                )}
                <Button onClick={handlePlayAll} className="mt-2 w-fit">
                  <Play size={16} fill="currentColor" /> Слушать
                </Button>
              </div>
              </CardContent>
            </Card>

            <div className="glass-panel animate-enter flex flex-col rounded-[var(--radius-xl)] p-2">
              {album.tracks?.map((track, i) => (
                <TrackItem key={track.id} track={track} index={i} onPlay={handlePlayTrack} />
              ))}
            </div>
          </>
        ) : (
          <p className="text-muted-foreground">Альбом не найден</p>
        )}
      </div>
    </AuthGuard>
  );
}
