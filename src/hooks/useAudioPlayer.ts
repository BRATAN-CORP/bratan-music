import { useEffect, useRef, useCallback, useState } from 'react';
import { usePlayerStore } from '@/store/player';
import { api } from '@/lib/api';

interface StreamResponse {
  url: string;
  source: string;
}

interface AudioBundle {
  audio: HTMLAudioElement;
  ctx: AudioContext | null;
  analyser: AnalyserNode | null;
  filters: BiquadFilterNode[];
  source: MediaElementAudioSourceNode | null;
  ctxFailed: boolean;
  playPromise: Promise<void> | null;
}

async function safePlay(audio: HTMLAudioElement) {
  const b = getBundle();
  // wait for any pending play promise to settle before issuing pause/play
  if (b.playPromise) {
    try { await b.playPromise; } catch { /* ignore */ }
  }
  const p = audio.play();
  b.playPromise = p;
  try { await p; } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return;
    throw err;
  } finally {
    if (b.playPromise === p) b.playPromise = null;
  }
}

async function safePause(audio: HTMLAudioElement) {
  const b = getBundle();
  if (b.playPromise) {
    try { await b.playPromise; } catch { /* ignore */ }
  }
  audio.pause();
}

let bundle: AudioBundle | null = null;

export const EQ_BANDS = [60, 170, 350, 1000, 3500, 10000] as const;

function getBundle(): AudioBundle {
  if (!bundle) {
    const audio = new Audio();
    audio.preload = 'auto';
    audio.crossOrigin = 'anonymous';
    bundle = { audio, ctx: null, analyser: null, filters: [], source: null, ctxFailed: false, playPromise: null };
  }
  return bundle;
}

let corsRetried = false;
function reloadWithoutCors(audio: HTMLAudioElement) {
  if (corsRetried || !audio.src) return;
  corsRetried = true;
  const src = audio.src;
  audio.crossOrigin = null;
  audio.src = '';
  audio.src = src;
  audio.load();
  safePlay(audio).catch(() => {});
}

function ensureAudioGraph(): AudioBundle {
  const b = getBundle();
  if (b.ctx || b.ctxFailed) return b;

  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) {
      b.ctxFailed = true;
      return b;
    }
    const ctx = new Ctx();
    const source = ctx.createMediaElementSource(b.audio);

    const filters = EQ_BANDS.map((freq, i) => {
      const f = ctx.createBiquadFilter();
      f.frequency.value = freq;
      f.gain.value = 0;
      f.Q.value = 1;
      f.type = i === 0 ? 'lowshelf' : i === EQ_BANDS.length - 1 ? 'highshelf' : 'peaking';
      return f;
    });

    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.85;

    const chain: AudioNode[] = [source, ...filters, analyser, ctx.destination];
    for (let i = 0; i < chain.length - 1; i++) {
      const a = chain[i];
      const b = chain[i + 1];
      if (a && b) a.connect(b);
    }

    b.ctx = ctx;
    b.analyser = analyser;
    b.filters = filters;
    b.source = source;
  } catch {
    b.ctxFailed = true;
  }
  return b;
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
    setError,
    pause,
    next,
  } = usePlayerStore();

  const loadingRef = useRef<string | null>(null);
  const loadedTrackRef = useRef<string | null>(null);

  const loadTrack = useCallback(async (trackId: string) => {
    const { audio } = getBundle();
    loadingRef.current = trackId;
    setError(null);
    try {
      const { url } = await api.get<StreamResponse>(`/tracks/${trackId}/stream`);
      if (loadingRef.current !== trackId) return;
      // wait for any in-flight play to settle before swapping src
      const b0 = getBundle();
      if (b0.playPromise) { try { await b0.playPromise; } catch { /* ignore */ } }
      audio.pause();
      audio.src = url;
      audio.load();
      loadedTrackRef.current = trackId;
      ensureAudioGraph();
      const b = getBundle();
      if (b.ctx && b.ctx.state === 'suspended') {
        await b.ctx.resume().catch(() => {});
      }
      await safePlay(audio);
    } catch (err) {
      if (loadingRef.current !== trackId) return;
      const message = err instanceof Error ? err.message : String(err);
      console.error('[stream]', message);
      setError(message);
      pause();
    }
  }, [pause, setError]);

  useEffect(() => {
    if (!currentTrack) return;
    if (currentTrack.id !== loadedTrackRef.current && currentTrack.id !== loadingRef.current) {
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
    const { audio } = getBundle();
    if (!audio.src || loadedTrackRef.current !== currentTrack?.id) return;
    if (isPlaying) {
      const b = ensureAudioGraph();
      if (b.ctx && b.ctx.state === 'suspended') {
        b.ctx.resume().catch(() => {});
      }
      safePlay(audio).catch((err) => {
        setError(err instanceof Error ? err.message : 'Не удалось воспроизвести');
        pause();
      });
    } else {
      safePause(audio);
    }
  }, [isPlaying, currentTrack?.id, pause, setError]);

  useEffect(() => {
    const { audio } = getBundle();
    audio.volume = muted ? 0 : volume;
  }, [volume, muted]);

  useEffect(() => {
    const { audio } = getBundle();

    const onTimeUpdate = () => setProgress(audio.currentTime);
    const onDurationChange = () => setDuration(audio.duration || 0);
    const onEnded = () => {
      if (repeat === 'one') {
        audio.currentTime = 0;
        safePlay(audio).catch(() => {});
      } else {
        next();
      }
    };
    const onError = () => {
      const code = audio.error?.code;
      if (audio.crossOrigin && !corsRetried) {
        reloadWithoutCors(audio);
        return;
      }
      const messages: Record<number, string> = {
        1: 'Загрузка прервана',
        2: 'Сетевая ошибка',
        3: 'Не удалось декодировать',
        4: 'Формат не поддерживается',
      };
      setError(messages[code ?? 0] ?? 'Ошибка плеера');
    };

    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('durationchange', onDurationChange);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('error', onError);

    return () => {
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('durationchange', onDurationChange);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('error', onError);
    };
  }, [repeat, next, setProgress, setDuration, setError]);

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
    const { audio } = getBundle();
    audio.currentTime = time;
    setProgress(time);
  }, [setProgress]);

  return { progress, seek };
}

export function setEqGain(bandIndex: number, gainDb: number): boolean {
  const b = ensureAudioGraph();
  if (!b.filters[bandIndex]) return false;
  b.filters[bandIndex].gain.value = gainDb;
  return true;
}

export function getEqGain(bandIndex: number): number {
  const b = getBundle();
  return b.filters[bandIndex]?.gain.value ?? 0;
}

export function isEqAvailable(): boolean {
  const b = ensureAudioGraph();
  return Boolean(b.ctx && !b.ctxFailed && b.filters.length > 0);
}

export function useAnalyserAmplitude(active: boolean): number {
  const [amp, setAmp] = useState(0);
  useEffect(() => {
    if (!active) {
      setAmp(0);
      return;
    }
    const b = ensureAudioGraph();
    if (!b.analyser) return;
    const analyser = b.analyser;
    const buffer = new Uint8Array(analyser.frequencyBinCount);
    let raf = 0;
    let last = 0;
    const tick = () => {
      analyser.getByteFrequencyData(buffer);
      let sumSq = 0;
      for (let i = 0; i < buffer.length; i++) {
        const v = (buffer[i] ?? 0) / 255;
        sumSq += v * v;
      }
      const rms = Math.sqrt(sumSq / buffer.length);
      // smooth
      last = last * 0.7 + rms * 0.3;
      setAmp(last);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active]);
  return amp;
}

export function useAnalyserData(active: boolean, bins = 32) {
  const [data, setData] = useState<Uint8Array>(() => new Uint8Array(bins));

  useEffect(() => {
    if (!active) return;
    const b = ensureAudioGraph();
    if (!b.analyser) return;
    const analyser = b.analyser;
    const buffer = new Uint8Array(analyser.frequencyBinCount);
    let raf = 0;

    const tick = () => {
      analyser.getByteFrequencyData(buffer);
      const step = Math.floor(buffer.length / bins) || 1;
      const out = new Uint8Array(bins);
      for (let i = 0; i < bins; i++) out[i] = buffer[i * step] ?? 0;
      setData(out);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active, bins]);

  return data;
}
