/**
 * Singleton download queue that pulls tracks / albums / playlists
 * into IndexedDB. Surfaces a typed event stream so React UIs can
 * subscribe to a particular job's progress without listening to
 * every download in the system.
 *
 * Concurrency policy: `MAX_CONCURRENT` tracks are decoded in parallel,
 * which is what big streaming apps do (Spotify is around 2; Apple
 * Music sits closer to 4). Going higher saturates Tidal's CDN and
 * tanks the EQ / scrubber UI on lower-end Android devices because
 * the worker thread is doing all the IndexedDB writes on the main
 * thread; going lower drags out an album save to a fastidious crawl.
 *
 * Cancellation: each track download owns an `AbortController`. The
 * downloads manager keeps a map of `jobId → controller` so cancelling
 * a parent batch (album/playlist) propagates to every still-in-flight
 * child.
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

const MAX_CONCURRENT = 2;

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
    const coverBlob = await fetchCoverBlob(album.coverUrl);
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
      coverBlob: coverBlob?.blob,
      coverMimeType: coverBlob?.mimeType,
      savedAt: Date.now(),
    });
    this.events.emit({ type: 'album-saved', albumId: album.id });

    this.recordJob(job, 'downloading');
    let succeeded = 0;
    let failed = 0;
    const reportProgress = () => {
      job.progress = tracks.length === 0 ? 1 : (succeeded + failed) / tracks.length;
      this.events.emit({ type: 'job-changed', job });
    };

    // Run track downloads with a small concurrency cap. We use a
    // simple worker pool — peel jobs off the array until empty.
    const queue = tracks.slice();
    const worker = async () => {
      for (;;) {
        const t = queue.shift();
        if (!t) return;
        try {
          await this.runTrack(`track:${t.id}`, t, parent);
          succeeded++;
        } catch {
          failed++;
        } finally {
          reportProgress();
        }
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(MAX_CONCURRENT, tracks.length) }, () => worker()),
    );

    this.recordJob(job, failed === tracks.length && tracks.length > 0 ? 'failed' : 'completed');
    if (failed === tracks.length && tracks.length > 0) {
      job.error = 'All tracks failed to download';
    }
  }

  async enqueuePlaylist(playlist: Playlist, tracks: Track[]): Promise<void> {
    const parent = `playlist:${playlist.id}`;
    const jobId = parent;
    const job = this.makeJob(jobId, 'playlist', playlist.id);
    this.recordJob(job, 'queued');

    // Resolve cover from playlist or first track, mirroring the
    // upstream Cover priority used elsewhere.
    const coverUrl = playlist.coverUrl ?? tracks[0]?.coverUrl ?? null;
    const coverBlob = await fetchCoverBlob(coverUrl);
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
      coverBlob: coverBlob?.blob,
      coverMimeType: coverBlob?.mimeType,
      savedAt: Date.now(),
    });
    this.events.emit({ type: 'playlist-saved', playlistId: playlist.id });

    this.recordJob(job, 'downloading');
    let succeeded = 0;
    let failed = 0;
    const reportProgress = () => {
      job.progress = tracks.length === 0 ? 1 : (succeeded + failed) / tracks.length;
      this.events.emit({ type: 'job-changed', job });
    };

    const queue = tracks.slice();
    const worker = async () => {
      for (;;) {
        const t = queue.shift();
        if (!t) return;
        try {
          await this.runTrack(`track:${t.id}`, t, parent);
          succeeded++;
        } catch {
          failed++;
        } finally {
          reportProgress();
        }
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(MAX_CONCURRENT, tracks.length) }, () => worker()),
    );

    this.recordJob(job, failed === tracks.length && tracks.length > 0 ? 'failed' : 'completed');
    if (failed === tracks.length && tracks.length > 0) {
      job.error = 'All tracks failed to download';
    }
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

  private async runTrack(jobId: string, track: Track, parent?: string): Promise<void> {
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
          job.progress = total ? Math.min(0.99, received / total) : Math.min(0.95, received / 5_000_000);
          this.events.emit({ type: 'job-changed', job });
        },
      });

      const coverBlob = await fetchCoverBlob(track.coverUrl);

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
        coverBlob: coverBlob?.blob,
        coverMimeType: coverBlob?.mimeType,
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

/** Module-scoped singleton — the manager owns global state (active
 *  jobs, abort controllers) and there must only be one. */
export const downloads = new DownloadsManager();

// Re-exports for the few places that need to query the manager from
// non-React code (the audio player, the offline store hook).
export type { DownloadJob, DownloadStatus, DownloadsManager };
