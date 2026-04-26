import { useEffect, useRef, useCallback } from 'react';
import { usePlayerStore } from '@/store/player';
import { api } from '@/lib/api';

interface StreamResponse {
  url: string;
  source: string;
}

let audioElement: HTMLAudioElement | null = null;

function getAudio(): HTMLAudioElement {
  if (!audioElement) {
    audioElement = new Audio();
    audioElement.preload = 'auto';
  }
  return audioElement;
}

export function useAudioPlayer() {
  const {
    currentTrack,
    isPlaying,
    volume,
    muted,
    repeat,
    progress,
    setProgress,
    setDuration,
    pause,
    next,
  } = usePlayerStore();

  const prevTrackId = useRef<string | null>(null);

  const loadTrack = useCallback(async (trackId: string) => {
    const audio = getAudio();
    try {
      const { url } = await api.get<StreamResponse>(`/tracks/${trackId}/stream`);
      audio.src = url;
      audio.load();
      await audio.play();
    } catch (err) {
      console.error('Stream error:', err);
      pause();
    }
  }, [pause]);

  useEffect(() => {
    if (!currentTrack) return;
    if (currentTrack.id !== prevTrackId.current) {
      prevTrackId.current = currentTrack.id;
      loadTrack(currentTrack.id);

      if ('mediaSession' in navigator) {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: currentTrack.title,
          artist: currentTrack.artist,
          artwork: currentTrack.coverUrl
            ? [{ src: currentTrack.coverUrl, sizes: '512x512', type: 'image/jpeg' }]
            : [],
        });
      }
    }
  }, [currentTrack, loadTrack]);

  useEffect(() => {
    const audio = getAudio();
    if (isPlaying) {
      audio.play().catch(() => pause());
    } else {
      audio.pause();
    }
  }, [isPlaying, pause]);

  useEffect(() => {
    getAudio().volume = muted ? 0 : volume;
  }, [volume, muted]);

  useEffect(() => {
    const audio = getAudio();

    const onTimeUpdate = () => setProgress(audio.currentTime);
    const onDurationChange = () => setDuration(audio.duration || 0);
    const onEnded = () => {
      if (repeat === 'one') {
        audio.currentTime = 0;
        audio.play();
      } else {
        next();
      }
    };

    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('durationchange', onDurationChange);
    audio.addEventListener('ended', onEnded);

    return () => {
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('durationchange', onDurationChange);
      audio.removeEventListener('ended', onEnded);
    };
  }, [repeat, next, setProgress, setDuration]);

  useEffect(() => {
    if ('mediaSession' in navigator) {
      const store = usePlayerStore.getState();
      navigator.mediaSession.setActionHandler('play', () => store.play());
      navigator.mediaSession.setActionHandler('pause', () => store.pause());
      navigator.mediaSession.setActionHandler('previoustrack', () => store.previous());
      navigator.mediaSession.setActionHandler('nexttrack', () => store.next());
    }
  }, []);

  const seek = useCallback((time: number) => {
    const audio = getAudio();
    audio.currentTime = time;
    setProgress(time);
  }, [setProgress]);

  return { progress, seek };
}
