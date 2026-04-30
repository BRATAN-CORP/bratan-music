import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import type { RoomChatPoll, RoomMessage } from '@/types/rooms';

const POLL_INTERVAL_MS = 2500;
const MAX_MESSAGES_KEPT = 400;

interface UseRoomChatResult {
  messages: RoomMessage[];
  send: (body: string) => Promise<void>;
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
 *   - `send()` POSTs to `/rooms/:id/chat`. On success we splice the
 *     created row in immediately so the sender sees their message
 *     before the next poll lands. The next poll (which will return
 *     the same row again) is deduped by id below.
 *
 * The hook caps history at `MAX_MESSAGES_KEPT` rows in memory so a
 * long-running session doesn't grow without bound.
 */
export function useRoomChat(roomId: string | undefined): UseRoomChatResult {
  const [messages, setMessages] = useState<RoomMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const lastIdRef = useRef(0);
  const cancelledRef = useRef(false);

  // Stable merge — order, dedupe, advance cursor, cap memory.
  const mergeMessages = useCallback((incoming: RoomMessage[]) => {
    setMessages((prev) => {
      const seen = new Set(prev.map((m) => m.id));
      const combined = prev.slice();
      for (const m of incoming) {
        if (seen.has(m.id)) continue;
        seen.add(m.id);
        combined.push(m);
      }
      combined.sort((a, b) => a.id - b.id);
      const top = combined[combined.length - 1];
      if (top && top.id > lastIdRef.current) lastIdRef.current = top.id;
      if (combined.length > MAX_MESSAGES_KEPT) {
        return combined.slice(combined.length - MAX_MESSAGES_KEPT);
      }
      return combined;
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
      setSending(true);
      try {
        const res = await api.post<{ message: RoomMessage }>(
          `/rooms/${roomId}/chat`,
          { body: trimmed },
        );
        if (res?.message) mergeMessages([res.message]);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Не удалось отправить');
      } finally {
        setSending(false);
      }
    },
    [roomId, mergeMessages],
  );

  return { messages, send, sending, error };
}
