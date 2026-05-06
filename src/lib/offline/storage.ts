/**
 * High-level "is this thing saved?" / "list everything I have saved"
 * helpers, layered on top of the typed CRUD in `db.ts`. Used by:
 *
 *   - The 3-dot menu (PR #2) to flip between "Сохранить на устройство"
 *     and "Удалить с устройства" depending on current state.
 *   - The Library/Загруженное tab (PR #3) to render the user's
 *     offline collections.
 *   - The audio player (PR #4) to swap the network stream URL for a
 *     local `URL.createObjectURL(blob)` when the track is saved.
 *
 * The helpers are deliberately stateless — each call hits IndexedDB.
 * For UIs that need to react to saved-status changes, use
 * `useOfflineStore` (created in `src/store/offline.ts`); it tracks
 * the same data in memory and bumps a counter on every mutation so
 * `useSyncExternalStore`-style consumers re-render automatically.
 */

import * as db from './db';
import type { OfflineAlbum, OfflinePlaylist, OfflineTrack } from './types';
import type { Album, Playlist, Track } from '@/types';

/** True if the given track id is already saved locally. */
export async function isTrackSaved(id: string): Promise<boolean> {
  const t = await db.getTrack(id);
  return !!t;
}

export async function isAlbumSaved(id: string): Promise<boolean> {
  const a = await db.getAlbum(id);
  return !!a;
}

export async function isPlaylistSaved(id: string): Promise<boolean> {
  const p = await db.getPlaylist(id);
  return !!p;
}

/** Return the saved track if present, else `null`. Used by the player
 *  to decide whether to play from blob or network. */
export async function getSavedTrack(id: string): Promise<OfflineTrack | null> {
  return db.getTrack(id);
}

export async function getSavedAlbum(id: string): Promise<OfflineAlbum | null> {
  return db.getAlbum(id);
}

export async function getSavedPlaylist(id: string): Promise<OfflinePlaylist | null> {
  return db.getPlaylist(id);
}

export async function listSavedTracks(): Promise<OfflineTrack[]> {
  return db.listTracks();
}

export async function listSavedAlbums(): Promise<OfflineAlbum[]> {
  return db.listAlbums();
}

export async function listSavedPlaylists(): Promise<OfflinePlaylist[]> {
  return db.listPlaylists();
}

/**
 * Remove a track from offline storage. Idempotent. Also removes the
 * track id from any collection that references it; if a collection
 * ends up with zero tracks left it stays in the user's library (we
 * don't auto-delete albums / playlists when the user manually drops
 * a single track — the empty collection is a signal that something
 * was removed but the user still wants the metadata around).
 */
export async function unsaveTrack(id: string): Promise<void> {
  await db.deleteTrack(id);
}

/**
 * Remove an album from offline storage. Tracks referenced by the album
 * are deleted only if no other saved collection (or direct user save)
 * references them.
 */
export async function unsaveAlbum(id: string): Promise<void> {
  const album = await db.getAlbum(id);
  if (!album) return;
  await db.deleteAlbum(id);
  await pruneOrphanedTracks(album.trackIds, `album:${id}`);
}

export async function unsavePlaylist(id: string): Promise<void> {
  const playlist = await db.getPlaylist(id);
  if (!playlist) return;
  await db.deletePlaylist(id);
  await pruneOrphanedTracks(playlist.trackIds, `playlist:${id}`);
}

/**
 * Walk a list of track ids and delete the ones that are no longer
 * referenced by any saved collection AND were not directly saved by
 * the user (`collections` includes only the just-removed parent).
 *
 * Used by `unsaveAlbum` / `unsavePlaylist` to garbage-collect track
 * blobs when the parent collection goes away.
 */
async function pruneOrphanedTracks(trackIds: string[], removedParent: string): Promise<void> {
  for (const trackId of trackIds) {
    const track = await db.getTrack(trackId);
    if (!track) continue;
    const remaining = track.collections.filter((c) => c !== removedParent);
    if (remaining.length === 0) {
      // The just-removed parent was the only thing keeping this
      // track around — drop it.
      await db.deleteTrack(trackId);
    } else {
      // The track is still referenced by another saved collection —
      // keep it but update the cross-reference list so a future
      // un-save cleans up correctly.
      await db.putTrack({ ...track, collections: remaining });
    }
  }
}

/**
 * Convert a saved `OfflineTrack` row into a network-shaped `Track`
 * for consumption by code paths that don't care about local-only
 * fields like `audioBlob` or `byteLength` (album / playlist detail
 * pages, the player queue, etc.). Drops the blob payloads so the
 * resulting object can safely flow into React Query caches without
 * pinning ~100 MB of FLAC bytes per track in memory.
 */
function offlineTrackToNetworkTrack(t: OfflineTrack): Track {
  return {
    id: t.id,
    title: t.title,
    artist: t.artist,
    artistId: t.artistId,
    artists: t.artists,
    album: t.album,
    albumId: t.albumId,
    duration: t.duration,
    coverUrl: t.coverUrl,
    coverVideoUrl: t.coverVideoUrl,
    source: t.source,
  };
}

/**
 * Hydrate a saved album into the same shape `useAlbum` returns from
 * the network. Used as the offline fallback on the album detail
 * page so tapping a downloaded album with no network shows the
 * actual track list instead of "альбом не найден".
 *
 * Tracks the album referenced but that aren't in IndexedDB (a
 * partially-finished download) are silently skipped — the user
 * still gets to play and inspect everything they actually have on
 * device, ordered by the album's original `trackIds` list.
 */
export async function getSavedAlbumWithTracks(
  id: string,
): Promise<(Album & { tracks: Track[] }) | null> {
  const album = await db.getAlbum(id);
  if (!album) return null;
  const tracks: Track[] = [];
  for (const tid of album.trackIds) {
    const t = await db.getTrack(tid);
    if (t) tracks.push(offlineTrackToNetworkTrack(t));
  }
  return {
    id: album.id,
    title: album.title,
    artist: album.artist,
    artistId: album.artistId,
    artists: album.artists,
    releaseType: album.releaseType,
    coverUrl: album.coverUrl,
    coverVideoUrl: album.coverVideoUrl,
    releaseDate: album.releaseDate,
    tracks,
  };
}

/**
 * Hydrate a saved playlist into a `Playlist & { tracks: Track[] }`
 * shape — same role as `getSavedAlbumWithTracks`, scoped to the
 * playlist detail page. The playlist's `trackIds` ordering is
 * preserved so the offline view matches the order the user saved.
 */
export async function getSavedPlaylistWithTracks(
  id: string,
): Promise<(Playlist & { tracks: Track[] }) | null> {
  const playlist = await db.getPlaylist(id);
  if (!playlist) return null;
  const tracks: Track[] = [];
  for (const tid of playlist.trackIds) {
    const t = await db.getTrack(tid);
    if (t) tracks.push(offlineTrackToNetworkTrack(t));
  }
  return {
    id: playlist.id,
    name: playlist.name,
    trackCount: playlist.trackCount,
    isLiked: playlist.isLiked,
    coverUrl: playlist.coverUrl ?? null,
    pinnedAt: playlist.pinnedAt ?? null,
    updatedAt: playlist.updatedAt,
    isPublic: playlist.isPublic,
    shareToken: playlist.shareToken,
    sourceKind: playlist.sourceKind,
    sourcePlaylistId: playlist.sourcePlaylistId,
    sourceUserId: playlist.sourceUserId,
    readOnly: playlist.readOnly,
    tracks,
  };
}

/**
 * Bump the `lastAccessAt` timestamp on a track. Used by the player
 * whenever it streams a track from the offline cache so a future
 * LRU-eviction policy can drop the least-recently-played first.
 */
export async function touchTrack(id: string): Promise<void> {
  const track = await db.getTrack(id);
  if (!track) return;
  await db.putTrack({ ...track, lastAccessAt: Date.now() });
}

/**
 * Wipe everything from the offline store. Used by the logout path so
 * a subsequent sign-in on the same device starts with a clean slate
 * (otherwise the new user inherits whatever was saved before).
 */
export async function wipeAll(): Promise<void> {
  await db.clearAll();
}

/** Total bytes currently stored in the offline cache. Used by the
 *  settings card and the future eviction policy. */
export async function getTotalCacheBytes(): Promise<number> {
  return db.totalCacheBytes();
}
