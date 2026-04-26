import { useParams } from 'react-router-dom';
import { Play, User } from 'lucide-react';
import { AuthGuard } from '@/components/features/AuthGuard';
import { TrackItem } from '@/components/features/TrackItem';
import { AlbumCard } from '@/components/features/AlbumCard';
import { ArtistCard } from '@/components/features/ArtistCard';
import { useArtist } from '@/hooks/useTrack';
import { usePlayerStore } from '@/store/player';
import type { Track } from '@/types';
import { Button } from '@/components/ui/Button';
import { Card, CardContent } from '@/components/ui/Card';

export function ArtistPage() {
  const { id } = useParams<{ id: string }>();
  const { data: artist, isLoading } = useArtist(id ?? '');
  const setTrack = usePlayerStore((s) => s.setTrack);
  const setQueue = usePlayerStore((s) => s.setQueue);

  const handlePlayTrack = (track: Track) => {
    setTrack({ id: track.id, title: track.title, artist: track.artist, coverUrl: track.coverUrl, duration: track.duration });
    if (artist?.topTracks) {
      setQueue(
        artist.topTracks.map((t) => ({ id: t.id, title: t.title, artist: t.artist, coverUrl: t.coverUrl, duration: t.duration }))
      );
    }
  };

  const handlePlayAll = () => {
    const first = artist?.topTracks?.[0];
    if (first) handlePlayTrack(first);
  };

  return (
    <AuthGuard>
      <div className="mx-auto max-w-7xl p-4 sm:p-6 lg:p-8">
        {isLoading ? (
          <p className="text-muted-foreground">Загрузка...</p>
        ) : artist ? (
          <>
            <Card className="animate-enter mb-8 border-primary/20 bg-card/70">
              <CardContent className="flex flex-col items-center gap-6 p-6 sm:flex-row sm:items-end">
              {artist.imageUrl ? (
                <img src={artist.imageUrl} alt={artist.name} className="h-44 w-44 rounded-full object-cover shadow-[var(--shadow-lg)] ring-4 ring-primary/20" />
              ) : (
                <div className="flex h-44 w-44 items-center justify-center rounded-full bg-secondary ring-4 ring-primary/20">
                  <User size={48} className="text-muted-foreground" />
                </div>
              )}
              <div className="flex flex-col gap-2 text-center sm:text-left">
                <p className="text-xs font-bold uppercase tracking-[0.24em] text-primary">Артист</p>
                <h1 className="hero-gradient-text text-4xl font-black tracking-tight sm:text-6xl">{artist.name}</h1>
                <Button onClick={handlePlayAll} className="mx-auto mt-2 w-fit sm:mx-0">
                  <Play size={16} fill="currentColor" /> Слушать
                </Button>
              </div>
              </CardContent>
            </Card>

            {artist.topTracks?.length > 0 && (
              <section className="animate-enter mb-8">
                <h2 className="mb-4 text-2xl font-bold">Популярные треки</h2>
                <div className="glass-panel flex flex-col rounded-[var(--radius-xl)] p-2">
                  {artist.topTracks.map((track, i) => (
                    <TrackItem key={track.id} track={track} index={i} onPlay={handlePlayTrack} />
                  ))}
                </div>
              </section>
            )}

            {artist.albums?.length > 0 && (
              <section className="animate-enter mb-8">
                <h2 className="mb-4 text-2xl font-bold">Альбомы</h2>
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
                  {artist.albums.map((album) => (
                    <AlbumCard key={album.id} album={album} />
                  ))}
                </div>
              </section>
            )}

            {artist.similarArtists?.length > 0 && (
              <section className="animate-enter">
                <h2 className="mb-4 text-2xl font-bold">Похожие артисты</h2>
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-5 xl:grid-cols-6">
                  {artist.similarArtists.map((a) => (
                    <ArtistCard key={a.id} artist={a} />
                  ))}
                </div>
              </section>
            )}
          </>
        ) : (
          <p className="text-muted-foreground">Артист не найден</p>
        )}
      </div>
    </AuthGuard>
  );
}
