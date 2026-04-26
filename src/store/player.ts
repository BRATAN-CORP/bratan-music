import { create } from 'zustand';

interface Track {
  id: string;
  title: string;
  artist: string;
  coverUrl?: string;
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
  setTrack: (track: Track) => void;
  setQueue: (tracks: Track[]) => void;
  addToQueue: (track: Track) => void;
  play: () => void;
  pause: () => void;
  togglePlay: () => void;
  next: () => void;
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
}

export const usePlayerStore = create<PlayerState>()((set, get) => ({
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

  setTrack: (track) => set({ currentTrack: track, isPlaying: true, progress: 0, error: null }),
  setQueue: (tracks) => set({ queue: tracks }),
  addToQueue: (track) => set((s) => ({ queue: [...s.queue, track] })),
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

  previous: () => {
    const { queue, currentTrack, progress } = get();
    if (progress > 3) {
      set({ progress: 0 });
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
      const modes: RepeatMode[] = ['off', 'one', 'all'];
      const idx = modes.indexOf(s.repeat);
      return { repeat: modes[(idx + 1) % modes.length] ?? 'off' };
    }),
  setProgress: (progress) => set({ progress }),
  setDuration: (duration) => set({ duration }),
  setError: (error) => set({ error }),
  openFullscreen: () => set({ fullscreen: true }),
  closeFullscreen: () => set({ fullscreen: false }),
}));
