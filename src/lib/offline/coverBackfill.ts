/**
 * One-shot cover-blob backfill for tracks / albums / playlists that
 * were saved offline before the CORS-aware `fetchCoverBlob` shipped.
 *
 * Background
 * ----------
 * Until the no-cors-fallback fix, `fetchCoverBlob` always used the
 * browser's default CORS-mode `fetch(url)`. Cover URLs on
 * `resources.tidal.com` are returned without any
 * `Access-Control-Allow-Origin` headers, so every CORS request
 * threw and the catch swallowed the error. The track was committed
 * to IndexedDB with `coverBlob: undefined`. While the user was
 * online the UI rendered the network `<img src={track.coverUrl}>`
 * just fine — the bug only surfaced once the device went offline,
 * the network URL failed, and `useOfflineCoverUrl` had no Blob to
 * hand back.
 *
 * Even after the new `fetchCoverBlob` lands, every track / album /
 * playlist that was saved with the old shape stays missing its
 * cover until the user re-saves it. Asking the user to re-save
 * dozens of albums to "reset" their offline library is a hostile
 * UX, so this module walks the existing IndexedDB rows on app
 * boot and backfills the missing covers in the background.
 *
 * Behaviour
 * ---------
 *   - Runs once per session, gated by the in-memory `started`
 *     flag. We don't persist a "backfill complete" flag because
 *     the operation is idempotent — entries that already have a
 *     `coverBlob` are skipped on every walk, and the cost of one
 *     `listTracks/Albums/Playlists` per session is tiny.
 *   - Yields back to the event loop after every entity (10ms
 *     delay) so we don't block the main thread on a large
 *     offline library.
 *   - Network-only — doesn't run when `navigator.onLine === false`.
 *     Re-attaches an `online` listener that re-runs the backfill
 *     on the next reconnect.
 *   - Best-effort — every fetch can silently fail (the underlying
 *     `fetchCoverBlob` already swallows errors). Failed entities
 *     stay un-backfilled and we'll try again on the next online
 *     event / next app boot.
 */
import * as db from './db';
import { fetchCoverBlob } from './streamResolver';

let started = false;

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** A cover entry needs a fresh network refetch when:
 *    • it has no `coverBlob` at all, OR the Blob is zero bytes —
 *      the earlier `no-cors` shape of `fetchCoverBlob` returned an
 *      *opaque* Response whose `.blob()` came back at zero bytes on
 *      Safari / WebKit; we wrote that empty Blob to IndexedDB which
 *      is now truthy but unrenderable, and `<img>` fires `onerror`
 *      so the user sees the placeholder glyph. */
function needsBlobRefetch(blob: Blob | undefined): boolean {
  if (!blob) return true;
  if (typeof blob.size === 'number' && blob.size === 0) return true;
  return false;
}

/** A cover entry needs the iOS-safe `coverBytes` ArrayBuffer
 *  populated when it has a usable `coverBlob` but no bytes mirror.
 *  These are entries saved before the bytes field shipped. iOS
 *  Safari occasionally evicts a Blob's backing bytes while keeping
 *  the Blob shell alive, so the cover stops rendering on PWA
 *  standalone offline reads. We heal by materialising bytes from
 *  the existing Blob via `blob.arrayBuffer()` — no network needed. */
function missingBytesMirror(
  blob: Blob | undefined,
  bytes: ArrayBuffer | undefined,
): boolean {
  if (bytes && bytes.byteLength > 0) return false;
  if (blob && (!('size' in blob) || blob.size > 0)) return true;
  return false;
}

async function materialiseBytesFromBlob(
  blob: Blob | undefined,
): Promise<ArrayBuffer | null> {
  if (!blob) return null;
  try {
    const buf = await blob.arrayBuffer();
    return buf.byteLength > 0 ? buf : null;
  } catch {
    return null;
  }
}

async function backfillTracks(): Promise<number> {
  let updated = 0;
  const tracks = await db.listTracks();
  for (const track of tracks) {
    if (needsBlobRefetch(track.coverBlob)) {
      if (!track.coverUrl) continue;
      const cover = await fetchCoverBlob(track.coverUrl);
      if (!cover) continue;
      await db.putTrack({
        ...track,
        coverBlob: cover.blob,
        coverBytes: cover.bytes,
        coverMimeType: cover.mimeType,
      });
      updated++;
      await sleep(10);
      continue;
    }
    if (missingBytesMirror(track.coverBlob, track.coverBytes)) {
      const bytes = await materialiseBytesFromBlob(track.coverBlob);
      if (!bytes) continue;
      await db.putTrack({ ...track, coverBytes: bytes });
      updated++;
      await sleep(10);
    }
  }
  return updated;
}

async function backfillAlbums(): Promise<number> {
  let updated = 0;
  const albums = await db.listAlbums();
  for (const album of albums) {
    if (needsBlobRefetch(album.coverBlob)) {
      if (!album.coverUrl) continue;
      const cover = await fetchCoverBlob(album.coverUrl);
      if (!cover) continue;
      await db.putAlbum({
        ...album,
        coverBlob: cover.blob,
        coverBytes: cover.bytes,
        coverMimeType: cover.mimeType,
      });
      updated++;
      await sleep(10);
      continue;
    }
    if (missingBytesMirror(album.coverBlob, album.coverBytes)) {
      const bytes = await materialiseBytesFromBlob(album.coverBlob);
      if (!bytes) continue;
      await db.putAlbum({ ...album, coverBytes: bytes });
      updated++;
      await sleep(10);
    }
  }
  return updated;
}

async function backfillPlaylists(): Promise<number> {
  let updated = 0;
  const playlists = await db.listPlaylists();
  for (const playlist of playlists) {
    if (needsBlobRefetch(playlist.coverBlob)) {
      if (!playlist.coverUrl) continue;
      const cover = await fetchCoverBlob(playlist.coverUrl);
      if (!cover) continue;
      await db.putPlaylist({
        ...playlist,
        coverBlob: cover.blob,
        coverBytes: cover.bytes,
        coverMimeType: cover.mimeType,
      });
      updated++;
      await sleep(10);
      continue;
    }
    if (missingBytesMirror(playlist.coverBlob, playlist.coverBytes)) {
      const bytes = await materialiseBytesFromBlob(playlist.coverBlob);
      if (!bytes) continue;
      await db.putPlaylist({ ...playlist, coverBytes: bytes });
      updated++;
      await sleep(10);
    }
  }
  return updated;
}

async function runBackfillOnce(): Promise<void> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
  try {
    const [t, a, p] = await Promise.all([
      backfillTracks(),
      backfillAlbums(),
      backfillPlaylists(),
    ]);
    if (t + a + p > 0) {
      // The offline store re-derives saved-id sets from IndexedDB on
      // mount and the `useOfflineCoverUrl` hook re-queries on every
      // `version` bump, so a manual cache-bump isn't strictly
      // required — but a single `console.info` makes the backfill
      // visible in the field if the user reports the bug again.
      console.info(
        `[offline] cover backfill: tracks=${t} albums=${a} playlists=${p}`,
      );
      // Best-effort kick the offline store to bump its `version` so
      // any currently-mounted `useOfflineCoverUrl` re-runs the
      // IndexedDB query and picks up the new blobs without waiting
      // for the next save / unsave. Lazy import to avoid a circular
      // dep through the store ↔ downloads bridge.
      try {
        const { useOfflineStore } = await import('@/store/offline');
        useOfflineStore.getState().bump();
      } catch {
        /* ignore — store may not be available in tests */
      }
    }
  } catch (err) {
    console.warn('[offline] cover backfill failed', err);
  }
}

/**
 * Kick off the one-shot backfill. Subsequent calls during the same
 * session are no-ops. Idempotent — safe to call from a React
 * effect or directly from `main.tsx`.
 */
export function startCoverBackfill(): void {
  if (started) return;
  started = true;
  // Fire-and-forget — we don't want to block app boot on this.
  void runBackfillOnce();
  if (typeof window !== 'undefined') {
    window.addEventListener('online', () => {
      void runBackfillOnce();
    });
  }
}
