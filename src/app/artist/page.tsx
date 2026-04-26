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
      <div className="mx-auto max-w-6xl p-4 sm:p-6 lg:p-10">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Загрузка...</p>
        ) : artist ? (
          <>
            <div className="mb-10 flex flex-col items-start gap-6 border-b border-border pb-10 sm:flex-row sm:items-end">
              {artist.imageUrl ? (
                <img
                  src={artist.imageUrl}
                  alt={artist.name}
                  className="h-40 w-40 rounded-full border border-border object-cover"
                />
              ) : (
                <div className="flex h-40 w-40 items-center justify-center rounded-full border border-border bg-secondary">
                  <User size={36} className="text-muted-foreground" />
                </div>
              )}
              <div className="flex flex-col gap-3">
                <span className="text-xs font-medium uppercase tracking-[0.25em] text-muted-foreground">Артист</span>
                <h1 className="text-3xl font-semibold tracking-tight sm:text-5xl">{artist.name}</h1>
                <div className="pt-2">
                  <Button onClick={handlePlayAll}>
                    <Play size={14} fill="currentColor" /> Слушать
                  </Button>
                </div>
              </div>
            </div>

            {artist.topTracks?.length > 0 && (
              <section className="mb-12">
                <h2 className="mb-4 border-b border-border pb-3 text-base font-semibold tracking-tight">Популярные треки</h2>
                <div className="overflow-hidden rounded-[var(--radius-md)] border border-border">
                  {artist.topTracks.map((track, i) => (
                    <TrackItem key={track.id} track={track} index={i} onPlay={handlePlayTrack} />
                  ))}
                </div>
              </section>
            )}

            {artist.albums?.length > 0 && (
              <section className="mb-12">
                <h2 className="mb-4 border-b border-border pb-3 text-base font-semibold tracking-tight">Альбомы</h2>
                <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
                  {artist.albums.map((album) => (
                    <AlbumCard key={album.id} album={album} />
                  ))}
                </div>
              </section>
            )}

            {artist.similarArtists?.length > 0 && (
              <section>
                <h2 className="mb-4 border-b border-border pb-3 text-base font-semibold tracking-tight">Похожие артисты</h2>
                <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 md:grid-cols-5 xl:grid-cols-6">
                  {artist.similarArtists.map((a) => (
                    <ArtistCard key={a.id} artist={a} />
                  ))}
                </div>
              </section>
            )}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">Артист не найден</p>
        )}
      </div>
    </AuthGuard>
  );
}
