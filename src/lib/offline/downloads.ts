/**
 * Singleton download queue that pulls tracks/albums/playlists into
 * IndexedDB. Exposes a typed event stream so React UIs can subscribe
 * to a particular job's progress.
 *
 * Concurrency: album/playlist downloads run strictly sequentially in
 * the user-provided track order so on-disk `savedAt` matches the
 * tracklist (deterministic ordering > a bit of wall-clock speed).
 * Single-track jobs from the 3-dot menu still run concurrently
 * across separate clicks via `inFlightTracks` dedupe.
 *
 * Cancellation: each track owns an AbortController; cancelling a
 * parent batch propagates to every still-in-flight child and stops
 * dispatching the rest of the queue.
 *
 * Framework-agnostic — not a React store. Everything is exposed via
 * EventTarget; the zustand mirror in `src/store/offline.ts`
 * re-publishes the relevant state to React consumers.
 */

import type { Album, Playlist, Track } from '@/types';
import { ApiError } from '@/lib/api';
import { useSettingsStore } from '@/store/settings';
import * as db from './db';
import {
  fetchAudioBlob,
  fetchCoverBlob,
  fetchLyricsPayload,
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
  /** Dedupe map: if track X is mid-flight from an album save, an
   *  explicit "save track X" click latches onto the same job
   *  instead of spawning a duplicate fetch. */
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

    // Persist the album shell first so a mid-download visit to
    // "Загруженное" sees a partial track list rather than nothing.
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
    // Skip already-saved tracks so a re-tap resumes missing ones
    // instead of rewriting the whole batch.
    const pending = await filterTracksToDownload(tracks, parent);
    await this.runBatchInOrder(parent, pending, job);

    // Verify on-disk presence before declaring "fully saved" — a
    // silent rollback (quota / iOS Safari mid-write) would otherwise
    // paint the checkmark on a partially-saved album.
    await this.finalizeBatch(job, tracks.map((t) => t.id));
  }

  async enqueuePlaylist(playlist: Playlist, tracks: Track[]): Promise<void> {
    const parent = `playlist:${playlist.id}`;
    const jobId = parent;
    const job = this.makeJob(jobId, 'playlist', playlist.id);
    this.recordJob(job, 'queued');

    // Cover priority: playlist → first track (mirrors upstream).
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
    const pending = await filterTracksToDownload(tracks, parent);
    await this.runBatchInOrder(parent, pending, job);
    await this.finalizeBatch(job, tracks.map((t) => t.id));
  }

  /**
   * Decide the final status by re-reading IDB. The runBatchInOrder
   * counters only know about THIS call's tracks; reading the store
   * directly is the single source of truth so the checkmark
   * reflects on-disk state, not in-memory bookkeeping.
   */
  private async finalizeBatch(job: DownloadJob, expectedTrackIds: string[]): Promise<void> {
    // Cancellations are terminal — don't overwrite them.
    const latest = this.jobs.get(job.jobId);
    if (latest && latest.status === 'cancelled') return;
    const missing = await findMissingTrackIds(expectedTrackIds);
    if (missing.length === 0) {
      this.recordJob(job, 'completed');
      return;
    }
    job.error =
      missing.length === expectedTrackIds.length && expectedTrackIds.length > 0
        ? 'All tracks failed to download'
        : `Saved ${expectedTrackIds.length - missing.length} of ${expectedTrackIds.length}; ${missing.length} failed`;
    this.recordJob(job, 'failed');
  }

  /**
   * Run a sequence of track downloads strictly in caller order,
   * surfacing progress on the parent job after each track lands.
   * Re-reads the latest job status before each iteration so the
   * loop stops dispatching as soon as the parent is cancelled;
   * already-running tracks abort via their own AbortController.
   */
  private async runBatchInOrder(
    parent: string,
    tracks: Track[],
    job: DownloadJob,
  ): Promise<{ succeeded: number; failed: number }> {
    let succeeded = 0;
    let failed = 0;
    // Per-track [0..1] progress folded into the parent ring so it
    // fills smoothly across the whole batch instead of advancing
    // only on full-track boundaries.
    let currentTrackProgress = 0;
    const reportProgress = () => {
      const total = tracks.length;
      const completed = succeeded + failed;
      const fractional = total === 0 ? 0 : currentTrackProgress / total;
      job.progress = total === 0 ? 1 : Math.min(1, completed / total + fractional);
      this.events.emit({ type: 'job-changed', job });
    };
    for (const t of tracks) {
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

  /** Drop a single track and emit `track-deleted` so the zustand
   *  mirror updates immediately. */
  async removeTrack(trackId: string): Promise<void> {
    this.cancel(`track:${trackId}`);
    const track = await db.getTrack(trackId);
    if (track) {
      await db.deleteTrack(trackId);
    }
    this.events.emit({ type: 'track-deleted', trackId });
  }

  /** Drop an album and any tracks kept around ONLY because of this
   *  album. Tracks the user explicitly saved or that another saved
   *  playlist still references stay put. */
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

  /**
   * Drop the album row but keep the audio blobs ("Удалить только
   * альбом"). Scrubs `album:<id>` from each child track's
   * `collections` so a future prune won't follow a dangling parent.
   */
  async removeAlbumKeepTracks(albumId: string): Promise<void> {
    this.cancel(`album:${albumId}`);
    const album = await db.getAlbum(albumId);
    if (!album) {
      this.events.emit({ type: 'album-deleted', albumId });
      return;
    }
    await db.deleteAlbum(albumId);
    for (const tid of album.trackIds) {
      const t = await db.getTrack(tid);
      if (!t) continue;
      const remaining = t.collections.filter((c) => c !== `album:${albumId}`);
      await db.putTrack({ ...t, collections: remaining });
    }
    this.events.emit({ type: 'album-deleted', albumId });
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

  /** See `removeAlbumKeepTracks`. */
  async removePlaylistKeepTracks(playlistId: string): Promise<void> {
    this.cancel(`playlist:${playlistId}`);
    const playlist = await db.getPlaylist(playlistId);
    if (!playlist) {
      this.events.emit({ type: 'playlist-deleted', playlistId });
      return;
    }
    await db.deletePlaylist(playlistId);
    for (const tid of playlist.trackIds) {
      const t = await db.getTrack(tid);
      if (!t) continue;
      const remaining = t.collections.filter((c) => c !== `playlist:${playlistId}`);
      await db.putTrack({ ...t, collections: remaining });
    }
    this.events.emit({ type: 'playlist-deleted', playlistId });
  }

  /**
   * Re-run a batch by downloading only the missing tracks and
   * rewriting the parent's `trackIds` to the current server-side
   * order. Covers two cases: a previous attempt left some tracks
   * missing, or new tracks landed upstream. Cover blob is not
   * refetched — it's still the same album/playlist.
   */
  async resumeAlbum(album: Album, tracks: Track[]): Promise<void> {
    const parent = `album:${album.id}`;
    const existing = await db.getAlbum(album.id);
    if (!existing) {
      // Album row was lost — fall back to a full save.
      await this.enqueueAlbum(album, tracks);
      return;
    }
    const jobId = parent;
    const job = this.makeJob(jobId, 'album', album.id);
    this.recordJob(job, 'queued');

    await db.putAlbum({ ...existing, trackIds: tracks.map((t) => t.id) });

    this.recordJob(job, 'downloading');
    const pending = await filterTracksToDownload(tracks, parent);
    await this.runBatchInOrder(parent, pending, job);

    await this.finalizeBatch(job, tracks.map((t) => t.id));
  }

  async resumePlaylist(playlist: Playlist, tracks: Track[]): Promise<void> {
    const parent = `playlist:${playlist.id}`;
    const existing = await db.getPlaylist(playlist.id);
    if (!existing) {
      await this.enqueuePlaylist(playlist, tracks);
      return;
    }
    const jobId = parent;
    const job = this.makeJob(jobId, 'playlist', playlist.id);
    this.recordJob(job, 'queued');

    await db.putPlaylist({
      ...existing,
      trackCount: playlist.trackCount,
      name: playlist.name,
      trackIds: tracks.map((t) => t.id),
    });

    this.recordJob(job, 'downloading');
    const pending = await filterTracksToDownload(tracks, parent);
    await this.runBatchInOrder(parent, pending, job);

    await this.finalizeBatch(job, tracks.map((t) => t.id));
  }

  /** Snapshot for the zustand store on init so a remount picks up
   *  existing state rather than starting empty. */
  snapshot(): DownloadJob[] {
    return Array.from(this.jobs.values()).map((j) => ({ ...j }));
  }

  /** Job currently tracking an entity (used by the 3-dot menu to
   *  render the ring spinner). */
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

      // Fire the lyrics fetch in parallel with the audio body — the
      // worker's `/tracks/:id/lyrics` is independent of the stream
      // URL endpoint so kicking it off here adds zero wall-clock to
      // the total download time. `fetchLyricsPayload` never throws,
      // so we don't have to wrap it; if it ends up null we just
      // leave the offline row's `lyrics` undefined and the next
      // online view falls back to the regular React-Query path.
      const lyricsPromise = fetchLyricsPayload(track.id, track.source);

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

      // Per-track cover fetch can 403 even when the album-level one
      // succeeded (Tidal CDN under heavy concurrent fetches). Borrow
      // the parent's cover already in IDB so the offline row shows
      // the album art instead of a broken-image glyph.
      if (!cover && parent) {
        cover = await borrowParentCover(parent);
      }
      if (!cover && track.albumId) {
        cover = await borrowParentCover(`album:${track.albumId}`);
      }

      // Merge `collections` rather than overwrite — unsaving the
      // album later mustn't drop a track the user pinned on its own.
      const existing = await db.getTrack(track.id);
      const collections = mergeCollections(existing?.collections, parent);

      // Lyrics arrived in parallel with the audio body; await once
      // we're ready to write the row. `fetchLyricsPayload` always
      // resolves (never throws) so this never blocks beyond the
      // single round trip already in flight. Prefer the freshly
      // fetched payload, fall back to whatever the prior row had
      // — never overwrite cached lyrics with `null`, since a
      // momentarily flaky upstream shouldn't blank lyrics that
      // the user previously had offline.
      const fetchedLyrics = await lyricsPromise;
      const lyrics = fetchedLyrics ?? existing?.lyrics;

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
        lyrics,
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

/** Re-use the parent album/playlist's cover when a per-track fetch
 *  fails. Returns null on missing parent / unusable blob / read
 *  error. Returns both legacy `Blob` and iOS-safe `bytes:
 *  ArrayBuffer` (materialised via `blob.arrayBuffer()` for legacy
 *  rows that pre-date the bytes field). */
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

/**
 * Subset of `trackIds` not currently in IndexedDB. Per-key
 * `db.getTrack` is O(log n) per row — cheaper than a full table
 * scan that would grow with the user's whole offline library.
 */
async function findMissingTrackIds(trackIds: string[]): Promise<string[]> {
  const missing: string[] = [];
  for (const id of trackIds) {
    try {
      const row = await db.getTrack(id);
      if (!row || !row.audioBlob) missing.push(id);
    } catch {
      missing.push(id);
    }
  }
  return missing;
}

/**
 * Filter to tracks not already saved for this parent. "Saved for
 * this parent" means the row exists AND `collections` lists this
 * parent — the second check avoids a subtle bug where a directly
 * saved track later gets pulled into an album save without the
 * cross-reference, so a future `removeAlbum` would skip detaching.
 */
async function filterTracksToDownload(tracks: Track[], parent: string): Promise<Track[]> {
  const pending: Track[] = [];
  for (const track of tracks) {
    let row: OfflineTrack | null = null;
    try {
      row = await db.getTrack(track.id);
    } catch {
      row = null;
    }
    if (!row || !row.audioBlob) {
      pending.push(track);
      continue;
    }
    if (!row.collections.includes(parent)) {
      // Already on device but missing the parent cross-reference
      // — patch in place so future prunes detach correctly. No
      // re-download; the audio blob is already there.
      try {
        await db.putTrack({ ...row, collections: mergeCollections(row.collections, parent) });
      } catch {
        /* non-fatal — caller still finishes the rest of the batch */
      }
    }
  }
  return pending;
}

/** Module-scoped singleton — owns global state (active jobs, abort
 *  controllers); there must only be one. */
export const downloads = new DownloadsManager();

export type { DownloadJob, DownloadStatus, DownloadsManager };
