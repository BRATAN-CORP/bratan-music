import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuthStore } from '@/store/auth';
import { api, ApiError } from '@/lib/api';
import type { RoomDetail, RoomState, RoomStatePoll, RoomTrackSnapshot } from '@/types/rooms';

const API_BASE = import.meta.env.VITE_API_URL ?? 'https://bratan-music-api.bratan-corp.workers.dev';

const POLL_INTERVAL_MS = 1500;
const HEARTBEAT_INTERVAL_MS = 20_000;
// If our clock-corrected target playback position drifts further than
// this from the actual <audio> currentTime, we hard-seek the audio
// element. Lower numbers = tighter sync, higher numbers = less choppy.
const HARD_SYNC_DRIFT_MS = 800;

interface UseRoomPlayerArgs {
  roomId: string | undefined;
  initial: RoomDetail | undefined;
  audioRef: React.RefObject<HTMLAudioElement | null>;
}

export interface UseRoomPlayerResult {
  state: RoomState | null;
  members: RoomDetail['members'];
  hostId: string | null;
  serverClockOffsetMs: number;
  /** Computed playback position in ms based on serverNowMs delta. */
  positionMs: number;
  /** Local volume control — does NOT sync across the room. */
  volume: number;
  setVolume: (v: number) => void;
  muted: boolean;
  toggleMute: () => void;
  togglePlay: () => void;
  seek: (positionMs: number) => void;
  setTrack: (track: RoomTrackSnapshot, opts?: { positionMs?: number; isPaused?: boolean }) => void;
  /** Optimistic refetch: forces a state poll right now (e.g. after the
   *  user pressed a control button so the UI shows the new state ASAP). */
  refresh: () => void;
  /** True when we're more than HARD_SYNC_DRIFT_MS off the room clock. */
  outOfSync: boolean;
  /** Last error from polling/control. */
  error: string | null;
}

function buildStreamUrl(track: RoomTrackSnapshot, roomId: string, accessToken: string): string {
  const t = encodeURIComponent(accessToken);
  if (track.source === 'upload' || track.id.startsWith('upload:')) {
    const rawId = track.id.startsWith('upload:') ? track.id.slice('upload:'.length) : track.id;
    return `${API_BASE}/rooms/${roomId}/stream/upload/${encodeURIComponent(rawId)}?token=${t}`;
  }
  if (track.source === 'override') {
    return `${API_BASE}/rooms/${roomId}/stream/override/${encodeURIComponent(track.id)}?token=${t}`;
  }
  // Tidal: the stream URL is fetched server-side and returned as JSON.
  // The caller resolves that URL separately.
  return '';
}

/**
 * Drives a single `<audio>` element to mirror the server-side room
 * state. The hook polls `GET /rooms/:id/state` every 1.5s and reconciles:
 *
 *   - track changes      → load a fresh stream URL, optionally seek
 *   - pause/play changes → mirror to <audio>
 *   - drift > 800ms      → hard-seek the <audio> back to the target
 *
 * Volume / mute are intentionally NOT synced — the user's local volume
 * stays local, matching the spec ("громкость понятно что у каждого
 * своя"). Crossfade / infinite-playback also do not apply: the room is
 * authoritative about which track plays and exactly when to start it.
 */
export function useRoomPlayer({ roomId, initial, audioRef }: UseRoomPlayerArgs): UseRoomPlayerResult {
  const accessToken = useAuthStore((s) => s.accessToken);
  const [state, setState] = useState<RoomState | null>(initial?.state ?? null);
  const [members, setMembers] = useState<RoomDetail['members']>(initial?.members ?? []);
  const [hostId] = useState<string | null>(initial?.hostId ?? null);
  const [error, setError] = useState<string | null>(null);
  const [volume, setVolumeState] = useState(0.7);
  const [muted, setMuted] = useState(false);
  const [serverClockOffsetMs, setServerClockOffsetMs] = useState(0);
  const [tickNow, setTickNow] = useState(() => Date.now());
  const [pollNonce, setPollNonce] = useState(0);
  const [outOfSync, setOutOfSync] = useState(false);
  const [resolvedSrc, setResolvedSrc] = useState<{ trackId: string; url: string } | null>(null);

  // Apply server clock offset from any room response.
  const applyServerNow = useCallback((serverNowMs: number) => {
    setServerClockOffsetMs(serverNowMs - Date.now());
  }, []);

  useEffect(() => {
    if (initial) applyServerNow(initial.serverNowMs);
  }, [initial, applyServerNow]);

  // Polling loop.
  useEffect(() => {
    if (!roomId) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const since = state?.version ?? 0;
        const res = await api.get<RoomStatePoll>(`/rooms/${roomId}/state?since=${since}`);
        if (cancelled) return;
        applyServerNow(res.serverNowMs);
        if (!res.unchanged && res.state) {
          setState(res.state);
          if (res.members) setMembers(res.members);
        }
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof ApiError ? err.message : err instanceof Error ? err.message : '';
        setError(message || null);
      }
    };
    void tick();
    const id = window.setInterval(tick, POLL_INTERVAL_MS);
    return () => { cancelled = true; window.clearInterval(id); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, pollNonce]);

  // Heartbeat so the server keeps the membership row "live" even when
  // nothing is changing.
  useEffect(() => {
    if (!roomId) return;
    const tick = async () => {
      try {
        const res = await api.post<{ ok: boolean; serverNowMs: number }>(`/rooms/${roomId}/heartbeat`);
        applyServerNow(res.serverNowMs);
      } catch { /* ignore */ }
    };
    const id = window.setInterval(tick, HEARTBEAT_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [roomId, applyServerNow]);

  // Cheap 250ms tick so the position progress bar updates smoothly even
  // when the server state is unchanged.
  useEffect(() => {
    const id = window.setInterval(() => setTickNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, []);

  // Compute the *target* playback position based on the clock-corrected
  // server time. Frozen if paused.
  const positionMs = useMemo(() => {
    if (!state) return 0;
    if (state.isPaused) return state.positionMs;
    const correctedNow = tickNow + serverClockOffsetMs;
    return Math.max(0, state.positionMs + (correctedNow - state.startedAtMs));
  }, [state, tickNow, serverClockOffsetMs]);

  // Resolve the stream URL whenever the track changes.
  useEffect(() => {
    let cancelled = false;
    const track = state?.track;
    if (!track || !roomId || !accessToken) {
      setResolvedSrc(null);
      return;
    }
    if (resolvedSrc?.trackId === track.id) return;
    (async () => {
      try {
        if (track.source === 'tidal' && !track.id.startsWith('upload:')) {
          const res = await api.get<{ url: string }>(
            `/rooms/${roomId}/stream/tidal/${encodeURIComponent(track.id)}?quality=LOSSLESS`
          );
          if (!cancelled) setResolvedSrc({ trackId: track.id, url: res.url });
        } else {
          const url = buildStreamUrl(track, roomId, accessToken);
          if (!cancelled) setResolvedSrc({ trackId: track.id, url });
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Не удалось получить поток');
        }
      }
    })();
    return () => { cancelled = true; };
  }, [state?.track, roomId, accessToken, resolvedSrc?.trackId]);

  // Apply src + play/pause + seek on the `<audio>` element.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!resolvedSrc) return;

    if (audio.src !== resolvedSrc.url) {
      audio.src = resolvedSrc.url;
      audio.load();
    }
  }, [resolvedSrc, audioRef]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = muted ? 0 : volume;
  }, [volume, muted, audioRef]);

  // Reconcile play/pause state.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !state) return;
    if (state.isPaused) {
      if (!audio.paused) audio.pause();
    } else {
      if (audio.paused) {
        audio.play().catch(() => {/* autoplay block — user has to tap */});
      }
    }
  }, [state?.isPaused, audioRef, state]);

  // Hard-sync drift: if our currentTime is more than HARD_SYNC_DRIFT_MS
  // off the target, snap to the target. Threshold is intentionally
  // higher than what the player would reach naturally so we don't
  // fight the audio engine on small jitter.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !state) return;
    const targetSec = positionMs / 1000;
    const driftMs = Math.abs((audio.currentTime - targetSec) * 1000);
    setOutOfSync(driftMs > HARD_SYNC_DRIFT_MS);
    if (driftMs > HARD_SYNC_DRIFT_MS && Number.isFinite(targetSec) && targetSec >= 0) {
      try { audio.currentTime = targetSec; } catch { /* range error pre-load */ }
    }
  }, [positionMs, audioRef, state]);

  const refresh = useCallback(() => setPollNonce((n) => n + 1), []);

  const togglePlay = useCallback(async () => {
    if (!roomId || !state) return;
    try {
      if (state.isPaused) {
        const res = await api.post<{ state: RoomState; serverNowMs: number }>(
          `/rooms/${roomId}/control`, { kind: 'play' }
        );
        applyServerNow(res.serverNowMs);
        setState(res.state);
      } else {
        const audio = audioRef.current;
        const at = audio ? Math.floor(audio.currentTime * 1000) : positionMs;
        const res = await api.post<{ state: RoomState; serverNowMs: number }>(
          `/rooms/${roomId}/control`, { kind: 'pause', positionMs: at }
        );
        applyServerNow(res.serverNowMs);
        setState(res.state);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка управления');
    }
  }, [roomId, state, audioRef, positionMs, applyServerNow]);

  const seek = useCallback(async (target: number) => {
    if (!roomId) return;
    try {
      const res = await api.post<{ state: RoomState; serverNowMs: number }>(
        `/rooms/${roomId}/control`, { kind: 'seek', positionMs: Math.max(0, Math.floor(target)) }
      );
      applyServerNow(res.serverNowMs);
      setState(res.state);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка перемотки');
    }
  }, [roomId, applyServerNow]);

  const setTrack = useCallback(async (
    track: RoomTrackSnapshot,
    opts?: { positionMs?: number; isPaused?: boolean }
  ) => {
    if (!roomId) return;
    try {
      const res = await api.post<{ state: RoomState; serverNowMs: number }>(
        `/rooms/${roomId}/control`,
        { kind: 'track', track, positionMs: opts?.positionMs ?? 0, isPaused: opts?.isPaused ?? false },
      );
      applyServerNow(res.serverNowMs);
      setState(res.state);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось сменить трек');
    }
  }, [roomId, applyServerNow]);

  const setVolume = useCallback((v: number) => {
    setVolumeState(Math.max(0, Math.min(1, v)));
  }, []);
  const toggleMute = useCallback(() => setMuted((m) => !m), []);

  return {
    state,
    members,
    hostId,
    serverClockOffsetMs,
    positionMs,
    volume,
    setVolume,
    muted,
    toggleMute,
    togglePlay,
    seek,
    setTrack,
    refresh,
    outOfSync,
    error,
  };
}
