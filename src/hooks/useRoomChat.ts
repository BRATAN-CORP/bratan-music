import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import type { RoomChatPoll, RoomMessage } from '@/types/rooms';

const POLL_INTERVAL_MS = 2500;
const MAX_MESSAGES_KEPT = 400;

/** Optimistic-rendering metadata layered on top of `RoomMessage`. */
export interface UiRoomMessage extends RoomMessage {
  /** True while the row is local-only (server hasn't echoed it yet). */
  pending?: boolean;
  /** True if `send()` failed and the row should be marked as undelivered. */
  failed?: boolean;
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
  const [messages, setMessages] = useState<UiRoomMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const lastIdRef = useRef(0);
  const cancelledRef = useRef(false);

  // Stable merge — order, dedupe, advance cursor, cap memory. Pending
  // optimistic rows (id < 0) stay at the tail until they get replaced
  // with their server-side counterparts in `send`.
  const mergeMessages = useCallback((incoming: RoomMessage[]) => {
    setMessages((prev) => {
      const seen = new Set(prev.map((m) => m.id));
      const combined = prev.slice();
      for (const m of incoming) {
        if (seen.has(m.id)) continue;
        seen.add(m.id);
        combined.push(m);
      }
      // Sort confirmed rows by id, then append still-pending rows so
      // they always render at the bottom regardless of arrival order.
      const confirmed = combined.filter((m) => m.id >= 0).sort((a, b) => a.id - b.id);
      const pending = combined.filter((m) => m.id < 0);
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

  // Initial fetch + polling loop.
  useEffect(() => {
    if (!roomId) return;
    let timer: number | null = null;

    const tick = async () => {
      if (cancelledRef.current) return;
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
        setError(err instanceof Error ? err.message : 'Ошибка чата');
      } finally {
        if (!cancelledRef.current) {
          timer = window.setTimeout(tick, POLL_INTERVAL_MS);
        }
      }
    };

    void tick();
    return () => {
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [roomId, mergeMessages]);

  const send = useCallback(
    async (body: string) => {
      if (!roomId) return;
      const trimmed = body.trim();
      if (!trimmed) return;

      // 1. Build an optimistic row keyed by a unique negative id. We
      //    use `-Date.now() - <jitter>` so concurrent sends never
      //    collide with each other (and never collide with server ids
      //    which are positive).
      const tempId = -(Date.now() * 1000 + Math.floor(Math.random() * 1000));
      const optimistic: UiRoomMessage = {
        id: tempId,
        userId: me?.id ?? 'me',
        username: me?.username ?? null,
        name: me?.name ?? null,
        body: trimmed,
        createdAtMs: Date.now(),
        pending: true,
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
          setMessages((prev) => prev.filter((m) => m.id !== tempId));
          return;
        }
        // 2. Swap the placeholder for the canonical row in-place,
        //    deduping in case the next poll already picked it up.
        setMessages((prev) => {
          const without = prev.filter((m) => m.id !== tempId && m.id !== real.id);
          const next: UiRoomMessage[] = [...without, real];
          const confirmed = next.filter((m) => m.id >= 0).sort((a, b) => a.id - b.id);
          const pending = next.filter((m) => m.id < 0);
          const merged = confirmed.concat(pending);
          if (real.id > lastIdRef.current) lastIdRef.current = real.id;
          return merged.length > MAX_MESSAGES_KEPT
            ? merged.slice(merged.length - MAX_MESSAGES_KEPT)
            : merged;
        });
        setError(null);
      } catch (err) {
        // 3. Mark the optimistic row as failed so the UI can show a
        //    retry hint. Don't drop it — the user's text shouldn't
        //    silently disappear.
        setMessages((prev) =>
          prev.map((m) => (m.id === tempId ? { ...m, pending: false, failed: true } : m)),
        );
        setError(err instanceof Error ? err.message : 'Не удалось отправить');
      } finally {
        setPendingCount((n) => Math.max(0, n - 1));
      }
    },
    [roomId, me],
  );

  return { messages, send, sending: pendingCount > 0, error };
}
