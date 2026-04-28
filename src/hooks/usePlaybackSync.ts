import { useCallback } from 'react';
import { usePlayerStore } from '@/store/player';
import type { Track } from '@/types';

/** Minimal subset the player store accepts via setTrack(). Pages and lists
 * pass richer Track objects; we narrow to the shape the store stores so
 * callers don't have to know which fields the persist middleware keeps. */
type PlayableTrack = Pick<
  Track,
  'id' | 'title' | 'artist' | 'duration'
> &
  Partial<Pick<Track, 'artistId' | 'albumId' | 'coverUrl' | 'coverVideoUrl'>>;

function toPlayable(t: PlayableTrack): PlayableTrack {
  return {
    id: t.id,
    title: t.title,
    artist: t.artist,
    artistId: t.artistId,
    albumId: t.albumId,
    coverUrl: t.coverUrl,
    coverVideoUrl: t.coverVideoUrl,
    duration: t.duration,
  };
}

/** Single-track playback sync. Anywhere we render a "play this track"
 * affordance — track rows, search hits, queue items, fullscreen header —
 * we want the icon and click to reflect what's actually happening in the
 * player so the experience feels like one app, not several disconnected
 * surfaces. Returns the active flag and a unified `playOrToggle`:
 *
 *   - if `track` is the currently-loaded track → toggle play/pause
 *   - else → set it as current (and optionally rebuild the queue)
 *
 * Use `isActive` to swap the Play icon for Pause, and `isActivePlaying`
 * to e.g. pulse-animate the active row only while audio is actually
 * advancing. */
export function useTrackPlayback(trackId: string) {
  const currentId = usePlayerStore((s) => s.currentTrack?.id);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const togglePlay = usePlayerStore((s) => s.togglePlay);
  const setTrack = usePlayerStore((s) => s.setTrack);
  const setQueue = usePlayerStore((s) => s.setQueue);

  const isActive = currentId === trackId;
  const isActivePlaying = isActive && isPlaying;

  const playOrToggle = useCallback(
    (track: PlayableTrack, queue?: PlayableTrack[]) => {
      if (currentId === track.id) {
        togglePlay();
        return;
      }
      setTrack(toPlayable(track));
      if (queue) setQueue(queue.map(toPlayable));
    },
    [currentId, togglePlay, setTrack, setQueue],
  );

  return { isActive, isActivePlaying, playOrToggle };
}

/** Collection-level playback sync. Album / playlist / artist hero "Play"
 * buttons should show Pause when any of their tracks is the current one,
 * and clicking should toggle play instead of restarting from the top.
 * `playCollection()` either toggles (when the collection owns the
 * current track) or starts at `tracks[0]` and seeds the queue. */
export function useCollectionPlayback(trackIds: string[]) {
  const currentId = usePlayerStore((s) => s.currentTrack?.id);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const togglePlay = usePlayerStore((s) => s.togglePlay);
  const setTrack = usePlayerStore((s) => s.setTrack);
  const setQueue = usePlayerStore((s) => s.setQueue);

  const isCollectionActive = Boolean(
    currentId && trackIds.includes(currentId),
  );
  const isCollectionPlaying = isCollectionActive && isPlaying;

  const playCollection = useCallback(
    (tracks: PlayableTrack[]) => {
      if (!tracks.length) return;
      if (isCollectionActive) {
        togglePlay();
        return;
      }
      const first = tracks[0];
      if (!first) return;
      setTrack(toPlayable(first));
      setQueue(tracks.map(toPlayable));
    },
    [isCollectionActive, togglePlay, setTrack, setQueue],
  );

  return { isCollectionActive, isCollectionPlaying, playCollection };
}
