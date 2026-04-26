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
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.92;

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
    streamVersion,
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

  const lastStreamVersionRef = useRef(streamVersion);
  useEffect(() => {
    if (!currentTrack) return;
    const versionBumped = lastStreamVersionRef.current !== streamVersion;
    lastStreamVersionRef.current = streamVersion;
    const trackChanged =
      currentTrack.id !== loadedTrackRef.current && currentTrack.id !== loadingRef.current;
    if (trackChanged || versionBumped) {
      // Force re-load by clearing the loaded ref so loadTrack runs.
      if (versionBumped) loadedTrackRef.current = null;
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
  }, [currentTrack, loadTrack, streamVersion]);

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

  const seek = useCallback((time: number) => {
    const { audio } = getBundle();
    audio.currentTime = time;
    setProgress(time);
  }, [setProgress]);

  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    const ms = navigator.mediaSession;
    const store = () => usePlayerStore.getState();
    const handlers: Array<[MediaSessionAction, MediaSessionActionHandler]> = [
      ['play', () => store().play()],
      ['pause', () => store().pause()],
      ['previoustrack', () => store().previous()],
      ['nexttrack', () => store().next()],
      ['seekbackward', (d) => seek(Math.max(0, progress - (d.seekOffset ?? 10)))],
      ['seekforward', (d) => seek(Math.min(usePlayerStore.getState().duration, progress + (d.seekOffset ?? 10)))],
      ['seekto', (d) => { if (typeof d.seekTime === 'number') seek(d.seekTime); }],
      ['stop', () => { store().pause(); }],
    ];
    for (const [action, handler] of handlers) {
      try { ms.setActionHandler(action, handler); } catch { /* not supported */ }
    }
    return () => {
      for (const [action] of handlers) {
        try { ms.setActionHandler(action, null); } catch { /* ignore */ }
      }
    };
  }, [progress, seek]);

  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    if (!('setPositionState' in navigator.mediaSession)) return;
    const { audio } = getBundle();
    const dur = audio.duration;
    if (!dur || !isFinite(dur)) return;
    try {
      navigator.mediaSession.setPositionState({
        duration: dur,
        position: Math.min(progress, dur),
        playbackRate: audio.playbackRate || 1,
      });
    } catch { /* ignore */ }
  }, [progress, currentTrack?.id]);

  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.playbackState = isPlaying ? 'playing' : currentTrack ? 'paused' : 'none';
  }, [isPlaying, currentTrack]);

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

export type AmplitudeBand = 'full' | 'bass';

export function useAnalyserAmplitude(active: boolean, band: AmplitudeBand = 'full'): number {
  const [amp, setAmp] = useState(0);
  useEffect(() => {
    if (!active) {
      setAmp(0);
      return;
    }
    const b = ensureAudioGraph();
    if (!b.analyser || !b.ctx) return;
    const analyser = b.analyser;
    const sampleRate = b.ctx.sampleRate || 44100;
    const binHz = sampleRate / analyser.fftSize;
    // Bass: ~30..180 Hz, focused on the kick/sub-bass region.
    const bassLo = Math.max(1, Math.floor(30 / binHz));
    const bassHi = Math.max(bassLo + 1, Math.ceil(180 / binHz));
    const buffer = new Uint8Array(analyser.frequencyBinCount);
    let raf = 0;
    let last = 0;
    let lastAt = performance.now();
    const tick = (now: number) => {
      analyser.getByteFrequencyData(buffer);
      let value: number;
      if (band === 'bass') {
        let sum = 0;
        let count = 0;
        for (let i = bassLo; i < bassHi && i < buffer.length; i++) {
          sum += (buffer[i] ?? 0) / 255;
          count++;
        }
        value = count > 0 ? sum / count : 0;
      } else {
        let sumSq = 0;
        for (let i = 0; i < buffer.length; i++) {
          const v = (buffer[i] ?? 0) / 255;
          sumSq += v * v;
        }
        value = Math.sqrt(sumSq / buffer.length);
      }
      // Heavier exponential smoothing on top of analyser's own smoothing.
      // dt-aware so the perceived speed is stable across frame rates.
      const dt = Math.min(64, now - lastAt);
      lastAt = now;
      const tau = band === 'bass' ? 110 : 90; // ms; higher = slower
      const k = 1 - Math.exp(-dt / tau);
      last = last + (value - last) * k;
      setAmp(last);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active, band]);
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
