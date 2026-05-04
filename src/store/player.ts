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
   *  bans intentionally do NOT prune the queue (the user's queue is
   *  a deliberate, manual selection — banning an artist hides them
   *  from recommendations going forward but doesn't retroactively
   *  yank already-queued tracks). If the current track itself was
   *  the one explicitly banned, advance to the next still-valid one.
   *  Called by the dislike mutation right after the optimistic
   *  update.
   *
   *  `bannedTrackId` is the id the user just toggled. Skip-to-next is
   *  only triggered when this id matches the current track — banning
   *  any OTHER track (or any artist) just prunes the queue, never
   *  hijacks playback of whatever the user is listening to right now.
   *  Omit the argument for the bootstrap path that has no notion of
   *  "the user just clicked ban" — falls back to the legacy "skip if
   *  current is banned" semantics for backwards compatibility. */
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
  previous: () => void;
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
    // Skip-on-play: if the next pick is banned, keep scanning. We
    // bound the scan at queue.length so a fully-banned queue can't
    // hang the engine — worst case we exhaust every slot and bail.
    //
    // Skips both explicit track-id bans AND artist-level bans —
    // banning an artist with `не рекомендовать` should not just
    // suppress them in recommendations, it should also stop
    // auto-advance from landing on them. The queue itself still
    // contains the row (banning an artist intentionally doesn't
    // prune already-queued items — see `pruneBanned`), so the user
    // can still play them by clicking the queue entry directly
    // (`jumpToQueue`); we just walk past them on natural flow.
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
        // End of queue — wrap regardless of repeat mode. The user
        // pressed skip-forward expecting *something* to play, and
        // the queue is non-empty.
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

  previous: () => {
    const { queue, currentTrack, progress, _seekToZero, repeat, playHistory } = get();
    // Primary path: pop the explicit play-history stack. This is the
    // *actual* "the track you were on a moment ago" pointer, pushed by
    // every state transition that promotes a new currentTrack —
    // setTrack, jumpToQueue, next, nextManual, the room bridge's
    // setTrackAt, and the audio engine's auto-crossfade promotion.
    // Walking the queue backwards (legacy fallback below) is fragile
    // around auto-advance: in some cases the queue/currentTrack pair
    // is in a transient state (post-crossfade slot churn, mid-fetch
    // queue prune, room bridge reorder) and findIndex returns -1,
    // leaving "back" silently no-op. The history stack survives all
    // of that because it stores ids, not array positions.
    if (playHistory.length > 0) {
      let history = playHistory;
      while (history.length > 0) {
        const lastId = history[history.length - 1];
        history = history.slice(0, -1);
        // Skip self-references (shouldn't happen with the pushHistory
        // guard, but be defensive against persisted state from older
        // builds where the stack might have been polluted).
        if (!lastId || lastId === currentTrack?.id) continue;
        const target = queue.find((t) => t.id === lastId);
        // The pop is a back-target as long as the queue still
        // contains it. We deliberately do NOT also gate on
        // `isBanned(target)` here: track-id-banned items are
        // already filtered out of the queue (`filterTrackBanned`),
        // so `queue.find` returning truthy means the track is
        // still a valid hop. Artist-banned tracks DO survive in
        // the queue (per `pruneBanned`'s "user's queue is sacred"
        // contract) and a previous version of this walk also
        // skipped them — that was the source of "back from track 6
        // to track 4 works but back from track 2 to track 1
        // doesn't" when one of the intermediate tracks shared an
        // artist with one the user later banned. "Back" is an
        // explicit user gesture; honour it.
        if (target) {
          set({
            currentTrack: target,
            isPlaying: true,
            progress: 0,
            playHistory: history,
          });
          return;
        }
        // Track is no longer in the queue (dequeued, track-id-banned
        // and pruned, etc.) — drop the entry and keep walking
        // backward.
      }
      // History exhausted with nothing playable — persist the cleanup
      // and fall through to the queue-walk fallback.
      set({ playHistory: history });
    }

    // First, see whether there is an actual previous track to walk to.
    // If there is, "back" always goes there — the user expects "back"
    // to mean "go to the previous song", not "rewind the current one".
    // The classic 3s-rewind idiom (Spotify et al) is preserved as a
    // fallback for the case where there is no valid neighbour to walk
    // to (first track of the queue under repeat='off').
    //
    // We deliberately do NOT skip artist-banned neighbours here.
    // Track-id-banned ones are already filtered out of the queue by
    // `filterTrackBanned`, so any item we land on is a legitimate
    // back target. Walking past artist-banned items used to leave
    // "back from 2 → 1" silently no-op once a credited artist of the
    // intermediate track had been banned — the user explicitly
    // pressed back, honour it.
    let target: Track | null = null;
    if (queue.length > 0) {
      const startIdx = queue.findIndex((t) => t.id === currentTrack?.id);
      if (startIdx > 0) {
        target = queue[startIdx - 1] ?? null;
      } else if (startIdx === 0 && repeat === 'all') {
        target = queue[queue.length - 1] ?? null;
      } else if (startIdx < 0) {
        // Current track isn't in the queue (rare — pruned mid-flight,
        // room-bridge state mismatch). Pick the last item as a
        // best-effort back target so the user isn't stranded.
        target = queue[queue.length - 1] ?? null;
      }
    }

    if (target) {
      set({ currentTrack: target, isPlaying: true, progress: 0 });
      return;
    }

    // No valid neighbour — fall back to "rewind current to 0" if the
    // current track is more than 3s in. Within the first 3 seconds we
    // intentionally do nothing (no neighbour, nothing to rewind).
    if (progress > 3) {
      set({ progress: 0, _seekToZero: _seekToZero + 1 });
    }
  },

  setVolume: (volume) => set({ volume, muted: volume === 0 }),
  toggleMute: () => set((s) => ({ muted: !s.muted })),
  toggleShuffle: () => set((s) => ({ shuffle: !s.shuffle })),
  cycleRepeat: () =>
    set((s) => {
      // off → all (queue/playlist repeat) → one (current track repeat) → off.
      // Rationale: on the first press from the inactive state the user
      // most likely wants "keep the queue going" rather than "loop this
      // single track". Single-track loop is a less common, more niche
      // intent so it lives at the second press.
      const modes: RepeatMode[] = ['off', 'all', 'one'];
      const idx = modes.indexOf(s.repeat);
      return { repeat: modes[(idx + 1) % modes.length] ?? 'off' };
    }),
  setProgress: (progress) => set({ progress }),
  setDuration: (duration) => set({ duration }),
  // We no longer surface playback errors via an inline banner inside
  // the mini- and fullscreen-player — that broke the visual rhythm of
  // the player every time something went wrong (especially common
  // during long sessions where transient stream errors are normal).
  // Instead we route through the global toast surface so all
  // user-facing errors live in one corner of the screen and disappear
  // on their own. The `error` field is kept on the store so anything
  // else relying on it (e.g. cleanup branches that treat a non-null
  // error as "we paused due to a problem") keeps working.
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
    // П8 — fullscreen state survives reload: if the user was inside the
    // expanded player when they refreshed, we re-open it on rehydrate so
    // the experience picks up exactly where it left off.
    fullscreen: s.fullscreen,
    // Persist the back-stack so a quick reload doesn't strand the
    // user on track 2 with no way back to track 1 (the most common
    // path before this fix — rehydrate dropped the history and the
    // queue-walk fallback couldn't always reach the prior song).
    playHistory: s.playHistory,
  }),
  // П2 — never auto-resume playback after a page reload. We deliberately
  // do NOT persist `isPlaying`. Even when the browser would technically
  // allow autoplay (because the user has interacted with the site
  // before), starting a track that the user didn't explicitly resume
  // feels like the page is hijacking their session. The rest of the
  // player state (current track, queue, progress, fullscreen) is
  // restored so a single tap on the play button picks up at the
  // previous timecode.
  onRehydrateStorage: () => (state) => {
    if (state) state.isPlaying = false;
  },
}));
