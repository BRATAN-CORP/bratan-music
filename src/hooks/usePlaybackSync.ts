import { useCallback } from 'react';
import { usePlayerStore, type PlaybackContext } from '@/store/player';
import { useSettingsStore } from '@/store/settings';
import { primeAudioForPlay, prefetchStreamUrl } from '@/hooks/useAudioPlayer';
import type { Track } from '@/types';

/** Minimal subset the player store accepts via setTrack(). Pages and lists
 * pass richer Track objects; we narrow to the shape the store stores so
 * callers don't have to know which fields the persist middleware keeps. */
type PlayableTrack = Pick<
  Track,
  'id' | 'title' | 'artist' | 'duration'
> &
  Partial<Pick<Track, 'artistId' | 'artists' | 'albumId' | 'coverUrl' | 'coverVideoUrl' | 'explicit' | 'source'>>;

function toPlayable(t: PlayableTrack): PlayableTrack {
  return {
    id: t.id,
    title: t.title,
    artist: t.artist,
    artistId: t.artistId,
    artists: t.artists,
    albumId: t.albumId,
    coverUrl: t.coverUrl,
    coverVideoUrl: t.coverVideoUrl,
    duration: t.duration,
    // Carry the source-provider Explicit flag through so the player
    // surfaces (mini-player, mobile dock, fullscreen) render the
    // `<ExplicitBadge>` consistently with the row the user clicked.
    // Without this the player track came back with explicit=undefined
    // even when the source row had it set, and the mini-player E badge
    // disappeared "on some tracks but not others".
    explicit: t.explicit,
    source: t.source,
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
  const setPlaybackContext = usePlayerStore((s) => s.setPlaybackContext);

  const isActive = currentId === trackId;
  const isActivePlaying = isActive && isPlaying;

  const playOrToggle = useCallback(
    (track: PlayableTrack, queue?: PlayableTrack[], context?: PlaybackContext) => {
      if (currentId === track.id) {
        togglePlay();
        return;
      }
      // We're in a guaranteed user gesture (a click). Prime the
      // audio engine SYNCHRONOUSLY before propagating the new track
      // into the store: that's the only chance browsers give us to
      // build/resume the AudioContext without a deferred-gesture
      // failure, and it lets the device's audio HAL spin up in
      // parallel with the React render + Zustand subscriber chain
      // that eventually triggers `loadTrack`. Saves ~50-300 ms on
      // every cold-start play.
      primeAudioForPlay();
      // Same gesture, parallel: kick off the stream URL fetch into
      // the in-flight cache. By the time `useAudioPlayer.loadTrack`
      // is reached (typically one React render later) the request
      // is already mid-flight, and on a cache hit it's instant.
      // Cache hits skip this entirely. Tidal-stream tracks only —
      // upload and pre-resolved (room-bridge) tracks short-circuit
      // inside `prefetchStreamUrl`.
      prefetchStreamUrl(
        { id: track.id },
        useSettingsStore.getState().tidalQuality,
      );
      setTrack(toPlayable(track));
      if (queue) setQueue(queue.map(toPlayable));
      if (context) setPlaybackContext(context);
    },
    [currentId, togglePlay, setTrack, setQueue, setPlaybackContext],
  );

  return { isActive, isActivePlaying, playOrToggle };
}

/** Collection-level playback sync. Album / playlist / artist hero "Play"
 * buttons should show Pause when the user started playback *from this
 * collection* and the current track still belongs to it. Without
 * `context`, a track that exists in multiple collections (album Y,
 * playlist Z, wave W) would light up ALL of their play buttons even when
 * the user actually started playing from history or a search hit.
 *
 * `playCollection()` either toggles (when the collection owns the
 * current track AND the context matches) or starts at `tracks[0]` and
 * seeds the queue + context. */
export function useCollectionPlayback(trackIds: string[], context?: PlaybackContext) {
  const currentId = usePlayerStore((s) => s.currentTrack?.id);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const currentContext = usePlayerStore((s) => s.playbackContext);
  const togglePlay = usePlayerStore((s) => s.togglePlay);
  const setTrack = usePlayerStore((s) => s.setTrack);
  const setQueue = usePlayerStore((s) => s.setQueue);
  const setPlaybackContext = usePlayerStore((s) => s.setPlaybackContext);

  const trackInCollection = Boolean(currentId && trackIds.includes(currentId));

  // The button is "active" only when the track is in this collection AND
  // playback was started from this exact collection (type + id match).
  const contextMatches = context
    ? currentContext?.type === context.type && currentContext?.id === context.id
    : trackInCollection; // backwards compat: no context → legacy behaviour
  const isCollectionActive = trackInCollection && contextMatches;
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
      primeAudioForPlay();
      prefetchStreamUrl(
        { id: first.id },
        useSettingsStore.getState().tidalQuality,
      );
      setTrack(toPlayable(first));
      setQueue(tracks.map(toPlayable));
      if (context) setPlaybackContext(context);
    },
    [isCollectionActive, togglePlay, setTrack, setQueue, setPlaybackContext, context],
  );

  return { isCollectionActive, isCollectionPlaying, playCollection };
}

/** Hover/long-press hint for "the user is about to play this track."
 *  Kicks off the stream URL fetch in the background so the click that
 *  follows lands on a warm cache. Idempotent — calling it on every
 *  pointerenter is fine, the in-flight cache will dedupe. Skipped for
 *  the currently-active track (already loaded) and for non-Tidal
 *  sources (handled by `prefetchStreamUrl`). */
export function useTrackHoverPrefetch(): (track: { id: string }) => void {
  const currentId = usePlayerStore((s) => s.currentTrack?.id);
  return useCallback(
    (track) => {
      if (track.id === currentId) return;
      prefetchStreamUrl(
        { id: track.id },
        useSettingsStore.getState().tidalQuality,
      );
    },
    [currentId],
  );
}
