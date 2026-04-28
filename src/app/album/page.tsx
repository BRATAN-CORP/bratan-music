import { useParams, Link } from 'react-router-dom';
import { Pause, Play, Disc3, Heart } from 'lucide-react';
import { AuthGuard } from '@/components/features/AuthGuard';
import { TrackItem } from '@/components/features/TrackItem';
import { useAlbum } from '@/hooks/useTrack';
import { useToggleAlbumLike } from '@/hooks/useLibrary';
import { usePlayerStore } from '@/store/player';
import { useCollectionPlayback } from '@/hooks/usePlaybackSync';
import type { Track } from '@/types';
import { Button } from '@/components/ui/Button';

export function AlbumPage() {
  const { id } = useParams<{ id: string }>();
  const { data: album, isLoading } = useAlbum(id ?? '');
  const setTrack = usePlayerStore((s) => s.setTrack);
  const setQueue = usePlayerStore((s) => s.setQueue);
  const togglePlay = usePlayerStore((s) => s.togglePlay);
  const albumLike = useToggleAlbumLike();
  const liked = album ? albumLike.isLiked(album.id) : false;

  // Hero "Play" button: shows Pause when any track from this album is the
  // current player track, and clicking toggles instead of restarting.
  const trackIds = album?.tracks?.map((t) => t.id) ?? [];
  const { isCollectionActive, isCollectionPlaying, playCollection } = useCollectionPlayback(trackIds);

  const handlePlayTrack = (track: Track) => {
    setTrack({ id: track.id, title: track.title, artist: track.artist, artistId: track.artistId, coverUrl: track.coverUrl, coverVideoUrl: track.coverVideoUrl, duration: track.duration });
    if (album?.tracks) {
      setQueue(
        album.tracks.map((t) => ({ id: t.id, title: t.title, artist: t.artist, artistId: t.artistId, coverUrl: t.coverUrl, coverVideoUrl: t.coverVideoUrl, duration: t.duration }))
      );
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
      <div className="mx-auto max-w-5xl p-4 sm:p-6 lg:p-10">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Загрузка...</p>
        ) : album ? (
          <>
            <div className="mb-10 flex flex-col gap-6 border-b border-border pb-10 sm:flex-row">
              {album.coverUrl ? (
                <img
                  src={album.coverUrl}
                  alt={album.title}
                  className="h-48 w-48 rounded-[var(--radius-md)] border border-border object-cover"
                />
              ) : (
                <div className="flex h-48 w-48 items-center justify-center rounded-[var(--radius-md)] border border-border bg-secondary">
                  <Disc3 size={36} className="text-muted-foreground" />
                </div>
              )}
              <div className="flex flex-col justify-end gap-3">
                <span className="text-xs font-medium uppercase tracking-[0.25em] text-muted-foreground">Альбом</span>
                <h1 className="text-3xl font-semibold tracking-tight sm:text-5xl">{album.title}</h1>
                <Link to={`/artist/${album.artistId}`} className="text-sm text-muted-foreground hover:text-foreground">
                  {album.artist}
                </Link>
                {album.releaseDate && (
                  <p className="text-xs text-muted-foreground">{album.releaseDate}</p>
                )}
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
                    onClick={() => albumLike.toggle({ id: album.id, title: album.title, artist: album.artist, artistId: album.artistId, coverUrl: album.coverUrl })}
                    className={`inline-flex h-9 w-9 items-center justify-center rounded-full border transition-all active:scale-90 ${
                      liked
                        ? 'border-[var(--color-accent)]/30 bg-[var(--color-accent)]/15 text-[var(--color-accent)]'
                        : 'border-border text-muted-foreground hover:text-foreground hover:bg-secondary'
                    }`}
                    aria-label={liked ? 'Убрать из библиотеки' : 'Добавить в библиотеку'}
                  >
                    <Heart size={16} className={liked ? 'fill-current' : ''} />
                  </button>
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
          <p className="text-sm text-muted-foreground">Альбом не найден</p>
        )}
      </div>
    </AuthGuard>
  );
}
