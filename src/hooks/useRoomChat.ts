import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { useT } from '@/i18n';
import type { RoomChatPoll, RoomMessage } from '@/types/rooms';

/**
 * Polling cadence for the chat list. The hook's primary delivery path
 * is now the per-room WebSocket (see worker/src/do/ChatRoomDO.ts);
 * polling is kept as a robustness fallback so a dropped socket, a
 * dev-tools breakpoint or a flapping connection still surface new
 * messages within a few seconds.
 *
 *   - `ACTIVE`: tab is visible AND the document has focus. Cadence is
 *     loose because the WebSocket should be carrying real-time updates
 *     — polling here just covers the edge case where the socket
 *     dropped without a clean close event yet.
 *   - `BLURRED`: tab is visible but unfocused (user typing in another
 *     window). Slightly slower so we don't burn battery on a chat
 *     nobody is currently watching.
 *   - `HIDDEN`: tab is in the background or the device is asleep.
 *     We mostly trust the browser to throttle setTimeout there
 *     anyway, but pick a long interval so we don't fire a burst of
 *     stale requests when the tab wakes up.
 *   - `WS_BROKEN`: WebSocket isn't currently delivering. Drop back to
 *     the original 0.9 s cadence so the user still sees other people's
 *     messages within ~1 beat even if the socket can't be re-opened.
 */
const POLL_INTERVAL_ACTIVE_MS = 4000;
const POLL_INTERVAL_BLURRED_MS = 6000;
const POLL_INTERVAL_HIDDEN_MS = 12000;
const POLL_INTERVAL_WS_BROKEN_MS = 900;
const MAX_MESSAGES_KEPT = 400;

/**
 * Where to send the WebSocket upgrade request. Mirrors `API_BASE` from
 * `@/lib/api` but rewritten with the `wss:` scheme. We resolve the
 * URL lazily so a hostile DOM (`window.location` clobber etc.) can't
 * affect the choice — we only consult `import.meta.env.VITE_API_URL`,
 * the same env var the REST client uses.
 */
function chatWsUrl(roomId: string, token: string): string {
  const base = (import.meta.env.VITE_API_URL as string | undefined)
    ?? 'https://bratan-music-api.bratan-corp.workers.dev';
  const wsBase = base.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:');
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
   * Stable React-key for the row that survives the swap of an
   * optimistic row (negative `id`) for the canonical server row
   * (positive `id`). Without this, `<AnimatePresence>` sees the key
   * change as an exit-then-enter and replays the row's entrance
   * animation a second time the moment the server echo lands —
   * exactly the "double pop on send" the user reported. Pending
   * rows get a random `clientKey` at insert time and we carry it
   * over when we replace them with the real row.
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
 *   - First call to `GET /rooms/:id/chat` returns the most recent
 *     ~100 messages in ascending order so the UI has something to
 *     render immediately.
 *   - After that we poll `?since=<lastId>` every 2.5s. The endpoint
 *     returns only messages strictly newer than the cursor, so the
 *     poll cost is constant regardless of room age.
 *   - `send()` writes an **optimistic** row to local state immediately
 *     (negative id, `pending: true`) so the sender sees their message
 *     before the network round-trip lands. When the POST resolves, the
 *     placeholder is replaced with the real row by tempId. On failure
 *     the placeholder flips to `failed: true` so the UI can mark it.
 *
 * The hook caps history at `MAX_MESSAGES_KEPT` rows in memory so a
 * long-running session doesn't grow without bound.
 */
export function useRoomChat(roomId: string | undefined): UseRoomChatResult {
  const me = useAuthStore((s) => s.user);
  const t = useT();
  const [messages, setMessages] = useState<UiRoomMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const lastIdRef = useRef(0);
  const cancelledRef = useRef(false);

  // Stable merge — order, dedupe, advance cursor, cap memory. Pending
  // optimistic rows (id < 0) stay at the tail until they get replaced
  // with their server-side counterparts in `send`.
  //
  // Race-condition guard for the "double pop on send" the user has
  // reported: the WebSocket can deliver our OWN echo back before
  // `send()`'s POST has resolved. Without special handling the WS row
  // is treated as a brand-new message, gets appended with a fresh
  // `srv-${id}` React key, and `<AnimatePresence>` plays the
  // entrance animation a SECOND time on top of the optimistic row
  // (which is still sitting in the list waiting for `send()` to
  // reconcile it). When the POST finally lands, `send()` then dedupes
  // by `m.id === real.id`, removing the WS row — and that exit
  // triggers another visible flicker.
  //
  // We can't fix the race upstream (the broadcast is racing the
  // HTTP response on different paths), but we CAN match incoming
  // confirmed rows against pending optimistic rows by sender + body
  // and merge them in place, preserving the optimistic row's
  // `clientKey` so React/Motion treat it as the same row. Result:
  // a single entrance animation regardless of whether WS or POST
  // wins the race.
  const mergeMessages = useCallback((incoming: RoomMessage[]) => {
    setMessages((prev) => {
      const seen = new Set(prev.map((m) => m.id));
      const working: UiRoomMessage[] = prev.slice();
      for (const m of incoming) {
        if (seen.has(m.id)) continue;
        if (m.id >= 0) {
          // Try to absorb this confirmed row into a pending
          // optimistic row from the same sender carrying the same
          // body. We only match the FIRST such pending row so
          // back-to-back identical messages still each get their
          // own server row.
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

  // Holds the latest `tick` so external callers (`send`,
  // visibilitychange / focus listeners) can request an immediate
  // poll without having to manage their own timers. Re-bound on each
  // render via `tickRef.current = tick` below.
  const pokeRef = useRef<() => void>(() => {});

  // Initial fetch + adaptive polling loop + WebSocket live-stream.
  //
  // The WebSocket is the primary delivery channel: every message is
  // broadcast from the worker right after the D1 commit lands (see
  // `worker/src/do/ChatRoomDO.ts`), so the receiver typically sees
  // it within ~50 ms RTT. Polling sticks around as a robustness
  // fallback — if the socket drops or fails to upgrade we fall back
  // to the original 0.9 s cadence so the chat keeps working.
  //
  // The interval is recomputed on every tick, on every visibility /
  // focus change, and on socket open/close so we widen it as soon as
  // the WS is delivering messages and tighten it the moment it isn't.
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
      // Coalesce overlapping pokes — if a request is already in
      // flight just let it land, the response will trigger the next
      // schedule.
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
          // Membership has been revoked under us — bail out and let
          // the parent page handle the redirect.
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
      // Fire-and-forget — the function is async but callers
      // (event listeners, `send`) don't need to wait for it.
      void tick();
    };

    /** Reschedule the next poll relative to "right now" using the
     *  current cadence. Called when the WS state flips so the polling
     *  loop tightens or loosens immediately, not on the next cycle. */
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
        // Without a token we can't authenticate the upgrade; let
        // polling carry the channel and try again on next reconnect.
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
        // Don't flip wsHealthy here — wait for the `hello` envelope so
        // we know the DO accepted us, not just that TCP/TLS finished.
        // (The DO sends `hello` synchronously after `accept()`.)
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
          // Corrupt frame — ignore. Next message or polling tick will
          // cover the row if it matters.
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
        // Re-arm the socket if it was torn down while the tab was hidden.
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

      // 1. Build an optimistic row keyed by a unique negative id +
      //    a stable `clientKey`. The `clientKey` is what React uses
      //    as the row's identity inside `<AnimatePresence>`, so when
      //    the server echo lands and we replace `id` with the real
      //    positive id below, the row keeps the same key and does
      //    NOT replay its entrance animation.
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
          // Server didn't echo a row — drop the optimistic placeholder
          // and rely on the next poll. Shouldn't happen but is safe.
          setMessages((prev) => prev.filter((m) => m.clientKey !== clientKey));
          return;
        }
        // 2. Replace the optimistic row IN PLACE — same `clientKey`,
        //    same array slot — so React/Motion treats this as an
        //    update of the existing row, not an exit + enter. The
        //    pending dim reverts and `id` flips to the real one
        //    without any visible animation. Also drop any duplicate
        //    that the next poll might have already merged.
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
