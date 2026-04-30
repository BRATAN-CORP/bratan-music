import { useEffect, useRef } from 'react';
import { api, ApiError } from '@/lib/api';
import { usePlayerStore } from '@/store/player';
import { useRoomConnectionStore } from '@/store/roomConnection';
import { useAuthStore } from '@/store/auth';
import { useSettingsStore } from '@/store/settings';
import { seekAudio } from '@/hooks/useAudioPlayer';
import type {
  RoomMember,
  RoomState,
  RoomStatePoll,
  RoomTrackSnapshot,
} from '@/types/rooms';

const API_BASE = import.meta.env.VITE_API_URL ?? 'https://bratan-music-api.bratan-corp.workers.dev';

/**
 * Poll cadence — kept short so a guest catches a play / pause / seek
 * within ~one tick. The server short-circuits unchanged requests via
 * `?since=<version>` so the steady-state cost is a 200-with-empty-body
 * roundtrip, not a state recompute.
 */
const POLL_INTERVAL_MS = 1500;
const HEARTBEAT_INTERVAL_MS = 20_000;
/**
 * "Real divergence" threshold: when a fresh event arrives and the
 * client's clock is more than this far from the room's authoritative
 * position, we hard-snap with `seekAudio`. Set deliberately loose so
 * normal buffer jitter, audio-thread scheduling and clock skew don't
 * trigger seeks (which manifest as choppy playback).
 */
const HARD_SYNC_DRIFT_MS = 4000;
/**
 * Local-progress jump threshold for "this was a user scrub" detection.
 * Anything bigger is treated as a deliberate seek; anything smaller is
 * treated as natural ~250 ms playback advance.
 */
const SEEK_PUSH_THRESHOLD_S = 2;

function trackIdsEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  return (a ?? null) === (b ?? null);
}

interface SnapshotSource {
  id: string;
  title: string;
  artist: string;
  artistId?: string;
  artists?: { id: string; name: string }[];
  albumId?: string;
  coverUrl?: string;
  coverVideoUrl?: string;
  duration: number;
  source?: string;
}

function snapshotFromTrack(t: SnapshotSource): RoomTrackSnapshot {
  return {
    id: t.id,
    title: t.title,
    artist: t.artist,
    artistId: t.artistId ?? null,
    artists: t.artists,
    album: null,
    albumId: t.albumId ?? null,
    coverUrl: t.coverUrl ?? null,
    coverVideoUrl: t.coverVideoUrl ?? null,
    duration: t.duration ?? 0,
    source: t.source ?? (t.id.startsWith('upload:') ? 'upload' : 'tidal'),
  };
}

function buildRoomStreamUrl(track: RoomTrackSnapshot, roomId: string, accessToken: string): string | null {
  const t = encodeURIComponent(accessToken);
  if (track.source === 'upload' || track.id.startsWith('upload:')) {
    const rawId = track.id.startsWith('upload:') ? track.id.slice('upload:'.length) : track.id;
    return `${API_BASE}/rooms/${roomId}/stream/upload/${encodeURIComponent(rawId)}?token=${t}`;
  }
  if (track.source === 'override') {
    return `${API_BASE}/rooms/${roomId}/stream/override/${encodeURIComponent(track.id)}?token=${t}`;
  }
  // Tidal needs a JSON round-trip — caller handles it.
  return null;
}

async function resolveRoomStreamUrl(
  track: RoomTrackSnapshot,
  roomId: string,
  accessToken: string,
): Promise<string> {
  const direct = buildRoomStreamUrl(track, roomId, accessToken);
  if (direct) return direct;
  const res = await api.get<{ url: string }>(
    `/rooms/${roomId}/stream/tidal/${encodeURIComponent(track.id)}?quality=LOSSLESS`,
  );
  return res.url;
}

interface BridgeRefs {
  /**
   * Highest `state.version` we have applied locally. Lets the polling
   * loop pass `?since=<version>` so the server can short-circuit
   * unchanged responses.
   */
  appliedVersion: number;
  /**
   * True while we're in the middle of writing room state into the
   * playerStore. The `usePlayerStore.subscribe` callback reads this
   * to skip the local→remote push that would otherwise feedback-loop
   * (every apply fires the subscription).
   */
  applying: boolean;
  /** Last known (currentTrack.id, isPlaying, progress) baseline. */
  lastLocalTrackId: string | null;
  lastLocalIsPlaying: boolean;
  lastLocalProgress: number;
  /** Server-clock skew (`serverNow - localNow`). */
  serverClockOffsetMs: number;
  /** Stream URL we last set for this track (so unchanged polls don't reload). */
  appliedStreamUrlForTrackId: string | null;
  /** Snapshot of pre-room shuffle/crossfade so we can restore them. */
  savedShuffle: boolean | null;
  savedCrossfade: { on: boolean; dur: number } | null;
}

/**
 * The single source of truth that bridges the global `<audio>` engine
 * with a server-authoritative listening room.
 *
 * Mounted at the layout level (`AppLayout`) so the user can navigate
 * between pages while the bridge keeps the global mini-player in lock-
 * step with the room. Behaviour is **event-driven**: the server bumps
 * `state.version` on each play / pause / seek / track-change, and the
 * bridge applies the new state exactly once per bump. Between events
 * the local audio engine plays freely — there is intentionally no
 * periodic drift correction, because re-seeking on every poll is
 * audible as choppy playback. Any genuine clock divergence is caught
 * the next time the host emits an event.
 *
 * 1.  Activates whenever `roomConnection.roomId` is non-null. Polls
 *     `GET /rooms/:id/state?since=<version>` every 1.5 s; the server
 *     responds `{ unchanged: true }` until something happens.
 * 2.  **Room → local.** When `state.version` advances:
 *     - **Track change.** Resolves a stream URL through
 *       `/rooms/:id/stream/...` (uploads / overrides via the proxy,
 *       Tidal via a JSON round-trip) and calls `setTrackAt(track,
 *       position, isPlaying)` so the global player loads the new track
 *       at the room's authoritative position. Guests joining a session
 *       in progress don't snap to 0:00 because `setTrackAt` honours
 *       the supplied progress. The local queue is hard-reset to
 *       `[track]` so a guest's pre-existing queue can't auto-advance
 *       into non-room content.
 *     - **Same track, isPaused changed.** Toggles `play()` / `pause()`
 *       locally — no seek, the local progress is trusted.
 *     - **Same track, isPaused same.** Treated as a host-issued seek;
 *       only re-seeks if the local clock has diverged by more than
 *       `HARD_SYNC_DRIFT_MS` to avoid no-op snaps.
 * 3.  **Local → room.** When the user (with control rights) plays a
 *     different track via /search, /library, or any surface that calls
 *     `playerStore.setTrack`, the bridge POSTs `kind: 'track'` to the
 *     room so everyone follows. Same for play/pause and large
 *     progress jumps (treated as user seeks).
 * 4.  **Mode lock.** Save+restore the user's shuffle/crossfade
 *     preferences while connected: both are forced off because cross-
 *     fades and queue reordering would silently desync from the host.
 *
 * Loop avoidance: `applying` is true for the synchronous span of every
 * room→local apply, so the subscribe-callback can detect "this change
 * came from us" and skip pushing it back to the server.
 */
export function useRoomBridge(): void {
  const refs = useRef<BridgeRefs>({
    appliedVersion: 0,
    applying: false,
    lastLocalTrackId: null,
    lastLocalIsPlaying: false,
    lastLocalProgress: 0,
    serverClockOffsetMs: 0,
    appliedStreamUrlForTrackId: null,
    savedShuffle: null,
    savedCrossfade: null,
  });

  const roomId = useRoomConnectionStore((s) => s.roomId);
  const hostId = useRoomConnectionStore((s) => s.hostId);
  const setLive = useRoomConnectionStore((s) => s.setLive);
  const clearActiveRoom = useRoomConnectionStore((s) => s.clear);

  const meId = useAuthStore((s) => s.user?.id ?? null);
  const isHost = !!hostId && hostId === meId;

  // 1. Save+restore shuffle/crossfade on connect/disconnect.
  useEffect(() => {
    if (!roomId) {
      const r = refs.current;
      if (r.savedCrossfade) {
        useSettingsStore.getState().setCrossfade(r.savedCrossfade.on);
        useSettingsStore.getState().setCrossfadeDuration(r.savedCrossfade.dur);
      }
      if (r.savedShuffle) {
        const { shuffle, toggleShuffle } = usePlayerStore.getState();
        if (!shuffle) toggleShuffle();
      }
      r.savedShuffle = null;
      r.savedCrossfade = null;
      r.appliedVersion = 0;
      r.appliedStreamUrlForTrackId = null;
      return;
    }
    const r = refs.current;
    const settings = useSettingsStore.getState();
    const player = usePlayerStore.getState();
    if (r.savedCrossfade === null) {
      r.savedCrossfade = { on: settings.crossfade, dur: settings.crossfadeDuration };
    }
    if (r.savedShuffle === null) {
      r.savedShuffle = player.shuffle;
    }
    if (settings.crossfade) settings.setCrossfade(false);
    if (settings.crossfadeDuration !== 0) settings.setCrossfadeDuration(0);
    if (player.shuffle) player.toggleShuffle();
  }, [roomId]);

  // 2. Polling loop: pull room state.
  useEffect(() => {
    if (!roomId) {
      setLive(false);
      return;
    }
    let cancelled = false;
    let scheduled: number | null = null;

    const applyRoomState = async (state: RoomState, members: RoomMember[], serverNowMs: number) => {
      const r = refs.current;
      // Mirror state + members into the connection store so consumer
      // surfaces (room page, badge) stay in sync without running their
      // own duplicate /state poll.
      useRoomConnectionStore.getState().setRemote({ state, members, serverNowMs });
      if (!state.track) return;

      const targetPositionMs = state.isPaused
        ? state.positionMs
        : Math.max(
            0,
            state.positionMs + (Date.now() + r.serverClockOffsetMs - state.startedAtMs),
          );

      const ps = usePlayerStore.getState();
      const sameTrack = trackIdsEqual(ps.currentTrack?.id, state.track.id);
      const sameUrlAlready = r.appliedStreamUrlForTrackId === state.track.id;

      r.applying = true;
      try {
        if (!sameTrack || !sameUrlAlready) {
          // Track change (or first apply of this track on this client).
          // Resolve the stream URL lazily — uploads / overrides build
          // synchronously; Tidal needs one extra round-trip. Failures
          // here just abort the apply; the next poll will retry.
          let streamUrl = '';
          try {
            const accessToken = useAuthStore.getState().accessToken ?? '';
            streamUrl = await resolveRoomStreamUrl(state.track, roomId, accessToken);
          } catch {
            // Drop applying flag and bail — next poll will retry.
            r.applying = false;
            return;
          }
          if (cancelled) {
            r.applying = false;
            return;
          }
          const trackPayload = {
            id: state.track.id,
            title: state.track.title,
            artist: state.track.artist,
            artistId: state.track.artistId ?? undefined,
            artists: state.track.artists,
            albumId: state.track.albumId ?? undefined,
            coverUrl: state.track.coverUrl ?? undefined,
            coverVideoUrl: state.track.coverVideoUrl ?? undefined,
            duration: state.track.duration ?? 0,
            source: state.track.source,
            streamUrl,
          };
          ps.setTrackAt(trackPayload, targetPositionMs / 1000, !state.isPaused);
          ps.setQueue([trackPayload]);
          r.appliedStreamUrlForTrackId = state.track.id;
        } else {
          // Same track, same URL. The version bumped because of a
          // play / pause / seek event. Apply only what changed —
          // never re-seek "just because" because that would interrupt
          // playback on every event.
          const wantPlaying = !state.isPaused;
          if (wantPlaying && !ps.isPlaying) ps.play();
          else if (!wantPlaying && ps.isPlaying) ps.pause();

          const driftMs = Math.abs((ps.progress * 1000) - targetPositionMs);
          if (driftMs > HARD_SYNC_DRIFT_MS) {
            seekAudio(targetPositionMs / 1000);
          }
        }
      } finally {
        r.applying = false;
      }

      // Re-baseline post-apply so the local→remote subscription is
      // judged against the just-applied state, not the stale one.
      const fresh = usePlayerStore.getState();
      r.lastLocalTrackId = fresh.currentTrack?.id ?? null;
      r.lastLocalIsPlaying = fresh.isPlaying;
      r.lastLocalProgress = fresh.progress;

      r.appliedVersion = state.version;
    };

    const tick = async () => {
      if (cancelled) return;
      try {
        const since = refs.current.appliedVersion;
        const res = await api.get<RoomStatePoll>(`/rooms/${roomId}/state?since=${since}`);
        if (cancelled) return;
        refs.current.serverClockOffsetMs = res.serverNowMs - Date.now();
        setLive(true);
        if (!res.unchanged && res.state) {
          await applyRoomState(res.state, res.members ?? [], res.serverNowMs);
        } else if (res.unchanged) {
          // Still publish the heartbeat-only `serverNowMs` so badge
          // animations have a fresh "isLive" tick.
          const cs = useRoomConnectionStore.getState();
          if (cs.state) {
            cs.setRemote({ state: cs.state, members: cs.members, serverNowMs: res.serverNowMs });
          }
        }
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 403) {
          clearActiveRoom();
          return;
        }
        setLive(false);
      }
    };

    void tick();
    scheduled = window.setInterval(() => void tick(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      if (scheduled) window.clearInterval(scheduled);
      setLive(false);
    };
  }, [roomId, setLive, clearActiveRoom]);

  // 3. Heartbeat so the server keeps membership alive even when nothing
  //    is changing (otherwise the live-member chip turns grey).
  useEffect(() => {
    if (!roomId) return;
    let cancelled = false;
    const beat = async () => {
      if (cancelled) return;
      try {
        const res = await api.post<{ ok: boolean; serverNowMs: number }>(`/rooms/${roomId}/heartbeat`);
        refs.current.serverClockOffsetMs = res.serverNowMs - Date.now();
      } catch { /* ignore — polling will surface a 403 if we lost access */ }
    };
    const id = window.setInterval(() => void beat(), HEARTBEAT_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [roomId]);

  // 4. Local → room push: subscribe to playerStore changes and forward
  //    user-initiated track / play / pause / seek to the room. The
  //    `applying` ref suppresses pushes that originate from our own
  //    `applyRoomState` writes.
  useEffect(() => {
    if (!roomId) return;
    const unsub = usePlayerStore.subscribe((state) => {
      const r = refs.current;
      const localTrackId = state.currentTrack?.id ?? null;
      const trackChanged = !trackIdsEqual(localTrackId, r.lastLocalTrackId);
      const isPlayingChanged = state.isPlaying !== r.lastLocalIsPlaying;
      const seekDelta = state.progress - r.lastLocalProgress;
      const seekJumped = Math.abs(seekDelta) > SEEK_PUSH_THRESHOLD_S && state.isPlaying;

      // Update baselines first so partial failures don't loop.
      r.lastLocalTrackId = localTrackId;
      r.lastLocalIsPlaying = state.isPlaying;
      r.lastLocalProgress = state.progress;

      if (r.applying) return;

      const conn = useRoomConnectionStore.getState();
      const canControl = isHost || !conn.hostOnlyControl;
      if (!canControl) return;

      if (trackChanged && state.currentTrack) {
        const snap = snapshotFromTrack(state.currentTrack);
        // Reset URL marker so the next room poll forces a fresh
        // `/rooms/:id/stream/...` resolve for the new track.
        r.appliedStreamUrlForTrackId = null;
        api.post(`/rooms/${roomId}/control`, {
          kind: 'track',
          track: snap,
          positionMs: 0,
          isPaused: !state.isPlaying,
        }).catch((err) => {
          if (err instanceof ApiError && err.status === 403) return;
        });
        return;
      }

      if (isPlayingChanged) {
        const positionMs = Math.max(0, Math.floor(state.progress * 1000));
        api.post(`/rooms/${roomId}/control`, {
          kind: state.isPlaying ? 'play' : 'pause',
          positionMs,
        }).catch(() => { /* ignore */ });
      }

      if (seekJumped) {
        api.post(`/rooms/${roomId}/control`, {
          kind: 'seek',
          positionMs: Math.max(0, Math.floor(state.progress * 1000)),
        }).catch(() => { /* ignore */ });
      }
    });
    return () => { unsub(); };
  }, [roomId, isHost]);
}
