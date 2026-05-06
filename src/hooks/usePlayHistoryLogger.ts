import { useEffect, useRef } from 'react';
import { usePlayerStore } from '@/store/player';
import { useAuthStore } from '@/store/auth';
import { useSettingsStore } from '@/store/settings';
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
 *   2. Auto-extend the queue when the user reaches the LAST track in
 *      the current queue. Fires once when the current track becomes
 *      the final item AND repeat is "off" — adds 20 wave-style tracks
 *      based on the current seed. This is what powers "endless
 *      playback" in the absence of repeat.
 *
 *      Why only on the last track (not pre-emptively a few tracks
 *      earlier): when the user starts an album or playlist they
 *      expect the queue to contain ONLY that album/playlist. Adding
 *      wave continuations a few tracks before the end made the queue
 *      UI show foreign tracks alongside the album, and on a manual
 *      skip-to-end the player would slide into a non-album track
 *      instead of stopping cleanly. Triggering on the final track
 *      keeps the queue pure for the whole album, and by the time the
 *      last track ends the wave has been fetched in the background.
 *
 *      Shuffle is a special case: `next()` picks a random queue index
 *      instead of advancing linearly, so the linear "remaining === 0"
 *      heuristic fires whenever random happens to land on the last
 *      queue position — which is independent of whether the user has
 *      heard the album in full. The shuffle branch tracks per-queue
 *      played track ids and only extends once every queue track has
 *      actually been played at least once, so wave tracks don't bleed
 *      into the listen mid-album.
 *
 * Mounted once at the AppLayout level. Activates only for
 * authenticated users.
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
  // Tracks queue track ids that have been heard at least once during
  // the current listening session. Used by maybeExtendQueue's shuffle
  // branch to gate the wave-continuation fetch behind "all tracks in
  // the current queue have actually been played". Without this gate,
  // shuffle would extend the queue with wave tracks the first time
  // random landed on the LAST INDEX of the queue (`remaining === 0` in
  // the linear sense) — which is decoupled from how many album/playlist
  // tracks the user had actually heard, so wave tracks started bleeding
  // into the album mid-listen. The set is never explicitly reset:
  // tracks from a previous queue context don't appear in the current
  // `queue.every(...)` check, so they're effectively scoped to the
  // queue they belong to without any extra bookkeeping.
  const playedQueueIdsRef = useRef<Set<string>>(new Set());

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
        // Shuffle is decoupled from queue position — `next()` just picks
        // `Math.random() * queue.length`, so the linear "remaining === 0"
        // check fires the first time random happens to land on the last
        // queue index, which can be early in the album. Wave tracks then
        // start bleeding into the queue and shuffle picks them mid-album,
        // which is the "треки из бесконечного прослушивания брались до
        // того как доиграл альбом целиком" behaviour the user reported.
        // Gate the trigger on "every track in the current queue has
        // actually been played at least once" instead — by the time we
        // hit the last unheard track in shuffle, we know the user has
        // genuinely finished the album/playlist and pulling wave
        // continuations is the right next step.
        const played = playedQueueIdsRef.current;
        const allPlayed = queue.every(
          (t) => played.has(t.id) || t.id === currentTrack.id,
        );
        if (!allPlayed) return;
      } else {
        const idx = queue.findIndex((t) => t.id === currentTrack.id);
        // Linear playback: extend when the user is on the very last
        // track of the current queue (remaining === 0). Earlier builds
        // extended when remaining ≤ 2, but that polluted album/playlist
        // queues with wave continuations before the user had finished
        // the explicit selection. The fetch below is async, so kicking
        // it off at the start of the last track gives it ~minutes to
        // resolve before the track actually ends.
        const remaining = idx >= 0 ? queue.length - idx - 1 : queue.length;
        if (remaining > 0) return;
      }

      lastExtendForTrackId.current = currentTrack.id;
      void (async () => {
        try {
          // Try seeding from the current track first — that's the
          // tightest "what should come right after THIS" signal.
          // If it returns nothing (cold-start track, very rare
          // catalogue entry, or transient API miss) fall back to the
          // first track of the queue, which for an album / playlist
          // load is the canonical anchor and almost always has
          // recommendations attached. Without this fallback, an
          // empty response left the queue un-extended forever and
          // the player simply stopped at the end of the album —
          // exactly the "ничего не играется после последнего трека"
          // symptom.
          const seedCandidates: string[] = [currentTrack.id];
          const queueSeed = usePlayerStore.getState().queue[0]?.id;
          if (queueSeed && queueSeed !== currentTrack.id) {
            seedCandidates.push(queueSeed);
          }
          let next: Awaited<ReturnType<typeof fetchContinue>> = [];
          for (const seed of seedCandidates) {
            next = await fetchContinue(seed, 20);
            if (next.length > 0) break;
          }
          if (next.length === 0) {
            // Genuinely no continuation available — clear the guard so
            // a later track-change (e.g. user manually picks something
            // else and comes back) gets a fresh attempt instead of
            // being silently locked out forever.
            lastExtendForTrackId.current = null;
            return;
          }
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

      // Record the track we're transitioning AWAY from as "played" so
      // the shuffle branch of maybeExtendQueue can tell when the user
      // has heard every track in the current queue. We add it whether
      // or not it ended up logged via flushPrevious — even a short
      // skip counts as "this track has been seen" for the purposes of
      // not re-shuffling the same items endlessly.
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
          // Snapshot the full credits list so a multi-artist play
          // ("A, B") lands in history with both ids preserved — each
          // name then renders as its own link in the recent-plays
          // strip on the home page.
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
