import { useEffect, useRef } from 'react';
import { usePlayerStore } from '@/store/player';
import { useAuthStore } from '@/store/auth';
import { useSettingsStore } from '@/store/settings';
import { logPlay, fetchContinue, fetchWave } from '@/lib/recommendations';
import type { Track } from '@/types';

/**
 * Two responsibilities, co-located so they share the same
 * `currentTrack` subscription and don't double-fire on quick track
 * changes:
 *
 *   1. POST to /history/play once a track is "significant":
 *      ≥ 30s listened OR ≥ 80% completion. Logs on transition AWAY
 *      and on unmount so refreshes don't lose the last play. Skips
 *      under 30s never reach the API — we don't want taste signal
 *      polluted by what the user actively rejected.
 *
 *   2. Auto-extend the queue when the user reaches the LAST queue
 *      track. Fires once at remaining===0 with repeat='off'. Earlier
 *      thresholds polluted album/playlist queues with wave tracks
 *      mid-listen.
 *
 *      Shuffle is special: `next()` picks a random index, so the
 *      linear remaining===0 fires whenever random lands on the last
 *      slot — decoupled from whether the album has actually been
 *      heard. Shuffle gates on "every queue track played at least
 *      once" instead.
 *
 * Mounted once at AppLayout. Auth-only.
 */
const SIGNIFICANT_SECONDS = 30;
const COMPLETED_PCT = 0.8;

interface InFlightTrack {
  trackId: string;
  source: string;
  artistId?: string;
  artistName: string;
  artists?: { id: string; name: string }[];
  title: string;
  albumId?: string;
  coverUrl?: string;
  duration: number;
  startedAt: number;
}

export function usePlayHistoryLogger() {
  const isAuthed = useAuthStore((s) => Boolean(s.accessToken));
  const inFlight = useRef<InFlightTrack | null>(null);
  const maxProgressRef = useRef<number>(0);
  const lastExtendForTrackId = useRef<string | null>(null);
  // Queue track ids heard at least once this session. Used by the
  // shuffle branch of maybeExtendQueue to gate wave-continuation on
  // "every queue track has actually been played". Implicitly scoped
  // to the current queue — stale ids just don't intersect.
  const playedQueueIdsRef = useRef<Set<string>>(new Set());
  // Single-flight guard — prevents rapid skip-forward taps on the
  // last track from racing parallel fetchContinue/fetchWave calls.
  const endExtendInFlight = useRef(false);

  useEffect(() => {
    if (!isAuthed) return;

    const flushPrevious = () => {
      const prev = inFlight.current;
      const listened = Math.max(0, Math.floor(maxProgressRef.current));
      if (!prev) return;
      const completed =
        prev.duration > 0 ? listened >= prev.duration * COMPLETED_PCT : false;
      if (listened >= SIGNIFICANT_SECONDS || completed) {
        void logPlay({
          trackId: prev.trackId,
          source: prev.source,
          artistId: prev.artistId,
          artistName: prev.artistName,
          artists: prev.artists,
          title: prev.title,
          albumId: prev.albumId,
          coverUrl: prev.coverUrl,
          duration: prev.duration,
          listenedSeconds: listened,
          completed,
        });
      }
      inFlight.current = null;
      maxProgressRef.current = 0;
    };

    // Seed hints for fetchContinue: most-specific first (current
    // track), then the queue head (album/playlist anchor). Either
    // can return zero — best-effort.
    const seedHints = (currentTrackId: string): string[] => {
      const seeds: string[] = [currentTrackId];
      const queueSeed = usePlayerStore.getState().queue[0]?.id;
      if (queueSeed && queueSeed !== currentTrackId) seeds.push(queueSeed);
      return seeds;
    };

    // Try each seed via fetchContinue; if all return empty, fall
    // back to fetchWave (personal endless stream) so the player
    // never goes silent at the end of the queue.
    const fetchExtensionTracks = async (seeds: string[]): Promise<Track[]> => {
      for (const seed of seeds) {
        try {
          const res = await fetchContinue(seed, 20);
          if (res.length > 0) return res;
        } catch {
          // continue to next seed / wave fallback
        }
      }
      try {
        const wave = await fetchWave(20);
        return wave;
      } catch {
        return [];
      }
    };

    // De-dupe extension batch against the existing queue. Key on
    // `${id}:${source}` because the same id can legitimately appear
    // from two providers (tidal + upload).
    const filterFresh = (extension: Track[], queue: Track[]): Track[] => {
      const have = new Set(queue.map((t) => `${t.id}:${(t as { source?: string }).source ?? 'tidal'}`));
      return extension.filter((t) => !have.has(`${t.id}:${(t as { source?: string }).source ?? 'tidal'}`));
    };

    // Fire-once-per-track guard: extend queue when the new current track
    // is announced and the queue is small.
    const maybeExtendQueue = () => {
      const { currentTrack, queue, repeat, shuffle } = usePlayerStore.getState();
      if (!currentTrack) return;
      if (lastExtendForTrackId.current === currentTrack.id) return;
      // Only extend in plain "off" mode. 'all' loops the user's queue,
      // 'one' is a deliberate single-track loop — neither wants random
      // wave tracks injected.
      if (repeat !== 'off') return;
      // User-controlled toggle in Settings → "Воспроизведение".
      // When off, the queue is intentionally finite and the player
      // stops on the last track.
      if (!useSettingsStore.getState().infinitePlayback) return;

      if (shuffle) {
        // Shuffle gates on "every queue track played at least once"
        // instead of linear remaining===0 — random landing on the
        // last index would otherwise inject wave tracks mid-album.
        const played = playedQueueIdsRef.current;
        const allPlayed = queue.every(
          (t) => played.has(t.id) || t.id === currentTrack.id,
        );
        if (!allPlayed) return;
      } else {
        // Linear: only fire on the very last track. Async fetch has
        // ~minutes to resolve before the track ends.
        const idx = queue.findIndex((t) => t.id === currentTrack.id);
        const remaining = idx >= 0 ? queue.length - idx - 1 : queue.length;
        if (remaining > 0) return;
      }

      lastExtendForTrackId.current = currentTrack.id;
      void (async () => {
        const extension = await fetchExtensionTracks(seedHints(currentTrack.id));
        if (extension.length === 0) {
          // No continuation — clear the guard so a later track-change
          // gets a fresh attempt.
          lastExtendForTrackId.current = null;
          return;
        }
        // Re-read state in case the user did something during the fetch.
        const after = usePlayerStore.getState();
        if (after.currentTrack?.id !== currentTrack.id) return;
        const fresh = filterFresh(extension, after.queue);
        if (fresh.length === 0) return;
        after.setQueue([...after.queue, ...fresh]);
      })();
    };

    // End-of-queue handler called synchronously from store's
    // next()/nextManual() before the visible silence/track-1 flash.
    // Returns true to claim responsibility (async setQueue/setTrack
    // below); store then skips its built-in fallback.
    const handleEndOfQueue = (): boolean => {
      if (!useSettingsStore.getState().infinitePlayback) return false;
      const player = usePlayerStore.getState();
      const currentTrack = player.currentTrack;
      if (!currentTrack) return false;
      // 'all' / 'one' loop the queue / track themselves — bow out.
      if (player.repeat !== 'off') return false;
      if (endExtendInFlight.current) return true;
      endExtendInFlight.current = true;
      void (async () => {
        try {
          const extension = await fetchExtensionTracks(seedHints(currentTrack.id));
          if (extension.length === 0) return;
          const after = usePlayerStore.getState();
          const fresh = filterFresh(extension, after.queue);
          const head = fresh[0];
          if (!head) return;
          // Append first so the queue UI updates, then promote the
          // head into currentTrack so the audio engine actually
          // starts playing it (without the explicit setTrack the
          // player would stay on the ended last track).
          after.setQueue([...after.queue, ...fresh]);
          after.setTrack(head);
        } finally {
          endExtendInFlight.current = false;
        }
      })();
      return true;
    };

    usePlayerStore.getState().setEndHandler(handleEndOfQueue);

    const handleTrackChange = (
      next: ReturnType<typeof usePlayerStore.getState>['currentTrack'],
    ) => {
      // Same-track no-ops (zustand subscribe fires on every set).
      const prev = inFlight.current;
      if (next?.id && prev?.trackId === next.id) return;

      // Record the track we're transitioning AWAY from as "played"
      // (used by shuffle's all-played gate). Counts even short skips
      // — "seen", not "completed".
      if (prev?.trackId) {
        playedQueueIdsRef.current.add(prev.trackId);
      }

      flushPrevious();

      if (next) {
        const t = next as typeof next & { source?: string; album?: string };
        inFlight.current = {
          trackId: t.id,
          source: t.source ?? 'tidal',
          artistId: t.artistId,
          artistName: t.artist,
          // Snapshot full credits so multi-artist plays land in
          // history with both ids — each name then renders as its
          // own link in the recent-plays strip.
          artists: Array.isArray(t.artists) && t.artists.length > 0
            ? t.artists.map((a) => ({ id: a.id, name: a.name }))
            : undefined,
          title: t.title,
          albumId: t.albumId,
          coverUrl: t.coverUrl,
          duration: t.duration ?? 0,
          startedAt: Date.now(),
        };
        maxProgressRef.current = 0;
        // Defer extension by one tick so the queue reflects the new
        // current track index (some setTrack callsites also setQueue
        // immediately after).
        setTimeout(maybeExtendQueue, 50);
      }
    };

    const unsubTrack = usePlayerStore.subscribe((state, prevState) => {
      if (state.currentTrack?.id !== prevState.currentTrack?.id) {
        handleTrackChange(state.currentTrack);
      }
    });

    const unsubProgress = usePlayerStore.subscribe((state) => {
      // Max-progress, not last-progress — listened-seconds stays
      // honest across backward seeks before a skip.
      if (state.progress > maxProgressRef.current) {
        maxProgressRef.current = state.progress;
      }
    });

    // Seed inFlight with whatever's currently playing on mount so a
    // refresh-then-skip still logs a play for the active track.
    handleTrackChange(usePlayerStore.getState().currentTrack);

    const onBeforeUnload = () => flushPrevious();
    window.addEventListener('beforeunload', onBeforeUnload);

    return () => {
      flushPrevious();
      unsubTrack();
      unsubProgress();
      // Only clear if it's still our handler — guards against the
      // StrictMode double-mount race.
      if (usePlayerStore.getState().endHandler === handleEndOfQueue) {
        usePlayerStore.getState().setEndHandler(null);
      }
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, [isAuthed]);
}
