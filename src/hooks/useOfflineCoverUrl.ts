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
      return entity?.coverBlob ?? null;
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

