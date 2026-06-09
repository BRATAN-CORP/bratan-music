import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Pause, Play, Heart, Radio, Ban, RotateCcw, Share2 } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { AuthGuard } from '@/components/features/AuthGuard';
import { TrackItem } from '@/components/features/TrackItem';
import { AlbumCard } from '@/components/features/AlbumCard';
import { ArtistCard } from '@/components/features/ArtistCard';
import { ShareButton } from '@/components/features/ShareButton';
import { HeroActionsKebab } from '@/components/features/HeroActionsKebab';
import { MenuItem, MenuDivider } from '@/components/ui/PopoverMenu';
import { shareLink } from '@/lib/share';
import { useArtist, useArtistRadio } from '@/hooks/useTrack';
import { useToggleArtistLike } from '@/hooks/useLibrary';
import { usePlayerStore } from '@/store/player';
import { useDislikesStore } from '@/store/dislikes';
import { useToggleDislike } from '@/hooks/useDislikes';
import { toast } from '@/store/toast';
import { useCollectionPlayback } from '@/hooks/usePlaybackSync';
import type { Track } from '@/types';
import { Button } from '@/components/ui/Button';
import { IconButton } from '@/components/ui/IconButton';
import { PageHero } from '@/components/ui/PageHero';
import { Skeleton, TrackListSkeleton, AlbumGridSkeleton } from '@/components/ui/Skeleton';
import { toPlayerTrack } from '@/lib/playerTrack';
import { useT } from '@/i18n';

export function ArtistPage() {
  const t = useT();
  const { id } = useParams<{ id: string }>();
  const { data: artist, isLoading } = useArtist(id ?? '');
  const { data: radio } = useArtistRadio(id ?? '');
  const setTrack = usePlayerStore((s) => s.setTrack);
  const setQueue = usePlayerStore((s) => s.setQueue);
  const setPlaybackContext = usePlayerStore((s) => s.setPlaybackContext);
  const artistLike = useToggleArtistLike();
  const liked = artist ? artistLike.isLiked(artist.id) : false;
  const artistDisliked = useDislikesStore((s) => Boolean(artist?.id && s.artists.has(artist.id)));
  const toggleDislike = useToggleDislike();
  const reduce = useReducedMotion();
  // Match `ArtistCard`: if Tidal's portrait URL is stale and 404s,
  // swap to the initials tile instead of letting the browser draw
  // the broken-image glyph in the hero.
  const [heroImgFailed, setHeroImgFailed] = useState(false);
  const heroPhoto = !!artist?.imageUrl && !heroImgFailed ? artist.imageUrl : undefined;

  // Hero "Play" button on the artist page targets the current top-track
  // queue — if anything in that list is the active player track, the
  // button mirrors play state and toggles instead of restarting.
  const topTrackIds = artist?.topTracks?.map((tr) => tr.id) ?? [];
  const artistCtx = id ? { type: 'artist' as const, id } : undefined;
  const { isCollectionActive, isCollectionPlaying, playCollection } = useCollectionPlayback(topTrackIds, artistCtx);

  const handlePlayTrack = (track: Track) => {
    setTrack(toPlayerTrack(track));
    if (artist?.topTracks) {
      setQueue(artist.topTracks.map(toPlayerTrack));
    }
    if (artistCtx) setPlaybackContext(artistCtx);
  };

  const handlePlayAll = () => {
    if (artist?.topTracks?.length) {
      playCollection(artist.topTracks);
    }
  };

  const handlePlayRadio = () => {
    const items = radio?.items;
    const first = items?.[0];
    if (!items?.length || !first) return;
    setTrack(toPlayerTrack(first));
    setQueue(items.map(toPlayerTrack));
    if (id) setPlaybackContext({ type: 'artist', id: `${id}-radio` });
  };

  // Hoisted out of the inline `actions={…}` block so the inline icon
  // rail (visible from `sm` up) and the overflow `HeroActionsKebab`
  // (visible below `sm`) share one source of truth for ban / share
  // handlers.
  const handleToggleArtistDislike = () => {
    if (!artist) return;
    const wasDisliked = artistDisliked;
    toggleDislike.mutate(
      { kind: 'artist', id: artist.id, source: 'tidal', nextState: wasDisliked ? 'unbanned' : 'banned' },
      {
        onSuccess: () => {
          toast.info(
            wasDisliked
              ? t('dislike.artistRestored')
              : t('dislike.artistHidden', { name: artist.name }),
          );
        },
        onError: (err) => {
          toast.error(err instanceof Error ? err.message : t('dislike.failed'));
        },
      },
    );
  };

  const handleShareArtist = async () => {
    if (!artist) return;
    const result = await shareLink({
      path: `/artist/${artist.id}`,
      shareTitle: artist.name,
      shareText: t('artistPage.shareText', { name: artist.name }),
    });
    if (result.copied) toast.info(t('share.copied'));
  };

  return (
    <AuthGuard>
      <div className="mx-auto max-w-6xl p-4 sm:p-6 lg:p-10">
        {isLoading ? (
          <ArtistPageSkeleton />
        ) : artist ? (
          <>
            <PageHero
              ambience={heroPhoto ? (
                <AnimatePresence initial={false} mode="sync">
                  {/* Cross-fade the blurred portrait between artists so
                      navigation doesn't snap. The bleed past every edge
                      keeps the soft blur radius fully behind the parent
                      overflow-hidden mask — fixes the ragged feathered
                      edge previously reported on desktop. */}
                  <motion.div
                    key={artist.id + ':bg'}
                    aria-hidden
                    className="absolute -inset-[15%] bg-cover bg-center blur-2xl saturate-150"
                    style={{ backgroundImage: `url(${heroPhoto})` }}
                    initial={reduce ? { opacity: 0.6, scale: 1 } : { opacity: 0, scale: 1.08 }}
                    animate={{ opacity: 0.6, scale: 1 }}
                    exit={reduce ? { opacity: 0 } : { opacity: 0 }}
                    transition={{ duration: 0.9, ease: [0.4, 0, 0.2, 1] }}
                  />
                </AnimatePresence>
              ) : undefined}
              cover={heroPhoto ? (
                <img
                  src={heroPhoto}
                  alt={artist.name}
                  className="h-32 w-32 rounded-full border border-white/10 object-cover shadow-[var(--shadow-cover)] sm:h-40 sm:w-40"
                  onError={() => setHeroImgFailed(true)}
                />
              ) : (
                <FallbackAvatar name={artist.name} />
              )}
              eyebrow={t('artistPage.eyebrow')}
              title={artist.name}
              actions={
                <>
                  <Button onClick={handlePlayAll}>
                    {isCollectionPlaying ? (
                      <>
                        <Pause size={14} fill="currentColor" /> {t('artistPage.pause')}
                      </>
                    ) : (
                      <>
                        <Play size={14} fill="currentColor" /> {isCollectionActive ? t('artistPage.continue') : t('artistPage.listen')}
                      </>
                    )}
                  </Button>
                  <IconButton
                    tone="accent"
                    active={liked}
                    onClick={() => artistLike.toggle({ id: artist.id, name: artist.name, imageUrl: artist.imageUrl })}
                    aria-label={liked ? t('artistPage.unfollow') : t('artistPage.follow')}
                  >
                    <Heart size={16} className={liked ? 'fill-current' : ''} />
                  </IconButton>

                  {/* Inline rail for the secondary actions — visible
                      from `sm` (640px) up. Below that we collapse into
                      `HeroActionsKebab` so the row never wraps. The
                      handlers are hoisted above so both surfaces call
                      the same code. */}
                  <div className="hidden sm:contents">
                    <IconButton
                      tone="danger"
                      active={artistDisliked}
                      onClick={handleToggleArtistDislike}
                      disabled={toggleDislike.isPending}
                      aria-label={artistDisliked
                        ? t('dislike.artistUnban', { name: artist.name })
                        : t('dislike.artistBan', { name: artist.name })}
                      title={artistDisliked
                        ? t('dislike.artistUnban', { name: artist.name })
                        : t('dislike.artistBan', { name: artist.name })}
                    >
                      {artistDisliked ? <RotateCcw size={16} /> : <Ban size={16} />}
                    </IconButton>
                    {radio?.items?.length ? (
                      <button
                        type="button"
                        onClick={handlePlayRadio}
                        className="inline-flex h-9 items-center gap-2 rounded-full border border-border px-4 text-sm text-muted-foreground transition-all hover:bg-secondary hover:text-foreground active:scale-95"
                        aria-label={t('artistPage.radioAria')}
                      >
                        <Radio size={14} /> {t('artistPage.radio')}
                      </button>
                    ) : null}
                    <ShareButton
                      path={`/artist/${artist.id}`}
                      shareTitle={artist.name}
                      shareText={t('artistPage.shareText', { name: artist.name })}
                      ariaLabel={t('artistPage.shareAria')}
                    />
                  </div>

                  <HeroActionsKebab className="sm:hidden">
                    <MenuItem
                      onClick={handleToggleArtistDislike}
                      disabled={toggleDislike.isPending}
                      icon={artistDisliked ? <RotateCcw size={14} /> : <Ban size={14} />}
                    >
                      {artistDisliked
                        ? t('dislike.artistUnban', { name: artist.name })
                        : t('dislike.artistBan', { name: artist.name })}
                    </MenuItem>
                    {radio?.items?.length ? (
                      <MenuItem
                        onClick={handlePlayRadio}
                        icon={<Radio size={14} />}
                      >
                        {t('artistPage.radio')}
                      </MenuItem>
                    ) : null}
                    <MenuDivider />
                    <MenuItem
                      onClick={handleShareArtist}
                      icon={<Share2 size={14} />}
                    >
                      {t('share.shareGeneric')}
                    </MenuItem>
                  </HeroActionsKebab>
                </>
              }
              className="border-b-0"
            />

            {artist.topTracks?.length > 0 && (
              <section className="mb-12">
                <h2 className="mb-4 border-b border-border pb-3 text-base font-semibold tracking-tight">{t('artistPage.topTracks')}</h2>
                <div className="overflow-visible rounded-[var(--radius-md)] border border-border">
                  {artist.topTracks.map((track, i) => (
                    <TrackItem key={track.id} track={track} index={i} onPlay={handlePlayTrack} />
                  ))}
                </div>
              </section>
            )}

            {artist.albums?.length > 0 && (
              <section className="mb-12">
                <div className="mb-4 flex items-center justify-between border-b border-border pb-3">
                  <h2 className="text-base font-semibold tracking-tight">{t('artistPage.albums')}</h2>
                  {((artist.albumsMoreTotal ?? artist.albums.length) > 10) && (
                    <Link
                      to={`/artist/${artist.id}/albums`}
                      className="text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                    >
                      {t('artistPage.showAll')}
                    </Link>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
                  {artist.albums.slice(0, 10).map((album) => (
                    <AlbumCard key={album.id} album={album} />
                  ))}
                </div>
              </section>
            )}

            {artist.singles?.length > 0 && (
              <section className="mb-12">
                <div className="mb-4 flex items-center justify-between border-b border-border pb-3">
                  <h2 className="text-base font-semibold tracking-tight">{t('artistPage.singles')}</h2>
                  {((artist.singlesMoreTotal ?? artist.singles.length) > 10) && (
                    <Link
                      to={`/artist/${artist.id}/singles`}
                      className="text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                    >
                      {t('artistPage.showAll')}
                    </Link>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
                  {artist.singles.slice(0, 10).map((album) => (
                    <AlbumCard key={album.id} album={album} />
                  ))}
                </div>
              </section>
            )}

            {artist.similarArtists?.length > 0 && (
              <section>
                <h2 className="mb-4 border-b border-border pb-3 text-base font-semibold tracking-tight">{t('artistPage.similar')}</h2>
                <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 md:grid-cols-5 xl:grid-cols-6">
                  {artist.similarArtists.map((a) => (
                    <ArtistCard key={a.id} artist={a} />
                  ))}
                </div>
              </section>
            )}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">{t('artistPage.notFound')}</p>
        )}
      </div>
    </AuthGuard>
  );
}

/**
 * Page-level skeleton mirroring the artist page (round avatar +
 * eyebrow / title / actions, top tracks list, albums grid). Pre-
 * allocates the same vertical bands the live data fills in.
 */
function ArtistPageSkeleton() {
  return (
    <>
      <div className="mb-12 flex flex-col items-start gap-6 border-b border-border pb-10 sm:flex-row sm:items-end">
        <Skeleton className="h-32 w-32 rounded-full sm:h-40 sm:w-40" />
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-9 w-2/3 max-w-md" />
          <div className="flex flex-wrap items-center gap-2 pt-2">
            <Skeleton className="h-9 w-32 rounded-full" />
            <Skeleton className="h-9 w-9 rounded-full" />
            <Skeleton className="h-9 w-9 rounded-full" />
            <Skeleton className="h-9 w-24 rounded-full" />
            <Skeleton className="h-9 w-9 rounded-full" />
          </div>
        </div>
      </div>

      <section className="mb-12">
        <Skeleton className="mb-4 h-4 w-32" />
        <div className="overflow-hidden rounded-[var(--radius-md)] border border-border">
          <TrackListSkeleton count={6} />
        </div>
      </section>

      <section className="mb-12">
        <Skeleton className="mb-4 h-4 w-24" />
        <AlbumGridSkeleton count={5} />
      </section>
    </>
  );
}

/**
 * Header-sized initials-on-gradient fallback for artists without a
 * Tidal portrait. Same visual language as `ArtistCard`'s fallback so
 * an artist with no photo looks identical between search tiles and
 * the artist page.
 */
function FallbackAvatar({ name }: { name: string }) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const [first, second] = words;
  const initials = !first
    ? '?'
    : !second
      ? first.slice(0, 2).toUpperCase()
      : ((first[0] ?? '') + (second[0] ?? '')).toUpperCase();
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  const hue = Math.abs(hash) % 360;
  return (
    <div
      className="flex h-40 w-40 items-center justify-center rounded-full border border-white/10 text-3xl font-semibold tracking-wide text-white shadow-[var(--shadow-cover)]"
      style={{
        background: `radial-gradient(120% 120% at 30% 25%, hsl(${hue} 65% 45% / 0.95), hsl(${(hue + 40) % 360} 55% 22%))`,
      }}
      aria-label={name}
    >
      {initials}
    </div>
  );
}
