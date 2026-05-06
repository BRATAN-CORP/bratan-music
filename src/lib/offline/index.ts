/**
 * Public surface of the offline cache module.
 *
 * Components / hooks / stores import everything from `@/lib/offline`
 * rather than reaching into individual files — keeps the import
 * graph small and gives us a single seam for future swaps (e.g.
 * moving the audio download path into a Service Worker, swapping
 * IndexedDB for OPFS on browsers that ship FS Access, etc.).
 */

export {
  isTrackSaved,
  isAlbumSaved,
  isPlaylistSaved,
  getSavedTrack,
  getSavedAlbum,
  getSavedPlaylist,
  listSavedTracks,
  listSavedAlbums,
  listSavedPlaylists,
  unsaveTrack,
  unsaveAlbum,
  unsavePlaylist,
  touchTrack,
  wipeAll,
  getTotalCacheBytes,
} from './storage';

export { downloads } from './downloads';
export type { DownloadEvent, DownloadJob, DownloadStatus } from './downloads';

export {
  resolveStreamForDownload,
  fetchAudioBlob,
  fetchCoverBlob,
  fallbackChain,
  QUALITY_FALLBACK_ORDER,
} from './streamResolver';

export type {
  OfflineTrack,
  OfflineAlbum,
  OfflinePlaylist,
} from './types';
