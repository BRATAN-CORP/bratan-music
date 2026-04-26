import { useParams, Link } from 'react-router-dom';
import { Play, Heart, Radio } from 'lucide-react';
import { AuthGuard } from '@/components/features/AuthGuard';
import { TrackItem } from '@/components/features/TrackItem';
import { useTrack, useTrackRadio } from '@/hooks/useTrack';
import { useLikeTrack } from '@/hooks/useLibrary';
import { usePlayerStore } from '@/store/player';
import type { Track } from '@/types';

export function TrackPage() {
  const { id } = useParams<{ id: string }>();
  const { data: track, isLoading } = useTrack(id ?? '');
  const { data: radio } = useTrackRadio(id ?? '');
  const like = useLikeTrack();
  const setTrack = usePlayerStore((s) => s.setTrack);
  const setQueue = usePlayerStore((s) => s.setQueue);

  const handlePlay = () => {
    if (!track) return;
    setTrack({ id: track.id, title: track.title, artist: track.artist, coverUrl: track.coverUrl, duration: track.duration });
    if (radio?.items) {
      setQueue([
        { id: track.id, title: track.title, artist: track.artist, coverUrl: track.coverUrl, duration: track.duration },
        ...radio.items.map((t) => ({ id: t.id, title: t.title, artist: t.artist, coverUrl: t.coverUrl, duration: t.duration })),
      ]);
    }
  };

  const handlePlayRadioTrack = (t: Track) => {
    setTrack({ id: t.id, title: t.title, artist: t.artist, coverUrl: t.coverUrl, duration: t.duration });
  };

  return (
    <AuthGuard>
      <div className="p-6">
        {isLoading ? (
          <p style={{ color: 'var(--color-text-muted)' }}>Загрузка...</p>
        ) : track ? (
          <>
            <div className="flex flex-col sm:flex-row gap-6 mb-8">
              {track.coverUrl && (
                <img src={track.coverUrl} alt={track.title} className="w-48 h-48 rounded-xl object-cover" />
              )}
              <div className="flex flex-col justify-end gap-3">
                <h1 className="text-3xl font-bold">{track.title}</h1>
                <Link
                  to={`/artist/${track.artistId}`}
                  className="text-lg hover:underline"
                  style={{ color: 'var(--color-text-muted)' }}
                >
                  {track.artist}
                </Link>
                <Link
                  to={`/album/${track.albumId}`}
                  className="text-sm hover:underline"
                  style={{ color: 'var(--color-text-subtle)' }}
                >
                  {track.album}
                </Link>
                <div className="flex gap-2 mt-2">
                  <button
                    onClick={handlePlay}
                    className="flex items-center gap-2 px-5 py-2 rounded-full text-sm font-medium"
                    style={{ backgroundColor: 'var(--color-accent)', color: 'var(--color-text-on-accent)' }}
                  >
                    <Play size={16} fill="currentColor" /> Слушать
                  </button>
                  <button
                    onClick={() => like.mutate(track.id)}
                    className="p-2 rounded-full hover:opacity-80"
                    style={{ border: '1px solid var(--color-border)' }}
                  >
                    <Heart size={18} />
                  </button>
                </div>
              </div>
            </div>

            {radio?.items && radio.items.length > 0 && (
              <section>
                <h2 className="text-lg font-bold mb-3 flex items-center gap-2">
                  <Radio size={18} style={{ color: 'var(--color-accent)' }} />
                  Похожие треки
                </h2>
                <div className="flex flex-col">
                  {radio.items.map((t, i) => (
                    <TrackItem key={t.id} track={t} index={i} onPlay={handlePlayRadioTrack} />
                  ))}
                </div>
              </section>
            )}
          </>
        ) : (
          <p style={{ color: 'var(--color-text-muted)' }}>Трек не найден</p>
        )}
      </div>
    </AuthGuard>
  );
}
