/**
 * Resolves the best available cover URL for a track/album/playlist,
 * preferring the locally cached blob (via `URL.createObjectURL`) when
 * the entity is saved offline so the tile renders without network.
 *
 * Resolution order:
 *   - Saved entity has a usable blob → object URL.
 *   - Saved but blob missing → network `fallback` (caller's URL).
 *   - Neither → `undefined`, so `<img src={undefined}>` lets
 *     `<CoverFallback>` / onError placeholders take over.
 *
 * Cache key is `(kind, id, version)` where `version` is the offline
 * store's mutation counter — the lookup auto-invalidates on save /
 * unsave. One object URL per resolution, revoked on unmount /
 * dependency change so blob URLs don't leak (they hold backing data
 * alive in memory, and the store can hit hundreds of tracks).
 */
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useOfflineStore } from '@/store/offline';
import * as db from '@/lib/offline/db';
import { fetchCoverBlob } from '@/lib/offline/streamResolver';
import type { OfflineAlbum, OfflinePlaylist, OfflineTrack } from '@/lib/offline/types';

type OfflineCoverKind = 'track' | 'album' | 'playlist';

/** Distill a usable Blob out of a saved IDB row regardless of
 *  storage shape. Prefers `coverBytes` (structured-cloned
 *  ArrayBuffer); falls back to re-materialising `coverBlob` because
 *  iOS Safari WKWebView (15-17, including the standalone PWA shell)
 *  occasionally evicts a Blob's file-backed bytes while keeping the
 *  shell alive — a direct `createObjectURL(blob)` then yields a URL
 *  `<img>` can't decode. Returns null on zero-byte/unreadable rows. */
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
  // Re-materialise via `.arrayBuffer()` so WebKit forces the bytes
  // back in. The resulting fresh Blob survives the next eviction;
  // `coverBackfill` commits these bytes back to IDB on the next
  // online tick so subsequent reads skip the rematerialisation.
  try {
    const bytes = await blob.arrayBuffer();
    if (bytes.byteLength === 0) return null;
    return new Blob([bytes], { type: mime });
  } catch {
    return null;
  }
}

/** Fall back to the parent album's blob when a track's own is
 *  missing — non-singles share album art so this keeps offline
 *  track lists intact until `coverBackfill` heals the per-track row. */
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

/** Walk a track's `collections` (`["album:123","playlist:abc"]`)
 *  for any saved playlist with a renderable cover blob. Last-ditch
 *  fallback before the placeholder glyph. */
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
      // Skip unreadable; the next collection might still have one.
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
  // Subscribe to `version` so every save/unsave/metadata refresh
  // in the offline store re-runs the query key, auto-invalidating
  // the cache without explicit plumbing.
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

      // Some legacy saves wrote zero-byte opaque-response Blobs to
      // IDB (Safari/WebKit `mode: 'no-cors'`); they're truthy but
      // unrenderable. For tracks, fall back to album/playlist cover
      // — tracks share artwork with their parent collections, which
      // keeps offline rows intact until `coverBackfill` heals them.
      if (kind === 'track') {
        const track = entity as { albumId?: string; collections?: string[] } | null;
        const albumBlob = await readBlobFromAlbumId(track?.albumId);
        if (albumBlob) return albumBlob;
        const playlistBlob = await readBlobFromCollections(track?.collections);
        if (playlistBlob) return playlistBlob;
      }

      // Last-ditch on-the-fly heal: saved entity with no usable
      // blob anywhere, online → refetch from CDN and persist back.
      // Closes the gap left by the once-per-session
      // `coverBackfill` sweep when an album opens mid-session.
      const onlineNow = typeof navigator === 'undefined' || navigator.onLine !== false;
      if (onlineNow && entity) {
        const url =
          (entity as { coverUrl?: string | null }).coverUrl ?? null;
        if (url) {
          const cover = await fetchCoverBlob(url);
          if (cover) {
            try {
              if (kind === 'track') {
                await db.putTrack({
                  ...(entity as OfflineTrack),
                  coverBlob: cover.blob,
                  coverBytes: cover.bytes,
                  coverMimeType: cover.mimeType,
                });
              } else if (kind === 'album') {
                await db.putAlbum({
                  ...(entity as OfflineAlbum),
                  coverBlob: cover.blob,
                  coverBytes: cover.bytes,
                  coverMimeType: cover.mimeType,
                });
              } else {
                await db.putPlaylist({
                  ...(entity as OfflinePlaylist),
                  coverBlob: cover.blob,
                  coverBytes: cover.bytes,
                  coverMimeType: cover.mimeType,
                });
              }
              // Bump so other consumers re-derive covers from the
              // healed row instead of holding the null result.
              useOfflineStore.getState().bump();
            } catch {
              // IDB write failure shouldn't gate this render —
              // return the blob anyway, retry persist on next tick.
            }
            return cover.blob;
          }
        }
      }

      return null;
    },
    // Cover blobs are immutable per save; `version` bumps the key
    // on changes so we can mark the result fresh forever in-window.
    staleTime: Infinity,
    gcTime: 5 * 60 * 1000,
  });

  // Hold the URL in state so the create/revoke lifecycle stays in
  // one effect — calling `createObjectURL` in the render body would
  // leak a fresh URL on every re-render.
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
 * Object-URL from a Blob directly with a network fallback — used
 * when the caller already has the offline entity in hand and we can
 * skip the round-trip through the offline store. Manages
 * createObjectURL/revokeObjectURL lifecycle for the caller.
 */
export function useBlobObjectUrl(
  blob: Blob | null | undefined,
  fallback: string | null | undefined,
): string | undefined {
  const [url, setUrl] = useState<string | undefined>(() => fallback ?? undefined);
  useEffect(() => {
    // Zero-byte guard — legacy opaque-response Blobs are truthy
    // but unrenderable, so fall back to the network URL.
    const usable = blob && (typeof blob.size !== 'number' || blob.size > 0);
    if (!usable) {
      setUrl(fallback ?? undefined);
      return undefined;
    }
    // Rebuild via `arrayBuffer()` to defeat the iOS Safari blob
    // eviction — see `pickUsableBlob` for the full rationale.
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

