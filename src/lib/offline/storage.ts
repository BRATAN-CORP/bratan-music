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
