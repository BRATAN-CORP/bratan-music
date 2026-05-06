/**
 * Reactive mirror of the framework-agnostic offline cache state.
 *
 * `src/lib/offline/downloads.ts` is intentionally React-free so it can
 * one day be invoked from a Service Worker; this zustand slice
 * subscribes to its event bus once at app boot, snapshots the
 * relevant state into store fields and lets the UI consume the data
 * with the project's standard hook idiom (`useOfflineStore((s) => …)`).
 *
 * Slices we expose:
 *
 *   - `savedTrackIds`    Set of track ids that are currently saved.
 *                        Used by every "is this track saved?" badge.
 *   - `savedAlbumIds`    Same for albums.
 *   - `savedPlaylistIds` Same for playlists.
 *   - `jobsById`         Snapshot of active / recently-finished jobs
 *                        keyed by `jobId`. The 3-dot menu uses this
 *                        to show a progress ring.
 *
 * Hydration: the first time the store is read we kick off a
 * background scan of IndexedDB to populate the saved-id sets so the
 * UI can flip "Save offline" → "Saved" before the user has even
 * scrolled.
 */

import { create } from 'zustand';
import {
  downloads,
  type DownloadEvent,
  type DownloadJob,
} from '@/lib/offline/downloads';
import {
  listSavedAlbums,
  listSavedPlaylists,
  listSavedTracks,
} from '@/lib/offline/storage';

interface OfflineState {
  savedTrackIds: Set<string>;
  savedAlbumIds: Set<string>;
  savedPlaylistIds: Set<string>;
  jobsById: Record<string, DownloadJob>;
  /** True once we've scanned IndexedDB for the initial id sets. The
   *  badges on track rows wait for this so they don't render
   *  "no badge" for a split second on every page load. */
  hydrated: boolean;
  /** Bumped whenever something in the store changes — exposed so
   *  components that need to invalidate React Query caches when
   *  saved state shifts can subscribe with a single selector. */
  version: number;

  hydrate: () => Promise<void>;
  /** Update a single saved-id set without re-scanning IndexedDB. */
  applyEvent: (event: DownloadEvent) => void;
}

export const useOfflineStore = create<OfflineState>((set, get) => ({
  savedTrackIds: new Set<string>(),
  savedAlbumIds: new Set<string>(),
  savedPlaylistIds: new Set<string>(),
  jobsById: {},
  hydrated: false,
  version: 0,

  hydrate: async () => {
    if (get().hydrated) return;
    try {
      const [tracks, albums, playlists] = await Promise.all([
        listSavedTracks(),
        listSavedAlbums(),
        listSavedPlaylists(),
      ]);
      const jobsById: Record<string, DownloadJob> = {};
      for (const job of downloads.snapshot()) jobsById[job.jobId] = job;
      set({
        savedTrackIds: new Set(tracks.map((t) => t.id)),
        savedAlbumIds: new Set(albums.map((a) => a.id)),
        savedPlaylistIds: new Set(playlists.map((p) => p.id)),
        jobsById,
        hydrated: true,
        version: get().version + 1,
      });
    } catch {
      // IndexedDB unavailable (private mode on some browsers) — flip
      // the hydrated flag anyway so the rest of the app stops
      // waiting on us.
      set({ hydrated: true });
    }
  },

  applyEvent: (event) => {
    const state = get();
    switch (event.type) {
      case 'track-saved': {
        const next = new Set(state.savedTrackIds);
        next.add(event.trackId);
        set({ savedTrackIds: next, version: state.version + 1 });
        break;
      }
      case 'track-deleted': {
        const next = new Set(state.savedTrackIds);
        next.delete(event.trackId);
        set({ savedTrackIds: next, version: state.version + 1 });
        break;
      }
      case 'album-saved': {
        const next = new Set(state.savedAlbumIds);
        next.add(event.albumId);
        set({ savedAlbumIds: next, version: state.version + 1 });
        break;
      }
      case 'album-deleted': {
        const next = new Set(state.savedAlbumIds);
        next.delete(event.albumId);
        set({ savedAlbumIds: next, version: state.version + 1 });
        break;
      }
      case 'playlist-saved': {
        const next = new Set(state.savedPlaylistIds);
        next.add(event.playlistId);
        set({ savedPlaylistIds: next, version: state.version + 1 });
        break;
      }
      case 'playlist-deleted': {
        const next = new Set(state.savedPlaylistIds);
        next.delete(event.playlistId);
        set({ savedPlaylistIds: next, version: state.version + 1 });
        break;
      }
      case 'job-changed': {
        set({
          jobsById: { ...state.jobsById, [event.job.jobId]: event.job },
          version: state.version + 1,
        });
        break;
      }
      case 'queue-changed': {
        // Already covered by job-changed — kept here so an exhaustive
        // switch-by-type doesn't miss the event variant.
        break;
      }
    }
  },
}));

let bridgeWired = false;

/**
 * Wire the framework-agnostic event bus into the React store. Called
 * exactly once from the app entry point so we don't double-subscribe
 * across hot reloads / fast refresh.
 */
export function wireOfflineBridge(): void {
  if (bridgeWired) return;
  bridgeWired = true;
  void useOfflineStore.getState().hydrate();
  downloads.events.on((event) => {
    useOfflineStore.getState().applyEvent(event);
  });
}
