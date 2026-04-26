import { useParams, Link } from 'react-router-dom';
import { Play, Heart } from 'lucide-react';
import { AuthGuard } from '@/components/features/AuthGuard';
import { TrackItem } from '@/components/features/TrackItem';
import { useTrack, useTrackRadio } from '@/hooks/useTrack';
import { useLikeTrack } from '@/hooks/useLibrary';
import { usePlayerStore } from '@/store/player';
import type { Track } from '@/types';
import { Button } from '@/components/ui/Button';

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
      <div className="mx-auto max-w-5xl p-4 sm:p-6 lg:p-10">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Загрузка...</p>
        ) : track ? (
          <>
            <div className="mb-10 flex flex-col gap-6 border-b border-border pb-10 sm:flex-row">
              {track.coverUrl && (
                <img
                  src={track.coverUrl}
                  alt={track.title}
                  className="h-48 w-48 rounded-[var(--radius-md)] border border-border object-cover"
                />
              )}
              <div className="flex flex-col justify-end gap-3">
                <span className="text-xs font-medium uppercase tracking-[0.25em] text-muted-foreground">Трек</span>
                <h1 className="text-3xl font-semibold tracking-tight sm:text-5xl">{track.title}</h1>
                <Link to={`/artist/${track.artistId}`} className="text-sm text-muted-foreground hover:text-foreground">
                  {track.artist}
                </Link>
                <Link to={`/album/${track.albumId}`} className="text-xs text-muted-foreground hover:text-foreground">
                  {track.album}
                </Link>
                <div className="flex gap-2 pt-2">
                  <Button onClick={handlePlay}>
                    <Play size={14} fill="currentColor" /> Слушать
                  </Button>
                  <Button onClick={() => like.mutate(track.id)} variant="outline" size="icon" aria-label="Лайк">
                    <Heart size={16} />
                  </Button>
                </div>
              </div>
            </div>

            {radio?.items && radio.items.length > 0 && (
              <section>
                <h2 className="mb-4 border-b border-border pb-3 text-base font-semibold tracking-tight">Похожие треки</h2>
                <div className="overflow-hidden rounded-[var(--radius-md)] border border-border">
                  {radio.items.map((t, i) => (
                    <TrackItem key={t.id} track={t} index={i} onPlay={handlePlayRadioTrack} />
                  ))}
                </div>
              </section>
            )}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">Трек не найден</p>
        )}
      </div>
    </AuthGuard>
  );
}
