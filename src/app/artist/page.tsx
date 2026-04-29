import { useParams } from 'react-router-dom';
import { Pause, Play, User, Heart, Radio } from 'lucide-react';
import { AuthGuard } from '@/components/features/AuthGuard';
import { TrackItem } from '@/components/features/TrackItem';
import { AlbumCard } from '@/components/features/AlbumCard';
import { ArtistCard } from '@/components/features/ArtistCard';
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

  const handlePlayRadioTrack = (t: Track) => {
    if (!radio?.items) {
      setTrack(toPlayerTrack(t));
      return;
    }
    const idx = radio.items.findIndex((x) => x.id === t.id);
    setTrack(toPlayerTrack(t));
    setQueue(radio.items.slice(idx >= 0 ? idx : 0).map(toPlayerTrack));
  };

  return (
    <AuthGuard>
      <div className="mx-auto max-w-6xl p-4 sm:p-6 lg:p-10">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Загрузка...</p>
        ) : artist ? (
          <>
            <div className="mb-10 flex flex-col items-start gap-6 border-b border-border pb-10 sm:flex-row sm:items-end">
              {artist.imageUrl ? (
                <img
                  src={artist.imageUrl}
                  alt={artist.name}
                  className="h-40 w-40 rounded-full border border-border object-cover"
                />
              ) : (
                <div className="flex h-40 w-40 items-center justify-center rounded-full border border-border bg-secondary">
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

            {radio?.items?.length ? (
              <section className="mb-12">
                <div className="mb-4 flex items-center justify-between border-b border-border pb-3">
                  <h2 className="flex items-center gap-2 text-base font-semibold tracking-tight">
                    <Radio size={16} className="text-[var(--color-accent)]" />
                    Радио {artist.name}
                  </h2>
                  <Button variant="outline" size="sm" onClick={handlePlayRadio}>
                    <Play size={12} fill="currentColor" /> Слушать
                  </Button>
                </div>
                <div className="overflow-visible rounded-[var(--radius-md)] border border-border">
                  {radio.items.slice(0, 25).map((track, i) => (
                    <TrackItem key={track.id} track={track} index={i} onPlay={handlePlayRadioTrack} />
                  ))}
                </div>
              </section>
            ) : null}

            {artist.albums?.length > 0 && (
              <section className="mb-12">
                <h2 className="mb-4 border-b border-border pb-3 text-base font-semibold tracking-tight">Релизы</h2>
                <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
                  {artist.albums.map((album) => (
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
