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
  /**
   * Distinguishes auto-crossfade (natural end-of-track fade started by
   * `startCrossfade`, during which `store.currentTrack` is still the
   * outgoing one until the ramp completes) from manual crossfade
   * (user pressed next / picked a different track; `store.currentTrack`
   * has already updated and `b.active` is swapped to the incoming slot
   * as soon as the incoming stream starts playing so the timeline /
   * seek / media-session surfaces all address the NEW track).
   *
   * - `'auto'` → triggered from `onTimeUpdate` approaching `duration`.
   * - `'manual'` → triggered from the track-change effect in reaction
   *   to a user-driven `setTrack`.
   */
  crossfadeKind: 'auto' | 'manual' | null;
  playPromises: Record<Slot, Promise<void> | null>;
  /**
   * Last `audio.currentTime` we observed on the most recent
   * `timeupdate` for each slot. Used to detect non-playback jumps
   * (seeks, track reloads) so the end-of-track auto-crossfade trigger
   * does not fire on a user scrub into the final `crossfadeDuration`
   * seconds.
   */
  lastRealT: Record<Slot, number>;
  /**
   * Wall-clock timestamp (`performance.now()`) of the most recent
   * user-initiated seek on each slot. Used as a hard gate against the
   * end-of-track auto-crossfade trigger so a scrub INTO the final
   * `crossfadeDuration` seconds doesn't immediately hijack into a
   * fade-to-next-track. The previous "set lastRealT to seek target"
   * approach was actively counter-productive: `isNaturalProgression`
   * treats SMALL deltas as natural, so writing the seek target into
   * `lastRealT` made the very next timeupdate (with realT ≈ target)
   * look like a 0-delta natural step and immediately fire the auto-
   * crossfade. The wall-clock guard avoids that whole class of bug.
   */
  lastSeekAt: Record<Slot, number>;
  /**
   * Track id whose end-of-track auto-crossfade has already been
   * attempted in the current "play this track" cycle. Single-shot
   * gate so a flaky network failure mid-fade doesn't busy-loop the
   * trigger every timeupdate. Cleared on track change AND whenever
   * the user manually aborts an auto-crossfade by scrubbing — that
   * second case is what ensures playing through to the natural end
   * a second time DOES fade out (the previous code left this poison
   * in place, so the second pass played silently to completion).
   *
   * Lives on the bundle (rather than a React ref) so module-scope
   * helpers like `seekAudio` can clear it without re-mounting the
   * hook.
   */
  crossfadeAttemptedTrackId: string | null;
}

/** How long after a user seek to keep the auto-end-of-track crossfade
 *  trigger suppressed. Long enough that the post-seek timeupdate(s)
 *  with stale `currentTime` and the immediate seek-resolution bursts
 *  can't trip the natural-progression heuristic, short enough that
 *  the trigger arms again well before a typical track ends. */
const AUTO_CROSSFADE_SEEK_GUARD_MS = 750;

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
      crossfadeKind: null,
      playPromises: { a: null, b: null },
      lastRealT: { a: 0, b: 0 },
      lastSeekAt: { a: 0, b: 0 },
      crossfadeAttemptedTrackId: null,
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
  // Cancel any in-flight END-OF-TRACK crossfade: the user is actively
  // scrubbing the current track so the auto-advance-into-next-track
  // behaviour would hijack the gesture into silent fade-to-new-song.
  // Manual crossfades (user already chose a new track) are intentional
  // transitions and are left running.
  if (b.crossfadingInto !== null && b.crossfadeKind === 'auto') {
    abortAutoCrossfade(b);
  }
  const currentId = usePlayerStore.getState().currentTrack?.id ?? null;
  const slot = ownerSlotFor(b, currentId);
  const audio = b.audios[slot];
  if (!audio) return;
  // Update the store BEFORE touching audio.currentTime so the
  // spurious-reset gate in onTimeUpdate doesn't mistake a seek-to-0
  // for an unwanted reset. See the gate in `wireSlot`'s onTimeUpdate.
  usePlayerStore.getState().setProgress(time);
  // Stamp the wall-clock seek time so the auto-crossfade trigger in
  // onTimeUpdate stays gated for `AUTO_CROSSFADE_SEEK_GUARD_MS` after
  // the scrub. Also keep `lastRealT` synced so `isNaturalProgression`
  // sees a 0-delta on the very next tick (no spurious "I jumped 145s
  // forward" detection that would mark playback as unnatural for
  // non-crossfade purposes — the seek-time guard above is the
  // authoritative crossfade gate).
  b.lastRealT[slot] = time;
  b.lastSeekAt[slot] = performance.now();
  audio.currentTime = time;
}

/**
 * Teardown helper for canceling an auto end-of-track crossfade (e.g.
 * because the user started scrubbing). Restores the outgoing slot to
 * full gain, silences + unloads the incoming preload, and clears all
 * crossfade state so a later natural end can re-attempt.
 */
function abortAutoCrossfade(b: AudioBundle): void {
  cancelRamp();
  // Reset the once-per-track gate so playing the same track through to
  // the end again (e.g. user seeks back to mid-track and lets it run
  // out a second time) re-arms the auto-crossfade. Without this, the
  // second pass would play out silently — the store still says the
  // crossfade has been "attempted" so `startCrossfade` early-returns.
  b.crossfadeAttemptedTrackId = null;
  const incoming = b.crossfadingInto;
  if (!incoming) {
    b.crossfadeKind = null;
    return;
  }
  const outgoing = b.active;
  // Silence and unload the preload.
  try { b.audios[incoming].pause(); } catch { /* ignore */ }
  b.loaded[incoming] = null;
  setSlotGain(incoming, 0);
  // Restore outgoing gain to the user's chosen volume.
  const ps = usePlayerStore.getState();
  setSlotGain(outgoing, ps.muted ? 0 : ps.volume);
  b.crossfadingInto = null;
  b.crossfadeKind = null;
}

function reloadWithoutCors(slot: Slot) {
  const b = getBundle();
  const audio = b.audios[slot];
  if (corsRetried[slot] || !audio.src) return;
  corsRetried[slot] = true;
  // Capture the user's current playback position BEFORE the reload —
  // `audio.load()` rewinds currentTime to 0 unconditionally, so we
  // need to seek back here. Without this, a CORS-retry triggered
  // mid-playback (or on the first user-gesture play after page
  // reload, when the original CORS-anonymous fetch fails) would lose
  // the user's place even though `store.progress` correctly survives
  // (the spurious-reset gate in onTimeUpdate keeps it).
  const savedTime = audio.currentTime;
  const savedStoreProgress = usePlayerStore.getState().progress;
  const restoreTarget = Math.max(savedTime, savedStoreProgress);
  const src = audio.src;
  audio.crossOrigin = null;
  audio.src = '';
  audio.src = src;
  audio.load();
  if (restoreTarget > 0.5) {
    const onCanPlay = () => {
      audio.removeEventListener('canplay', onCanPlay);
      if (isFinite(audio.duration) && audio.duration > 0) {
        try {
          audio.currentTime = Math.min(restoreTarget, audio.duration);
        } catch { /* ignore */ }
      }
    };
    audio.addEventListener('canplay', onCanPlay, { once: true });
  }
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
 * Which slot currently "owns" the display surfaces (timeline, duration,
 * seek target) for the given track id. Normally this is `b.active`, but
 * during a crossfade — especially a manual one where the store has
 * already switched to the new track but the audio graph is still
 * ramping — it's whichever slot holds the matching loaded track id.
 *
 * Falls back to `b.active` when nothing matches so callers never see a
 * null. When two slots report the same id (transient state during
 * slot promotion) prefer the already-active one.
 */
function ownerSlotFor(b: AudioBundle, trackId: string | null | undefined): Slot {
  if (!trackId) return b.active;
  if (b.loaded[b.active] === trackId) return b.active;
  const other = inactiveSlot(b);
  if (b.loaded[other] === trackId) return other;
  return b.active;
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
  // The "attempted-once" gate that prevents busy-looping the crossfade
  // trigger every timeupdate (e.g. on a flaky network) lives on the
  // bundle as `b.crossfadeAttemptedTrackId` so module-scope helpers
  // can clear it too — see `abortAutoCrossfade`.
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

  /**
   * What the preload effect has (or is about to) buffer into the inactive
   * slot. Kept separate from `b.loaded[slot]` because a preloaded-but-
   * not-yet-played slot must NOT trick the track-change effect into
   * auto-promoting the inactive slot (which would hard-switch into the
   * next track without a crossfade). startCrossfade (and soft-switch)
   * consult this ref to decide whether they can skip the fetch+load step.
   */
  const preloadedIncomingRef = useRef<{ slot: Slot; trackId: string } | null>(null);

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

  /**
   * Manual crossfade — the user picked a different track (clicked next,
   * previous, a queue entry, a search result, etc.) so `store.currentTrack`
   * has already changed to the new target. Unlike `startCrossfade`
   * (natural end-of-track), this flow updates `b.active` as soon as the
   * incoming stream is playable so every display surface (timeline,
   * seek, duration text, media-session position) immediately addresses
   * the NEW track — the old track keeps playing in the background while
   * its gain ramps to zero, but the user sees the new track's timeline
   * starting at 0:00 from the moment they pressed next.
   *
   * Falls back to a hard `loadTrack` if the incoming stream fails to
   * load through the full quality fallback chain.
   */
  const softSwitchTo = useCallback(async (target: { id: string; source?: string; title: string; artist: string; coverUrl?: string }) => {
    const b = getBundle();

    // If we're already crossfading (natural end-of-track fade kicked in
    // and the user clicked next mid-ramp, or another manual switch is
    // still running) cancel the prior ramp so the new target takes
    // over cleanly.
    cancelRamp();

    // Clear any leftover restore-seek intent from the previous track.
    // Otherwise the onTimeUpdate restore-gate on the INCOMING slot
    // would keep setProgress suppressed (thinking the previous track's
    // unfinished seek is still pending) and the timeline would appear
    // stuck at the old position while the new track plays.
    pendingRestoreProgressRef.current = null;

    const incoming = inactiveSlot(b);
    const outgoing = b.active;
    const audio = b.audios[incoming];

    b.crossfadingInto = incoming;
    b.crossfadeKind = 'manual';
    crossfadingRef.current = true;
    b.crossfadeAttemptedTrackId = target.id;
    loadingRef.current = target.id;
    fallbackInProgressRef.current = true;

    const tgt = muted ? 0 : volume;
    const durMs = Math.max(500, crossfadeDuration * 1000);
    const rampStart = performance.now();

    // Kick off the OUTGOING fade-out RIGHT NOW, before we touch the
    // network. The whole point of "smooth switching" is that the
    // moment the user picks a new track, the audible transition
    // begins — not "begins after we've fetched a stream URL, decoded
    // the first frame and resolved play()". The previous behaviour
    // kept the outgoing slot at full volume during URL fetch + load
    // (often 1–3s on cellular), then flipped through a ramp; the
    // user heard a hard cut in the worst cases. Starting here makes
    // the outgoing fade independent of the incoming load latency.
    setSlotGain(outgoing, tgt);
    const outgoingRamp = rampGain(outgoing, tgt, 0, durMs);

    const teardown = (success: boolean) => {
      if (success) {
        safePause(outgoing);
        b.loaded[outgoing] = null;
        setSlotGain(outgoing, 0);
        // `b.active` was already swapped to `incoming` before the ramp.
      } else {
        // Failure: cancel any in-flight ramps, silence + unload the
        // failed incoming preload, restore outgoing as the sole active
        // slot at full volume so the caller's fallback (hard loadTrack)
        // doesn't briefly play into a half-faded outgoing.
        cancelRamp();
        safePause(incoming);
        b.loaded[incoming] = null;
        setSlotGain(incoming, 0);
        b.active = outgoing;
        setSlotGain(outgoing, muted ? 0 : volume);
      }
      b.crossfadingInto = null;
      b.crossfadeKind = null;
      crossfadingRef.current = false;
      fallbackInProgressRef.current = false;
    };

    // Walk the quality fallback chain — same chain loadTrack uses — so a
    // missing HI_RES_LOSSLESS on this particular track falls through to
    // LOSSLESS → HIGH → LOW instead of aborting the crossfade.
    let effectiveQuality: string = currentQualityRef.current;
    let url: string | null = null;
    let loaded = false;
    const MAX_RETRIES = 2;
    try {
      while (true) {
        if (loadingRef.current !== target.id) { teardown(false); return; }
        try {
          url = await fetchStreamUrl(target, effectiveQuality);
        } catch (err) {
          url = null;
          if (err instanceof ApiError && err.status === 402) {
            teardown(false);
            useUiStore.getState().openSubscriptionPrompt(
              'Дневной лимит бесплатных прослушиваний исчерпан.',
            );
            setError(null);
            pause();
            return;
          }
        }
        if (loadingRef.current !== target.id) { teardown(false); return; }
        if (url) {
          if (b.playPromises[incoming]) {
            try { await b.playPromises[incoming]; } catch { /* ignore */ }
          }
          audio.pause();
          corsRetried[incoming] = false;
          audio.crossOrigin = 'anonymous';
          ensureAudioGraph();
          setSlotGain(incoming, 0);
          for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
            if (loadingRef.current !== target.id) { teardown(false); return; }
            const ok = await tryLoadSrc(audio, url);
            if (ok) { loaded = true; break; }
            if (attempt < MAX_RETRIES) {
              await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
            }
          }
          if (loaded) break;
        }
        const nextQ = getNextFallbackQuality(effectiveQuality);
        if (!nextQ) break;
        currentQualityRef.current = nextQ;
        effectiveQuality = nextQ;
      }
      if (loadingRef.current !== target.id) { teardown(false); return; }
      if (!loaded) {
        // Couldn't preload in inactive slot — fall back to hard switch
        // via the regular loadTrack path (which also drives a fresh
        // fallback chain on the active slot).
        teardown(false);
        fallbackInProgressRef.current = false;
        loadTrack(target);
        return;
      }

      try { audio.currentTime = 0; } catch { /* ignore */ }
      b.loaded[incoming] = target.id;
      b.lastRealT[incoming] = 0;
      // The incoming slot has never been seeked — make sure the auto-
      // crossfade trigger isn't artificially gated on it once it
      // becomes the active slot below.
      b.lastSeekAt[incoming] = 0;

      if (b.ctx && b.ctx.state === 'suspended') {
        await b.ctx.resume().catch(() => {});
      }

      // Swap ACTIVE before play — so timeupdate / durationchange /
      // mediaSession-position reads on the incoming slot immediately
      // drive the store. The outgoing slot is suppressed inside each
      // listener via the owner-slot guard.
      b.active = incoming;
      fallbackInProgressRef.current = false;

      // Belt-and-suspenders: audio.load() inside tryLoadSrc should have
      // reset currentTime to 0, but some browsers preserve the last
      // seek on a pre-used slot. Setting it again right before play()
      // guarantees the new track starts from 0 regardless of what the
      // slot was doing before.
      try { audio.currentTime = 0; } catch { /* ignore */ }

      await safePlay(incoming);
      if (!crossfadingRef.current) { teardown(false); return; }

      // One more currentTime=0 after play() resolved — some engines
      // (notably older Safari) reset currentTime on the first
      // play-invocation to whatever was cached, even if we set it to 0
      // moments earlier. This is the last line of defence before the
      // ramp starts producing audible output from the incoming track.
      if (audio.currentTime > 0.5) {
        try { audio.currentTime = 0; } catch { /* ignore */ }
      }

      // Ramp the incoming slot in over whatever portion of the
      // crossfade window is left. On a fast network or a preloaded
      // queue this is the full `durMs`; on slow networks it might be
      // significantly shorter — that's intentional, the user already
      // heard the outgoing fade out and now wants the new track to be
      // audible quickly. We never go below 300ms so even on terrible
      // networks the new track still has a perceivable swell instead
      // of a pop.
      const elapsed = performance.now() - rampStart;
      const remaining = Math.max(300, durMs - elapsed);
      setSlotGain(incoming, 0);
      const incomingRamp = rampGain(incoming, 0, tgt, remaining);

      await Promise.all([outgoingRamp, incomingRamp]);
      if (!crossfadingRef.current) return;
      teardown(true);
    } catch (err) {
      console.warn('[soft-switch] failed, falling back to hard load', err);
      teardown(false);
      loadTrack(target);
    }
  }, [muted, volume, crossfadeDuration, pause, setError, loadTrack]);

  // Reload when track id changes (or stream version bumped).
  const lastStreamVersionRef = useRef(streamVersion);
  useEffect(() => {
    if (!currentTrack) return;
    const versionBumped = lastStreamVersionRef.current !== streamVersion;
    lastStreamVersionRef.current = streamVersion;
    const b = getBundle();
    // Whenever the playing track changes we re-arm the crossfade-attempt
    // gate so the next track is allowed to fade out exactly once.
    if (b.crossfadeAttemptedTrackId !== currentTrack.id) {
      b.crossfadeAttemptedTrackId = null;
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

      // Soft-switch path — user manually changed track (clicked next /
      // previous / a queue item / search result) while crossfade is
      // enabled AND we have something actively playing to fade out of.
      // Never soft-switch on a stream-version bump: that's a forced
      // refetch (override added/removed) and the user expects the same
      // track to restart from the new stream, not to cross-mix with
      // its old copy.
      const outgoingLoaded = b.loaded[b.active];
      const canSoftSwitch =
        crossfade
        && !versionBumped
        && outgoingLoaded !== null
        && outgoingLoaded !== currentTrack.id
        && isPlaying
        && !b.audios[b.active].paused;

      if ('mediaSession' in navigator) {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: currentTrack.title,
          artist: currentTrack.artist,
          artwork: currentTrack.coverUrl
            ? [{ src: currentTrack.coverUrl, sizes: '512x512', type: 'image/jpeg' }]
            : [],
        });
      }

      if (canSoftSwitch) {
        softSwitchTo(currentTrack);
        return;
      }

      // Hard switch path: cancel any in-flight crossfade and reload on
      // the active slot. Used on first play, on a paused → play track
      // change, when crossfade is disabled, and when soft-switch's
      // own preload failed and fell back here.
      cancelRamp();
      crossfadingRef.current = false;
      b.crossfadingInto = null;
      b.crossfadeKind = null;
      safePause(inactiveSlot(b));
      b.loaded[inactiveSlot(b)] = null;
      if (versionBumped) b.loaded[b.active] = null;
      loadTrack(currentTrack);
    }
  }, [currentTrack, loadTrack, streamVersion, crossfade, isPlaying, softSwitchTo, tidalQuality]);

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
   * seconds of the end, ramp OUTGOING down immediately and (in parallel)
   * bring the next queue track up in the inactive slot.
   *
   * Key difference from the previous implementation: the outgoing ramp
   * starts IMMEDIATELY, before the incoming stream URL is fetched. This
   * guarantees the user hears a fade-out even on slow networks. The
   * incoming slot ramps in from 0 → target for whatever portion of the
   * crossfade window is left by the time it is ready to play; in the
   * common case where the next track is already preloaded (see the
   * pre-load effect), both sides ramp fully in parallel.
   */
  const startCrossfade = useCallback(async () => {
    const b = getBundle();
    if (crossfadingRef.current) return;
    if (!currentTrack) return;
    if (b.crossfadeAttemptedTrackId === currentTrack.id) return;
    const idx = queue.findIndex((t) => t.id === currentTrack.id);
    if (idx < 0) return;
    const nextTrack = queue[idx + 1];
    if (!nextTrack) return;

    b.crossfadeAttemptedTrackId = currentTrack.id;
    crossfadingRef.current = true;
    const incoming = inactiveSlot(b);
    const outgoing = b.active;
    b.crossfadingInto = incoming;
    b.crossfadeKind = 'auto';
    const audio = b.audios[incoming];
    const target = muted ? 0 : volume;
    const durMs = Math.max(500, crossfadeDuration * 1000);
    const rampStart = performance.now();

    const teardown = (promote: boolean) => {
      if (promote) {
        safePause(outgoing);
        b.loaded[outgoing] = null;
        setSlotGain(outgoing, 0);
        b.active = incoming;
      } else {
        safePause(incoming);
        b.loaded[incoming] = null;
        setSlotGain(incoming, 0);
        setSlotGain(outgoing, muted ? 0 : volume);
      }
      b.crossfadingInto = null;
      b.crossfadeKind = null;
      crossfadingRef.current = false;
    };

    // Kick off the OUTGOING fade-out immediately. This is the critical
    // fix for "last 12s don't play" — we no longer wait for fetchStreamUrl
    // or canplay before starting the audible fade.
    setSlotGain(outgoing, target);
    const outgoingRamp = rampGain(outgoing, target, 0, durMs);

    // Preloaded fast path: if the pre-load effect has already buffered
    // nextTrack into the inactive slot, we can start playing + ramping
    // in immediately without a fetch. We track this via a separate ref
    // so the track-change effect's "promote preloaded slot" branch
    // doesn't mistake the preload for a completed soft-switch.
    const preloaded =
      preloadedIncomingRef.current?.trackId === nextTrack.id
      && preloadedIncomingRef.current?.slot === incoming
      && audio.src !== ''
      && audio.readyState >= 2;

    const incomingRamp = (async () => {
      try {
        if (!preloaded) {
          const url = await fetchStreamUrl(nextTrack, tidalQuality);
          if (!crossfadingRef.current) return;
          if (b.playPromises[incoming]) {
            try { await b.playPromises[incoming]; } catch { /* ignore */ }
          }
          audio.pause();
          ensureAudioGraph();
          setSlotGain(incoming, 0);
          const ok = await tryLoadSrc(audio, url);
          if (!crossfadingRef.current || !ok) return;
          try { audio.currentTime = 0; } catch { /* ignore */ }
          b.loaded[incoming] = nextTrack.id;
          b.lastRealT[incoming] = 0;
          b.lastSeekAt[incoming] = 0;
        } else {
          ensureAudioGraph();
          setSlotGain(incoming, 0);
          try { audio.currentTime = 0; } catch { /* ignore */ }
          // Promote the preload into a real load now that we're
          // committing to play it. Clear the preload ref so the
          // next track-change doesn't think this slot is still a
          // pending preload.
          b.loaded[incoming] = nextTrack.id;
          b.lastRealT[incoming] = 0;
          b.lastSeekAt[incoming] = 0;
          if (preloadedIncomingRef.current?.slot === incoming) {
            preloadedIncomingRef.current = null;
          }
        }

        if (b.ctx && b.ctx.state === 'suspended') {
          await b.ctx.resume().catch(() => {});
        }
        if (!crossfadingRef.current) return;
        await safePlay(incoming);
        if (!crossfadingRef.current) return;

        // Ramp in for however much of the crossfade window is left.
        // On slow networks this may be short; on the preloaded fast
        // path it's the full window.
        const elapsed = performance.now() - rampStart;
        const remaining = Math.max(300, durMs - elapsed);
        setSlotGain(incoming, 0);
        await rampGain(incoming, 0, target, remaining);
      } catch (err) {
        console.warn('[crossfade] incoming failed', err);
      }
    })();

    try {
      await Promise.all([outgoingRamp, incomingRamp]);
      if (!crossfadingRef.current) return; // cancelled
      // If the incoming failed to load at all we fall back to a hard
      // switch so we don't leave the user in silence.
      if (b.loaded[incoming] !== nextTrack.id) {
        teardown(false);
        setTrack(nextTrack);
        return;
      }
      teardown(true);
      setTrack(nextTrack);
    } catch (err) {
      console.warn('[crossfade] failed, falling back to hard switch', err);
      teardown(false);
    }
  }, [currentTrack, queue, volume, muted, crossfadeDuration, setTrack, tidalQuality]);

  // Proactive preload of queue[idx+1] into the inactive slot while the
  // user is playing with crossfade enabled. By the time startCrossfade
  // fires, the incoming stream is already buffered — no fetch + canplay
  // latency in the critical fade window. Tracked via `preloadedIncomingRef`
  // (NOT `b.loaded`), so the track-change effect's "promote inactive slot"
  // branch doesn't mistake a preload for a completed soft-switch.
  const preloadingNextRef = useRef<string | null>(null);
  useEffect(() => {
    if (!crossfade || !isPlaying || !currentTrack) return;
    const idx = queue.findIndex((t) => t.id === currentTrack.id);
    if (idx < 0) return;
    const nextTrack = queue[idx + 1];
    if (!nextTrack) return;
    const b = getBundle();
    const incoming = inactiveSlot(b);
    // Don't fight with an in-flight crossfade or a stale preload.
    if (crossfadingRef.current) return;
    if (
      preloadedIncomingRef.current?.trackId === nextTrack.id
      && preloadedIncomingRef.current?.slot === incoming
    ) return;
    if (preloadingNextRef.current === nextTrack.id) return;
    preloadingNextRef.current = nextTrack.id;
    let cancelled = false;
    (async () => {
      try {
        const url = await fetchStreamUrl(nextTrack, tidalQuality);
        if (cancelled || crossfadingRef.current) return;
        const audio = b.audios[incoming];
        ensureAudioGraph();
        setSlotGain(incoming, 0);
        audio.pause();
        audio.crossOrigin = 'anonymous';
        const ok = await tryLoadSrc(audio, url);
        if (cancelled || !ok) return;
        try { audio.currentTime = 0; } catch { /* ignore */ }
        // Record the preload in OUR ref only. We intentionally don't
        // touch `b.loaded[incoming]` — that would make the track-change
        // effect auto-promote the inactive slot on a user `next()` click
        // and skip the crossfade ramp entirely.
        preloadedIncomingRef.current = { slot: incoming, trackId: nextTrack.id };
        b.lastRealT[incoming] = 0;
        b.lastSeekAt[incoming] = 0;
      } catch {
        // Swallow — the normal startCrossfade path will retry with its
        // own fallback chain.
      } finally {
        if (preloadingNextRef.current === nextTrack.id) {
          preloadingNextRef.current = null;
        }
      }
    })();
    return () => { cancelled = true; };
  }, [crossfade, isPlaying, currentTrack, queue, tidalQuality]);

  // Time updates + ended + error + crossfade trigger.
  useEffect(() => {
    const b = getBundle();
    const wireSlot = (slot: Slot) => {
      const audio = b.audios[slot];
      /**
       * Whether this slot currently "owns" the UI surfaces (timeline,
       * duration text, ended-handler, etc.) for the playing track.
       *
       * Normally that's whichever slot `b.active` points at, but during
       * the brief window of a manual crossfade the store's currentTrack
       * has already switched to the new track while the outgoing slot
       * still holds the previous one — in that case the outgoing slot
       * must NOT drive store.progress / store.duration, otherwise it
       * would clobber the new track's timecode with its own.
       *
       * Rule: a slot owns the surfaces when its `loaded` track id
       * matches `store.currentTrack.id`. We fall back to `slot === b.active`
       * on any fuzzy state (no current track, no loaded id) so existing
       * behaviour is preserved when nothing is crossfading.
       */
      const isOwnerSlot = (): boolean => {
        const currentId = usePlayerStore.getState().currentTrack?.id ?? null;
        const loadedId = b.loaded[slot];
        if (currentId && loadedId) return loadedId === currentId;
        return slot === b.active;
      };
      const onTimeUpdate = () => {
        if (!isOwnerSlot()) return;
        const realT = audio.currentTime;

        // Spurious-reset defence: detect the case where the audio
        // element has been reset to 0 by something OTHER than a user
        // seek — most commonly a CORS / fallback retry that calls
        // `audio.load()`, which always rewinds `currentTime` to 0 and
        // immediately fires a `timeupdate(0)` event. Without this gate
        // that 0 propagates straight into `store.progress`, the
        // persisted timecode is wiped, and the user sees the timeline
        // jump from "1:23" to "0:00" the moment they hit play after
        // page reload.
        //
        // We only consider it spurious when (a) we DON'T already have
        // a pending restore-seek armed (the loadTrack path handles its
        // own initial reload), (b) the persisted progress is
        // significantly non-zero (so we know we're losing real state,
        // not just observing a fresh-track 0 → 0 update) and (c) the
        // current playback position is suspiciously close to 0. In
        // that situation we re-arm the restore-seek and ask the audio
        // element to seek back to the persisted position. The very
        // next setProgress is suppressed by the regular restore-seek
        // gate below, so `store.progress` stays at the persisted
        // target throughout.
        //
        // User-initiated seeks to 0 (`seek(0)`, `_seekToZero` handler,
        // `onEnded` with repeat='one') update `store.progress` BEFORE
        // touching `audio.currentTime`, so by the time their own
        // timeupdate fires `storeProgress` is already 0 and this gate
        // doesn't trigger.
        const restoreTarget = pendingRestoreProgressRef.current;
        const storeProgressNow = usePlayerStore.getState().progress;
        if (
          restoreTarget === null
          && realT < 0.5
          && storeProgressNow > 2
        ) {
          if (isFinite(audio.duration) && audio.duration > 0) {
            pendingRestoreProgressRef.current = storeProgressNow;
            try {
              audio.currentTime = Math.min(storeProgressNow, audio.duration);
            } catch { /* element not in seekable state yet */ }
          } else {
            // Duration not known yet → defer the seek to the
            // loadedmetadata listener, which already reads the ref.
            pendingRestoreProgressRef.current = storeProgressNow;
          }
          return;
        }

        // Restore-seek gating: keep suppressing timeupdates until the
        // audio element actually lands at the persisted target. Some
        // browsers fire timeupdate(0) AFTER we set currentTime=target if
        // the seek hasn't completed yet (data not buffered) — clearing
        // the ref unconditionally inside loadedmetadata used to let
        // those zero-updates clobber persisted progress, which is what
        // the user saw as "timeline shows 1:23 then snaps back to 0:00".
        if (restoreTarget !== null) {
          // Within 1.5s of the requested target → seek has landed.
          if (Math.abs(realT - restoreTarget) > 1.5) return;
          pendingRestoreProgressRef.current = null;
        }
        // Jump detection: only trigger the end-of-track auto-crossfade
        // when we've reached the final window via natural playback
        // progression, not a user scrub into the last few seconds. We
        // consider the step natural if it advanced by between 0 and
        // 1.5 s — the typical `timeupdate` cadence is 200–300 ms but
        // some browsers coalesce frames on slow tracks.
        const prevRealT = b.lastRealT[slot];
        const delta = realT - prevRealT;
        const isNaturalProgression = delta >= 0 && delta < 1.5;
        b.lastRealT[slot] = realT;

        // Suppress setProgress while the browser is still resolving a
        // seek. Some browsers fire timeupdate during the seek with a
        // stale currentTime (the pre-seek position), which would
        // otherwise clobber the target position the user just asked
        // for. Once `audio.seeking` goes back to false we resume
        // normal progress reporting.
        if (audio.seeking) return;

        setProgress(realT);
        const dur = audio.duration;
        // Authoritative seek guard: never fire the end-of-track auto-
        // crossfade within `AUTO_CROSSFADE_SEEK_GUARD_MS` of a user
        // scrub. This is the fix for "scrubbing into the final 12s
        // immediately fades to the next track and skips the audible
        // tail of the current track". `isNaturalProgression` alone
        // can't catch that — its window is delta-based, and the very
        // next timeupdate after a seek has realT ≈ b.lastRealT[slot]
        // (we sync those together in `seek` so other surfaces don't
        // see a jump), which trivially satisfies the natural step
        // heuristic.
        const sinceSeek = performance.now() - b.lastSeekAt[slot];
        if (
          crossfade
          && !crossfadingRef.current
          && isNaturalProgression
          && !audio.seeking
          && sinceSeek > AUTO_CROSSFADE_SEEK_GUARD_MS
          && isFinite(dur)
          && dur > 0
          && dur - audio.currentTime <= crossfadeDuration
        ) {
          startCrossfade();
        }
      };
      const onDurationChange = () => {
        if (!isOwnerSlot()) return;
        setDuration(audio.duration || 0);
      };
      const onLoadedMetadata = () => {
        if (!isOwnerSlot()) return;
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
        if (!isOwnerSlot()) return;
        if (repeat === 'one') {
          // Update the store first so the onTimeUpdate gate doesn't
          // mistake the deliberate rewind-to-0 for a spurious reset.
          setProgress(0);
          audio.currentTime = 0;
          safePlay(slot).catch(() => {});
        } else {
          // If we're already crossfading, the active slot has been swapped or
          // is about to be — let that flow finish; otherwise advance.
          if (!crossfadingRef.current) next();
        }
      };
      const onError = () => {
        if (!isOwnerSlot()) return;
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
    // If we're mid-AUTO crossfade (natural end-of-track fade), the user
    // scrubbing on the timeline is a strong signal that they want to
    // stay in the current track — abort the preload-into-next-track
    // flow so the seek doesn't get hijacked. Manual crossfades are
    // intentional track transitions and are left running.
    if (b.crossfadingInto !== null && b.crossfadeKind === 'auto') {
      abortAutoCrossfade(b);
    }
    const currentId = usePlayerStore.getState().currentTrack?.id ?? null;
    const slot = ownerSlotFor(b, currentId);
    const audio = b.audios[slot];
    // Update the store BEFORE touching audio.currentTime so the
    // spurious-reset gate in onTimeUpdate doesn't mistake the
    // resulting timeupdate for an unwanted reset (the gate compares
    // realT against `store.progress`).
    setProgress(time);
    // Stamp the wall-clock seek time so the auto-crossfade trigger is
    // hard-gated for `AUTO_CROSSFADE_SEEK_GUARD_MS` after the scrub.
    // This is the authoritative gate against the "scrubbed into the
    // last 12 s and crossfade hijacks immediately" bug — `lastRealT`
    // alone can't carry that signal because `isNaturalProgression`
    // treats SMALL deltas as natural, so writing the seek target into
    // it makes the very next timeupdate look like the most natural
    // step in the world.
    b.lastRealT[slot] = time;
    b.lastSeekAt[slot] = performance.now();
    audio.currentTime = time;
  }, [setProgress]);

  // Respond to store's _seekToZero (triggered by the "previous" action
  // when progress > 3s — restarts current track).
  const seekToZeroRef = useRef(_seekToZero);
  useEffect(() => {
    if (_seekToZero !== seekToZeroRef.current) {
      seekToZeroRef.current = _seekToZero;
      const b = getBundle();
      const audio = b.audios[b.active];
      // Same ordering as `seek()` — update the store first so the
      // onTimeUpdate spurious-reset gate sees storeProgress=0 by the
      // time the resulting timeupdate(0) fires.
      setProgress(0);
      audio.currentTime = 0;
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
      // Visuals should always track the slot loaded with the CURRENT
      // store track, not whichever slot happens to be `b.active`.
      // During a manual crossfade the store switches tracks as soon as
      // the user clicks next, while the outgoing slot keeps playing in
      // the background until its gain ramp completes; reading from
      // `b.active` during that window would briefly show the OUTGOING
      // track's position (e.g. "3:48" on a 3:55 track) right as the UI
      // is displaying the NEW track's title. Using the owner slot keeps
      // the bar visually aligned with the title/cover at all times.
      const currentId = usePlayerStore.getState().currentTrack?.id ?? null;
      const slot = ownerSlotFor(b, currentId);
      const audio = b.audios[slot];
      const now = performance.now();
      const dt = (now - lastTickAt) / 1000;
      lastTickAt = now;

      if (audio) {
        const realT = audio.currentTime;
        const dur = audio.duration;
        if (isFinite(dur) && dur > 0) durationSeconds.set(dur);

        // Reload-restore guard: while audio.currentTime is significantly
        // behind the persisted `store.progress` (because the seek to the
        // persisted position is still pending — common right after page
        // reload, AND right after the user clicks play before the seek
        // has had time to land), keep mirroring store.progress so the
        // bar doesn't visibly drop to 0:00 and then crawl forward. The
        // guard disengages as soon as `realT` catches up to within 1.5 s
        // of the stored target, at which point the prediction path
        // takes over for smooth interpolation.
        //
        // We use store.progress (not pendingRestoreProgressRef from the
        // sibling useAudioPlayer hook, which isn't accessible here)
        // because it is already gated by `onTimeUpdate`'s restore-seek
        // logic — `setProgress(audio.currentTime)` is suppressed until
        // the seek lands, so `store.progress` continues to reflect the
        // pre-reload target during the restore window.
        const storeProgress = usePlayerStore.getState().progress;
        if (storeProgress > 0.5 && realT < storeProgress - 1.5) {
          displayed = storeProgress;
          const dur2 = audio.duration;
          if (isFinite(dur2) && dur2 > 0) {
            displayed = Math.max(0, Math.min(displayed, dur2));
          } else {
            const storeDuration = usePlayerStore.getState().duration;
            if (storeDuration > 0) durationSeconds.set(storeDuration);
          }
          progressSeconds.set(displayed);
          // Mark initialised so the very next tick (after the guard
          // releases) doesn't fall into the `!initialised` branch and
          // snap `displayed` back to realT (= 0) — that's what produced
          // the "bar plays for half a second then jumps to 0:00" bug.
          initialised = true;
          // Skip the prediction/buffered branches this frame — they'd
          // overwrite the restored value with realT (= 0).
          raf = requestAnimationFrame(tick);
          return;
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
