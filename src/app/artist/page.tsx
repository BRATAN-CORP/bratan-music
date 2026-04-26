import { useParams } from 'react-router-dom';
import { Play, User } from 'lucide-react';
import { AuthGuard } from '@/components/features/AuthGuard';
import { TrackItem } from '@/components/features/TrackItem';
import { AlbumCard } from '@/components/features/AlbumCard';
import { ArtistCard } from '@/components/features/ArtistCard';
import { useArtist } from '@/hooks/useTrack';
import { usePlayerStore } from '@/store/player';
import type { Track } from '@/types';

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
      <div className="p-6">
        {isLoading ? (
          <p style={{ color: 'var(--color-text-muted)' }}>Загрузка...</p>
        ) : artist ? (
          <>
            <div className="flex flex-col sm:flex-row items-center sm:items-end gap-6 mb-8">
              {artist.imageUrl ? (
                <img src={artist.imageUrl} alt={artist.name} className="w-40 h-40 rounded-full object-cover" />
              ) : (
                <div className="w-40 h-40 rounded-full flex items-center justify-center" style={{ backgroundColor: 'var(--color-bg-muted)' }}>
                  <User size={48} style={{ color: 'var(--color-text-subtle)' }} />
                </div>
              )}
              <div className="flex flex-col gap-2 text-center sm:text-left">
                <p className="text-xs font-medium uppercase" style={{ color: 'var(--color-text-subtle)' }}>Артист</p>
                <h1 className="text-3xl font-bold">{artist.name}</h1>
                <button
                  onClick={handlePlayAll}
                  className="flex items-center gap-2 px-5 py-2 rounded-full text-sm font-medium mt-2 w-fit mx-auto sm:mx-0"
                  style={{ backgroundColor: 'var(--color-accent)', color: 'var(--color-text-on-accent)' }}
                >
                  <Play size={16} fill="currentColor" /> Слушать
                </button>
              </div>
            </div>

            {artist.topTracks?.length > 0 && (
              <section className="mb-8">
                <h2 className="text-lg font-bold mb-3">Популярные треки</h2>
                <div className="flex flex-col">
                  {artist.topTracks.map((track, i) => (
                    <TrackItem key={track.id} track={track} index={i} onPlay={handlePlayTrack} />
                  ))}
                </div>
              </section>
            )}

            {artist.albums?.length > 0 && (
              <section className="mb-8">
                <h2 className="text-lg font-bold mb-3">Альбомы</h2>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                  {artist.albums.map((album) => (
                    <AlbumCard key={album.id} album={album} />
                  ))}
                </div>
              </section>
            )}

            {artist.similarArtists?.length > 0 && (
              <section>
                <h2 className="text-lg font-bold mb-3">Похожие артисты</h2>
                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3">
                  {artist.similarArtists.map((a) => (
                    <ArtistCard key={a.id} artist={a} />
                  ))}
                </div>
              </section>
            )}
          </>
        ) : (
          <p style={{ color: 'var(--color-text-muted)' }}>Артист не найден</p>
        )}
      </div>
    </AuthGuard>
  );
}
