import { useParams, Link } from 'react-router-dom';
import { Play, Disc3 } from 'lucide-react';
import { AuthGuard } from '@/components/features/AuthGuard';
import { TrackItem } from '@/components/features/TrackItem';
import { useAlbum } from '@/hooks/useTrack';
import { usePlayerStore } from '@/store/player';
import type { Track } from '@/types';

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
      <div className="p-6">
        {isLoading ? (
          <p style={{ color: 'var(--color-text-muted)' }}>Загрузка...</p>
        ) : album ? (
          <>
            <div className="flex flex-col sm:flex-row gap-6 mb-8">
              {album.coverUrl ? (
                <img src={album.coverUrl} alt={album.title} className="w-48 h-48 rounded-xl object-cover" />
              ) : (
                <div className="w-48 h-48 rounded-xl flex items-center justify-center" style={{ backgroundColor: 'var(--color-bg-muted)' }}>
                  <Disc3 size={48} style={{ color: 'var(--color-text-subtle)' }} />
                </div>
              )}
              <div className="flex flex-col justify-end gap-2">
                <p className="text-xs font-medium uppercase" style={{ color: 'var(--color-text-subtle)' }}>Альбом</p>
                <h1 className="text-3xl font-bold">{album.title}</h1>
                <Link
                  to={`/artist/${album.artistId}`}
                  className="text-lg hover:underline"
                  style={{ color: 'var(--color-text-muted)' }}
                >
                  {album.artist}
                </Link>
                {album.releaseDate && (
                  <p className="text-xs" style={{ color: 'var(--color-text-subtle)' }}>{album.releaseDate}</p>
                )}
                <button
                  onClick={handlePlayAll}
                  className="flex items-center gap-2 px-5 py-2 rounded-full text-sm font-medium mt-2 w-fit"
                  style={{ backgroundColor: 'var(--color-accent)', color: 'var(--color-text-on-accent)' }}
                >
                  <Play size={16} fill="currentColor" /> Слушать
                </button>
              </div>
            </div>

            <div className="flex flex-col">
              {album.tracks?.map((track, i) => (
                <TrackItem key={track.id} track={track} index={i} onPlay={handlePlayTrack} />
              ))}
            </div>
          </>
        ) : (
          <p style={{ color: 'var(--color-text-muted)' }}>Альбом не найден</p>
        )}
      </div>
    </AuthGuard>
  );
}
