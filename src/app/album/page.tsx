import { useParams, Link } from 'react-router-dom';
import { Pause, Play, Disc3, Heart, Share2 } from 'lucide-react';
import { AuthGuard } from '@/components/features/AuthGuard';
import { TrackItem } from '@/components/features/TrackItem';
import { useAlbum } from '@/hooks/useTrack';
import { ShareButton } from '@/components/features/ShareButton';
import { AlbumOfflineButton } from '@/components/features/OfflineActionButton';
import { HeroActionsKebab } from '@/components/features/HeroActionsKebab';
import { MenuItem } from '@/components/ui/PopoverMenu';
import { shareLink } from '@/lib/share';
import { useToggleAlbumLike } from '@/hooks/useLibrary';
import { ExplicitBadge } from '@/components/features/ExplicitBadge';
import { useOfflineCoverUrl } from '@/hooks/useOfflineCoverUrl';
import { usePlayerStore } from '@/store/player';
import { useCollectionPlayback } from '@/hooks/usePlaybackSync';
import { toast } from '@/store/toast';
import type { Track } from '@/types';
import { Button } from '@/components/ui/Button';
import { IconButton } from '@/components/ui/IconButton';
import { PageHero } from '@/components/ui/PageHero';
import { Skeleton, TrackListSkeleton } from '@/components/ui/Skeleton';
import { toPlayerTrack } from '@/lib/playerTrack';
import { useT } from '@/i18n';

export function AlbumPage() {
  const t = useT();
  const { id } = useParams<{ id: string }>();
  const { data: album, isLoading } = useAlbum(id ?? '');
  const setTrack = usePlayerStore((s) => s.setTrack);
  const setQueue = usePlayerStore((s) => s.setQueue);
  const togglePlay = usePlayerStore((s) => s.togglePlay);
  const setPlaybackContext = usePlayerStore((s) => s.setPlaybackContext);
  const albumLike = useToggleAlbumLike();
  const liked = album ? albumLike.isLiked(album.id) : false;
  // Resolve the hero cover from the offline cache when the album is
  // saved — keeps the iconic art visible on iOS Safari even when the
  // remote URL no longer reaches Tidal's CDN (slow cellular, captive
  // portal, expired auth). The hook also handles the iOS Safari
  // Blob-eviction case by re-materialising bytes from the saved
  // `coverBytes` ArrayBuffer.
  const heroCoverUrl = useOfflineCoverUrl('album', album?.id, album?.coverUrl);

  // Hero "Play" button: shows Pause when any track from this album is the
  // current player track, and clicking toggles instead of restarting.
  const trackIds = album?.tracks?.map((tr) => tr.id) ?? [];
  const albumCtx = id ? { type: 'album' as const, id } : undefined;
  const { isCollectionActive, isCollectionPlaying, playCollection } = useCollectionPlayback(trackIds, albumCtx);

  const handlePlayTrack = (track: Track) => {
    setTrack(toPlayerTrack(track));
    if (album?.tracks) {
      setQueue(album.tracks.map(toPlayerTrack));
    }
    if (albumCtx) setPlaybackContext(albumCtx);
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

  // Hoisted so the inline ShareButton (visible from `sm` up) and the
  // overflow `HeroActionsKebab` share one share-link path. Toast on
  // clipboard success because the kebab menu closes immediately and
  // the user otherwise gets no feedback.
  const handleShareAlbum = async () => {
    if (!album) return;
    const result = await shareLink({
      path: `/album/${album.id}`,
      shareTitle: album.title,
      shareText: `${album.title} — ${album.artist}`,
    });
    if (result.copied) toast.info(t('share.copied'));
  };

  return (
    <AuthGuard>
      <div className="mx-auto max-w-6xl p-4 sm:p-6 lg:p-10">
        {isLoading ? (
          <AlbumPageSkeleton />
        ) : album ? (
          <>
            <PageHero
              ambience={heroCoverUrl ? (
                <div
                  aria-hidden
                  className="absolute -inset-[15%] bg-cover bg-center blur-2xl saturate-150 opacity-60"
                  style={{ backgroundImage: `url(${heroCoverUrl})` }}
                />
              ) : undefined}
              cover={heroCoverUrl ? (
                <img
                  src={heroCoverUrl}
                  alt={album.title}
                  className="h-40 w-40 rounded-[var(--radius-md)] border border-white/10 object-cover shadow-[var(--shadow-cover)] sm:h-48 sm:w-48"
                />
              ) : (
                <div className="flex h-40 w-40 items-center justify-center rounded-[var(--radius-md)] border border-white/10 bg-secondary/60 shadow-[var(--shadow-cover)] sm:h-48 sm:w-48">
                  <Disc3 size={36} className="text-muted-foreground" />
                </div>
              )}
              eyebrow={t('albumPage.eyebrow')}
              title={(
                <span className="inline-flex flex-wrap items-center gap-1.5">
                  <span>{album.title}</span>
                  <ExplicitBadge explicit={album.explicit} size={20} />
                </span>
              )}
              subtitle={album.artists && album.artists.length > 1 ? (
                <>
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
                </>
              ) : (
                <Link to={`/artist/${album.artistId}`} className="hover:text-foreground">
                  {album.artist}
                </Link>
              )}
              meta={album.releaseDate ?? null}
              actions={
                <>
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
                  <IconButton
                    tone="accent"
                    active={liked}
                    onClick={() => albumLike.toggle({ id: album.id, title: album.title, artist: album.artist, artistId: album.artistId, coverUrl: album.coverUrl })}
                    aria-label={liked ? t('albumPage.unlike') : t('albumPage.like')}
                  >
                    <Heart size={16} className={liked ? 'fill-current' : ''} />
                  </IconButton>
                  <AlbumOfflineButton album={album} tracks={album.tracks ?? []} />

                  {/* Visible from `sm` (640px) up — below that the
                      Listen + Heart + Offline trio already eats the
                      row, so Share folds into the kebab to avoid
                      wrapping. */}
                  <div className="hidden sm:contents">
                    <ShareButton
                      path={`/album/${album.id}`}
                      shareTitle={album.title}
                      shareText={`${album.title} — ${album.artist}`}
                      ariaLabel={t('albumPage.shareAria')}
                    />
                  </div>

                  <HeroActionsKebab className="sm:hidden">
                    <MenuItem onClick={handleShareAlbum} icon={<Share2 size={14} />}>
                      {t('share.shareGeneric')}
                    </MenuItem>
                  </HeroActionsKebab>
                </>
              }
            />

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

/**
 * Page-level skeleton mirroring the live album page (PageHero with a
 * 160px square cover, eyebrow + title + subtitle + meta + action
 * buttons, followed by a tracklist). Renders the same vertical band
 * the data will fill in so swapping skeleton → live doesn't shift
 * layout.
 */
function AlbumPageSkeleton() {
  return (
    <>
      <div className="mb-10 flex flex-col gap-6 border-b border-border pb-10 sm:flex-row sm:items-end">
        <Skeleton className="h-40 w-40 rounded-[var(--radius-md)] sm:h-48 sm:w-48" />
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-9 w-2/3" />
          <Skeleton className="h-3 w-1/3" />
          <Skeleton className="h-3 w-24" />
          <div className="flex flex-wrap items-center gap-2 pt-2">
            <Skeleton className="h-9 w-32 rounded-full" />
            <Skeleton className="h-9 w-9 rounded-full" />
            <Skeleton className="h-9 w-9 rounded-full" />
            <Skeleton className="h-9 w-9 rounded-full" />
          </div>
        </div>
      </div>
      <div className="overflow-hidden rounded-[var(--radius-md)] border border-border">
        <TrackListSkeleton count={8} />
      </div>
    </>
  );
}
