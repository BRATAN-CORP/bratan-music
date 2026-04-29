import { useEffect, useRef } from 'react';
import { usePlayerStore } from '@/store/player';
import { useAuthStore } from '@/store/auth';
import { logPlay, fetchContinue } from '@/lib/recommendations';

/**
 * Two responsibilities, intentionally co-located so they share the
 * same "current track" subscription and don't double-fire on quick
 * track changes:
 *
 *   1. POST to /history/play when a track passes the "significant
 *      play" threshold: ≥ 30s listened OR ≥ 80% completion. We log on
 *      transition away from a track (via subscribe) and on unmount —
 *      so refreshes/closing the tab don't lose the last play. Skips
 *      under 30s never reach the API (intentional — we don't want
 *      taste signal polluted by what the user actively rejected).
 *
 *   2. Auto-extend the queue when it nears empty. Fires once per
 *      track-change when there are ≤ 2 tracks left after the current
 *      one and repeat is "off" — adds 20 wave-style tracks based on
 *      the current seed. This is what powers "endless playback" in
 *      the absence of repeat.
 *
 * Mounted once at the AppLayout level. Activates only for
 * authenticated users.
 */
const SIGNIFICANT_SECONDS = 30;
const COMPLETED_PCT = 0.8;
const QUEUE_REFILL_THRESHOLD = 2;

interface InFlightTrack {
  trackId: string;
  source: string;
  artistId?: string;
  artistName: string;
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

    // Fire-once-per-track guard: extend queue when the new current track
    // is announced and the queue is small.
    const maybeExtendQueue = () => {
      const { currentTrack, queue, repeat } = usePlayerStore.getState();
      if (!currentTrack) return;
      if (lastExtendForTrackId.current === currentTrack.id) return;
      // Only extend in plain "off" mode. 'all' loops the user's queue,
      // 'one' is a deliberate single-track loop — neither wants random
      // wave tracks injected.
      if (repeat !== 'off') return;
      const idx = queue.findIndex((t) => t.id === currentTrack.id);
      const remaining = idx >= 0 ? queue.length - idx - 1 : queue.length;
      if (remaining > QUEUE_REFILL_THRESHOLD) return;

      lastExtendForTrackId.current = currentTrack.id;
      void (async () => {
        try {
          const next = await fetchContinue(currentTrack.id, 20);
          if (next.length === 0) return;
          // Re-read state in case the user did something between the
          // request and the response.
          const after = usePlayerStore.getState();
          const stillCurrent = after.currentTrack?.id === currentTrack.id;
          if (!stillCurrent) return;
          // Filter out anything already in the queue.
          const have = new Set(after.queue.map((t) => `${t.id}:${(t as { source?: string }).source ?? 'tidal'}`));
          const fresh = next.filter((t) => !have.has(`${t.id}:${t.source ?? 'tidal'}`));
          if (fresh.length === 0) return;
          after.setQueue([...after.queue, ...fresh]);
        } catch {
          // network blip — try again on the next track-change.
          lastExtendForTrackId.current = null;
        }
      })();
    };

    const handleTrackChange = (
      next: ReturnType<typeof usePlayerStore.getState>['currentTrack'],
    ) => {
      // Same-track no-ops (zustand subscribe fires on every set).
      const prev = inFlight.current;
      if (next?.id && prev?.trackId === next.id) return;

      flushPrevious();

      if (next) {
        const t = next as typeof next & { source?: string; album?: string };
        inFlight.current = {
          trackId: t.id,
          source: t.source ?? 'tidal',
          artistId: t.artistId,
          artistName: t.artist,
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
      // Track the maximum progress reached during the current track —
      // used to compute listened-seconds even if the user seeks
      // backwards before skipping.
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
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, [isAuthed]);
}
