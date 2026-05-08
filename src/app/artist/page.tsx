import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Pause, Play, Heart, Radio, Ban, RotateCcw } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { AuthGuard } from '@/components/features/AuthGuard';
import { TrackItem } from '@/components/features/TrackItem';
import { AlbumCard } from '@/components/features/AlbumCard';
import { ArtistCard } from '@/components/features/ArtistCard';
import { ShareButton } from '@/components/features/ShareButton';
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
import { SectionHeading } from '@/components/ui/SectionHeading';
import { PageLoader } from '@/components/ui/PageLoader';
import { toPlayerTrack } from '@/lib/playerTrack';
import { useT } from '@/i18n';

export function ArtistPage() {
  const t = useT();
  const { id } = useParams<{ id: string }>();
  const { data: artist, isLoading } = useArtist(id ?? '');
  const { data: radio } = useArtistRadio(id ?? '');
  const setTrack = usePlayerStore((s) => s.setTrack);
  const setQueue = usePlayerStore((s) => s.setQueue);
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
  const { isCollectionActive, isCollectionPlaying, playCollection } = useCollectionPlayback(topTrackIds);

  const handlePlayTrack = (track: Track) => {
    setTrack(toPlayerTrack(track));
    if (artist?.topTracks) {
      setQueue(artist.topTracks.map(toPlayerTrack));
    }
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
  };

  const ambience = heroPhoto ? (
    <AnimatePresence initial={false} mode="sync">
      <motion.div
        key={(artist?.id ?? '') + ':bg'}
        className="pointer-events-none absolute -inset-[15%] bg-cover bg-center blur-2xl saturate-150"
        style={{ backgroundImage: `url(${heroPhoto})` }}
        initial={reduce ? { opacity: 0.6, scale: 1 } : { opacity: 0, scale: 1.08 }}
        animate={{ opacity: 0.6, scale: 1 }}
        exit={reduce ? { opacity: 0 } : { opacity: 0 }}
        transition={{ duration: 0.9, ease: [0.4, 0, 0.2, 1] }}
      />
    </AnimatePresence>
  ) : undefined;

  const cover = heroPhoto ? (
    <motion.img
      src={heroPhoto}
      alt={artist?.name ?? ''}
      className="h-40 w-40 rounded-full border border-white/10 object-cover shadow-[0_18px_48px_-16px_rgba(0,0,0,0.55)]"
      onError={() => setHeroImgFailed(true)}
      initial={reduce ? false : { opacity: 0, scale: 0.96 }}
      animate={reduce ? undefined : { opacity: 1, scale: 1 }}
      transition={{ type: 'spring', stiffness: 220, damping: 28 }}
    />
  ) : artist ? (
    <FallbackAvatar name={artist.name} reduce={Boolean(reduce)} />
  ) : null;

  return (
    <AuthGuard>
      <div className="mx-auto max-w-6xl p-4 sm:p-6 lg:p-10">
        {isLoading ? (
          <PageLoader label={t('artistPage.loading')} />
        ) : artist ? (
          <>
            <PageHero
              ambience={ambience}
              cover={cover}
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
                  <IconButton
                    tone="danger"
                    active={artistDisliked}
                    disabled={toggleDislike.isPending}
                    onClick={() => {
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
                    }}
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
                </>
              }
            />

            {artist.topTracks?.length > 0 && (
              <motion.section
                initial={reduce ? false : { opacity: 0, y: 8 }}
                animate={reduce ? undefined : { opacity: 1, y: 0 }}
                transition={{ type: 'spring', stiffness: 240, damping: 28, delay: 0.05 }}
                className="mb-12"
              >
                <SectionHeading>{t('artistPage.topTracks')}</SectionHeading>
                <div className="liquid-glass overflow-visible rounded-[var(--radius-xl)] sm:rounded-[var(--radius-lg)]">
                  {artist.topTracks.map((track, i) => (
                    <TrackItem key={track.id} track={track} index={i} onPlay={handlePlayTrack} />
                  ))}
                </div>
              </motion.section>
            )}

            {artist.albums?.length > 0 && (
              <motion.section
                initial={reduce ? false : { opacity: 0, y: 8 }}
                animate={reduce ? undefined : { opacity: 1, y: 0 }}
                transition={{ type: 'spring', stiffness: 240, damping: 28, delay: 0.08 }}
                className="mb-12"
              >
                <SectionHeading
                  trailing={
                    (artist.albumsMoreTotal ?? artist.albums.length) > 10 ? (
                      <Link
                        to={`/artist/${artist.id}/albums`}
                        className="text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                      >
                        {t('artistPage.showAll')}
                      </Link>
                    ) : null
                  }
                >
                  {t('artistPage.albums')}
                </SectionHeading>
                <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
                  {artist.albums.slice(0, 10).map((album) => (
                    <AlbumCard key={album.id} album={album} />
                  ))}
                </div>
              </motion.section>
            )}

            {artist.singles?.length > 0 && (
              <motion.section
                initial={reduce ? false : { opacity: 0, y: 8 }}
                animate={reduce ? undefined : { opacity: 1, y: 0 }}
                transition={{ type: 'spring', stiffness: 240, damping: 28, delay: 0.11 }}
                className="mb-12"
              >
                <SectionHeading
                  trailing={
                    (artist.singlesMoreTotal ?? artist.singles.length) > 10 ? (
                      <Link
                        to={`/artist/${artist.id}/singles`}
                        className="text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                      >
                        {t('artistPage.showAll')}
                      </Link>
                    ) : null
                  }
                >
                  {t('artistPage.singles')}
                </SectionHeading>
                <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
                  {artist.singles.slice(0, 10).map((album) => (
                    <AlbumCard key={album.id} album={album} />
                  ))}
                </div>
              </motion.section>
            )}

            {artist.similarArtists?.length > 0 && (
              <motion.section
                initial={reduce ? false : { opacity: 0, y: 8 }}
                animate={reduce ? undefined : { opacity: 1, y: 0 }}
                transition={{ type: 'spring', stiffness: 240, damping: 28, delay: 0.14 }}
              >
                <SectionHeading>{t('artistPage.similar')}</SectionHeading>
                <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 md:grid-cols-5 xl:grid-cols-6">
                  {artist.similarArtists.map((a) => (
                    <ArtistCard key={a.id} artist={a} />
                  ))}
                </div>
              </motion.section>
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
 * Header-sized initials-on-gradient fallback for artists without a
 * Tidal portrait. Same visual language as `ArtistCard`'s fallback so
 * an artist with no photo looks identical between search tiles and
 * the artist page.
 */
function FallbackAvatar({ name, reduce }: { name: string; reduce: boolean }) {
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
    <motion.div
      className="flex h-40 w-40 items-center justify-center rounded-full border border-white/10 text-3xl font-semibold tracking-wide text-white shadow-[0_18px_48px_-16px_rgba(0,0,0,0.55)]"
      style={{
        background: `radial-gradient(120% 120% at 30% 25%, hsl(${hue} 65% 45% / 0.95), hsl(${(hue + 40) % 360} 55% 22%))`,
      }}
      aria-label={name}
      initial={reduce ? false : { opacity: 0, scale: 0.96 }}
      animate={reduce ? undefined : { opacity: 1, scale: 1 }}
      transition={{ type: 'spring', stiffness: 220, damping: 28 }}
    >
      {initials}
    </motion.div>
  );
}
