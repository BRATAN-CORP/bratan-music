import { useState } from 'react';
import { Loader2, Pause, Play } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { usePlayerStore } from '@/store/player';
import { useSettingsStore } from '@/store/settings';
import { primeAudioForPlay, prefetchStreamUrl } from '@/hooks/useAudioPlayer';
import { toPlayerTrack } from '@/lib/playerTrack';
import type { Album, Track } from '@/types';
import { useT } from '@/i18n';

/**
 * Cover-overlay play button for `AlbumCard` and any other surface that
 * shows a clickable album thumbnail. Used to be a decorative `<div>`
 * sitting inside a `<Link>` — a click on it just navigated to the album
 * page like any other click on the cover, which made the affordance
 * misleading. Now it actually plays the album.
 *
 * Behavior:
 *   - Clicking calls `preventDefault` + `stopPropagation` so the
 *     surrounding `<Link>` (which wraps the cover for keyboard /
 *     touch navigation) doesn't fire. The user gets the play action
 *     they asked for, not a page transition.
 *   - First click fetches the album's full track list on demand
 *     through react-query. Pre-caching at card render time would fan
 *     out into N round-trips per row, so we hold off until the user
 *     actually wants the album.
 *   - When *any* track from this album is the currently-loaded track
 *     (matched via `currentTrack.albumId`), the button becomes a
 *     play/pause toggle instead of restarting from track 1. This
 *     mirrors the behavior of the album-page hero button so the two
 *     surfaces don't disagree.
 */
interface AlbumPlayButtonProps {
  albumId: string;
  /** Used in the aria label so screen readers and keyboard users
   *  hear "Play <album title>" instead of a generic "Play". */
  albumTitle: string;
  /** Layout/positioning classes from the parent (typically
   *  `absolute bottom-2 right-2` on top of the cover). The hover-reveal
   *  animation is also driven from here so each card surface can keep
   *  its own translate/opacity timings. */
  className?: string;
}

interface AlbumDetail extends Album {
  tracks: Track[];
}

export function AlbumPlayButton({ albumId, albumTitle, className }: AlbumPlayButtonProps) {
  const t = useT();
  const queryClient = useQueryClient();
  // Active only when the player is currently playing FROM this album
  // (playbackContext matches). This prevents every album card that
  // happens to contain the current track from lighting up.
  const isAlbumActive = usePlayerStore((s) =>
    s.currentTrack?.albumId === albumId
    && s.playbackContext?.type === 'album'
    && s.playbackContext?.id === albumId,
  );
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const togglePlay = usePlayerStore((s) => s.togglePlay);
  const setTrack = usePlayerStore((s) => s.setTrack);
  const setQueue = usePlayerStore((s) => s.setQueue);
  const setPlaybackContext = usePlayerStore((s) => s.setPlaybackContext);
  const [loading, setLoading] = useState(false);

  const showPause = isAlbumActive && isPlaying;
  const ariaLabel = showPause
    ? t('album.pauseAria', { title: albumTitle })
    : t('album.playAria', { title: albumTitle });

  const handleClick = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (loading) return;
    if (isAlbumActive) {
      togglePlay();
      return;
    }
    setLoading(true);
    try {
      const album = await queryClient.fetchQuery<AlbumDetail>({
        queryKey: ['album', albumId],
        queryFn: () => api.get<AlbumDetail>(`/albums/${albumId}`),
        // Album track lists are immutable for our purposes — keeping
        // them fresh for ten minutes covers any reasonable session
        // without bloating memory.
        staleTime: 1000 * 60 * 10,
      });
      const first = album.tracks?.[0];
      if (!first) return;
      // Same gesture-bound priming as the per-track play path. The
      // browser only lets us spin up an AudioContext synchronously
      // off a user click; deferring the prime to a Zustand subscriber
      // adds 50–300 ms of round-trip latency on cold starts.
      primeAudioForPlay();
      prefetchStreamUrl(
        { id: first.id },
        useSettingsStore.getState().tidalQuality,
      );
      const tracks = album.tracks.map(toPlayerTrack);
      setQueue(tracks);
      setTrack(toPlayerTrack(first));
      setPlaybackContext({ type: 'album', id: albumId });
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={loading}
      aria-label={ariaLabel}
      className={className}
    >
      {loading ? (
        <Loader2 size={14} className="animate-spin" />
      ) : showPause ? (
        <Pause size={14} fill="currentColor" />
      ) : (
        <Play size={14} fill="currentColor" />
      )}
    </button>
  );
}
