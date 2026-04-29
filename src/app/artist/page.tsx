import { Link, useParams } from 'react-router-dom';
import { Pause, Play, User, Heart, Radio } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { AuthGuard } from '@/components/features/AuthGuard';
import { TrackItem } from '@/components/features/TrackItem';
import { AlbumCard } from '@/components/features/AlbumCard';
import { ArtistCard } from '@/components/features/ArtistCard';
import { ShareButton } from '@/components/features/ShareButton';
import { useArtist, useArtistRadio } from '@/hooks/useTrack';
import { useToggleArtistLike } from '@/hooks/useLibrary';
import { usePlayerStore } from '@/store/player';
import { useCollectionPlayback } from '@/hooks/usePlaybackSync';
import type { Track } from '@/types';
import { Button } from '@/components/ui/Button';
import { toPlayerTrack } from '@/lib/playerTrack';

export function ArtistPage() {
  const { id } = useParams<{ id: string }>();
  const { data: artist, isLoading } = useArtist(id ?? '');
  const { data: radio } = useArtistRadio(id ?? '');
  const setTrack = usePlayerStore((s) => s.setTrack);
  const setQueue = usePlayerStore((s) => s.setQueue);
  const artistLike = useToggleArtistLike();
  const liked = artist ? artistLike.isLiked(artist.id) : false;
  const reduce = useReducedMotion();

  // Hero "Play" button on the artist page targets the current top-track
  // queue — if anything in that list is the active player track, the
  // button mirrors play state and toggles instead of restarting.
  const topTrackIds = artist?.topTracks?.map((t) => t.id) ?? [];
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

  return (
    <AuthGuard>
      <div className="mx-auto max-w-6xl p-4 sm:p-6 lg:p-10">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Загрузка...</p>
        ) : artist ? (
          <>
            {/* Hero with blurred ambience layer derived from the artist
                photo — mirrors the FullscreenPlayer's pattern (blurred
                cover image + saturate boost + soft dark vignette) so the
                page picks up the artist's dominant colour without losing
                the rest of the layout's neutral chrome. The blurred
                image is keyed by the artist id so a navigation between
                artists crossfades the ambience instead of snapping. */}
            <div className="relative isolate -mx-4 mb-10 overflow-hidden px-4 pb-10 pt-6 sm:-mx-6 sm:px-6 sm:pt-10 lg:-mx-10 lg:px-10">
              {artist.imageUrl ? (
                <AnimatePresence initial={false} mode="sync">
                  <motion.div
                    key={artist.id + ':bg'}
                    aria-hidden
                    className="pointer-events-none absolute inset-0 -z-10 bg-cover bg-center blur-3xl saturate-150"
                    style={{ backgroundImage: `url(${artist.imageUrl})` }}
                    initial={reduce ? { opacity: 0.55, scale: 1 } : { opacity: 0, scale: 1.08 }}
                    animate={{ opacity: 0.55, scale: 1 }}
                    exit={reduce ? { opacity: 0 } : { opacity: 0 }}
                    transition={{ duration: 0.9, ease: [0.4, 0, 0.2, 1] }}
                  />
                </AnimatePresence>
              ) : (
                /* No artist photo — fall back to a soft accent radial so
                   the hero still feels different from a flat page bg. */
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(80%_120%_at_30%_0%,var(--color-accent-glow),transparent_70%)] opacity-40"
                />
              )}
              {/* Two-layer overlay: a subtle dark wash for legibility on
                  bright photos, plus a vertical fade into the page bg so
                  the hero melts into the next section instead of ending
                  on a hard border. The accent-tinted radial keeps a hint
                  of brand colour when the photo is desaturated. */}
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0 -z-10 bg-gradient-to-b from-black/10 via-[var(--color-bg)]/35 to-[var(--color-bg)]"
              />
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(60%_80%_at_25%_15%,var(--color-accent-glow),transparent_75%)] opacity-25"
              />

              <div className="flex flex-col items-start gap-6 sm:flex-row sm:items-end">
              {artist.imageUrl ? (
                <img
                  src={artist.imageUrl}
                  alt={artist.name}
                  className="h-40 w-40 rounded-full border border-white/10 object-cover shadow-[0_18px_48px_-16px_rgba(0,0,0,0.55)]"
                />
              ) : (
                <div className="flex h-40 w-40 items-center justify-center rounded-full border border-white/10 bg-secondary shadow-[0_18px_48px_-16px_rgba(0,0,0,0.55)]">
                  <User size={36} className="text-muted-foreground" />
                </div>
              )}
              <div className="flex flex-col gap-3">
                <span className="text-xs font-medium uppercase tracking-[0.25em] text-muted-foreground">Артист</span>
                <h1 className="text-3xl font-semibold tracking-tight sm:text-5xl">{artist.name}</h1>
                <div className="flex items-center gap-2 pt-2">
                  <Button onClick={handlePlayAll}>
                    {isCollectionPlaying ? (
                      <>
                        <Pause size={14} fill="currentColor" /> Пауза
                      </>
                    ) : (
                      <>
                        <Play size={14} fill="currentColor" /> {isCollectionActive ? 'Продолжить' : 'Слушать'}
                      </>
                    )}
                  </Button>
                  <button
                    type="button"
                    onClick={() => artistLike.toggle({ id: artist.id, name: artist.name, imageUrl: artist.imageUrl })}
                    className={`inline-flex h-9 w-9 items-center justify-center rounded-full border transition-all active:scale-90 ${
                      liked
                        ? 'border-[var(--color-accent)]/30 bg-[var(--color-accent)]/15 text-[var(--color-accent)]'
                        : 'border-border text-muted-foreground hover:text-foreground hover:bg-secondary'
                    }`}
                    aria-label={liked ? 'Отписаться' : 'Подписаться'}
                  >
                    <Heart size={16} className={liked ? 'fill-current' : ''} />
                  </button>
                  {radio?.items?.length ? (
                    <button
                      type="button"
                      onClick={handlePlayRadio}
                      className="inline-flex h-9 items-center gap-2 rounded-full border border-border px-4 text-sm text-muted-foreground transition-all hover:bg-secondary hover:text-foreground active:scale-95"
                      aria-label="Запустить радио артиста"
                    >
                      <Radio size={14} /> Радио
                    </button>
                  ) : null}
                  <ShareButton
                    path={`/artist/${artist.id}`}
                    shareTitle={artist.name}
                    shareText={`Артист: ${artist.name}`}
                    ariaLabel="Поделиться артистом"
                  />
                </div>
              </div>
              </div>
            </div>

            {artist.topTracks?.length > 0 && (
              <section className="mb-12">
                <h2 className="mb-4 border-b border-border pb-3 text-base font-semibold tracking-tight">Популярные треки</h2>
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
                  <h2 className="text-base font-semibold tracking-tight">Альбомы</h2>
                  {((artist.albumsMoreTotal ?? artist.albums.length) > 10) && (
                    <Link
                      to={`/artist/${artist.id}/albums`}
                      className="text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                    >
                      Показать все →
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
                  <h2 className="text-base font-semibold tracking-tight">Синглы</h2>
                  {((artist.singlesMoreTotal ?? artist.singles.length) > 10) && (
                    <Link
                      to={`/artist/${artist.id}/singles`}
                      className="text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                    >
                      Показать все →
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
                <h2 className="mb-4 border-b border-border pb-3 text-base font-semibold tracking-tight">Похожие артисты</h2>
                <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 md:grid-cols-5 xl:grid-cols-6">
                  {artist.similarArtists.map((a) => (
                    <ArtistCard key={a.id} artist={a} />
                  ))}
                </div>
              </section>
            )}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">Артист не найден</p>
        )}
      </div>
    </AuthGuard>
  );
}
