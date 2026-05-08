import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { isTrackBanned, isBanned, filterTrackBanned } from '@/store/dislikes';

const PLAY_HISTORY_MAX = 50;

/**
 * Push a "previous" pointer onto the LIFO history stack used by
 * `previous()`. Skips no-op transitions (same track to same track) and
 * de-dupes the immediate top so a user that taps next/previous in
 * quick succession doesn't grow the stack with redundant entries.
 */
function pushHistory(history: string[], oldId: string | undefined, newId: string): string[] {
  if (!oldId || oldId === newId) return history;
  // De-dupe top of stack — guards against double `setTrack` calls
  // (rapid promote-then-set during crossfade teardown, room-bridge
  // echoes, etc.) that would otherwise push the same id twice.
  if (history.length > 0 && history[history.length - 1] === oldId) return history;
  const next = [...history, oldId];
  if (next.length > PLAY_HISTORY_MAX) next.splice(0, next.length - PLAY_HISTORY_MAX);
  return next;
}

interface Track {
  id: string;
  title: string;
  artist: string;
  /** Tidal artist id — needed for the 'go to artist' action in the
   * player. Optional because some legacy callsites don't pass it
   * (liked tracks loaded from older snapshots, etc.). */
  artistId?: string;
  /**
   * Full credit list when the upstream surfaces multiple contributors.
   * Preserved through the player so the mini-player and fullscreen
   * UI can render every name as its own clickable link.
   */
  artists?: { id: string; name: string }[];
  /** Tidal album id — needed for the 'перейти к альбому' action in the
   * fullscreen 3-dot menu. Optional for the same reason as artistId. */
  albumId?: string;
  coverUrl?: string;
  /** Animated cover (mp4). Used in the fullscreen player as a tasteful loop. */
  coverVideoUrl?: string;
  duration: number;
  /** Provider tag — "tidal" | "upload" | "override". Optional because
   *  legacy tracks default to "tidal" downstream. */
  source?: string;
  /**
   * Pre-resolved audio stream URL that bypasses the global
   * `/tracks/:id/stream` quality-fallback ladder. Used by the room
   * bridge to route a track through `/rooms/:id/stream/...` so guests
   * are listening to the host's selection (uploads, overrides, or
   * tidal) without each gaining direct catalog access. The audio
   * engine plays this URL as-is when set.
   */
  streamUrl?: string;
}

type RepeatMode = 'off' | 'one' | 'all';

interface PlayerState {
  currentTrack: Track | null;
  queue: Track[];
  isPlaying: boolean;
  volume: number;
  muted: boolean;
  shuffle: boolean;
  repeat: RepeatMode;
  progress: number;
  duration: number;
  error: string | null;
  fullscreen: boolean;
  /** Bumped to force the audio hook to re-fetch the stream URL for the
   * current track (used after replacing or deleting an override). */
  streamVersion: number;
  /** Incremented when the audio element needs to seek to 0 (e.g. back
   *  button restart). The audio hook subscribes to this counter. */
  _seekToZero: number;
  /**
   * LIFO stack of track ids the user (or the auto-advance engine) just
   * walked off, newest at the end. Drives `previous()` — popping a real
   * "the one you were on a moment ago" pointer survives queue mutations,
   * post-crossfade slot churn and any other state the queue-walking path
   * can't see. Capped to keep persisted state lightweight.
   */
  playHistory: string[];
  bumpStream: () => void;
  setTrack: (track: Track) => void;
  /**
   * Atomic "switch to a different track at this exact position" used by
   * the room bridge so a guest joining a session in progress doesn't
   * snap to 0:00 on the audio element. Unlike `setTrack`, this does NOT
   * reset `progress` to 0 — `useAudioPlayer.loadTrack` reads the current
   * `progress` and seeks the new src to that target on `loadedmetadata`.
   */
  setTrackAt: (track: Track, progressSec: number, isPlaying: boolean) => void;
  setQueue: (tracks: Track[]) => void;
  addToQueue: (track: Track) => void;
  /** Insert a track immediately after the currently-playing one. */
  playNext: (track: Track) => void;
  removeFromQueue: (trackId: string) => void;
  /** Drop queue items whose *track id* the user just banned. Artist
   *  bans never prune the queue — banning an artist hides them from
   *  recommendations going forward but the user's queue is sacred.
   *  If the current track was the one banned, advance.
   *
   *  `bannedTrackId` scopes the skip: only when it matches the
   *  currently-playing id. Banning any neighbour leaves audio
   *  untouched. Omit for the bootstrap path — falls back to the
   *  legacy "skip if current is banned" check. */
  pruneBanned: (bannedTrackId?: string) => void;
  /** Move a track inside the queue from one index to another. */
  reorderQueue: (from: number, to: number) => void;
  /** Jump straight to the given queue index. */
  jumpToQueue: (index: number) => void;
  play: () => void;
  pause: () => void;
  togglePlay: () => void;
  /** Auto-advance (called by audio engine on track end). Honours repeat
   *  mode: stops at the end of the queue when repeat is 'off'. */
  next: () => void;
  /** Manual skip (user pressed the skip-forward button). Always wraps to
   *  the first track when at the end of the queue, even with repeat='off'
   *  — the queue is non-empty so the user expects *something* to play. */
  nextManual: () => void;
  /**
   * "Back" — semantics depend on `force`:
   * - `force = false` (default, button / mediaSession): if the user is
   *   past the 3 s mark in the current track, restart it from 0
   *   (Spotify / Apple Music idiom — mid-track "back" means "start
   *   over", not "previous song"). Within the first 3 s, fall through
   *   to the prev-track path: pop the play-history stack, then walk
   *   the queue, then (no neighbour, but still past 3 s) rewind.
   * - `force = true` (gesture: mini-player swipe / fullscreen cover
   *   drag): always treat as "previous track", regardless of
   *   `progress`. Gestures are an explicit navigation intent — the
   *   user has just dragged the cover off-screen — and must never
   *   restart the current track.
   *
   * `mediaSession.previoustrack` (system media controls / lock screen
   * / Bluetooth headset) shares the button path: `force=false`. */
  previous: (force?: boolean) => void;
  setVolume: (volume: number) => void;
  toggleMute: () => void;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
  setProgress: (progress: number) => void;
  setDuration: (duration: number) => void;
  setError: (err: string | null) => void;
  openFullscreen: () => void;
  closeFullscreen: () => void;
  /** Wipe everything the user accumulated during a session — current
   *  track, queue, progress, error, fullscreen flag. Called from
   *  useAuthStore.logout so the bottom player disappears immediately
   *  after sign-out without leaking the previous user's state. */
  reset: () => void;
  /**
   * Optional "end of queue" handler installed by `usePlayHistoryLogger`.
   * Consulted by `next()` / `nextManual()` when the queue is
   * exhausted. Returning `true` claims responsibility for advance
   * (async wave/continue fetch); the store action then bails. With no
   * handler / `false`: `next()` stops, `nextManual()` wraps to 0.
   * Decouples recommendations from the zustand graph. */
  endHandler: (() => boolean) | null;
  setEndHandler: (handler: (() => boolean) | null) => void;
}

export const usePlayerStore = create<PlayerState>()(persist((set, get) => ({
  currentTrack: null,
  queue: [],
  isPlaying: false,
  volume: 0.7,
  muted: false,
  shuffle: false,
  repeat: 'off',
  progress: 0,
  duration: 0,
  error: null,
  fullscreen: false,
  streamVersion: 0,
  _seekToZero: 0,
  playHistory: [],
  endHandler: null,

  setEndHandler: (handler) => set({ endHandler: handler }),

  bumpStream: () => set((s) => ({ streamVersion: s.streamVersion + 1, progress: 0 })),

  setTrack: (track) => set((s) => ({
    currentTrack: track,
    isPlaying: true,
    progress: 0,
    error: null,
    playHistory: pushHistory(s.playHistory, s.currentTrack?.id, track.id),
  })),
  setTrackAt: (track, progressSec, isPlaying) => set((s) => ({
    currentTrack: track,
    isPlaying,
    progress: Math.max(0, progressSec),
    error: null,
    playHistory: pushHistory(s.playHistory, s.currentTrack?.id, track.id),
  })),
  // Queue mutators only filter on track-id bans. Artist bans are
  // recommendation-side concerns — the user's queue is allowed to
  // contain tracks by a banned artist (e.g. they queued the track
  // up before banning the artist, or are playing a curated
  // playlist that happens to credit them).
  setQueue: (tracks) => set({ queue: filterTrackBanned(tracks) }),
  addToQueue: (track) => set((s) => {
    if (isTrackBanned(track)) return s;
    return { queue: [...s.queue, track] };
  }),
  playNext: (track) => set((s) => {
    const idx = s.queue.findIndex((t) => t.id === s.currentTrack?.id);
    const next = [...s.queue];
    // Skip if it's already the very next item.
    if (next[idx + 1]?.id === track.id) return s;
    // Drop any earlier copy so playNext doesn't create duplicates.
    const filtered = next.filter((t) => t.id !== track.id);
    const insertAt = idx >= 0 ? idx + 1 : filtered.length;
    filtered.splice(insertAt, 0, track);
    return { queue: filtered };
  }),
  removeFromQueue: (trackId) => set((s) => ({
    queue: s.queue.filter((t) => t.id !== trackId),
  })),
  pruneBanned: (bannedTrackId) => {
    // Track-id-only filter: artist bans never retroactively yank
    // their tracks from the user's queue. See the type-decl comment
    // and `dislikes.ts` for the full rationale.
    const s = get();
    const cleanQueue = filterTrackBanned(s.queue);
    const queueChanged = cleanQueue.length !== s.queue.length;
    const currentBanned = s.currentTrack ? isTrackBanned(s.currentTrack) : false;
    if (!queueChanged && !currentBanned) return;

    // Decide whether the just-pruned track was the user's currently-
    // playing one. The mutation path passes `bannedTrackId` so we can
    // be exact: only the *click I just did on the playing track*
    // should hijack playback — banning any neighbour in the queue
    // (the kebab on a different row, the artist menu) leaves audio
    // untouched and only the queue shrinks. The bootstrap path
    // (cross-device sync, page-load rehydrate) has no click context
    // and falls back to the broader currentBanned check.
    const shouldSkip = bannedTrackId !== undefined
      ? currentBanned && bannedTrackId === s.currentTrack?.id
      : currentBanned;

    if (!shouldSkip) {
      set({ queue: cleanQueue });
      return;
    }

    // Find the next still-valid track AFTER the position the current
    // track held in the OLD queue, NOT after wherever findIndex would
    // land in the cleaned queue (which would be -1, and the legacy
    // `next()` handles -1 by jumping to queue[0] — that lands the
    // user on the *first* track instead of the natural successor and
    // is exactly the surprise jump-back-to-track-1 the user reported
    // when they ban the currently-playing track). Walk forward from
    // the old position; fall back to wrapping if repeat='all'.
    const oldIdx = s.currentTrack
      ? s.queue.findIndex((t) => t.id === s.currentTrack!.id)
      : -1;
    let nextTrack: Track | null = null;
    if (oldIdx >= 0) {
      for (let i = oldIdx + 1; i < s.queue.length; i++) {
        const t = s.queue[i];
        if (t && !isBanned(t)) { nextTrack = t; break; }
      }
      if (!nextTrack && s.repeat === 'all') {
        for (let i = 0; i < oldIdx; i++) {
          const t = s.queue[i];
          if (t && !isBanned(t)) { nextTrack = t; break; }
        }
      }
    } else {
      // Defensive: current wasn't in the (pre-prune) queue at all.
      // Pick the first non-banned track in the cleaned queue.
      nextTrack = cleanQueue.find((t) => !isBanned(t)) ?? null;
    }

    if (nextTrack) {
      set({
        queue: cleanQueue,
        currentTrack: nextTrack,
        isPlaying: true,
        progress: 0,
        playHistory: pushHistory(s.playHistory, s.currentTrack?.id, nextTrack.id),
      });
    } else {
      // Nothing forward and no wrap target — just clean and pause.
      set({ queue: cleanQueue, isPlaying: false });
    }
  },
  reorderQueue: (from, to) => set((s) => {
    if (from === to) return s;
    if (from < 0 || from >= s.queue.length) return s;
    if (to < 0 || to >= s.queue.length) return s;
    const next = [...s.queue];
    const [moved] = next.splice(from, 1);
    if (!moved) return s;
    next.splice(to, 0, moved);
    return { queue: next };
  }),
  jumpToQueue: (index) => set((s) => {
    const target = s.queue[index];
    if (!target) return s;
    return {
      currentTrack: target,
      isPlaying: true,
      progress: 0,
      playHistory: pushHistory(s.playHistory, s.currentTrack?.id, target.id),
    };
  }),
  play: () => set({ isPlaying: true }),
  pause: () => set({ isPlaying: false }),
  togglePlay: () => set((s) => ({ isPlaying: !s.isPlaying })),

  next: () => {
    const { queue, currentTrack, shuffle, repeat } = get();
    if (!queue.length) return;
    const startIdx = queue.findIndex((t) => t.id === currentTrack?.id);
    // Skip-on-play: if the next pick is banned (track-id OR artist),
    // keep scanning. Bounded by queue.length so a fully-banned queue
    // can't hang. Auto-advance walks past artist-banned items even
    // though they survive in the queue (see `pruneBanned`); the user
    // can still reach them via direct `jumpToQueue`.
    let probe = startIdx;
    for (let attempts = 0; attempts < queue.length; attempts++) {
      let nextIdx: number;
      if (shuffle) {
        nextIdx = Math.floor(Math.random() * queue.length);
      } else if (probe < queue.length - 1) {
        nextIdx = probe + 1;
      } else if (repeat === 'all') {
        nextIdx = 0;
      } else {
        // End-of-queue, repeat='off'. Try the end handler (infinite
        // playback / wave continuation); if it claims, it drives
        // setQueue/setTrack async. No handler → player stops.
        const handler = get().endHandler;
        if (handler && handler()) return;
        return;
      }
      const candidate = queue[nextIdx];
      if (!candidate) return;
      if (!isBanned(candidate)) {
        set((s) => ({
          currentTrack: candidate,
          isPlaying: true,
          progress: 0,
          playHistory: pushHistory(s.playHistory, s.currentTrack?.id, candidate.id),
        }));
        return;
      }
      probe = nextIdx;
      // Don't loop forever in repeat='all' if every track is banned.
      if (probe === startIdx && attempts > 0) return;
    }
  },

  nextManual: () => {
    const { queue, currentTrack, shuffle } = get();
    if (!queue.length) return;
    const startIdx = queue.findIndex((t) => t.id === currentTrack?.id);
    let probe = startIdx;
    for (let attempts = 0; attempts < queue.length; attempts++) {
      let nextIdx: number;
      if (shuffle) {
        nextIdx = Math.floor(Math.random() * queue.length);
      } else if (probe < queue.length - 1) {
        nextIdx = probe + 1;
      } else {
        // End-of-queue (manual). Try the end handler so the wave
        // continues without a flash of track-1; if no handler
        // claims, wrap to 0 so a non-empty queue doesn't no-op.
        const handler = get().endHandler;
        if (handler && handler()) return;
        nextIdx = 0;
      }
      const candidate = queue[nextIdx];
      if (!candidate) return;
      if (!isBanned(candidate)) {
        set((s) => ({
          currentTrack: candidate,
          isPlaying: true,
          progress: 0,
          playHistory: pushHistory(s.playHistory, s.currentTrack?.id, candidate.id),
        }));
        return;
      }
      probe = nextIdx;
      if (probe === startIdx && attempts > 0) return;
    }
  },

  previous: (force = false) => {
    const { queue, currentTrack, progress, _seekToZero, repeat, playHistory } = get();
    // Threshold-based "rewind to 0" idiom for button / mediaSession
    // presses (Spotify / Apple Music): mid-track "back" means "start
    // this track over", not "go to the previous song". Within the
    // first 3 s the press still means "previous track" — the user is
    // either correcting an accidental skip-forward or quickly
    // walking back through the queue.
    //
    // Gestures (`force = true`) bypass this entirely: a horizontal
    // swipe on the mini-player strip or a drag on the fullscreen
    // cover is an explicit navigation intent that has already moved
    // the cover off-screen, so restarting the current track would
    // feel like the gesture was eaten.
    const REWIND_THRESHOLD_SEC = 3;
    if (!force && progress >= REWIND_THRESHOLD_SEC) {
      set({ progress: 0, _seekToZero: _seekToZero + 1 });
      return;
    }
    // Primary path: pop the play-history stack. Every state
    // transition that promotes a new currentTrack pushes here, so
    // popping survives queue mutations / crossfade slot churn /
    // room-bridge reorders that would defeat a queue-index walk.
    if (playHistory.length > 0) {
      let history = playHistory;
      while (history.length > 0) {
        const lastId = history[history.length - 1];
        history = history.slice(0, -1);
        // Defensive against polluted persisted state from older
        // builds.
        if (!lastId || lastId === currentTrack?.id) continue;
        const target = queue.find((t) => t.id === lastId);
        // Don't gate on `isBanned`: track-id-bans are already
        // pruned from the queue, and artist-banned items survive
        // there by design — "back" is an explicit user gesture, so
        // we honour it even when an intermediate track shares an
        // artist with one the user later banned.
        if (target) {
          set({
            currentTrack: target,
            isPlaying: true,
            progress: 0,
            playHistory: history,
          });
          return;
        }
      }
      // History exhausted — persist the cleanup and fall through to
      // the queue-walk fallback.
      set({ playHistory: history });
    }

    // "Back" goes to the previous song when one exists; the
    // 3s-rewind idiom (Spotify) is the fallback for the first track
    // under repeat='off'. Artist-banned neighbours are NOT skipped
    // for the same reason as above — explicit user gesture.
    let target: Track | null = null;
    if (queue.length > 0) {
      const startIdx = queue.findIndex((t) => t.id === currentTrack?.id);
      if (startIdx > 0) {
        target = queue[startIdx - 1] ?? null;
      } else if (startIdx === 0 && repeat === 'all') {
        target = queue[queue.length - 1] ?? null;
      } else if (startIdx < 0) {
        // Current track isn't in the queue (mid-flight prune,
        // room-bridge mismatch). Best-effort: last item.
        target = queue[queue.length - 1] ?? null;
      }
    }

    if (target) {
      set({ currentTrack: target, isPlaying: true, progress: 0 });
      return;
    }

    // No valid neighbour — last-resort rewind only on the button
    // path (`force=false`) and only past the 3 s threshold. The
    // `>= REWIND_THRESHOLD_SEC` pre-check above already handled the
    // common case; we get here when `progress < REWIND_THRESHOLD_SEC`
    // AND the queue/history walk found nothing to switch to. Within
    // the first 3 s with no neighbour we deliberately do nothing — a
    // tap that early reads as "previous track", not "rewind". For
    // gestures, "no neighbour" means "no previous track to swipe to";
    // the cover-snap-back animation already gives the user feedback
    // that the gesture had no target, so the store stays a no-op.
    if (!force && progress > REWIND_THRESHOLD_SEC) {
      set({ progress: 0, _seekToZero: _seekToZero + 1 });
    }
  },

  setVolume: (volume) => set({ volume, muted: volume === 0 }),
  toggleMute: () => set((s) => ({ muted: !s.muted })),
  toggleShuffle: () => set((s) => ({ shuffle: !s.shuffle })),
  cycleRepeat: () =>
    set((s) => {
      // off → all (queue) → one (track) → off. First press from off
      // most likely means "keep the queue going", not single-track
      // loop (rarer intent).
      const modes: RepeatMode[] = ['off', 'all', 'one'];
      const idx = modes.indexOf(s.repeat);
      return { repeat: modes[(idx + 1) % modes.length] ?? 'off' };
    }),
  setProgress: (progress) => set({ progress }),
  setDuration: (duration) => set({ duration }),
  // Errors route through the global toast surface (not an inline
  // banner) so they live in one corner and disappear on their own.
  // Field kept for cleanup branches that treat non-null as "paused
  // due to problem".
  setError: (error) => {
    set({ error });
    if (error) {
      // Lazy-import to break the cyclic dep risk between stores.
      import('@/store/toast').then(({ toast }) => toast.error(error));
    }
  },
  openFullscreen: () => set({ fullscreen: true }),
  closeFullscreen: () => set({ fullscreen: false }),
  reset: () => set({
    currentTrack: null,
    queue: [],
    isPlaying: false,
    progress: 0,
    duration: 0,
    error: null,
    fullscreen: false,
    playHistory: [],
  }),
}), {
  name: 'bratan-player',
  partialize: (s) => ({
    currentTrack: s.currentTrack,
    queue: s.queue,
    volume: s.volume,
    muted: s.muted,
    shuffle: s.shuffle,
    repeat: s.repeat,
    progress: s.progress,
    duration: s.duration,
    // П8 — fullscreen state survives reload so the expanded player
    // re-opens on rehydrate.
    fullscreen: s.fullscreen,
    // П8 — persist the back-stack so a reload doesn't strand the
    // user with no way back to a previous track.
    playHistory: s.playHistory,
  }),
  // П2 — never auto-resume after reload. `isPlaying` is NOT
  // persisted: even with autoplay allowed, starting a track the user
  // didn't explicitly resume feels like hijacking the session. One
  // tap on play picks up at the persisted timecode.
  onRehydrateStorage: () => (state) => {
    if (state) state.isPlaying = false;
  },
}));
