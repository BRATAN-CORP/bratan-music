/**
 * Offline-action replay queue.
 *
 * The premise: while the device is offline, the user can still tap
 * the heart on a track / album / artist, and the player can still
 * record a "significant play" event. Every such mutation that would
 * normally hit the worker is intercepted and dropped into this queue
 * instead. The queue lives in IndexedDB so a refresh / reboot /
 * cold-start on the way back to the network doesn't lose anything.
 *
 * On the way back up:
 *   - The browser fires `online` — we kick off a flush.
 *   - We also flush proactively at app boot (covers the case where
 *     the user closed the tab while offline and reopened it later
 *     while connectivity is fine but the `online` event was missed).
 *   - The flush walks the queue in FIFO order and replays each
 *     action against the worker via the same `api.*` helpers the
 *     online mutation hooks use. Successful entries are removed.
 *     Failures are bucketed:
 *       - Network error (`fetch` rejected, no `ApiError.status`)
 *         → leave the entry in place; we'll try again on the next
 *         flush. The user is still effectively offline.
 *       - 401 → bail out of the entire flush; the auth-refresh path
 *         in `api.ts` handles it. We'll retry once the user is
 *         re-authed.
 *       - 429 / 5xx → leave in place; transient.
 *       - Other 4xx → permanent. Bump `attempts` and drop after
 *         `MAX_ATTEMPTS` so a single rotten entry can't permanently
 *         block the queue.
 *
 * The replay path mutates server state — for likes that's fine
 * because the server is the source of truth for the canonical liked
 * set, and the client store has already optimistically updated. For
 * play history, the worker's "significant play" dedup window is
 * generous enough that a delayed beacon doesn't double-count.
 */

import { api, ApiError } from '@/lib/api';
import { queryClient } from '@/lib/queryClient';
import {
  countSyncEntries,
  deleteSyncEntry,
  listSyncEntries,
  putSyncEntry,
} from './db';
import type {
  SyncAction,
  SyncQueueEntry,
} from './types';

const MAX_ATTEMPTS = 5;

interface SyncListener {
  (state: { pending: number; flushing: boolean }): void;
}

const listeners = new Set<SyncListener>();
let flushing = false;
let flushPending = false;

function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  // Fallback for older browsers — good enough for a row id.
  return `sync-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

async function notify(): Promise<void> {
  const pending = await countSyncEntries().catch(() => 0);
  for (const l of listeners) l({ pending, flushing });
}

export function subscribeSyncQueue(listener: SyncListener): () => void {
  listeners.add(listener);
  void notify();
  return () => {
    listeners.delete(listener);
  };
}

export async function enqueueSync(action: SyncAction): Promise<void> {
  const entry: SyncQueueEntry = {
    id: uuid(),
    enqueuedAt: Date.now(),
    action,
    attempts: 0,
  };
  await putSyncEntry(entry);
  await notify();
  // If we happen to be online, fire off a flush right now so the
  // queue is empty by the time the user navigates away. The flush
  // is a no-op when offline (every replay will just fail and the
  // entry stays put).
  if (typeof navigator !== 'undefined' && navigator.onLine) {
    void flushSyncQueue();
  }
}

async function replayAction(action: SyncAction): Promise<void> {
  switch (action.kind) {
    case 'like-track':
      await api.post(`/library/like/${action.trackId}`, action.snapshot);
      return;
    case 'unlike-track':
      await api.delete(`/library/like/${action.trackId}`);
      return;
    case 'like-album':
      await api.post(`/library/items/album/${action.albumId}`, action.snapshot);
      return;
    case 'unlike-album':
      await api.delete(`/library/items/album/${action.albumId}`);
      return;
    case 'like-artist':
      await api.post(`/library/items/artist/${action.artistId}`, action.snapshot);
      return;
    case 'unlike-artist':
      await api.delete(`/library/items/artist/${action.artistId}`);
      return;
    case 'log-play':
      await api.post(`/history/play`, action.payload);
      return;
  }
}

/** Replay every pending action against the worker, FIFO. Idempotent
 *  enough that calling concurrently is safe (the second caller is
 *  ignored while the first is running) and that calling at boot
 *  with an empty queue is a fast no-op. */
export async function flushSyncQueue(): Promise<void> {
  if (flushing) {
    flushPending = true;
    return;
  }
  flushing = true;
  await notify();
  try {
    let ran: boolean;
    do {
      ran = false;
      const entries = await listSyncEntries().catch(() => [] as SyncQueueEntry[]);
      for (const entry of entries) {
        if (typeof navigator !== 'undefined' && !navigator.onLine) {
          // Connectivity dropped mid-flush — leave the rest in
          // place and bail out cleanly. The next `online` event
          // will pick up where we left off.
          return;
        }
        try {
          await replayAction(entry.action);
          await deleteSyncEntry(entry.id);
          ran = true;
        } catch (err) {
          if (err instanceof ApiError) {
            // 401 is handled by the auth refresh path inside `api`;
            // by the time it propagates here, the refresh failed —
            // bail and let the user re-auth before we try again.
            if (err.status === 401) return;
            // 429 / 5xx → transient, retry on next flush tick.
            if (err.status === 429 || err.status >= 500) {
              entry.attempts += 1;
              entry.lastError = err.message;
              if (entry.attempts >= MAX_ATTEMPTS) {
                await deleteSyncEntry(entry.id).catch(() => undefined);
              } else {
                await putSyncEntry(entry).catch(() => undefined);
              }
              continue;
            }
            // 4xx (other than 401/429) → permanent. The worker said
            // no, retrying won't help. Drop the entry.
            await deleteSyncEntry(entry.id).catch(() => undefined);
            continue;
          }
          // Plain Error (network failed, no status) → keep the
          // entry, leave the loop, wait for next `online`.
          return;
        }
      }
      // If a new entry was enqueued mid-flush, run another pass so
      // the user sees their full history of offline actions land
      // before they navigate back to the library.
    } while (ran && flushPending);
    flushPending = false;
  } finally {
    flushing = false;
    await notify();
    // Refetch the slices most likely to have drifted from server
    // state during the offline session. A blanket invalidate is
    // wasteful (and will refetch the entire library) but
    // narrowing to the four keys we know we touched keeps the
    // network footprint small.
    queryClient.invalidateQueries({ queryKey: ['liked'] });
    queryClient.invalidateQueries({ queryKey: ['library', 'album'] });
    queryClient.invalidateQueries({ queryKey: ['library', 'artist'] });
    queryClient.invalidateQueries({ queryKey: ['recent'] });
  }
}

/** Wire the queue to `navigator.onLine`. Mounted once from
 *  `wireOfflineBridge` at app boot. */
export function startSyncQueueAutoFlush(): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const onOnline = () => {
    void flushSyncQueue();
  };
  window.addEventListener('online', onOnline);
  // Also run once on boot to drain anything queued from a previous
  // session.
  if (navigator.onLine) {
    void flushSyncQueue();
  }
  return () => {
    window.removeEventListener('online', onOnline);
  };
}
