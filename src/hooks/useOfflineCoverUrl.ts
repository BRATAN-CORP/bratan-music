/**
 * Resolves the best available cover URL for a track / album / playlist,
 * preferring the locally-cached blob (rendered via
 * `URL.createObjectURL`) whenever the entity is saved offline so the
 * tile renders even with the network down.
 *
 * Why this exists
 * ---------------
 * The download pipeline already snapshots the cover image into
 * IndexedDB as a `Blob` (`OfflineTrack.coverBlob`,
 * `OfflineAlbum.coverBlob`, `OfflinePlaylist.coverBlob`), but the UI
 * was still binding `<img src={...coverUrl}>` to the network URL. On
 * a phone with no signal the request fails, the browser swaps the
 * image out for the broken-image glyph, and the fallback `Disc3` /
 * initials placeholder takes over — exactly the "обложки не
 * сохранились" bug the user reported.
 *
 * Behaviour
 * ---------
 *   - When the entity id is in the offline cache AND the saved row
 *     has a `coverBlob`, we return `URL.createObjectURL(blob)`.
 *   - When it isn't (anonymous viewer, never saved, or the blob
 *     wasn't successfully captured at download time), we return the
 *     network `coverUrl` fallback the caller already had.
 *   - When neither is available we return `undefined`, matching
 *     `<img src={undefined}>` semantics so `<CoverFallback>` and
 *     `onError` placeholders keep working.
 *
 * Cache and lifecycle
 * -------------------
 *   - The blob lookup is keyed by `(kind, id, version)` where
 *     `version` is the offline store's mutation counter, so the
 *     cache invalidates automatically the moment a track/album/
 *     playlist is added to or removed from the offline store.
 *   - We allocate one object URL per resolution and `revokeObjectURL`
 *     it on unmount / dependency change. This matters: leaked blob
 *     URLs hold their backing data alive in memory and the offline
 *     store can grow into the hundreds of saved tracks.
 */
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useOfflineStore } from '@/store/offline';
import * as db from '@/lib/offline/db';

type OfflineCoverKind = 'track' | 'album' | 'playlist';

/** Distill a usable Blob out of a saved IDB row regardless of which
 *  storage shape the row was written in. Returns a brand-new in-memory
 *  Blob constructed from the structured-cloned `coverBytes`
 *  ArrayBuffer when present, falling back to materialising bytes from
 *  the legacy `coverBlob` so iOS Safari (which sometimes evicts the
 *  Blob's backing store while keeping the shell alive) gets a fresh
 *  in-memory Blob to feed `URL.createObjectURL`. Returns `null` for
 *  zero-byte / unreadable rows so the caller can fall through to the
 *  parent-collection fallback or the placeholder glyph. */
async function pickUsableBlob(
  source:
    | { coverBlob?: Blob; coverBytes?: ArrayBuffer; coverMimeType?: string }
    | null
    | undefined,
): Promise<Blob | null> {
  if (!source) return null;
  const mime = source.coverMimeType ?? source.coverBlob?.type ?? 'image/jpeg';
  if (source.coverBytes && source.coverBytes.byteLength > 0) {
    return new Blob([source.coverBytes], { type: mime });
  }
  const blob = source.coverBlob;
  if (!blob) return null;
  if (typeof blob.size === 'number' && blob.size === 0) return null;
  // Re-materialise the legacy Blob's underlying bytes synchronously
  // into an in-memory ArrayBuffer, then build a fresh Blob from that.
  // iOS Safari WKWebView (15-17, including the standalone PWA shell)
  // occasionally evicts a Blob's file-backed bytes between page
  // loads while keeping the Blob shell alive — `URL.createObjectURL`
  // on the resurrected Blob then yields a URL `<img>` can no longer
  // decode and the user falls back to the placeholder glyph offline.
  // Reading via `.arrayBuffer()` forces WebKit to load the bytes and
  // the resulting fresh Blob survives the next eviction cycle. The
  // `coverBackfill` pass will commit these bytes back to IDB on the
  // next online tick so subsequent reads skip this rematerialisation.
  try {
    const bytes = await blob.arrayBuffer();
    if (bytes.byteLength === 0) return null;
    return new Blob([bytes], { type: mime });
  } catch {
    return null;
  }
}

/** Pull a usable cover blob from the parent album row, if any. Used
 *  as a fallback when a track's own `coverBlob` is missing — most
 *  non-single tracks share artwork with their album anyway, so this
 *  is the cheapest way to keep offline track lists / the player
 *  visually intact while the next `coverBackfill` pass heals the
 *  per-track row. */
async function readBlobFromAlbumId(
  albumId: string | undefined,
): Promise<Blob | null> {
  if (!albumId) return null;
  try {
    const album = await db.getAlbum(albumId);
    return await pickUsableBlob(album);
  } catch {
    return null;
  }
}

/** Walk the track's `collections` list (`["album:123","playlist:abc"]`)
 *  for any saved playlist that still carries a renderable cover blob.
 *  Last-ditch fallback before we give up and let the caller render
 *  the placeholder glyph. */
async function readBlobFromCollections(
  collections: string[] | undefined,
): Promise<Blob | null> {
  if (!collections || collections.length === 0) return null;
  for (const c of collections) {
    if (!c.startsWith('playlist:')) continue;
    const id = c.slice('playlist:'.length);
    try {
      const playlist = await db.getPlaylist(id);
      const blob = await pickUsableBlob(playlist);
      if (blob) return blob;
    } catch {
      // Skip unreadable rows; the next collection might still have a
      // healthy blob.
    }
  }
  return null;
}

/**
 * @param kind     Which IndexedDB store to look the entity up in.
 * @param id       Entity id. `null`/`undefined` short-circuits to fallback.
 * @param fallback Network cover URL used when the entity isn't saved
 *                 offline or its blob is missing.
 */
export function useOfflineCoverUrl(
  kind: OfflineCoverKind,
  id: string | null | undefined,
  fallback: string | null | undefined,
): string | undefined {
  // Subscribing to `version` here means every save / unsave / metadata
  // refresh in the offline store re-runs the query key derivation —
  // the cache effectively invalidates on every relevant mutation
  // without us needing to plumb explicit invalidations through.
  const version = useOfflineStore((s) => s.version);
  const isSaved = useOfflineStore((s) => {
    if (!id) return false;
    if (kind === 'track') return s.savedTrackIds.has(id);
    if (kind === 'album') return s.savedAlbumIds.has(id);
    return s.savedPlaylistIds.has(id);
  });

  const { data: blob } = useQuery<Blob | null>({
    queryKey: ['offline-cover', kind, id, version],
    enabled: !!id && isSaved,
    queryFn: async () => {
      if (!id) return null;
      const entity =
        kind === 'track'
          ? await db.getTrack(id)
          : kind === 'album'
            ? await db.getAlbum(id)
            : await db.getPlaylist(id);
      const direct = await pickUsableBlob(entity);
      if (direct) return direct;

      // Pre-PR-#350 saves wrote *zero-byte* opaque-response Blobs
      // into IndexedDB (Safari / WebKit issue with `mode: 'no-cors'`
      // — the response is opaque and `.blob()` returns size 0). Those
      // blobs are truthy but unrenderable: `<img src=blob:...>` fires
      // `onerror` and the user sees the fallback glyph. The
      // `coverBackfill` pass heals them when the device next comes
      // online, but until that lands we still need to render *some*
      // cover for the offline player and track list — exactly what
      // the user reported as missing ("обложки в офлайн режиме всё
      // равно не отображаются").
      //
      // For tracks AND albums / playlists alike, fall back to a
      // parent collection's cover when the entity's own blob is
      // missing or unrenderable. Tracks structurally share artwork
      // with their album / playlist, so this keeps offline track
      // rows intact even when the per-track CDN fetch failed.
      if (kind === 'track') {
        const track = entity as { albumId?: string; collections?: string[] } | null;
        const albumBlob = await readBlobFromAlbumId(track?.albumId);
        if (albumBlob) return albumBlob;
        const playlistBlob = await readBlobFromCollections(track?.collections);
        if (playlistBlob) return playlistBlob;
      }

      return null;
    },
    // Cover blobs don't change after download — only on a brand-new
    // save, which bumps `version` and invalidates the key. So we can
    // mark the result fresh forever within a key window.
    staleTime: Infinity,
    gcTime: 5 * 60 * 1000,
  });

  // We hold the resolved URL in state so we can manage the
  // `URL.createObjectURL` / `revokeObjectURL` lifecycle in a single
  // useEffect — calling `createObjectURL` directly inside the render
  // body would leak a fresh URL on every re-render.
  const [url, setUrl] = useState<string | undefined>(() => fallback ?? undefined);

  useEffect(() => {
    if (blob) {
      const obj = URL.createObjectURL(blob);
      setUrl(obj);
      return () => {
        URL.revokeObjectURL(obj);
      };
    }
    setUrl(fallback ?? undefined);
    return undefined;
  }, [blob, fallback]);

  return url;
}

/**
 * Resolve a stable object-URL from a `Blob` directly, with a network
 * URL fallback. Use this when the caller already has the offline
 * entity in hand (e.g. the `OfflineLibraryTab` render maps over
 * `OfflineAlbum[]` returned from IndexedDB) so we skip the round-trip
 * back through the offline store. Manages
 * `createObjectURL`/`revokeObjectURL` lifecycle for the caller.
 */
export function useBlobObjectUrl(
  blob: Blob | null | undefined,
  fallback: string | null | undefined,
): string | undefined {
  const [url, setUrl] = useState<string | undefined>(() => fallback ?? undefined);
  useEffect(() => {
    // Same zero-byte guard as `useOfflineCoverUrl` — pre-PR-#350
    // saves wrote opaque 0-byte Blobs to IDB, and `URL.createObjectURL`
    // on those blobs yields a URL the `<img>` element can't decode.
    // Fall back to the network URL so the user at least sees the
    // cover while online and the next `coverBackfill` pass heals
    // the saved row.
    const usable = blob && (typeof blob.size !== 'number' || blob.size > 0);
    if (!usable) {
      setUrl(fallback ?? undefined);
      return undefined;
    }
    // Re-materialise bytes via `arrayBuffer()` and rebuild a fresh
    // in-memory Blob — iOS Safari sometimes evicts the original
    // Blob's backing store while keeping the shell alive, so a
    // direct `URL.createObjectURL(blob)` would yield an undecodable
    // URL on PWA standalone offline reads. See `useOfflineCoverUrl`
    // for the full rationale.
    let cancelled = false;
    let obj: string | null = null;
    blob.arrayBuffer().then((bytes) => {
      if (cancelled) return;
      const fresh = new Blob([bytes], { type: blob.type || 'image/jpeg' });
      obj = URL.createObjectURL(fresh);
      setUrl(obj);
    }).catch(() => {
      if (!cancelled) setUrl(fallback ?? undefined);
    });
    return () => {
      cancelled = true;
      if (obj) URL.revokeObjectURL(obj);
    };
  }, [blob, fallback]);
  return url;
}

