import { useEffect, useRef } from 'react';
import { useParams, Link, useSearchParams } from 'react-router-dom';
import { Pause, Play, Heart } from 'lucide-react';
import { AuthGuard } from '@/components/features/AuthGuard';
import { TrackItem } from '@/components/features/TrackItem';
import { useTrack, useTrackRadio } from '@/hooks/useTrack';
import { useToggleLike } from '@/hooks/useLibrary';
import { usePlayerStore } from '@/store/player';
import { useTrackPlayback } from '@/hooks/usePlaybackSync';
import type { Track } from '@/types';
import { Button } from '@/components/ui/Button';
import { PageLoader } from '@/components/ui/PageLoader';
import { toPlayerTrack } from '@/lib/playerTrack';
import { ArtistLinks } from '@/components/features/ArtistLinks';
import { useT } from '@/i18n';

export function TrackPage() {
  const t = useT();
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const { data: track, isLoading } = useTrack(id ?? '');
  const { data: radio } = useTrackRadio(id ?? '');
  const { isLiked, toggle } = useToggleLike();
  const liked = track ? isLiked(track.id) : false;
  const setTrack = usePlayerStore((s) => s.setTrack);
  const setQueue = usePlayerStore((s) => s.setQueue);
  const togglePlay = usePlayerStore((s) => s.togglePlay);
  const autoplayedRef = useRef<string | null>(null);
  // Hero "Play" button mirrors the global player state for this track.
  const { isActive, isActivePlaying } = useTrackPlayback(track?.id ?? '');

  const handlePlay = () => {
    if (!track) return;
    if (isActive) {
      togglePlay();
      return;
    }
    setTrack(toPlayerTrack(track));
    if (radio?.items) {
      setQueue([toPlayerTrack(track), ...radio.items.map(toPlayerTrack)]);
    }
  };

  const handlePlayRadioTrack = (radioTrack: Track) => {
    setTrack(toPlayerTrack(radioTrack));
  };

  // Auto-play when the page is opened via a share link (?autoplay=1).
  // Browsers gate audio.play() on a prior user gesture, so this only
  // succeeds if the visitor already interacted with the SPA — but we
  // attempt it anyway and silently fall back to a paused state.
  useEffect(() => {
    if (!track) return;
    if (searchParams.get('autoplay') !== '1') return;
    if (autoplayedRef.current === track.id) return;
    autoplayedRef.current = track.id;
    handlePlay();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track?.id, radio?.items?.length, searchParams]);

  return (
    <AuthGuard>
      <div className="mx-auto max-w-6xl p-4 sm:p-6 lg:p-10">
        {isLoading ? (
          <PageLoader label={t('track.loading')} />
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
                <span className="text-xs font-medium uppercase tracking-[0.25em] text-muted-foreground">{t('track.pageEyebrow')}</span>
                <h1 className="text-3xl font-semibold tracking-tight sm:text-5xl">{track.title}</h1>
                <div className="text-sm text-muted-foreground">
                  <ArtistLinks
                    artists={track.artists}
                    fallbackName={track.artist}
                    fallbackId={track.artistId}
                    className="hover:text-foreground hover:underline"
                  />
                </div>
                <Link to={`/album/${track.albumId}`} className="text-xs text-muted-foreground hover:text-foreground">
                  {track.album}
                </Link>
                <div className="flex gap-2 pt-2">
                  <Button onClick={handlePlay}>
                    {isActivePlaying ? (
                      <>
                        <Pause size={14} fill="currentColor" /> {t('track.pause')}
                      </>
                    ) : (
                      <>
                        <Play size={14} fill="currentColor" /> {isActive ? t('track.continue') : t('track.listen')}
                      </>
                    )}
                  </Button>
                  <Button
                    onClick={() => toggle(track)}
                    variant="outline"
                    size="icon"
                    aria-label={liked ? t('player.unlike') : t('player.like')}
                    className={liked ? 'text-[var(--color-accent)]' : ''}
                  >
                    <Heart size={16} fill={liked ? 'currentColor' : 'none'} />
                  </Button>
                </div>
              </div>
            </div>

            {radio?.items && radio.items.length > 0 && (
              <section>
                <h2 className="mb-4 border-b border-border pb-3 text-base font-semibold tracking-tight">{t('track.similar')}</h2>
                <div className="overflow-visible rounded-[var(--radius-md)] border border-border">
                  {radio.items.map((t, i) => (
                    <TrackItem key={t.id} track={t} index={i} onPlay={handlePlayRadioTrack} />
                  ))}
                </div>
              </section>
            )}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">{t('track.notFound')}</p>
        )}
      </div>
    </AuthGuard>
  );
}
