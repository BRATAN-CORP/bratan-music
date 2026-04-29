import { useEffect, useRef, useCallback, useState } from 'react';
import { useMotionValue, type MotionValue } from 'motion/react';
import { usePlayerStore } from '@/store/player';
import { useSettingsStore } from '@/store/settings';
import { useAuthStore } from '@/store/auth';
import { useUiStore } from '@/store/ui';
import { api, ApiError } from '@/lib/api';

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

/**
 * iOS Safari / iOS PWA detection. Web Audio (`AudioContext` +
 * `createMediaElementSource`) suspends the moment the tab is hidden or
 * the home button is pressed, which silences playback because the audio
 * is routed through the graph. To get true background audio (P12) we
 * skip the graph entirely on iOS and let the `<audio>` element output
 * natively. We pay for that with no EQ + no visualiser on iOS, but the
 * trade is worth it — those features only animate while the user is
 * looking at the app anyway.
 */
function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  if (/iPad|iPhone|iPod/i.test(ua)) return true;
  // iPadOS 13+ reports as MacIntel; sniff via touch capability.
  const nav = navigator as Navigator & { maxTouchPoints?: number };
  return navigator.platform === 'MacIntel' && (nav.maxTouchPoints ?? 0) > 1;
}

function makeAudio(): HTMLAudioElement {
  const a = new Audio();
  a.preload = 'auto';
  a.crossOrigin = 'anonymous';
  // iOS Safari refuses to play audio inline (i.e. with the screen
  // unlocked while in background) unless this attribute is explicitly
  // set on the element.
  a.setAttribute('playsinline', '');
  // Hint to the browser that this is the primary media of the page so
  // Media Session UI surfaces (lock screen, command centre on iOS,
  // notification on Android) get the right metadata.
  a.setAttribute('x-webkit-airplay', 'allow');
  return a;
}

function getBundle(): AudioBundle {
  if (!bundle) {
    const audioA = makeAudio();
    const audioB = makeAudio();
    // Some mobile browsers (notably iOS Safari) are stricter about
    // background playback for detached <audio> elements than for ones
    // attached to the DOM. Mounting them off-screen lets the same
    // singleton survive across React unmounts while still satisfying
    // the "this is on the page" heuristic that iOS uses to decide
    // whether the lock-screen / control-center transport applies.
    if (typeof document !== 'undefined' && document.body) {
      const host = document.createElement('div');
      host.style.cssText =
        'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none;clip:rect(0 0 0 0);';
      host.setAttribute('aria-hidden', 'true');
      host.appendChild(audioA);
      host.appendChild(audioB);
      document.body.appendChild(host);
    }
    bundle = {
      audios: { a: audioA, b: audioB },
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

/**
 * Standalone seek used by surfaces that need a draggable timeline but do
 * not own the rest of the audio engine (e.g. MobileBottomDock). Mounting
 * the full `useAudioPlayer()` hook just to expose `seek` would spin up a
 * second copy of every effect (mediaSession, listeners, fallbacks, …) and
 * has been observed to cause flaky tap registration on iOS Safari when
 * three components race the same singleton's listeners. */
export function seekAudio(time: number): void {
  const b = getBundle();
  const audio = b.audios[b.active];
  if (!audio) return;
  audio.currentTime = time;
  usePlayerStore.getState().setProgress(time);
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

  // P12 — never wire up Web Audio on iOS. createMediaElementSource binds
  // the <audio> element's output to the graph permanently; once the
  // graph is suspended (which iOS does aggressively when the tab is
  // hidden or the device locks), there is no way to fall back to the
  // element's native output, so the user just hears silence in the
  // background. Leaving the bundle in `ctxFailed` mode causes
  // `setSlotGain` to write straight to `audio.volume` and the
  // visualiser hooks to gracefully render zeros — both already have
  // graph-less fallbacks.
  if (isIOS()) {
    b.ctxFailed = true;
    return b;
  }

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

    // Wire each slot: source -> gain -> filters[0]. Initial gain on the
    // active slot must reflect the user's persisted volume — graph is
    // built lazily on first play, after Zustand persist has rehydrated, so
    // hardcoding 1 here means the user hears the track at full volume
    // even though the slider says e.g. 30%. Read from the store directly
    // instead of going through the React closure (which may have a stale
    // value at graph-creation time).
    const ps = usePlayerStore.getState();
    const userVol = ps.muted ? 0 : ps.volume;
    for (const slot of ['a', 'b'] as const) {
      const src = ctx.createMediaElementSource(b.audios[slot]);
      const gain = ctx.createGain();
      gain.gain.value = slot === b.active ? userVol : 0;
      // Mirror to audio.volume so even crossfaded slots without graph
      // attention land on the right level.
      b.audios[slot].volume = slot === b.active ? userVol : 0;
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

/** Per-slot active ramp tracking. The previous implementation used a single
 *  global RAF id, so when both slots ramped in parallel during a crossfade
 *  the second call clobbered the first id and `cancelRamp` could only stop
 *  ONE of the two ramps. The leftover ramp would keep writing gain values
 *  into a slot we'd already loaded a fresh track into — that's exactly the
 *  "track plays but no sound" / "audio fades out unexpectedly" symptom. */
const activeRamps: Record<Slot, { raf: number; resolve: () => void } | null> = { a: null, b: null };

function cancelRamp(slot?: Slot) {
  const slots: Slot[] = slot ? [slot] : ['a', 'b'];
  for (const s of slots) {
    const ramp = activeRamps[s];
    if (ramp) {
      cancelAnimationFrame(ramp.raf);
      ramp.resolve();
      activeRamps[s] = null;
    }
  }
}

/**
 * Animate gain from `fromValue` to `toValue` over `durationMs` for the given
 * slot. Returns a promise that resolves when the ramp finishes (or is
 * cancelled). Safe to run two ramps in parallel — each slot tracks its own
 * RAF id.
 */
function rampGain(slot: Slot, fromValue: number, toValue: number, durationMs: number): Promise<void> {
  cancelRamp(slot);
  return new Promise((resolve) => {
    const start = performance.now();
    setSlotGain(slot, fromValue);
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const v = fromValue + (toValue - fromValue) * t;
      setSlotGain(slot, v);
      if (t >= 1) {
        activeRamps[slot] = null;
        resolve();
        return;
      }
      const ramp = activeRamps[slot];
      if (ramp) ramp.raf = requestAnimationFrame(tick);
    };
    activeRamps[slot] = { raf: requestAnimationFrame(tick), resolve };
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
  /** Track id we already attempted (and failed) to crossfade out of. While
   *  set, we won't retry crossfade on every timeupdate — otherwise a flaky
   *  network would make us spam fetchStreamUrl 30 times in the last 6
   *  seconds of a track. Cleared whenever currentTrack changes. */
  const crossfadeAttemptedRef = useRef<string | null>(null);

  const currentQualityRef = useRef<string>(tidalQuality);
  currentQualityRef.current = tidalQuality;
  const fallbackInProgressRef = useRef(false);

  /** When restoring from localStorage on page load, the audio element will
   *  fire `timeupdate` (currentTime=0) as soon as the new src loads, which
   *  would clobber the persisted progress with 0 before we get a chance to
   *  seek. While this ref is non-null we (a) treat 0-time updates as a
   *  no-op and (b) seek the audio to the saved position as soon as
   *  metadata loads. Cleared after the seek lands or playback advances. */
  const pendingRestoreProgressRef = useRef<number | null>(null);

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

    // ARM the restore-seek BEFORE we touch audio.src. If the page just
    // reloaded with a persisted progress, suppress the inevitable
    // timeupdate(0) that fires during initial load and remember the target
    // for the loadedmetadata listener to pick up. Tracks restarted by
    // setTrack/bumpStream/etc. always have progress=0, so this only kicks
    // in for the reload-restore path. The threshold is intentionally
    // permissive (>0.05s) — even half a second into a track should
    // restore so the user doesn't see "1:23 → 0:00" between rehydrate
    // and the audio element coming online.
    const initialStoreProgress = usePlayerStore.getState().progress;
    if (initialStoreProgress > 0.05) {
      pendingRestoreProgressRef.current = initialStoreProgress;
    }

    // Wait for any in-flight play promise before touching the audio element.
    if (b.playPromises[slot]) {
      try { await b.playPromises[slot]; } catch { /* ignore */ }
    }
    audio.pause();

    // Try each quality level in the fallback chain.
    let url: string | null = null;
    let loaded = false;
    let paywall = false;
    const MAX_RETRIES = 2;
    while (true) {
      if (loadingRef.current !== trackId) return;
      try {
        url = await fetchStreamUrl(track, effectiveQuality);
      } catch (err) {
        url = null;
        // 402 Payment Required → daily free-listen quota is exhausted.
        // Surface the global paywall and stop the fallback loop; trying
        // lower qualities won't help because the limit is per-track, not
        // per-quality. We bubble the flag out of the loop instead of
        // returning here so we still pause the audio cleanly below.
        if (err instanceof ApiError && err.status === 402) {
          paywall = true;
          break;
        }
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

    if (paywall) {
      useUiStore.getState().openSubscriptionPrompt(
        'Дневной лимит бесплатных прослушиваний исчерпан.',
      );
      setError(null);
      pause();
      return;
    }

    if (!loaded) {
      setError('Не удалось загрузить трек');
      pause();
      return;
    }

    b.loaded[slot] = trackId;
    ensureAudioGraph();
    {
      const ps = usePlayerStore.getState();
      setSlotGain(slot, ps.muted ? 0 : ps.volume);
    }
    setSlotGain(inactiveSlot(b), 0);
    if (b.ctx && b.ctx.state === 'suspended') {
      await b.ctx.resume().catch(() => {});
    }
    // If loadedmetadata never fired our seek (e.g. cached/already-decoded
    // src), execute it now while we have a known-good audio.duration.
    // Restart the seek if loadedmetadata's listener didn't get a chance
    // to set it (cached/decoded src). Don't clear the ref — onTimeUpdate
    // clears it once the seek actually lands. See onTimeUpdate for why.
    if (pendingRestoreProgressRef.current !== null) {
      const dur = audio.duration;
      if (isFinite(dur) && dur > 0) {
        audio.currentTime = Math.min(pendingRestoreProgressRef.current, dur);
      }
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
    // Whenever the playing track changes we re-arm the crossfade-attempt
    // gate so the next track is allowed to fade out exactly once.
    if (crossfadeAttemptedRef.current !== currentTrack.id) {
      crossfadeAttemptedRef.current = null;
    }

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
      // If a crossfade was in flight, cancel it: pause the incoming slot too
      // AND restore the active slot's gain to the user's volume — otherwise
      // the leftover ramp would have left it near 0 and the next play()
      // would resume into silence.
      if (crossfadingRef.current) {
        cancelRamp();
        crossfadingRef.current = false;
        b.crossfadingInto = null;
        safePause(inactiveSlot(b));
        setSlotGain(inactiveSlot(b), 0);
        const s = usePlayerStore.getState();
        setSlotGain(slot, s.muted ? 0 : s.volume);
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
    if (crossfadeAttemptedRef.current === currentTrack.id) return;
    const idx = queue.findIndex((t) => t.id === currentTrack.id);
    if (idx < 0) return;
    const nextTrack = queue[idx + 1];
    if (!nextTrack) return;

    crossfadeAttemptedRef.current = currentTrack.id;
    crossfadingRef.current = true;
    const incoming = inactiveSlot(b);
    const outgoing = b.active;
    b.crossfadingInto = incoming;
    const audio = b.audios[incoming];

    // Helper that fully tears the crossfade down. Called both on success
    // (after promotion) and on any error / external cancellation.
    const teardown = (promote: boolean) => {
      if (promote) {
        safePause(outgoing);
        b.loaded[outgoing] = null;
        setSlotGain(outgoing, 0);
        b.active = incoming;
      } else {
        // Failure: keep outgoing as active, kill the incoming attempt.
        safePause(incoming);
        b.loaded[incoming] = null;
        setSlotGain(incoming, 0);
        // Restore outgoing gain in case its ramp moved it.
        setSlotGain(outgoing, muted ? 0 : volume);
      }
      b.crossfadingInto = null;
      crossfadingRef.current = false;
    };

    try {
      const url = await fetchStreamUrl(nextTrack, tidalQuality);
      if (!crossfadingRef.current) return;

      if (b.playPromises[incoming]) {
        try { await b.playPromises[incoming]; } catch { /* ignore */ }
      }
      audio.pause();

      // Mute the incoming slot BEFORE we attach src. ensureAudioGraph()
      // creates GainNodes only on first call — on a brand-new session
      // with crossfade enabled the graph might not exist yet, in which
      // case setSlotGain falls back to writing audio.volume. We need the
      // 0 in place before play() so the user never hears the first 1-2
      // frames of the incoming track at full volume.
      ensureAudioGraph();
      setSlotGain(incoming, 0);

      // Wait for the incoming track to be playable before we hit play().
      // Without this, browsers can either delay play() until canplay fires
      // (so we ramp into silence) or the play() promise rejects on slow
      // networks ("track plays without sound" symptom).
      const loaded = await tryLoadSrc(audio, url);
      if (!crossfadingRef.current) { teardown(false); return; }
      if (!loaded) {
        teardown(false);
        return;
      }
      // Now that metadata is in we can safely seek to 0.
      try { audio.currentTime = 0; } catch { /* ignore */ }
      b.loaded[incoming] = nextTrack.id;

      if (b.ctx && b.ctx.state === 'suspended') {
        await b.ctx.resume().catch(() => {});
      }
      await safePlay(incoming);
      if (!crossfadingRef.current) { teardown(false); return; }

      const target = muted ? 0 : volume;
      const durMs = Math.max(500, crossfadeDuration * 1000);
      await Promise.all([
        rampGain(outgoing, target, 0, durMs),
        rampGain(incoming, 0, target, durMs),
      ]);
      if (!crossfadingRef.current) return; // got cancelled mid-ramp
      teardown(true);
      // Tell the store the playing track has changed without triggering a
      // reload. The load effect detects 'slot already loaded' and skips.
      setTrack(nextTrack);
    } catch (err) {
      console.warn('[crossfade] failed, falling back to hard switch', err);
      teardown(false);
    }
  }, [currentTrack, queue, volume, muted, crossfadeDuration, setTrack, tidalQuality]);

  // Time updates + ended + error + crossfade trigger.
  useEffect(() => {
    const b = getBundle();
    const wireSlot = (slot: Slot) => {
      const audio = b.audios[slot];
      const onTimeUpdate = () => {
        if (slot !== b.active) return;
        // Restore-seek gating: keep suppressing timeupdates until the
        // audio element actually lands at the persisted target. Some
        // browsers fire timeupdate(0) AFTER we set currentTime=target if
        // the seek hasn't completed yet (data not buffered) — clearing
        // the ref unconditionally inside loadedmetadata used to let
        // those zero-updates clobber persisted progress, which is what
        // the user saw as "timeline shows 1:23 then snaps back to 0:00".
        const target = pendingRestoreProgressRef.current;
        if (target !== null) {
          // Within 1.5s of the requested target → seek has landed.
          if (Math.abs(audio.currentTime - target) > 1.5) return;
          pendingRestoreProgressRef.current = null;
        }
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
      const onLoadedMetadata = () => {
        if (slot !== b.active) return;
        const target = pendingRestoreProgressRef.current;
        if (target !== null && isFinite(audio.duration) && audio.duration > 0) {
          // Kick off the seek but DON'T clear the ref here — onTimeUpdate
          // clears it only once audio.currentTime actually reaches the
          // target. Browsers can fire timeupdate(0) after the seek call
          // when data isn't buffered yet; if we cleared the ref now those
          // zero updates would clobber the persisted progress.
          audio.currentTime = Math.min(target, audio.duration);
        }
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
      audio.addEventListener('loadedmetadata', onLoadedMetadata);
      audio.addEventListener('ended', onEnded);
      audio.addEventListener('error', onError);
      return () => {
        audio.removeEventListener('timeupdate', onTimeUpdate);
        audio.removeEventListener('durationchange', onDurationChange);
        audio.removeEventListener('loadedmetadata', onLoadedMetadata);
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

  // P12 — when the tab comes back from being hidden (browser switched
  // back, screen unlocked, etc.), the AudioContext on Chromium-based
  // platforms is often left in `suspended` state. If the user was
  // mid-playback the <audio> element keeps decoding but there's no
  // signal reaching speakers. Force-resume on visibility recovery and
  // also on any media event that fires while we're trying to play.
  useEffect(() => {
    const resumeIfNeeded = () => {
      const b = getBundle();
      if (b.ctx && b.ctx.state === 'suspended') {
        b.ctx.resume().catch(() => {});
      }
      // On iOS, where we deliberately skipped Web Audio, just nudge
      // the active <audio> element back into play state if the store
      // says it should be playing — Safari pauses on visibility hide.
      if (usePlayerStore.getState().isPlaying) {
        const audio = b.audios[b.active];
        if (audio.paused && audio.src) {
          audio.play().catch(() => {});
        }
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') resumeIfNeeded();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', resumeIfNeeded);
    window.addEventListener('pageshow', resumeIfNeeded);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', resumeIfNeeded);
      window.removeEventListener('pageshow', resumeIfNeeded);
    };
  }, []);

  // Mount-time only: aggressively revoke any seek handlers that
  // earlier builds may have registered. iOS Safari caches the
  // MediaSession action set across reloads and even PWA installs;
  // a stale `seekbackward`/`seekforward` registration from before
  // is what keeps the iOS Now-Playing widget rendering ⏪10s/⏩10s
  // instead of ⏮/⏭. Setting them to `null` is the spec-compliant
  // revoke. We do this ONCE in its own effect — separate from the
  // track-scoped registration loop below — so iOS Safari's
  // internal heuristic never sees interleaved set/null calls for
  // seek actions during a track transition (which empirically
  // re-arms the seek layout on iOS 17+).
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    const ms = navigator.mediaSession;
    for (const action of ['seekbackward', 'seekforward', 'seekto'] as const) {
      try { ms.setActionHandler(action, null); } catch { /* ignore */ }
    }
  }, []);

  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    const ms = navigator.mediaSession;
    const store = () => usePlayerStore.getState();
    // Strict-minimum handler set for iOS Now-Playing. iOS picks the
    // two transport buttons next to play/pause from the *current*
    // action set: registering `seekbackward`/`seekforward` (or
    // leaving them registered from a previous track) makes iOS
    // prefer the 10-second skip layout (⏪/⏩) over previous/next
    // (⏮/⏭). We re-register prev/next on every track change so
    // even if iOS's per-session action map drifts, the next track
    // boundary always rebuilds the correct set. Seek* handlers are
    // intentionally never set here — only the dedicated mount-time
    // null-revoke effect above touches them.
    const handlers: Array<[MediaSessionAction, MediaSessionActionHandler]> = [
      ['play', () => store().play()],
      ['pause', () => store().pause()],
      ['previoustrack', () => store().previous()],
      ['nexttrack', () => store().nextManual()],
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
  }, [currentTrack?.id]);

  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    if (!('setPositionState' in navigator.mediaSession)) return;
    const b = getBundle();
    const audio = b.audios[b.active];
    const dur = audio.duration;
    if (!dur || !isFinite(dur)) return;
    try {
      // Pin playbackRate to 1 — variable playbackRate combined with
      // a finite duration is one of the signals iOS Safari uses to
      // classify the stream as "podcast-shaped" and surface the
      // 10-second skip transport buttons.
      navigator.mediaSession.setPositionState({
        duration: dur,
        position: Math.min(progress, dur),
        playbackRate: 1,
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
      // Asymmetric smoothing: the attack (when the new value is louder than
      // the smoothed one) tracks the kick fast for a snappy, kick-locked
      // pulse, while the release (decay back to silence) lingers a touch
      // so the glow doesn't strobe on every sample. Asymmetry > pure tau
      // for music: kicks read as *visible* but the glow stays smooth.
      const attackTau = band === 'bass' ? 25 : 30;
      const releaseTau = band === 'bass' ? 90 : 80;
      const tau = value > last ? attackTau : releaseTau;
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

/**
 * Bass-band visualisation signals for the fullscreen player (П6). The
 * existing `useAnalyserAmplitude(_, 'bass')` returns a single smoothed
 * amplitude — visually that maps to a near-static halo because the
 * smoothed value moves slowly and clings to a high baseline whenever
 * the track has any sustained bass content.
 *
 * For richer visuals we want two signals:
 *
 *   - `amp` — fast-attack / slow-release smoothed bass amplitude, same
 *     as before but tuned to give a wider dynamic range (we apply a
 *     square-rooted gain in the consumer).
 *   - `kick` — a transient detector. We track a slow baseline of the
 *     bass level and trigger an envelope every time the instantaneous
 *     amplitude jumps above it. The envelope has near-instant attack
 *     and ~280ms release, so visible kicks look like flashes rather
 *     than a constantly-on glow.
 *
 * Both signals are bass-band only (30–180 Hz). The hook re-renders at
 * the animation frame rate, matching the cost profile of
 * useAnalyserAmplitude.
 */
export function useBassPulse(active: boolean): { amp: number; kick: number } {
  const [state, setState] = useState({ amp: 0, kick: 0 });
  useEffect(() => {
    if (!active) {
      setState({ amp: 0, kick: 0 });
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
    let smoothed = 0;
    let baseline = 0;
    let kickEnv = 0;
    let lastAt = performance.now();
    const tick = (now: number) => {
      analyser.getByteFrequencyData(buffer);
      let sum = 0;
      let count = 0;
      for (let i = bassLo; i < bassHi && i < buffer.length; i++) {
        sum += (buffer[i] ?? 0) / 255;
        count++;
      }
      const raw = count > 0 ? sum / count : 0;
      const dt = Math.min(64, now - lastAt);
      lastAt = now;
      // Asymmetric smoothing for the visible amplitude.
      const attackTau = raw > smoothed ? 25 : 90;
      smoothed = smoothed + (raw - smoothed) * (1 - Math.exp(-dt / attackTau));
      // Slow baseline tracks the average bass level over ~600ms, so we
      // can detect spikes above it as transients.
      baseline = baseline + (raw - baseline) * (1 - Math.exp(-dt / 600));
      const transient = Math.max(0, smoothed - baseline - 0.04);
      const target = Math.min(1, transient * 6);
      // Instant attack to the new target if it's higher, then a slow
      // exponential decay back toward zero.
      if (target > kickEnv) kickEnv = target;
      else kickEnv = kickEnv + (0 - kickEnv) * (1 - Math.exp(-dt / 280));
      setState({ amp: smoothed, kick: kickEnv });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active]);
  return state;
}

/**
 * Smooth progress + buffered-range visualisation values driven from the
 * active audio element via requestAnimationFrame. The store's `progress`
 * still updates on `timeupdate` events (every 200–300ms in most browsers,
 * jerky on short tracks), and remains the source of truth for things that
 * read time as a number (lyrics auto-scroll, time text, mediaSession).
 *
 * UI surfaces that visualise the playhead — the mini-player and
 * fullscreen-player progress bars — should drive their `width` from the
 * MotionValues returned here so the bar slides at full frame rate without
 * forcing a React re-render every animation frame.
 *
 * `bufferedSeconds` is the end of the contiguous buffered range covering
 * the current playback position (so the gray bar represents "downloaded
 * up to here from where you are"), and falls back to the furthest end of
 * any buffered range if no range covers the playhead yet.
 */
export function usePlaybackVisuals(): {
  progressSeconds: MotionValue<number>;
  bufferedSeconds: MotionValue<number>;
  durationSeconds: MotionValue<number>;
} {
  // Seed motion values from the persisted store so the very first
  // paint after a reload already shows the saved progress / duration
  // instead of a 0 % bar that fills in once audio.currentTime catches
  // up. Without this seed the bar visibly snaps from 0 → X% the moment
  // the seek lands, which reads as "timeline reset to 0:00".
  const initialStore = usePlayerStore.getState();
  const progressSeconds = useMotionValue(initialStore.progress);
  const bufferedSeconds = useMotionValue(0);
  const durationSeconds = useMotionValue(initialStore.duration);

  useEffect(() => {
    let raf = 0;
    // Wall-clock time of the previous tick (used for predicting the
    // playhead between currentTime samples).
    let lastTickAt = performance.now();
    // Last value we wrote to progressSeconds. Initialised lazily on the
    // first frame where we actually see audio.currentTime.
    let displayed = progressSeconds.get();
    let initialised = false;

    const tick = () => {
      const b = getBundle();
      const audio = b.audios[b.active];
      const now = performance.now();
      const dt = (now - lastTickAt) / 1000;
      lastTickAt = now;

      if (audio) {
        const realT = audio.currentTime;
        const dur = audio.duration;
        if (isFinite(dur) && dur > 0) durationSeconds.set(dur);

        // Reload-restore guard: while audio.currentTime is still parked
        // at 0 because the seek to the persisted progress hasn't landed
        // yet, mirror store.progress instead so the bar (and the
        // visuals derived from it) don't flash 0:00 between rehydrate
        // and the actual seek arriving. Once playback advances or the
        // seek completes, audio.currentTime takes over normally.
        if (audio.paused && realT < 0.05) {
          const storeProgress = usePlayerStore.getState().progress;
          if (storeProgress > 0.05) {
            displayed = storeProgress;
            const dur2 = audio.duration;
            if (isFinite(dur2) && dur2 > 0) {
              displayed = Math.max(0, Math.min(displayed, dur2));
            } else {
              const storeDuration = usePlayerStore.getState().duration;
              if (storeDuration > 0) durationSeconds.set(storeDuration);
            }
            progressSeconds.set(displayed);
            // Skip the prediction/buffered branches this frame — they'd
            // overwrite the restored value with realT (= 0).
            raf = requestAnimationFrame(tick);
            return;
          }
        }

        if (!initialised) {
          displayed = realT;
          initialised = true;
        } else if (audio.paused) {
          // While paused, snap directly — no interpolation needed.
          displayed = realT;
        } else {
          // Predict the playhead by extrapolating wall-clock dt over the
          // last displayed time. `audio.currentTime` only updates at the
          // browser's `timeupdate` cadence (often 200–300 ms, sometimes
          // worse on short tracks where the bar otherwise visibly jumps).
          // We integrate dt at full rAF rate so the bar slides smoothly,
          // and softly ease the prediction toward the real currentTime to
          // correct any drift. Large drifts (> 0.25 s) only happen on
          // seeks/big stalls — snap in that case so we don't slow-roll
          // into the new position.
          const rate = audio.playbackRate || 1;
          const predicted = displayed + dt * rate;
          const drift = realT - predicted;
          if (Math.abs(drift) > 0.25) {
            displayed = realT;
          } else {
            // Soft pull toward truth (~6 % per frame at 60 fps converges
            // in under a second; imperceptible visually).
            displayed = predicted + drift * 0.06;
          }
        }

        if (isFinite(dur) && dur > 0) {
          displayed = Math.max(0, Math.min(displayed, dur));
        } else {
          displayed = Math.max(0, displayed);
        }
        progressSeconds.set(displayed);

        // Walk the buffered TimeRanges and pick the end of the range that
        // currently contains the playhead. If we're between ranges (rare —
        // happens after a seek before the new range fills in) fall back
        // to the furthest end so the gray bar at least never jumps
        // backwards visually.
        const ranges = audio.buffered;
        let bufEnd = 0;
        for (let i = 0; i < ranges.length; i++) {
          const start = ranges.start(i);
          const end = ranges.end(i);
          if (start <= realT && realT <= end) {
            bufEnd = end;
            break;
          }
          if (end > bufEnd) bufEnd = end;
        }
        bufferedSeconds.set(bufEnd);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [progressSeconds, bufferedSeconds, durationSeconds]);

  return { progressSeconds, bufferedSeconds, durationSeconds };
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
