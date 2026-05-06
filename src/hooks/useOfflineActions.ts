/**
 * Public API for surfaces (kebab menus, hero buttons, library rows)
 * that need to query / mutate offline-saved state for a track, album,
 * or playlist.
 *
 * Splits cleanly between:
 *   - `useOfflineSavedTrack(id)` etc. — read-only React hooks that
 *     subscribe to the zustand mirror so the UI re-renders when a
 *     download finishes and adds an id to the saved set.
 *   - `useOfflineActions()` — imperative handle returning callbacks
 *     for `saveTrack`, `unsaveTrack`, `saveAlbum`, … plus a
 *     stable-by-ref `cancel` so a button can flip into "Cancel
 *     download" mid-flight.
 *
 * The actions are imperative on purpose. Using TanStack Query
 * mutations would force the call sites to depend on the React Query
 * cache, but the source of truth here is IndexedDB, not the server,
 * and the downloads manager already debounces and dedupes
 * concurrent enqueues. We surface progress through the same
 * zustand store the badges read from, so a button and its sibling
 * row badge stay in sync without any extra plumbing.
 */
import { useCallback, useEffect } from 'react';
import { useOfflineStore } from '@/store/offline';
import { downloads } from '@/lib/offline/downloads';
import type { Album, Playlist, Track } from '@/types';
import type { DownloadJob } from '@/lib/offline/types';

/** Hydration-aware helper: nudges the offline store to scan IndexedDB
 *  on first read so saved-state badges aren't briefly empty after
 *  a hard reload. Cheap to call repeatedly (the store short-circuits
 *  after the first hydrate). */
export function useOfflineHydration(): boolean {
  const hydrated = useOfflineStore((s) => s.hydrated);
  const hydrate = useOfflineStore((s) => s.hydrate);
  useEffect(() => {
    if (!hydrated) void hydrate();
  }, [hydrated, hydrate]);
  return hydrated;
}

/** True when the given track id has audio blob in the offline cache. */
export function useIsTrackSavedOffline(trackId: string): boolean {
  useOfflineHydration();
  return useOfflineStore((s) => s.savedTrackIds.has(trackId));
}

export function useIsAlbumSavedOffline(albumId: string): boolean {
  useOfflineHydration();
  return useOfflineStore((s) => s.savedAlbumIds.has(albumId));
}

export function useIsPlaylistSavedOffline(playlistId: string): boolean {
  useOfflineHydration();
  return useOfflineStore((s) => s.savedPlaylistIds.has(playlistId));
}

/** Live progress for the in-flight job tracking a given track id. Returns
 *  null when no job is active. */
export function useTrackDownloadJob(trackId: string): DownloadJob | null {
  return useOfflineStore((s) => s.jobsById[`track:${trackId}`] ?? null);
}

export function useAlbumDownloadJob(albumId: string): DownloadJob | null {
  return useOfflineStore((s) => s.jobsById[`album:${albumId}`] ?? null);
}

export function usePlaylistDownloadJob(playlistId: string): DownloadJob | null {
  return useOfflineStore((s) => s.jobsById[`playlist:${playlistId}`] ?? null);
}

export interface OfflineActions {
  saveTrack: (track: Track) => Promise<void>;
  unsaveTrack: (trackId: string) => Promise<void>;
  saveAlbum: (album: Album, tracks: Track[]) => Promise<void>;
  unsaveAlbum: (albumId: string) => Promise<void>;
  savePlaylist: (playlist: Playlist, tracks: Track[]) => Promise<void>;
  unsavePlaylist: (playlistId: string) => Promise<void>;
  cancelTrack: (trackId: string) => void;
  cancelAlbum: (albumId: string) => void;
  cancelPlaylist: (playlistId: string) => void;
}

/**
 * Imperative handle. Use from event handlers; do *not* call inside a
 * render phase. Each action delegates to the framework-agnostic
 * `downloads` manager, which emits events that the offline store
 * subscribes to, so badges and buttons re-render automatically.
 */
export function useOfflineActions(): OfflineActions {
  const saveTrack = useCallback(async (track: Track) => {
    await downloads.enqueueTrack(track);
  }, []);

  const unsaveTrack = useCallback(async (trackId: string) => {
    await downloads.removeTrack(trackId);
  }, []);

  const saveAlbum = useCallback(async (album: Album, tracks: Track[]) => {
    await downloads.enqueueAlbum(album, tracks);
  }, []);

  const unsaveAlbum = useCallback(async (albumId: string) => {
    await downloads.removeAlbum(albumId);
  }, []);

  const savePlaylist = useCallback(async (playlist: Playlist, tracks: Track[]) => {
    await downloads.enqueuePlaylist(playlist, tracks);
  }, []);

  const unsavePlaylist = useCallback(async (playlistId: string) => {
    await downloads.removePlaylist(playlistId);
  }, []);

  const cancelTrack = useCallback((trackId: string) => {
    downloads.cancel(`track:${trackId}`);
  }, []);

  const cancelAlbum = useCallback((albumId: string) => {
    downloads.cancel(`album:${albumId}`);
  }, []);

  const cancelPlaylist = useCallback((playlistId: string) => {
    downloads.cancel(`playlist:${playlistId}`);
  }, []);

  return {
    saveTrack, unsaveTrack,
    saveAlbum, unsaveAlbum,
    savePlaylist, unsavePlaylist,
    cancelTrack, cancelAlbum, cancelPlaylist,
  };
}
