import { useEffect, useRef, useCallback, useState } from 'react';
import { usePlayerStore } from '@/store/player';
import { useSettingsStore } from '@/store/settings';
import { useAuthStore } from '@/store/auth';
import { api } from '@/lib/api';

import type { TidalQuality } from '@/store/settings';

const API_BASE = import.meta.env.VITE_API_URL ?? 'https://bratan-music-api.bratan-corp.workers.dev';

const QUALITY_FALLBACK_ORDER: TidalQuality[] = ['HI_RES_LOSSLESS', 'LOSSLESS', 'HIGH', 'LOW'];

function getNextFallbackQuality(current: string): TidalQuality | null {
  const idx = QUALITY_FALLBACK_ORDER.indexOf(current as TidalQuality);
  if (idx < 0 || idx >= QUALITY_FALLBACK_ORDER.length - 1) return null;
  return QUALITY_FALLBACK_ORDER[idx + 1] ?? null;
}

/**
 * Build the stream URL for any track. Upload tracks (id="upload:<uuid>") are
 * served from the worker's R2-backed /uploads/:id/stream endpoint with a
 * ?token= query fallback (the audio element can't send Authorization).
 */
async function fetchStreamUrl(track: { id: string; source?: string }, quality: string): Promise<string> {
  if (track.id.startsWith('upload:') || track.source === 'upload') {
    const rawId = track.id.startsWith('upload:') ? track.id.slice('upload:'.length) : track.id;
    const token = useAuthStore.getState().accessToken ?? '';
    return `${API_BASE}/uploads/${rawId}/stream?token=${encodeURIComponent(token)}`;
  }
  const res = await api.get<{ url: string }>(`/tracks/${track.id}/stream?quality=${encodeURIComponent(quality)}`);
  return res.url;
}

type Slot = 'a' | 'b';

/**
 * The audio engine is a singleton with two HTMLAudioElement slots feeding a
 * shared post-source signal chain (filters → analyser → destination). Each
 * slot has its own GainNode so we can ramp volumes independently for
 * crossfades. Outside of a crossfade only one slot is "active"; the other is
 * paused with gain=0.
 */
interface AudioBundle {
  audios: Record<Slot, HTMLAudioElement>;
  sources: Record<Slot, MediaElementAudioSourceNode | null>;
  gains: Record<Slot, GainNode | null>;
  loaded: Record<Slot, string | null>;
  ctx: AudioContext | null;
  analyser: AnalyserNode | null;
  filters: BiquadFilterNode[];
  ctxFailed: boolean;
  active: Slot;
  /** When non-null, a crossfade ramp is in flight. */
  crossfadingInto: Slot | null;
  playPromises: Record<Slot, Promise<void> | null>;
}

let bundle: AudioBundle | null = null;
let corsRetried: Record<Slot, boolean> = { a: false, b: false };

export const EQ_BANDS = [60, 170, 350, 1000, 3500, 10000] as const;

function makeAudio(): HTMLAudioElement {
  const a = new Audio();
  a.preload = 'auto';
  a.crossOrigin = 'anonymous';
  return a;
}

function getBundle(): AudioBundle {
  if (!bundle) {
    bundle = {
      audios: { a: makeAudio(), b: makeAudio() },
      sources: { a: null, b: null },
      gains: { a: null, b: null },
      loaded: { a: null, b: null },
      ctx: null,
      analyser: null,
      filters: [],
      ctxFailed: false,
      active: 'a',
      crossfadingInto: null,
      playPromises: { a: null, b: null },
    };
  }
  return bundle;
}

function reloadWithoutCors(slot: Slot) {
  const b = getBundle();
  const audio = b.audios[slot];
  if (corsRetried[slot] || !audio.src) return;
  corsRetried[slot] = true;
  const src = audio.src;
  audio.crossOrigin = null;
  audio.src = '';
  audio.src = src;
  audio.load();
  safePlay(slot).catch(() => {});
}

async function safePlay(slot: Slot) {
  const b = getBundle();
  const audio = b.audios[slot];
  if (b.playPromises[slot]) {
    try { await b.playPromises[slot]; } catch { /* ignore */ }
  }
  const p = audio.play();
  b.playPromises[slot] = p;
  try { await p; } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return;
    throw err;
  } finally {
    if (b.playPromises[slot] === p) b.playPromises[slot] = null;
  }
}

async function safePause(slot: Slot) {
  const b = getBundle();
  if (b.playPromises[slot]) {
    try { await b.playPromises[slot]; } catch { /* ignore */ }
  }
  b.audios[slot].pause();
}

/**
 * Build the shared signal chain lazily on first user interaction. Both slots
 * route source → gain → filter[0] → … → filter[N] → analyser → destination.
 */
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

    // Build filter chain: filters[0] -> filters[1] -> ... -> analyser -> destination
    for (let i = 0; i < filters.length - 1; i++) {
      filters[i]!.connect(filters[i + 1]!);
    }
    filters[filters.length - 1]!.connect(analyser);
    analyser.connect(ctx.destination);

    // Wire each slot: source -> gain -> filters[0]
    for (const slot of ['a', 'b'] as const) {
      const src = ctx.createMediaElementSource(b.audios[slot]);
      const gain = ctx.createGain();
      // Inactive slot starts muted.
      gain.gain.value = slot === b.active ? 1 : 0;
      src.connect(gain);
      gain.connect(filters[0]!);
      b.sources[slot] = src;
      b.gains[slot] = gain;
    }

    b.ctx = ctx;
    b.analyser = analyser;
    b.filters = filters;
  } catch {
    b.ctxFailed = true;
  }
  return b;
}

function inactiveSlot(b: AudioBundle): Slot {
  return b.active === 'a' ? 'b' : 'a';
}

/**
 * Set the gain node value (when graph is up) AND the underlying element
 * volume (fallback for when AudioContext failed to start). Used for the
 * crossfade ramp.
 */
function setSlotGain(slot: Slot, value: number) {
  const b = getBundle();
  const g = b.gains[slot];
  const v = Math.max(0, Math.min(1, value));
  if (g) {
    try { g.gain.value = v; } catch { /* ignore */ }
  }
  // We always also nudge .volume so the inactive slot is silent even when the
  // AudioContext path failed to come up (e.g. CORS retry path with no graph).
  b.audios[slot].volume = v;
}

let activeRamp: number | null = null;

function cancelRamp() {
  if (activeRamp != null) {
    cancelAnimationFrame(activeRamp);
    activeRamp = null;
  }
}

/**
 * Animate gain from `fromValue` to `toValue` over `durationMs` for the given
 * slot. Returns a promise that resolves when the ramp finishes (or is
 * cancelled).
 */
function rampGain(slot: Slot, fromValue: number, toValue: number, durationMs: number): Promise<void> {
  return new Promise((resolve) => {
    const start = performance.now();
    setSlotGain(slot, fromValue);
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const v = fromValue + (toValue - fromValue) * t;
      setSlotGain(slot, v);
      if (t >= 1) {
        resolve();
        return;
      }
      activeRamp = requestAnimationFrame(tick);
    };
    activeRamp = requestAnimationFrame(tick);
  });
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
    queue,
    setProgress,
    setDuration,
    setError,
    pause,
    next,
    setTrack,
    _seekToZero,
  } = usePlayerStore();

  const crossfade = useSettingsStore((s) => s.crossfade);
  const crossfadeDuration = useSettingsStore((s) => s.crossfadeDuration);
  const tidalQuality = useSettingsStore((s) => s.tidalQuality);

  const loadingRef = useRef<string | null>(null);
  const crossfadingRef = useRef(false);

  const currentQualityRef = useRef<string>(tidalQuality);
  currentQualityRef.current = tidalQuality;
  const fallbackInProgressRef = useRef(false);

  /** Try loading the audio src and wait for it to become playable.
   *  Resolves with true on success, false on media error. */
  const tryLoadSrc = (audio: HTMLAudioElement, url: string): Promise<boolean> => {
    return new Promise((resolve) => {
      const cleanup = () => {
        audio.removeEventListener('canplay', onCanPlay);
        audio.removeEventListener('error', onErr);
      };
      const onCanPlay = () => { cleanup(); resolve(true); };
      const onErr = () => { cleanup(); resolve(false); };
      audio.addEventListener('canplay', onCanPlay, { once: true });
      audio.addEventListener('error', onErr, { once: true });
      audio.src = url;
      audio.load();
    });
  };

  /** Load the given track into the active slot and start playback from 0.
   *  Automatically tries the full quality fallback chain before giving up.
   *  If `quality` is provided it overrides the user setting (used for fallback). */
  const loadTrack = useCallback(async (track: { id: string; source?: string }, quality?: string) => {
    const trackId = track.id;
    const b = getBundle();
    loadingRef.current = trackId;
    let effectiveQuality = quality ?? currentQualityRef.current;
    setError(null);
    fallbackInProgressRef.current = true;

    const slot = b.active;
    const audio = b.audios[slot];

    // Wait for any in-flight play promise before touching the audio element.
    if (b.playPromises[slot]) {
      try { await b.playPromises[slot]; } catch { /* ignore */ }
    }
    audio.pause();

    // Try each quality level in the fallback chain.
    let url: string | null = null;
    let loaded = false;
    const MAX_RETRIES = 2;
    while (true) {
      if (loadingRef.current !== trackId) return;
      try {
        url = await fetchStreamUrl(track, effectiveQuality);
      } catch {
        url = null;
      }
      if (loadingRef.current !== trackId) return;
      if (url) {
        corsRetried[slot] = false;
        audio.crossOrigin = 'anonymous';
        // Try loading and auto-retry up to MAX_RETRIES for transient errors.
        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
          if (loadingRef.current !== trackId) return;
          const ok = await tryLoadSrc(audio, url);
          if (ok) { loaded = true; break; }
          if (attempt < MAX_RETRIES) {
            console.warn(`[stream] attempt ${attempt + 1} failed for ${effectiveQuality}, retrying...`);
            await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
          }
        }
        if (loaded) break;
      }
      // Try next quality in fallback chain.
      const next = getNextFallbackQuality(effectiveQuality);
      if (!next) break;
      console.warn(`[stream] quality ${effectiveQuality} failed, falling back to ${next}`);
      currentQualityRef.current = next;
      effectiveQuality = next;
    }

    if (loadingRef.current !== trackId) return;
    fallbackInProgressRef.current = false;

    if (!loaded) {
      setError('Не удалось загрузить трек');
      pause();
      return;
    }

    b.loaded[slot] = trackId;
    ensureAudioGraph();
    setSlotGain(slot, 1);
    setSlotGain(inactiveSlot(b), 0);
    if (b.ctx && b.ctx.state === 'suspended') {
      await b.ctx.resume().catch(() => {});
    }
    // Only auto-play if the store says we should be playing (avoids
    // a sound blip when the track is restored from localStorage on reload).
    if (!usePlayerStore.getState().isPlaying) return;
    try {
      await safePlay(slot);
    } catch (err) {
      if (loadingRef.current !== trackId) return;
      setError(err instanceof Error ? err.message : 'Не удалось воспроизвести');
      pause();
    }
  }, [pause, setError]);

  // Reload when track id changes (or stream version bumped).
  const lastStreamVersionRef = useRef(streamVersion);
  useEffect(() => {
    if (!currentTrack) return;
    const versionBumped = lastStreamVersionRef.current !== streamVersion;
    lastStreamVersionRef.current = streamVersion;
    const b = getBundle();

    // If the requested track is already loaded into the inactive slot (the
    // crossfade preloaded it and finished) we just promote that slot — no
    // need to refetch / restart.
    if (b.loaded[inactiveSlot(b)] === currentTrack.id && !versionBumped) {
      // Promote the inactive (now-playing) slot.
      const newActive = inactiveSlot(b);
      // Make sure old slot is silent + paused.
      safePause(b.active);
      b.active = newActive;
      setSlotGain(newActive, 1);
      setSlotGain(inactiveSlot(b), 0);
      crossfadingRef.current = false;
      b.crossfadingInto = null;
      // Update mediaSession metadata.
      if ('mediaSession' in navigator) {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: currentTrack.title,
          artist: currentTrack.artist,
          artwork: currentTrack.coverUrl
            ? [{ src: currentTrack.coverUrl, sizes: '512x512', type: 'image/jpeg' }]
            : [],
        });
      }
      return;
    }

    const trackChanged = currentTrack.id !== b.loaded[b.active] && currentTrack.id !== loadingRef.current;
    if (trackChanged || versionBumped) {
      // Reset quality fallback to user's chosen quality for the new track.
      currentQualityRef.current = tidalQuality;
      // Cancel any in-flight crossfade so we don't keep two audios alive.
      cancelRamp();
      crossfadingRef.current = false;
      b.crossfadingInto = null;
      safePause(inactiveSlot(b));
      b.loaded[inactiveSlot(b)] = null;
      if (versionBumped) b.loaded[b.active] = null;
      loadTrack(currentTrack);

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

  // Play / pause toggle on the active slot.
  useEffect(() => {
    const b = getBundle();
    const slot = b.active;
    const audio = b.audios[slot];
    if (!audio.src || b.loaded[slot] !== currentTrack?.id) return;
    if (isPlaying) {
      if (fallbackInProgressRef.current) return;
      // If restored from localStorage, seek to the saved progress before playing.
      const storeProgress = usePlayerStore.getState().progress;
      if (audio.currentTime < 1 && storeProgress > 1) {
        const dur = audio.duration;
        if (isFinite(dur) && dur > 0) {
          audio.currentTime = Math.min(storeProgress, dur);
        } else {
          const onMeta = () => {
            audio.removeEventListener('loadedmetadata', onMeta);
            if (isFinite(audio.duration) && audio.duration > 0) {
              audio.currentTime = Math.min(storeProgress, audio.duration);
            }
          };
          audio.addEventListener('loadedmetadata', onMeta, { once: true });
        }
      }
      const ctxBundle = ensureAudioGraph();
      if (ctxBundle.ctx && ctxBundle.ctx.state === 'suspended') {
        ctxBundle.ctx.resume().catch(() => {});
      }
      safePlay(slot).catch((err) => {
        setError(err instanceof Error ? err.message : 'Не удалось воспроизвести');
        pause();
      });
    } else {
      safePause(slot);
      // If a crossfade was in flight, cancel it: pause the incoming slot too.
      if (crossfadingRef.current) {
        cancelRamp();
        crossfadingRef.current = false;
        b.crossfadingInto = null;
        safePause(inactiveSlot(b));
        setSlotGain(inactiveSlot(b), 0);
        b.loaded[inactiveSlot(b)] = null;
      }
    }
  }, [isPlaying, currentTrack?.id, pause, setError]);

  // Volume / mute always apply to whichever slot is active. The opposite slot
  // is held at gain=0 except during a crossfade when both are ramped.
  useEffect(() => {
    const b = getBundle();
    if (crossfadingRef.current) return;
    setSlotGain(b.active, muted ? 0 : volume);
    setSlotGain(inactiveSlot(b), 0);
  }, [volume, muted]);

  /**
   * Crossfade trigger: when the active slot is within `crossfadeDuration`
   * seconds of the end, start preloading the next queue track into the
   * inactive slot and ramp gains. Once the ramp finishes we promote the
   * inactive slot via setTrack(nextTrack), which the load effect short-
   * circuits (since the slot is already loaded).
   */
  const startCrossfade = useCallback(async () => {
    const b = getBundle();
    if (crossfadingRef.current) return;
    if (!currentTrack) return;
    const idx = queue.findIndex((t) => t.id === currentTrack.id);
    if (idx < 0) return;
    const nextTrack = queue[idx + 1];
    if (!nextTrack) return;

    crossfadingRef.current = true;
    const incoming = inactiveSlot(b);
    b.crossfadingInto = incoming;
    try {
      const url = await fetchStreamUrl(nextTrack, tidalQuality);
      if (!crossfadingRef.current) return;
      const audio = b.audios[incoming];
      if (b.playPromises[incoming]) {
        try { await b.playPromises[incoming]; } catch { /* ignore */ }
      }
      audio.pause();
      audio.src = url;
      audio.load();
      audio.currentTime = 0;
      b.loaded[incoming] = nextTrack.id;
      ensureAudioGraph();
      setSlotGain(incoming, 0);
      if (b.ctx && b.ctx.state === 'suspended') {
        await b.ctx.resume().catch(() => {});
      }
      await safePlay(incoming);
      const target = muted ? 0 : volume;
      const durMs = Math.max(500, crossfadeDuration * 1000);
      // Run both ramps in parallel.
      await Promise.all([
        rampGain(b.active, target, 0, durMs),
        rampGain(incoming, 0, target, durMs),
      ]);
      if (!crossfadingRef.current) return;
      // Ramp done → switch the active slot.
      safePause(b.active);
      const oldActive = b.active;
      b.loaded[oldActive] = null;
      b.active = incoming;
      b.crossfadingInto = null;
      crossfadingRef.current = false;
      // Tell the store the playing track has changed without triggering a
      // reload. Our load effect detects 'slot already loaded' and skips.
      setTrack(nextTrack);
    } catch (err) {
      console.warn('[crossfade] failed, falling back to hard switch', err);
      crossfadingRef.current = false;
      b.crossfadingInto = null;
    }
  }, [currentTrack, queue, volume, muted, crossfadeDuration, setTrack, tidalQuality]);

  // Time updates + ended + error + crossfade trigger.
  useEffect(() => {
    const b = getBundle();
    const wireSlot = (slot: Slot) => {
      const audio = b.audios[slot];
      const onTimeUpdate = () => {
        if (slot !== b.active) return;
        setProgress(audio.currentTime);
        const dur = audio.duration;
        if (
          crossfade
          && !crossfadingRef.current
          && isFinite(dur)
          && dur > 0
          && dur - audio.currentTime <= crossfadeDuration
        ) {
          startCrossfade();
        }
      };
      const onDurationChange = () => {
        if (slot !== b.active) return;
        setDuration(audio.duration || 0);
      };
      const onEnded = () => {
        if (slot !== b.active) return;
        if (repeat === 'one') {
          audio.currentTime = 0;
          safePlay(slot).catch(() => {});
        } else {
          // If we're already crossfading, the active slot has been swapped or
          // is about to be — let that flow finish; otherwise advance.
          if (!crossfadingRef.current) next();
        }
      };
      const onError = () => {
        if (slot !== b.active) return;
        // During loadTrack's internal fallback loop, errors are handled
        // by tryLoadSrc — ignore them here to prevent visual stutter.
        if (fallbackInProgressRef.current) return;
        const code = audio.error?.code;
        if (audio.crossOrigin && !corsRetried[slot]) {
          reloadWithoutCors(slot);
          return;
        }
        const messages: Record<number, string> = {
          1: 'Загрузка прервана',
          2: 'Сетевая ошибка при загрузке трека',
          3: 'Не удалось декодировать аудио',
          4: 'Аудио формат не поддерживается',
        };
        const nativeMsg = audio.error?.message;
        const msg = messages[code ?? 0]
          ?? (nativeMsg ? `Ошибка: ${nativeMsg}` : 'Ошибка воспроизведения');
        setError(msg);
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
    };
    const offA = wireSlot('a');
    const offB = wireSlot('b');
    return () => { offA(); offB(); };
  }, [repeat, next, setProgress, setDuration, setError, crossfade, crossfadeDuration, startCrossfade, currentTrack, loadTrack]);

  const seek = useCallback((time: number) => {
    const b = getBundle();
    const audio = b.audios[b.active];
    audio.currentTime = time;
    setProgress(time);
  }, [setProgress]);

  // Respond to store's _seekToZero (triggered by the "previous" action
  // when progress > 3s — restarts current track).
  const seekToZeroRef = useRef(_seekToZero);
  useEffect(() => {
    if (_seekToZero !== seekToZeroRef.current) {
      seekToZeroRef.current = _seekToZero;
      const b = getBundle();
      const audio = b.audios[b.active];
      audio.currentTime = 0;
      setProgress(0);
    }
  }, [_seekToZero, setProgress]);

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
    const b = getBundle();
    const audio = b.audios[b.active];
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
      const dt = Math.min(64, now - lastAt);
      lastAt = now;
      const tau = band === 'bass' ? 110 : 90;
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
