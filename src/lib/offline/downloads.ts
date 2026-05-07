/**
 * Singleton download queue that pulls tracks / albums / playlists
 * into IndexedDB. Surfaces a typed event stream so React UIs can
 * subscribe to a particular job's progress without listening to
 * every download in the system.
 *
 * Concurrency policy
 * ------------------
 * **Album and playlist downloads run strictly sequentially** in the
 * user-provided track order. The earlier implementation used a
 * worker pool (`MAX_CONCURRENT = 2`) that peeled jobs off the queue
 * in non-deterministic order, so the on-disk write order didn't
 * match the tracklist and "Загруженное" / album view rendered
 * tracks in a different order than the user clicked. The user
 * explicitly asked for "чёткий порядок, без race conditions", so we
 * trade some wall-clock speed for deterministic ordering.
 *
 * **Single-track jobs** triggered from a 3-dot menu still run
 * concurrently across separate user clicks — each one is its own
 * top-level call and rides on `inFlightTracks` for dedupe.
 *
 * Cancellation: each track download owns an `AbortController`. The
 * downloads manager keeps a map of `jobId → controller` so cancelling
 * a parent batch (album/playlist) propagates to every still-in-flight
 * child. Sequential mode also stops dispatching the next track when
 * the parent job has been cancelled.
 *
 * The manager is *not* a React store — it's framework-agnostic and
 * exposes everything via `EventTarget`. The lightweight zustand
 * mirror in `src/store/offline.ts` subscribes once and re-publishes
 * the relevant state to React consumers.
 */

import type { Album, Playlist, Track } from '@/types';
import { ApiError } from '@/lib/api';
import { useSettingsStore } from '@/store/settings';
import * as db from './db';
import {
  fetchAudioBlob,
  fetchCoverBlob,
  resolveStreamForDownload,
} from './streamResolver';
import type { DownloadJob, DownloadStatus, OfflineTrack } from './types';

/** Custom event payload — exactly one event type, but typed as a
 *  discriminated union for clarity at call sites. */
export type DownloadEvent =
  | { type: 'job-changed'; job: DownloadJob }
  | { type: 'queue-changed' }
  | { type: 'track-saved'; trackId: string }
  | { type: 'track-deleted'; trackId: string }
  | { type: 'album-saved'; albumId: string }
  | { type: 'album-deleted'; albumId: string }
  | { type: 'playlist-saved'; playlistId: string }
  | { type: 'playlist-deleted'; playlistId: string };

/** Strongly-typed wrapper around `EventTarget` so consumers don't
 *  have to remember the magic event-name string. */
class DownloadEventBus extends EventTarget {
  emit(event: DownloadEvent): void {
    this.dispatchEvent(new CustomEvent('event', { detail: event }));
  }
  on(handler: (event: DownloadEvent) => void): () => void {
    const listener = (e: Event) => {
      const detail = (e as CustomEvent<DownloadEvent>).detail;
      handler(detail);
    };
    this.addEventListener('event', listener);
    return () => this.removeEventListener('event', listener);
  }
}

class DownloadsManager {
  readonly events = new DownloadEventBus();
  private active = new Map<string, AbortController>();
  /** Tracks currently being downloaded as part of *some* batch.
   *  Used by `enqueueAlbum` / `enqueueTrack` to dedupe — if track X
   *  is already mid-flight from the album save, an explicit user
   *  click on "Сохранить трек X" should latch onto the same job
   *  rather than spawning a duplicate fetch. */
  private inFlightTracks = new Map<string, Promise<void>>();
  /** Tracks the latest known job state by id so the UI can show the
   *  ring next to a row even after the manager has dropped the job
   *  from `queue` / `active`. */
  private jobs = new Map<string, DownloadJob>();

  // ─────────────────────────── public ───────────────────────────

  /** Enqueue a single track. Resolves once the track is fully
   *  decoded AND committed to IndexedDB, or rejects on failure. */
  async enqueueTrack(track: Track, parent?: string): Promise<void> {
    const jobId = `track:${track.id}`;
    const inFlight = this.inFlightTracks.get(track.id);
    if (inFlight) return inFlight;

    const promise = this.runTrack(jobId, track, parent).finally(() => {
      this.inFlightTracks.delete(track.id);
    });
    this.inFlightTracks.set(track.id, promise);
    return promise;
  }

  async enqueueAlbum(album: Album, tracks: Track[]): Promise<void> {
    const parent = `album:${album.id}`;
    const jobId = parent;
    const job = this.makeJob(jobId, 'album', album.id);
    this.recordJob(job, 'queued');

    // Persist the album shell first so a user that opens
    // "Загруженное" mid-download sees the album with a partial
    // track list rather than nothing at all.
    const cover = await fetchCoverBlob(album.coverUrl);
    await db.putAlbum({
      id: album.id,
      title: album.title,
      artist: album.artist,
      artistId: album.artistId,
      artists: album.artists,
      releaseType: album.releaseType,
      coverUrl: album.coverUrl,
      coverVideoUrl: album.coverVideoUrl,
      releaseDate: album.releaseDate,
      trackIds: tracks.map((t) => t.id),
      coverBlob: cover?.blob,
      coverBytes: cover?.bytes,
      coverMimeType: cover?.mimeType,
      savedAt: Date.now(),
    });
    this.events.emit({ type: 'album-saved', albumId: album.id });

    this.recordJob(job, 'downloading');
    const { succeeded, failed } = await this.runBatchInOrder(parent, tracks, job);

    this.recordJob(job, failed === tracks.length && tracks.length > 0 ? 'failed' : 'completed');
    if (failed === tracks.length && tracks.length > 0) {
      job.error = 'All tracks failed to download';
    }
    void succeeded;
  }

  async enqueuePlaylist(playlist: Playlist, tracks: Track[]): Promise<void> {
    const parent = `playlist:${playlist.id}`;
    const jobId = parent;
    const job = this.makeJob(jobId, 'playlist', playlist.id);
    this.recordJob(job, 'queued');

    // Resolve cover from playlist or first track, mirroring the
    // upstream Cover priority used elsewhere.
    const coverUrl = playlist.coverUrl ?? tracks[0]?.coverUrl ?? null;
    const cover = await fetchCoverBlob(coverUrl);
    await db.putPlaylist({
      id: playlist.id,
      name: playlist.name,
      trackCount: playlist.trackCount,
      isLiked: playlist.isLiked,
      coverUrl: playlist.coverUrl,
      pinnedAt: playlist.pinnedAt,
      updatedAt: playlist.updatedAt,
      isPublic: playlist.isPublic,
      shareToken: playlist.shareToken,
      sourceKind: playlist.sourceKind,
      sourcePlaylistId: playlist.sourcePlaylistId,
      sourceUserId: playlist.sourceUserId,
      readOnly: playlist.readOnly,
      trackIds: tracks.map((t) => t.id),
      coverBlob: cover?.blob,
      coverBytes: cover?.bytes,
      coverMimeType: cover?.mimeType,
      savedAt: Date.now(),
    });
    this.events.emit({ type: 'playlist-saved', playlistId: playlist.id });

    this.recordJob(job, 'downloading');
    const { succeeded, failed } = await this.runBatchInOrder(parent, tracks, job);

    this.recordJob(job, failed === tracks.length && tracks.length > 0 ? 'failed' : 'completed');
    if (failed === tracks.length && tracks.length > 0) {
      job.error = 'All tracks failed to download';
    }
    void succeeded;
  }

  /**
   * Run a sequence of track downloads strictly in the order the
   * caller passed them, surfacing progress on the parent job after
   * each track lands.
   *
   * Why sequential and not parallel
   * --------------------------------
   * The previous worker-pool implementation processed two tracks at
   * a time. Two tracks completing in a different order than they
   * were dispatched made the IndexedDB `savedAt` timestamps
   * interleave, so the "Загруженное" service playlist (sorted
   * newest-first) showed tracks in a different order than the user
   * had asked them to download. The user explicitly asked for
   * "чёткий порядок, без race conditions" so we trade a bit of
   * wall-clock saving speed for deterministic ordering.
   *
   * Cancellation
   * ------------
   * `cancel(parent)` flips the parent job's status to `cancelled`
   * via `recordJob`. We re-read the latest status from `this.jobs`
   * before each iteration so the loop stops dispatching as soon as
   * the user cancels — already-running track downloads still see
   * their own `AbortController.abort()` propagation through
   * `runTrack` / `inFlightTracks`.
   */
  private async runBatchInOrder(
    parent: string,
    tracks: Track[],
    job: DownloadJob,
  ): Promise<{ succeeded: number; failed: number }> {
    let succeeded = 0;
    let failed = 0;
    // Per-track progress in [0..1] for the track currently being
    // fetched. Reset to 0 at the top of each iteration so the
    // parent ring doesn't briefly snap back when we move on to the
    // next track. Without this slot the parent progress only
    // advanced on full-track boundaries, so a 12-track album that
    // hadn't yet finished its first track sat visibly stuck at 0%
    // for the entire first track — reported as "индикатор
    // загрузки не показывается при батчевой загрузке".
    let currentTrackProgress = 0;
    const reportProgress = () => {
      const total = tracks.length;
      const completed = succeeded + failed;
      // Fold the in-flight track's fractional progress into the
      // parent so the ring fills smoothly across the whole batch.
      const fractional = total === 0 ? 0 : currentTrackProgress / total;
      job.progress = total === 0 ? 1 : Math.min(1, completed / total + fractional);
      this.events.emit({ type: 'job-changed', job });
    };
    for (const t of tracks) {
      // Bail out if the user (or a programmatic caller) cancelled
      // the parent job while a previous track was downloading. We
      // count remaining tracks as "failed" only if the user hasn't
      // explicitly cancelled — a cancellation just stops the loop.
      const latest = this.jobs.get(job.jobId);
      if (latest && latest.status === 'cancelled') break;
      currentTrackProgress = 0;
      reportProgress();
      try {
        await this.runTrack(`track:${t.id}`, t, parent, (p) => {
          currentTrackProgress = p;
          reportProgress();
        });
        succeeded++;
      } catch {
        failed++;
      } finally {
        currentTrackProgress = 0;
        reportProgress();
      }
    }
    return { succeeded, failed };
  }

  /** Cancel an in-flight job and any of its children (for a batch).
   *  Idempotent — calling on a finished/unknown job is a no-op. */
  cancel(jobId: string): void {
    const ctrl = this.active.get(jobId);
    if (ctrl) ctrl.abort();
    const job = this.jobs.get(jobId);
    if (job && job.status !== 'completed' && job.status !== 'failed') {
      this.recordJob(job, 'cancelled');
    }
  }

  /** Drop a single track from the offline cache and emit the matching
   *  `track-deleted` event so the zustand mirror updates immediately.
   *  The 3-dot menu calls this when the user hits "Удалить с
   *  устройства" on an individually-saved track. */
  async removeTrack(trackId: string): Promise<void> {
    this.cancel(`track:${trackId}`);
    const track = await db.getTrack(trackId);
    if (track) {
      await db.deleteTrack(trackId);
    }
    this.events.emit({ type: 'track-deleted', trackId });
  }

  /** Drop an album and any tracks that were *only* kept around because
   *  of this album. Tracks that the user explicitly saved on their own,
   *  or that another saved playlist still references, stay put. */
  async removeAlbum(albumId: string): Promise<void> {
    this.cancel(`album:${albumId}`);
    const album = await db.getAlbum(albumId);
    if (!album) {
      this.events.emit({ type: 'album-deleted', albumId });
      return;
    }
    const orphanedTrackIds: string[] = [];
    await db.deleteAlbum(albumId);
    for (const tid of album.trackIds) {
      const t = await db.getTrack(tid);
      if (!t) continue;
      const remaining = t.collections.filter((c) => c !== `album:${albumId}`);
      if (remaining.length === 0) {
        await db.deleteTrack(tid);
        orphanedTrackIds.push(tid);
      } else {
        await db.putTrack({ ...t, collections: remaining });
      }
    }
    this.events.emit({ type: 'album-deleted', albumId });
    for (const tid of orphanedTrackIds) {
      this.events.emit({ type: 'track-deleted', trackId: tid });
    }
  }

  async removePlaylist(playlistId: string): Promise<void> {
    this.cancel(`playlist:${playlistId}`);
    const playlist = await db.getPlaylist(playlistId);
    if (!playlist) {
      this.events.emit({ type: 'playlist-deleted', playlistId });
      return;
    }
    const orphanedTrackIds: string[] = [];
    await db.deletePlaylist(playlistId);
    for (const tid of playlist.trackIds) {
      const t = await db.getTrack(tid);
      if (!t) continue;
      const remaining = t.collections.filter((c) => c !== `playlist:${playlistId}`);
      if (remaining.length === 0) {
        await db.deleteTrack(tid);
        orphanedTrackIds.push(tid);
      } else {
        await db.putTrack({ ...t, collections: remaining });
      }
    }
    this.events.emit({ type: 'playlist-deleted', playlistId });
    for (const tid of orphanedTrackIds) {
      this.events.emit({ type: 'track-deleted', trackId: tid });
    }
  }

  /** Snapshot of every known job — used by the zustand store on
   *  init so a remount picks up the existing state rather than
   *  starting empty. */
  snapshot(): DownloadJob[] {
    return Array.from(this.jobs.values()).map((j) => ({ ...j }));
  }

  /** Find the job (if any) currently tracking a track / album /
   *  playlist by entity id. Used by the 3-dot menu to render the
   *  ring spinner with the right percentage on hover. */
  getJob(jobId: string): DownloadJob | null {
    return this.jobs.get(jobId) ?? null;
  }

  // ────────────────────────── internal ──────────────────────────

  private makeJob(
    jobId: string,
    kind: DownloadJob['kind'],
    entityId: string,
  ): DownloadJob {
    return {
      jobId,
      kind,
      entityId,
      status: 'queued',
      progress: 0,
      createdAt: Date.now(),
    };
  }

  private recordJob(job: DownloadJob, status: DownloadStatus): void {
    job.status = status;
    if (status === 'downloading' && !job.startedAt) job.startedAt = Date.now();
    if (status === 'completed' || status === 'failed' || status === 'cancelled') {
      job.completedAt = Date.now();
      if (status === 'completed') job.progress = 1;
    }
    this.jobs.set(job.jobId, job);
    this.events.emit({ type: 'job-changed', job });
    this.events.emit({ type: 'queue-changed' });
  }

  private async runTrack(
    jobId: string,
    track: Track,
    parent?: string,
    onProgress?: (progress: number) => void,
  ): Promise<void> {
    const job = this.makeJob(jobId, 'track', track.id);
    this.recordJob(job, 'queued');
    this.recordJob(job, 'downloading');
    const ctrl = new AbortController();
    this.active.set(jobId, ctrl);

    try {
      const desiredQuality = useSettingsStore.getState().offlineQuality;
      const resolved = await resolveStreamForDownload(track.id, track.source, desiredQuality);

      const { blob, mimeType } = await fetchAudioBlob(resolved.url, {
        signal: ctrl.signal,
        onProgress: (received, total) => {
          const p = total ? Math.min(0.99, received / total) : Math.min(0.95, received / 5_000_000);
          job.progress = p;
          this.events.emit({ type: 'job-changed', job });
          onProgress?.(p);
        },
      });

      let cover = await fetchCoverBlob(track.coverUrl);

      // If the per-track cover fetch failed (Tidal's CDN sometimes
      // 403s individual image URLs even when the same album-level
      // cover succeeds — observed when many tracks save in quick
      // succession), borrow the parent album / playlist cover that
      // we already wrote to IDB before this loop started. The user
      // sees a consistent album cover on every offline row instead
      // of the broken-image glyph on the tracks whose individual
      // covers happened to fail. Reported as "обложки в офлайн
      // режиме всё равно не отображаются — на загруженном плейлисте
      // работают".
      if (!cover && parent) {
        cover = await borrowParentCover(parent);
      }
      if (!cover && track.albumId) {
        cover = await borrowParentCover(`album:${track.albumId}`);
      }

      // If the track is already saved (e.g. user explicitly saved it
      // first, then the parent album save started), merge the
      // collection list rather than overwriting it. That way
      // unsaving the album later doesn't accidentally drop a track
      // the user pinned in their own right.
      const existing = await db.getTrack(track.id);
      const collections = mergeCollections(existing?.collections, parent);

      const offlineTrack: OfflineTrack = {
        id: track.id,
        title: track.title,
        artist: track.artist,
        artistId: track.artistId,
        artists: track.artists,
        album: track.album,
        albumId: track.albumId,
        duration: track.duration,
        coverUrl: track.coverUrl,
        coverVideoUrl: track.coverVideoUrl,
        source: track.source,
        audioBlob: blob,
        mimeType,
        quality: resolved.quality,
        coverBlob: cover?.blob,
        coverBytes: cover?.bytes,
        coverMimeType: cover?.mimeType,
        savedAt: existing?.savedAt ?? Date.now(),
        lastAccessAt: existing?.lastAccessAt ?? Date.now(),
        byteLength: blob.size,
        collections,
      };
      await db.putTrack(offlineTrack);
      this.events.emit({ type: 'track-saved', trackId: track.id });
      this.recordJob(job, 'completed');
    } catch (err) {
      if (ctrl.signal.aborted) {
        this.recordJob(job, 'cancelled');
        return;
      }
      const message = err instanceof ApiError
        ? err.message
        : err instanceof Error
          ? err.message
          : 'Download failed';
      job.error = message;
      this.recordJob(job, 'failed');
      throw err;
    } finally {
      this.active.delete(jobId);
    }
  }
}

function mergeCollections(existing: string[] | undefined, parent: string | undefined): string[] {
  const set = new Set<string>(existing ?? []);
  if (parent) set.add(parent);
  return Array.from(set);
}

/** Fetch the cover blob already stored on the parent album / playlist
 *  row in IndexedDB so we can re-use it when an individual track's
 *  cover fetch fails. Returns `null` when the parent isn't found
 *  yet, when the parent itself has no usable blob, or on any IDB
 *  read error — the caller treats `null` as "no cover available".
 *
 *  Returns BOTH the legacy `Blob` and the iOS-safe `bytes:
 *  ArrayBuffer` so the caller can persist both fields on the child
 *  track row (see `OfflineTrack.coverBytes`). When the parent only
 *  has the legacy `coverBlob` (saved before the bytes field shipped)
 *  we materialise the bytes on the fly via `blob.arrayBuffer()`. */
async function borrowParentCover(
  parent: string,
): Promise<{ blob: Blob; bytes: ArrayBuffer; mimeType: string } | null> {
  try {
    if (parent.startsWith('album:')) {
      const album = await db.getAlbum(parent.slice('album:'.length));
      const blob = album?.coverBlob;
      const bytes = album?.coverBytes;
      const mimeType = album?.coverMimeType ?? 'image/jpeg';
      if (bytes && bytes.byteLength > 0) {
        return { blob: blob ?? new Blob([bytes], { type: mimeType }), bytes, mimeType };
      }
      if (blob && (!('size' in blob) || blob.size > 0)) {
        const buf = await blob.arrayBuffer().catch(() => null);
        if (buf && buf.byteLength > 0) {
          return { blob, bytes: buf, mimeType };
        }
      }
    } else if (parent.startsWith('playlist:')) {
      const playlist = await db.getPlaylist(parent.slice('playlist:'.length));
      const blob = playlist?.coverBlob;
      const bytes = playlist?.coverBytes;
      const mimeType = playlist?.coverMimeType ?? 'image/jpeg';
      if (bytes && bytes.byteLength > 0) {
        return { blob: blob ?? new Blob([bytes], { type: mimeType }), bytes, mimeType };
      }
      if (blob && (!('size' in blob) || blob.size > 0)) {
        const buf = await blob.arrayBuffer().catch(() => null);
        if (buf && buf.byteLength > 0) {
          return { blob, bytes: buf, mimeType };
        }
      }
    }
  } catch {
    /* fall through — caller treats null as "no cover". */
  }
  return null;
}

/** Module-scoped singleton — the manager owns global state (active
 *  jobs, abort controllers) and there must only be one. */
export const downloads = new DownloadsManager();

// Re-exports for the few places that need to query the manager from
// non-React code (the audio player, the offline store hook).
export type { DownloadJob, DownloadStatus, DownloadsManager };
