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

/** Poll cadence — short so guests catch play/pause/seek within one
 *  tick; server short-circuits unchanged via `?since=<version>` so
 *  steady-state is a tiny round-trip. */
const POLL_INTERVAL_MS = 1500;
const HEARTBEAT_INTERVAL_MS = 20_000;
/** Drift past this triggers `seekAudio`. Loose enough that normal
 *  buffer jitter / clock skew doesn't cause audible choppy seeks. */
const HARD_SYNC_DRIFT_MS = 4000;
/** Local-progress jump threshold for "this was a user scrub".
 *  Anything bigger is a deliberate seek; smaller is natural advance. */
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
  explicit?: boolean;
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
    explicit: t.explicit,
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
  /** Highest `state.version` applied locally; passed as `?since=` */
  appliedVersion: number;
  /** True while writing room state into playerStore so the
   *  subscribe callback skips the feedback-loop push. */
  applying: boolean;
  /** Last (currentTrack.id, isPlaying, progress) baseline. */
  lastLocalTrackId: string | null;
  lastLocalIsPlaying: boolean;
  lastLocalProgress: number;
  /** `serverNow - localNow`. */
  serverClockOffsetMs: number;
  /** Last stream URL for this track (so unchanged polls don't reload). */
  appliedStreamUrlForTrackId: string | null;
  /** Pre-room shuffle/crossfade snapshot for restore. */
  savedShuffle: boolean | null;
  savedCrossfade: { on: boolean; dur: number } | null;
}

/**
 * Bridge between the global `<audio>` engine and a server-authoritative
 * listening room. Event-driven: the server bumps `state.version` on
 * each play/pause/seek/track-change and the bridge applies it once per
 * bump. No periodic drift correction — re-seeking on every poll is
 * audibly choppy; genuine divergence is caught at the next event.
 *
 * Mounted at the layout level so navigation doesn't drop the bridge.
 *
 * Room→local: track changes resolve a stream URL (uploads/overrides
 * via proxy, Tidal via JSON round-trip) and call
 * `setTrackAt(track, position, isPlaying)`; same-track changes toggle
 * play/pause locally. A drift past `HARD_SYNC_DRIFT_MS` triggers a
 * single `seekAudio` snap.
 *
 * Local→room: subscriber on playerStore POSTs control events when
 * `applying` is false (suppresses our own writes). Shuffle / crossfade
 * are saved+forced-off while connected because both would silently
 * desync from the host; restored on disconnect.
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

  // Save+restore shuffle/crossfade on connect/disconnect.
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

  // Polling loop.
  useEffect(() => {
    if (!roomId) {
      setLive(false);
      return;
    }
    let cancelled = false;
    let scheduled: number | null = null;

    const applyRoomState = async (state: RoomState, members: RoomMember[], serverNowMs: number) => {
      const r = refs.current;
      // Mirror state+members into the connection store so consumers
      // (room page, badge) stay in sync without their own /state poll.
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
          // Track change. Resolve URL lazily; failures abort the
          // apply and the next poll will retry.
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
          // Only replace the queue when it doesn't already contain
          // this track. An unconditional `setQueue([trackPayload])`
          // would destroy the host's own queue every time their
          // freshly chosen track round-tripped through `/state`,
          // killing next/prev, swipe, and auto-advance — all of which
          // resolve via `queue[idx + 1]`. Cold guests still need the
          // current track seeded so their queue UI lines up.
          const queueHasTrack = ps.queue.some((t) => t.id === trackPayload.id);
          if (!queueHasTrack) ps.setQueue([trackPayload]);
          r.appliedStreamUrlForTrackId = state.track.id;
        } else {
          // Same track, same URL: a play/pause/seek event. Apply only
          // what changed; never re-seek unconditionally.
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

      // Re-baseline so local→remote is judged against just-applied
      // state, not the stale baseline.
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
        // Mirror hostOnlyControl every poll regardless of version
        // bump — members must see toggle changes within one window.
        if (typeof res.hostOnlyControl === 'boolean') {
          const cs = useRoomConnectionStore.getState();
          if (cs.hostOnlyControl !== res.hostOnlyControl) {
            cs.setHostOnlyControl(res.hostOnlyControl);
          }
        }
        if (!res.unchanged && res.state) {
          await applyRoomState(res.state, res.members ?? [], res.serverNowMs);
        } else if (res.unchanged) {
          // Publish heartbeat-only `serverNowMs` so badge animations
          // get a fresh "isLive" tick.
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

  // Heartbeat so membership stays alive when nothing is changing
  // (otherwise the live-member chip turns grey).
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

  // Local→room: forward user-initiated track/play/pause/seek; the
  // `applying` ref suppresses pushes from our own applyRoomState writes.
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
        // Reset URL marker so the next poll forces a fresh resolve.
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
