/**
 * Type definitions for the on-device offline cache.
 *
 * Everything that lives in IndexedDB is described here so the rest of
 * the offline module is just typed CRUD. The shapes intentionally
 * mirror the network types in `src/types/index.ts` (Track, Album,
 * Playlist) but carry a few extra fields that only make sense locally
 * (`savedAt`, `quality`, `byteLength`, etc.).
 *
 * Contract with the rest of the app:
 *   - `OfflineTrack.id` matches `Track.id` 1:1, including upload ids
 *     (`upload:<uuid>`) and any other provider-tagged ids. Lookups
 *     can use the same id without translation.
 *   - `OfflineAlbum.trackIds` and `OfflinePlaylist.trackIds` are dense
 *     arrays of track ids. The corresponding `OfflineTrack` rows are
 *     stored independently in `tracks` so two playlists that share a
 *     track don't duplicate the audio blob.
 *   - `OfflineTrack.audioBlob` is the actual decoded-by-the-browser
 *     audio body. We hand it to the player as a `URL.createObjectURL`
 *     so the audio element plays from RAM instead of the network.
 */

import type { TidalQuality } from '@/store/settings';

/** Identical to the network `Track` shape minus the bits that don't
 *  matter offline (Tidal-specific ranking, etc.) plus the local audio
 *  payload and provenance metadata. */
export interface OfflineTrack {
  id: string;
  title: string;
  artist: string;
  artistId?: string;
  artists?: { id: string; name: string }[];
  album?: string;
  albumId?: string;
  duration: number;
  coverUrl?: string;
  coverVideoUrl?: string;
  /** Provider tag — `'tidal'` | `'upload'` | `'override'`. Mirrors
   *  the upstream `Track.source` so the player can branch on the
   *  same field whether playing online or offline. */
  source?: string;
  /** Decoded audio body. Browser hands this back from IndexedDB as a
   *  `Blob` we can wrap in `URL.createObjectURL()`. */
  audioBlob: Blob;
  /** MIME type of the audio body — `audio/flac`, `audio/mp4`, etc.
   *  Some browsers refuse to play a blob without a content type. */
  mimeType: string;
  /** Quality the user actually got. May differ from the user's
   *  configured `offlineQuality` if the fallback ladder kicked in. */
  quality: TidalQuality;
  /** Cached cover image as a blob so the saved track renders even
   *  with no network. Optional because the cover may have been
   *  unavailable at download time. */
  coverBlob?: Blob;
  coverMimeType?: string;
  /** Wall-clock timestamp at which the track was saved offline.
   *  Used to sort the "Загруженное" service playlist newest-first
   *  and to fuel any future "evict oldest" cache-size policy. */
  savedAt: number;
  /** Last access timestamp — bumped whenever the player streams
   *  this track from the offline store. Used by future LRU
   *  eviction. */
  lastAccessAt: number;
  /** Size of `audioBlob` in bytes, denormalised so we can compute
   *  total cache footprint without rehydrating every blob. */
  byteLength: number;
  /** ID of the parent collection that triggered this download, if
   *  any. Used to garbage-collect tracks when the collection is
   *  removed from offline storage and the track isn't referenced
   *  by any other collection. Empty array means the track was
   *  saved directly from a 3-dot menu and has no parent. */
  collections: string[];
}

/** Album metadata stored alongside its track ids. The album doesn't
 *  embed the tracks directly so the same `OfflineTrack` can serve
 *  both an album view and a playlist view. */
export interface OfflineAlbum {
  id: string;
  title: string;
  artist: string;
  artistId: string;
  artists?: { id: string; name: string }[];
  releaseType?: 'ALBUM' | 'EP' | 'SINGLE' | 'COMPILATION';
  coverUrl?: string;
  coverVideoUrl?: string;
  releaseDate?: string;
  trackIds: string[];
  /** Cached cover image so the album tile renders offline. */
  coverBlob?: Blob;
  coverMimeType?: string;
  savedAt: number;
}

/** Playlist metadata. Mirrors the network `Playlist` plus the local
 *  `trackIds` so the offline playlist page can render a track list
 *  without the network. */
export interface OfflinePlaylist {
  id: string;
  name: string;
  trackCount: number;
  isLiked: boolean;
  coverUrl?: string | null;
  pinnedAt?: number | null;
  updatedAt: number;
  isPublic?: boolean;
  shareToken?: string | null;
  sourceKind?: 'user' | 'tidal' | null;
  sourcePlaylistId?: string | null;
  sourceUserId?: string | null;
  readOnly?: boolean;
  trackIds: string[];
  coverBlob?: Blob;
  coverMimeType?: string;
  savedAt: number;
}

/** Status of a download job, as observed by the UI. The downloads
 *  manager exposes these via an `EventTarget` so React components
 *  can subscribe to a single track / collection's progress without
 *  re-rendering the whole library on every byte downloaded. */
export type DownloadStatus =
  | 'queued'
  | 'downloading'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface DownloadJob {
  /** Stable identifier — `track:<id>` for individual tracks,
   *  `album:<id>` / `playlist:<id>` for batches. */
  jobId: string;
  /** Type of the entity being saved. A batch job ('album' /
   *  'playlist') spawns child track jobs but the parent stays in
   *  the queue until every child resolves. */
  kind: 'track' | 'album' | 'playlist';
  /** Entity id without the `track:` / `album:` / `playlist:` prefix.
   *  Equal to the upstream Track/Album/Playlist id. */
  entityId: string;
  status: DownloadStatus;
  /** 0 — 1, derived from byte counts when available, else from the
   *  ratio of completed-to-total child jobs for a batch. */
  progress: number;
  /** When non-null, the user-readable error message for the UI.
   *  Only populated for `failed` jobs. */
  error?: string;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
}

/** A single offline-buffered mutation that needs to be replayed
 *  against the worker once connectivity returns. The shape mirrors
 *  the existing online mutation hooks 1:1 so the flush loop can
 *  call the same `api.*` helpers without a per-action adapter.
 *
 *  Stored in the `syncQueue` IndexedDB object store, keyed by `id`.
 *  `id` is a UUID we generate at enqueue time so two duplicate
 *  actions (e.g. the user double-taps the like button before the
 *  flush runs) end up as separate rows; the flush loop dedupes by
 *  examining the resulting state and dropping no-ops.
 */
export type SyncAction =
  | { kind: 'like-track'; trackId: string; snapshot: SyncTrackSnapshot }
  | { kind: 'unlike-track'; trackId: string }
  | { kind: 'like-album'; albumId: string; snapshot: SyncAlbumSnapshot }
  | { kind: 'unlike-album'; albumId: string }
  | { kind: 'like-artist'; artistId: string; snapshot: SyncArtistSnapshot }
  | { kind: 'unlike-artist'; artistId: string }
  | { kind: 'log-play'; payload: SyncPlayPayload };

export interface SyncTrackSnapshot {
  title?: string;
  artist?: string;
  artistId?: string;
  artists?: { id: string; name: string }[];
  album?: string;
  albumId?: string;
  duration?: number;
  coverUrl?: string;
  source?: string;
}
export interface SyncAlbumSnapshot {
  title: string;
  artist: string;
  artistId: string;
  coverUrl?: string;
}
export interface SyncArtistSnapshot {
  name: string;
  imageUrl?: string;
}
export interface SyncPlayPayload {
  trackId: string;
  source?: string;
  artistId?: string;
  artistName?: string;
  artists?: { id: string; name: string }[];
  title?: string;
  albumId?: string;
  coverUrl?: string;
  duration?: number;
  listenedSeconds?: number;
  completed?: boolean;
}

export interface SyncQueueEntry {
  id: string;
  enqueuedAt: number;
  action: SyncAction;
  /** Number of times we've tried to flush this entry. After
   *  `MAX_ATTEMPTS` we drop it to keep the queue from growing
   *  unboundedly on a permanent server-side rejection. */
  attempts: number;
  /** If we got an error from the server other than a network
   *  failure (4xx that's not 401/429), we record the message here
   *  before dropping the entry, so a future debug screen can
   *  surface what happened. */
  lastError?: string;
}

/** Single entry in the IndexedDB `meta` store. Records everything
 *  the manager needs to decide whether a track is fully saved,
 *  which collections it belongs to, and (in PR #5) whether there's
 *  any pending offline action queued for sync. */
export interface OfflineMeta {
  key: string;
  value: unknown;
}
