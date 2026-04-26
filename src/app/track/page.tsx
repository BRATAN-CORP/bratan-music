import { useParams, Link } from 'react-router-dom';
import { Play, Heart, Radio } from 'lucide-react';
import { AuthGuard } from '@/components/features/AuthGuard';
import { TrackItem } from '@/components/features/TrackItem';
import { useTrack, useTrackRadio } from '@/hooks/useTrack';
import { useLikeTrack } from '@/hooks/useLibrary';
import { usePlayerStore } from '@/store/player';
import type { Track } from '@/types';
import { Button } from '@/components/ui/Button';
import { Card, CardContent } from '@/components/ui/Card';

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
      <div className="mx-auto max-w-7xl p-4 sm:p-6 lg:p-8">
        {isLoading ? (
          <p className="text-muted-foreground">Загрузка...</p>
        ) : track ? (
          <>
            <Card className="animate-enter mb-8 border-primary/20 bg-card/70">
              <CardContent className="flex flex-col gap-6 p-6 sm:flex-row">
              {track.coverUrl && (
                <img src={track.coverUrl} alt={track.title} className="h-56 w-56 rounded-[1.75rem] object-cover shadow-[var(--shadow-lg)]" />
              )}
              <div className="flex flex-col justify-end gap-3">
                <p className="text-xs font-bold uppercase tracking-[0.24em] text-primary">Трек</p>
                <h1 className="hero-gradient-text text-4xl font-black tracking-tight sm:text-6xl">{track.title}</h1>
                <Link
                  to={`/artist/${track.artistId}`}
                  className="text-lg text-muted-foreground hover:text-foreground"
                >
                  {track.artist}
                </Link>
                <Link
                  to={`/album/${track.albumId}`}
                  className="text-sm text-muted-foreground hover:text-foreground"
                >
                  {track.album}
                </Link>
                <div className="flex gap-2 mt-2">
                  <Button onClick={handlePlay}>
                    <Play size={16} fill="currentColor" /> Слушать
                  </Button>
                  <Button onClick={() => like.mutate(track.id)} variant="secondary" size="icon">
                    <Heart size={18} />
                  </Button>
                </div>
              </div>
              </CardContent>
            </Card>

            {radio?.items && radio.items.length > 0 && (
              <section className="animate-enter">
                <h2 className="mb-4 flex items-center gap-2 text-2xl font-bold">
                  <Radio size={20} className="text-primary" />
                  Похожие треки
                </h2>
                <div className="glass-panel flex flex-col rounded-[var(--radius-xl)] p-2">
                  {radio.items.map((t, i) => (
                    <TrackItem key={t.id} track={t} index={i} onPlay={handlePlayRadioTrack} />
                  ))}
                </div>
              </section>
            )}
          </>
        ) : (
          <p className="text-muted-foreground">Трек не найден</p>
        )}
      </div>
    </AuthGuard>
  );
}
