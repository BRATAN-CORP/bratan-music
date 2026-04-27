import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface Track {
  id: string;
  title: string;
  artist: string;
  /** Tidal artist id — needed for the 'go to artist' action in the
   * player. Optional because some legacy callsites don't pass it
   * (liked tracks loaded from older snapshots, etc.). */
  artistId?: string;
  coverUrl?: string;
  /** Animated cover (mp4). Used in the fullscreen player as a tasteful loop. */
  coverVideoUrl?: string;
  duration: number;
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
  bumpStream: () => void;
  setTrack: (track: Track) => void;
  setQueue: (tracks: Track[]) => void;
  addToQueue: (track: Track) => void;
  /** Insert a track immediately after the currently-playing one. */
  playNext: (track: Track) => void;
  removeFromQueue: (trackId: string) => void;
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

  bumpStream: () => set((s) => ({ streamVersion: s.streamVersion + 1, progress: 0 })),

  setTrack: (track) => set({ currentTrack: track, isPlaying: true, progress: 0, error: null }),
  setQueue: (tracks) => set({ queue: tracks }),
  addToQueue: (track) => set((s) => ({ queue: [...s.queue, track] })),
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
    return { currentTrack: target, isPlaying: true, progress: 0 };
  }),
  play: () => set({ isPlaying: true }),
  pause: () => set({ isPlaying: false }),
  togglePlay: () => set((s) => ({ isPlaying: !s.isPlaying })),

  next: () => {
    const { queue, currentTrack, shuffle, repeat } = get();
    if (!queue.length) return;
    const idx = queue.findIndex((t) => t.id === currentTrack?.id);
    let nextIdx: number;
    if (shuffle) {
      nextIdx = Math.floor(Math.random() * queue.length);
    } else if (idx < queue.length - 1) {
      nextIdx = idx + 1;
    } else if (repeat === 'all') {
      nextIdx = 0;
    } else {
      return;
    }
    const nextTrack = queue[nextIdx];
    if (nextTrack) set({ currentTrack: nextTrack, isPlaying: true, progress: 0 });
  },

  nextManual: () => {
    const { queue, currentTrack, shuffle } = get();
    if (!queue.length) return;
    const idx = queue.findIndex((t) => t.id === currentTrack?.id);
    let nextIdx: number;
    if (shuffle) {
      nextIdx = Math.floor(Math.random() * queue.length);
    } else if (idx < queue.length - 1) {
      nextIdx = idx + 1;
    } else {
      // End of queue — wrap regardless of repeat mode. The user pressed
      // skip-forward expecting *something* to play, and the queue is
      // non-empty.
      nextIdx = 0;
    }
    const nextTrack = queue[nextIdx];
    if (nextTrack) set({ currentTrack: nextTrack, isPlaying: true, progress: 0 });
  },

  previous: () => {
    const { queue, currentTrack, progress, _seekToZero } = get();
    if (progress > 3) {
      set({ progress: 0, _seekToZero: _seekToZero + 1 });
      return;
    }
    const idx = queue.findIndex((t) => t.id === currentTrack?.id);
    if (idx > 0) {
      const prevTrack = queue[idx - 1];
      if (prevTrack) set({ currentTrack: prevTrack, isPlaying: true, progress: 0 });
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
  setError: (error) => set({ error }),
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
    // Persist isPlaying so UI state matches what the user left the player at.
    // useAudioPlayer's loadTrack honours this on rehydrate: if the browser
    // blocks autoplay (no user gesture yet), the play() rejection path
    // falls back to pause() which writes isPlaying=false — keeping UI and
    // audio in sync regardless of whether the resume actually starts.
    isPlaying: s.isPlaying,
  }),
}));
