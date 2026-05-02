import { useParams, Link } from 'react-router-dom';
import { Pause, Play, Disc3, Heart } from 'lucide-react';
import { AuthGuard } from '@/components/features/AuthGuard';
import { TrackItem } from '@/components/features/TrackItem';
import { useAlbum } from '@/hooks/useTrack';
import { ShareButton } from '@/components/features/ShareButton';
import { useToggleAlbumLike } from '@/hooks/useLibrary';
import { usePlayerStore } from '@/store/player';
import { useCollectionPlayback } from '@/hooks/usePlaybackSync';
import type { Track } from '@/types';
import { Button } from '@/components/ui/Button';
import { toPlayerTrack } from '@/lib/playerTrack';
import { useT } from '@/i18n';

export function AlbumPage() {
  const t = useT();
  const { id } = useParams<{ id: string }>();
  const { data: album, isLoading } = useAlbum(id ?? '');
  const setTrack = usePlayerStore((s) => s.setTrack);
  const setQueue = usePlayerStore((s) => s.setQueue);
  const togglePlay = usePlayerStore((s) => s.togglePlay);
  const albumLike = useToggleAlbumLike();
  const liked = album ? albumLike.isLiked(album.id) : false;

  // Hero "Play" button: shows Pause when any track from this album is the
  // current player track, and clicking toggles instead of restarting.
  const trackIds = album?.tracks?.map((tr) => tr.id) ?? [];
  const { isCollectionActive, isCollectionPlaying, playCollection } = useCollectionPlayback(trackIds);

  const handlePlayTrack = (track: Track) => {
    setTrack(toPlayerTrack(track));
    if (album?.tracks) {
      setQueue(album.tracks.map(toPlayerTrack));
    }
  };

  const handlePlayAll = () => {
    if (isCollectionActive) {
      togglePlay();
      return;
    }
    if (album?.tracks?.length) {
      playCollection(album.tracks);
    }
  };

  return (
    <AuthGuard>
      <div className="mx-auto max-w-6xl p-4 sm:p-6 lg:p-10">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">{t('albumPage.loading')}</p>
        ) : album ? (
          <>
            {/* Hero, mirrored from the artist page: the cover doubles
                as a blurred ambience layer that bleeds beyond the
                visible bounds (so the soft blur radius is fully behind
                the parent's overflow-hidden mask — no ragged feathered
                edges) plus a soft top-down vignette and accent radial.
                If there is no cover at all, a soft accent radial keeps
                the hero from looking flat. */}
            <div className="relative isolate -mx-4 mb-10 overflow-hidden border-b border-border px-4 pb-10 pt-6 sm:-mx-6 sm:px-6 sm:pt-10 lg:-mx-10 lg:px-10">
              {album.coverUrl ? (
                <div
                  aria-hidden
                  className="pointer-events-none absolute -inset-[15%] -z-10 bg-cover bg-center blur-2xl saturate-150 opacity-60"
                  style={{ backgroundImage: `url(${album.coverUrl})` }}
                />
              ) : (
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(80%_120%_at_30%_0%,var(--color-accent-glow),transparent_70%)] opacity-40"
                />
              )}
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0 -z-10 bg-gradient-to-b from-black/10 via-[var(--color-bg)]/35 to-[var(--color-bg)]"
              />
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(60%_80%_at_25%_15%,var(--color-accent-glow),transparent_75%)] opacity-25"
              />
              <div className="flex flex-col gap-6 sm:flex-row">
              {album.coverUrl ? (
                <img
                  src={album.coverUrl}
                  alt={album.title}
                  className="h-48 w-48 rounded-[var(--radius-md)] border border-white/10 object-cover shadow-[0_18px_48px_-16px_rgba(0,0,0,0.55)]"
                />
              ) : (
                <div className="flex h-48 w-48 items-center justify-center rounded-[var(--radius-md)] border border-white/10 bg-secondary/60 shadow-[0_18px_48px_-16px_rgba(0,0,0,0.55)]">
                  <Disc3 size={36} className="text-muted-foreground" />
                </div>
              )}
              <div className="flex flex-col justify-end gap-3">
                <span className="text-xs font-medium uppercase tracking-[0.25em] text-muted-foreground">{t('albumPage.eyebrow')}</span>
                <h1 className="text-3xl font-semibold tracking-tight sm:text-5xl">{album.title}</h1>
                {album.artists && album.artists.length > 1 ? (
                  <div className="text-sm text-muted-foreground">
                    {album.artists.map((a, i) => (
                      <span key={a.id + ':' + i}>
                        <Link
                          to={`/artist/${a.id}`}
                          className="hover:text-foreground hover:underline"
                        >
                          {a.name}
                        </Link>
                        {i < album.artists!.length - 1 && ', '}
                      </span>
                    ))}
                  </div>
                ) : (
                  <Link to={`/artist/${album.artistId}`} className="text-sm text-muted-foreground hover:text-foreground">
                    {album.artist}
                  </Link>
                )}
                {album.releaseDate && (
                  <p className="text-xs text-muted-foreground">{album.releaseDate}</p>
                )}
                <div className="flex items-center gap-2 pt-2">
                  <Button onClick={handlePlayAll}>
                    {isCollectionPlaying ? (
                      <>
                        <Pause size={14} fill="currentColor" /> {t('albumPage.pause')}
                      </>
                    ) : (
                      <>
                        <Play size={14} fill="currentColor" /> {isCollectionActive ? t('albumPage.continue') : t('albumPage.listen')}
                      </>
                    )}
                  </Button>
                  <button
                    type="button"
                    onClick={() => albumLike.toggle({ id: album.id, title: album.title, artist: album.artist, artistId: album.artistId, coverUrl: album.coverUrl })}
                    className={`inline-flex h-9 w-9 items-center justify-center rounded-full border transition-all active:scale-90 ${
                      liked
                        ? 'border-[var(--color-accent)]/30 bg-[var(--color-accent)]/15 text-[var(--color-accent)]'
                        : 'border-border text-muted-foreground hover:text-foreground hover:bg-secondary'
                    }`}
                    aria-label={liked ? t('albumPage.unlike') : t('albumPage.like')}
                  >
                    <Heart size={16} className={liked ? 'fill-current' : ''} />
                  </button>
                  <ShareButton
                    path={`/album/${album.id}`}
                    shareTitle={album.title}
                    shareText={`${album.title} — ${album.artist}`}
                    ariaLabel={t('albumPage.shareAria')}
                  />
                </div>
              </div>
              </div>
            </div>

            <div className="overflow-visible rounded-[var(--radius-md)] border border-border">
              {album.tracks?.map((track, i) => (
                <TrackItem key={track.id} track={track} index={i} onPlay={handlePlayTrack} />
              ))}
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">{t('albumPage.notFound')}</p>
        )}
      </div>
    </AuthGuard>
  );
}
