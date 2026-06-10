import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, API_BASE } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { useT } from '@/i18n';
import type { RoomChatPoll, RoomMessage } from '@/types/rooms';

/**
 * Polling cadences. WebSocket is the primary delivery path (see
 * worker/src/do/ChatRoomDO.ts); polling is a fallback for dropped
 * sockets / breakpoints / flaps.
 *
 *   - ACTIVE: visible+focused. Loose — WS handles real-time.
 *   - BLURRED: visible+unfocused. Slower so we don't burn battery.
 *   - HIDDEN: background/asleep. Long interval so wake-ups don't
 *     fire a burst of stale requests.
 *   - WS_BROKEN: WS not delivering. Tight 0.9 s so users still see
 *     messages within ~1 beat.
 */
const POLL_INTERVAL_ACTIVE_MS = 4000;
const POLL_INTERVAL_BLURRED_MS = 6000;
const POLL_INTERVAL_HIDDEN_MS = 12000;
const POLL_INTERVAL_WS_BROKEN_MS = 900;
const MAX_MESSAGES_KEPT = 400;

/**
 * WebSocket upgrade URL — `API_BASE` rewritten with `wss:`. `API_BASE`
 * is sourced only from `import.meta.env.VITE_API_URL` (build-time), so
 * a hostile DOM (window.location clobber) can't redirect the upgrade.
 */
function chatWsUrl(roomId: string, token: string): string {
  const wsBase = API_BASE.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:');
  return `${wsBase}/rooms/${encodeURIComponent(roomId)}/chat/ws?token=${encodeURIComponent(token)}`;
}

/** Reconnect schedule when the WebSocket fails. Exponential up to ~16s. */
const WS_BACKOFF_MS = [500, 1000, 2000, 4000, 8000, 16000] as const;

/** Optimistic-rendering metadata layered on top of `RoomMessage`. */
export interface UiRoomMessage extends RoomMessage {
  /** True while the row is local-only (server hasn't echoed it yet). */
  pending?: boolean;
  /** True if `send()` failed and the row should be marked as undelivered. */
  failed?: boolean;
  /**
   * Stable React key surviving the swap of an optimistic row
   * (negative `id`) for the canonical server row (positive `id`).
   * Prevents `<AnimatePresence>` from playing exit/enter on the
   * row identity change — same `clientKey` is preserved across
   * the replacement.
   */
  clientKey?: string;
}

interface UseRoomChatResult {
  messages: UiRoomMessage[];
  send: (body: string) => Promise<void>;
  /** True while at least one message is in-flight; the composer can use this
   *  to render a soft hint but should NOT disable input on it. */
  sending: boolean;
  error: string | null;
}

/**
 * Polling-based chat for a listening room.
 *
 *   - Initial GET returns the most recent ~100 messages.
 *   - Subsequent polls use `?since=<lastId>` so cost stays constant
 *     regardless of room age.
 *   - `send()` writes an optimistic row (negative id, pending: true)
 *     immediately and reconciles it when POST resolves; on failure
 *     it flips to `failed: true`.
 *
 * History capped at MAX_MESSAGES_KEPT so a long session doesn't grow
 * without bound.
 */
export function useRoomChat(roomId: string | undefined): UseRoomChatResult {
  const me = useAuthStore((s) => s.user);
  const t = useT();
  const [messages, setMessages] = useState<UiRoomMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const lastIdRef = useRef(0);
  const cancelledRef = useRef(false);

  // Stable merge — order, dedupe, advance cursor, cap memory.
  // Pending optimistic rows (id < 0) stay at the tail until they're
  // replaced with their server-side counterparts in `send`.
  //
  // Race guard for "double pop on send": WS can deliver our OWN echo
  // before `send()`'s POST resolves. We absorb confirmed rows into
  // pending rows from the same sender+body, preserving the
  // optimistic row's `clientKey` so Motion sees a single entrance
  // animation regardless of whether WS or POST wins.
  const mergeMessages = useCallback((incoming: RoomMessage[]) => {
    setMessages((prev) => {
      const seen = new Set(prev.map((m) => m.id));
      const working: UiRoomMessage[] = prev.slice();
      for (const m of incoming) {
        if (seen.has(m.id)) continue;
        if (m.id >= 0) {
          // Match only the FIRST same-sender/body pending row —
          // back-to-back identical messages still get their own row.
          const pendingIdx = working.findIndex(
            (p) =>
              p.id < 0 &&
              p.pending === true &&
              p.userId === m.userId &&
              p.body === m.body,
          );
          if (pendingIdx >= 0) {
            const pending = working[pendingIdx]!;
            working[pendingIdx] = { ...m, clientKey: pending.clientKey };
            seen.add(m.id);
            continue;
          }
        }
        seen.add(m.id);
        working.push(m);
      }
      // Sort confirmed rows by id, then append still-pending rows so
      // they always render at the bottom regardless of arrival order.
      const confirmed = working.filter((m) => m.id >= 0).sort((a, b) => a.id - b.id);
      const pending = working.filter((m) => m.id < 0);
      const merged = confirmed.concat(pending);
      const top = confirmed[confirmed.length - 1];
      if (top && top.id > lastIdRef.current) lastIdRef.current = top.id;
      if (merged.length > MAX_MESSAGES_KEPT) {
        return merged.slice(merged.length - MAX_MESSAGES_KEPT);
      }
      return merged;
    });
  }, []);

  // Reset history when the active room changes (or the page unmounts).
  useEffect(() => {
    cancelledRef.current = false;
    lastIdRef.current = 0;
    setMessages([]);
    return () => {
      cancelledRef.current = true;
    };
  }, [roomId]);

  // Latest `tick` accessor so listeners (`send`, visibilitychange,
  // focus) can request an immediate poll without their own timers.
  const pokeRef = useRef<() => void>(() => {});

  // Initial fetch + adaptive polling + WebSocket live-stream.
  // Interval is recomputed on every tick / visibility / focus /
  // socket open-close so it widens once WS is delivering and
  // tightens the moment it isn't.
  useEffect(() => {
    if (!roomId) return;
    let timer: number | null = null;
    let inFlight = false;
    /** True while the WebSocket is open AND has received the `hello`
     *  greeting from the DO. While true, polling backs off to the
     *  loose intervals — we trust the socket to push new rows. */
    let wsHealthy = false;
    let socket: WebSocket | null = null;
    let reconnectAttempt = 0;
    let reconnectTimer: number | null = null;

    const computeIntervalMs = (): number => {
      if (typeof document === 'undefined') return POLL_INTERVAL_ACTIVE_MS;
      if (document.visibilityState === 'hidden') return POLL_INTERVAL_HIDDEN_MS;
      const blurred = typeof document.hasFocus === 'function' && !document.hasFocus();
      if (!wsHealthy) return POLL_INTERVAL_WS_BROKEN_MS;
      if (blurred) return POLL_INTERVAL_BLURRED_MS;
      return POLL_INTERVAL_ACTIVE_MS;
    };

    const tick = async () => {
      if (cancelledRef.current) return;
      // Coalesce overlapping pokes — the in-flight response will
      // trigger the next schedule.
      if (inFlight) return;
      if (timer !== null) {
        window.clearTimeout(timer);
        timer = null;
      }
      inFlight = true;
      try {
        const since = lastIdRef.current;
        const path = since > 0
          ? `/rooms/${roomId}/chat?since=${since}`
          : `/rooms/${roomId}/chat`;
        const res = await api.get<RoomChatPoll>(path);
        if (cancelledRef.current) return;
        if (res.messages.length) {
          mergeMessages(res.messages);
        }
        setError(null);
      } catch (err) {
        if (err instanceof ApiError && err.status === 403) {
          // Membership revoked — bail and let the parent page redirect.
          cancelledRef.current = true;
          return;
        }
        setError(err instanceof Error ? err.message : t('rooms.chat.errorChat'));
      } finally {
        inFlight = false;
        if (!cancelledRef.current) {
          timer = window.setTimeout(tick, computeIntervalMs());
        }
      }
    };

    pokeRef.current = () => {
      void tick();
    };

    /** Reschedule the next poll using the current cadence. Called
     *  on WS state flips so polling re-tunes immediately. */
    const reschedulePoll = () => {
      if (cancelledRef.current) return;
      if (timer !== null) {
        window.clearTimeout(timer);
        timer = null;
      }
      timer = window.setTimeout(tick, computeIntervalMs());
    };

    const closeSocket = (sock: WebSocket | null) => {
      if (!sock) return;
      try { sock.close(); } catch { /* already closed */ }
    };

    const scheduleReconnect = () => {
      if (cancelledRef.current) return;
      if (reconnectTimer !== null) return;
      const delay = WS_BACKOFF_MS[Math.min(reconnectAttempt, WS_BACKOFF_MS.length - 1)];
      reconnectAttempt += 1;
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null;
        if (!cancelledRef.current) openSocket();
      }, delay);
    };

    const openSocket = () => {
      if (cancelledRef.current) return;
      if (typeof WebSocket === 'undefined') return;
      const token = useAuthStore.getState().accessToken;
      if (!token) {
        // No token — can't authenticate the upgrade. Let polling
        // carry it and retry on next reconnect.
        scheduleReconnect();
        return;
      }
      let next: WebSocket;
      try {
        next = new WebSocket(chatWsUrl(roomId, token));
      } catch {
        scheduleReconnect();
        return;
      }
      socket = next;
      next.addEventListener('open', () => {
        // Wait for the `hello` envelope before flipping wsHealthy —
        // open just means TCP/TLS finished, not that the DO
        // accepted us.
      });
      next.addEventListener('message', (event) => {
        if (cancelledRef.current) return;
        const raw = typeof event.data === 'string' ? event.data : '';
        if (!raw) return;
        try {
          const env = JSON.parse(raw) as
            | { kind: 'hello'; serverNowMs?: number }
            | { kind: 'message'; message: RoomMessage };
          if (env.kind === 'hello') {
            wsHealthy = true;
            reconnectAttempt = 0;
            reschedulePoll();
            return;
          }
          if (env.kind === 'message' && env.message) {
            mergeMessages([env.message]);
          }
        } catch {
          // Corrupt frame — next message / polling tick covers it.
        }
      });
      const onLost = () => {
        if (socket !== next) return;
        socket = null;
        if (wsHealthy) {
          wsHealthy = false;
          reschedulePoll();
        }
        if (!cancelledRef.current) scheduleReconnect();
      };
      next.addEventListener('close', onLost);
      next.addEventListener('error', onLost);
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        void tick();
        // Re-arm the socket if it was torn down while hidden.
        if (!socket && reconnectTimer === null) openSocket();
      }
    };
    const onFocus = () => void tick();

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', onFocus);

    void tick();
    openSocket();
    return () => {
      if (timer !== null) window.clearTimeout(timer);
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      closeSocket(socket);
      socket = null;
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', onFocus);
      pokeRef.current = () => {};
    };
  }, [roomId, mergeMessages, t]);

  const send = useCallback(
    async (body: string) => {
      if (!roomId) return;
      const trimmed = body.trim();
      if (!trimmed) return;

      // 1. Optimistic row keyed by a negative id + stable
      //    `clientKey` — the row keeps its React key when we swap
      //    in the real positive id, so no re-entrance animation.
      const tempId = -(Date.now() * 1000 + Math.floor(Math.random() * 1000));
      const clientKey = `local-${tempId}`;
      const optimistic: UiRoomMessage = {
        id: tempId,
        userId: me?.id ?? 'me',
        username: me?.username ?? null,
        name: me?.name ?? null,
        body: trimmed,
        createdAtMs: Date.now(),
        pending: true,
        clientKey,
      };
      setMessages((prev) => [...prev, optimistic]);
      setPendingCount((n) => n + 1);

      try {
        const res = await api.post<{ message: RoomMessage }>(
          `/rooms/${roomId}/chat`,
          { body: trimmed },
        );
        const real = res?.message;
        if (!real) {
          // No echo — drop placeholder, rely on next poll.
          setMessages((prev) => prev.filter((m) => m.clientKey !== clientKey));
          return;
        }
        // 2. Replace the optimistic row in place — same `clientKey`,
        //    same slot — so Motion treats it as an update, not an
        //    exit/enter. Also drops any duplicate from a poll race.
        setMessages((prev) => {
          let replaced = false;
          const merged: UiRoomMessage[] = [];
          for (const m of prev) {
            if (m.clientKey === clientKey) {
              merged.push({ ...real, clientKey });
              replaced = true;
              continue;
            }
            if (m.id === real.id) continue;
            merged.push(m);
          }
          if (!replaced) merged.push({ ...real, clientKey });
          if (real.id > lastIdRef.current) lastIdRef.current = real.id;
          return merged.length > MAX_MESSAGES_KEPT
            ? merged.slice(merged.length - MAX_MESSAGES_KEPT)
            : merged;
        });
        setError(null);
        // Trigger an immediate background poll so any messages other
        // participants sent in the same window arrive without waiting
        // for the next scheduled tick.
        pokeRef.current();
      } catch (err) {
        // 3. Mark the optimistic row as failed so the UI can show a
        //    retry hint. Don't drop it — the user's text shouldn't
        //    silently disappear.
        setMessages((prev) =>
          prev.map((m) =>
            m.clientKey === clientKey ? { ...m, pending: false, failed: true } : m,
          ),
        );
        setError(err instanceof Error ? err.message : t('rooms.chat.sendFailed'));
      } finally {
        setPendingCount((n) => Math.max(0, n - 1));
      }
    },
    [roomId, me, t],
  );

  return { messages, send, sending: pendingCount > 0, error };
}
