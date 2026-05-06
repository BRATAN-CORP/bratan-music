/**
 * IndexedDB layer for the on-device offline cache.
 *
 * Why IndexedDB and not Cache API? Two reasons:
 *
 *   1. iOS Safari restricts the Cache API hard for cross-origin audio
 *      bodies (the FLAC stream lives on Tidal's CDN, proxied through
 *      our worker). IndexedDB doesn't care about origin.
 *   2. We need structured queries — "list every track in this album",
 *      "find the playlists that reference this track id" — which are
 *      cheap with IndexedDB indices and awkward to retrofit on top of
 *      a flat URL-keyed cache.
 *
 * Schema (version 1):
 *   - `tracks`     keyPath=id, no indices required (we look up by id
 *                  or fan out via `trackIds` arrays in album/playlist
 *                  records).
 *   - `albums`     keyPath=id.
 *   - `playlists`  keyPath=id.
 *   - `meta`       keyPath=key — opaque key/value bag for module-level
 *                  state (sync queue cursors, last-good-quality cache,
 *                  etc.). PR #5 will add a parallel `syncQueue` store
 *                  with a different shape; we deliberately keep `meta`
 *                  generic so we don't have to bump the schema for
 *                  every small piece of state.
 *
 * The wrapper exposes a `Promise`-friendly API on top of the native
 * callback-shaped IndexedDB so the rest of the code can `await`
 * everything.
 */

import type {
  OfflineAlbum,
  OfflinePlaylist,
  OfflineTrack,
  SyncQueueEntry,
} from './types';

const DB_NAME = 'bratan-offline';
/** Bumped to 2 in PR #5 to add the `syncQueue` store used by the
 *  offline-action replay loop (likes / play history / etc. that
 *  the user performed while offline). */
const DB_VERSION = 2;

export const STORE_TRACKS = 'tracks';
export const STORE_ALBUMS = 'albums';
export const STORE_PLAYLISTS = 'playlists';
export const STORE_META = 'meta';
export const STORE_SYNC_QUEUE = 'syncQueue';

let dbPromise: Promise<IDBDatabase> | null = null;

function isIndexedDBAvailable(): boolean {
  return typeof indexedDB !== 'undefined';
}

/** Open (or create) the offline DB. Idempotent — subsequent calls
 *  share the same promise so we never race two `open` requests. */
export function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  if (!isIndexedDBAvailable()) {
    return Promise.reject(new Error('IndexedDB is not available in this environment'));
  }
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
    req.onblocked = () => reject(new Error('IndexedDB open blocked by another tab'));
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_TRACKS)) {
        db.createObjectStore(STORE_TRACKS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_ALBUMS)) {
        db.createObjectStore(STORE_ALBUMS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_PLAYLISTS)) {
        db.createObjectStore(STORE_PLAYLISTS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(STORE_SYNC_QUEUE)) {
        // PR #5: replay queue for offline likes / play history.
        // Keyed by an enqueued UUID; rows are processed FIFO via
        // the `enqueuedAt` index so a flush always replays in
        // chronological order.
        const store = db.createObjectStore(STORE_SYNC_QUEUE, { keyPath: 'id' });
        store.createIndex('byEnqueuedAt', 'enqueuedAt', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
  });
  return dbPromise;
}

/** Wrap a single IndexedDB request in a promise. The native API
 *  fires `onsuccess` / `onerror` callbacks; we shim those onto
 *  resolve / reject. Used by every CRUD helper below. */
function reqAsPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
}

/** Walk an object store with a cursor, returning every record. We
 *  only ever store on the order of hundreds of entries (saved
 *  tracks, albums, playlists), so an in-memory full-scan is fine. */
function getAll<T>(store: IDBObjectStore): Promise<T[]> {
  return reqAsPromise(store.getAll() as IDBRequest<T[]>);
}

/** Run a transaction with the given mode and handler. The handler
 *  receives the raw object store; it can issue any number of
 *  requests synchronously. The promise resolves once `oncomplete`
 *  fires (i.e. every queued request has resolved). */
async function tx<T>(
  storeName: string,
  mode: IDBTransactionMode,
  handler: (store: IDBObjectStore) => Promise<T> | T,
): Promise<T> {
  const db = await openDB();
  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(storeName, mode);
    const store = transaction.objectStore(storeName);
    let resultValue: T;
    let pending: Promise<T> | T;
    try {
      pending = handler(store);
    } catch (err) {
      reject(err);
      return;
    }
    Promise.resolve(pending)
      .then((value) => {
        resultValue = value;
      })
      .catch(reject);
    transaction.oncomplete = () => resolve(resultValue);
    transaction.onabort = () =>
      reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
    transaction.onerror = () =>
      reject(transaction.error ?? new Error('IndexedDB transaction failed'));
  });
}

// ──────────────────────────── tracks ────────────────────────────

export async function putTrack(track: OfflineTrack): Promise<void> {
  await tx(STORE_TRACKS, 'readwrite', (store) => reqAsPromise(store.put(track)));
}

export async function getTrack(id: string): Promise<OfflineTrack | null> {
  const result = await tx(STORE_TRACKS, 'readonly', (store) =>
    reqAsPromise<OfflineTrack | undefined>(store.get(id) as IDBRequest<OfflineTrack | undefined>),
  );
  return result ?? null;
}

export async function deleteTrack(id: string): Promise<void> {
  await tx(STORE_TRACKS, 'readwrite', (store) => reqAsPromise(store.delete(id)));
}

export async function listTracks(): Promise<OfflineTrack[]> {
  return tx(STORE_TRACKS, 'readonly', (store) => getAll<OfflineTrack>(store));
}

// ──────────────────────────── albums ────────────────────────────

export async function putAlbum(album: OfflineAlbum): Promise<void> {
  await tx(STORE_ALBUMS, 'readwrite', (store) => reqAsPromise(store.put(album)));
}

export async function getAlbum(id: string): Promise<OfflineAlbum | null> {
  const result = await tx(STORE_ALBUMS, 'readonly', (store) =>
    reqAsPromise<OfflineAlbum | undefined>(store.get(id) as IDBRequest<OfflineAlbum | undefined>),
  );
  return result ?? null;
}

export async function deleteAlbum(id: string): Promise<void> {
  await tx(STORE_ALBUMS, 'readwrite', (store) => reqAsPromise(store.delete(id)));
}

export async function listAlbums(): Promise<OfflineAlbum[]> {
  return tx(STORE_ALBUMS, 'readonly', (store) => getAll<OfflineAlbum>(store));
}

// ─────────────────────────── playlists ──────────────────────────

export async function putPlaylist(playlist: OfflinePlaylist): Promise<void> {
  await tx(STORE_PLAYLISTS, 'readwrite', (store) => reqAsPromise(store.put(playlist)));
}

export async function getPlaylist(id: string): Promise<OfflinePlaylist | null> {
  const result = await tx(STORE_PLAYLISTS, 'readonly', (store) =>
    reqAsPromise<OfflinePlaylist | undefined>(
      store.get(id) as IDBRequest<OfflinePlaylist | undefined>,
    ),
  );
  return result ?? null;
}

export async function deletePlaylist(id: string): Promise<void> {
  await tx(STORE_PLAYLISTS, 'readwrite', (store) => reqAsPromise(store.delete(id)));
}

export async function listPlaylists(): Promise<OfflinePlaylist[]> {
  return tx(STORE_PLAYLISTS, 'readonly', (store) => getAll<OfflinePlaylist>(store));
}

// ──────────────────────────── meta ──────────────────────────────

export async function getMeta<T = unknown>(key: string): Promise<T | null> {
  const result = await tx(STORE_META, 'readonly', (store) =>
    reqAsPromise<{ key: string; value: T } | undefined>(
      store.get(key) as IDBRequest<{ key: string; value: T } | undefined>,
    ),
  );
  return result ? result.value : null;
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  await tx(STORE_META, 'readwrite', (store) =>
    reqAsPromise(store.put({ key, value })),
  );
}

export async function deleteMeta(key: string): Promise<void> {
  await tx(STORE_META, 'readwrite', (store) => reqAsPromise(store.delete(key)));
}

// ───────────────────────── sync queue ──────────────────────────

export async function putSyncEntry(entry: SyncQueueEntry): Promise<void> {
  await tx(STORE_SYNC_QUEUE, 'readwrite', (store) => reqAsPromise(store.put(entry)));
}

export async function deleteSyncEntry(id: string): Promise<void> {
  await tx(STORE_SYNC_QUEUE, 'readwrite', (store) => reqAsPromise(store.delete(id)));
}

/** Cursor-walk the queue in FIFO order via the `byEnqueuedAt` index.
 *  Done as a single full-store scan because the queue is on the
 *  order of dozens of entries, not thousands. */
export async function listSyncEntries(): Promise<SyncQueueEntry[]> {
  const db = await openDB();
  return new Promise<SyncQueueEntry[]>((resolve, reject) => {
    const transaction = db.transaction(STORE_SYNC_QUEUE, 'readonly');
    const store = transaction.objectStore(STORE_SYNC_QUEUE);
    const idx = store.index('byEnqueuedAt');
    const out: SyncQueueEntry[] = [];
    const req = idx.openCursor();
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) {
        resolve(out);
        return;
      }
      out.push(cursor.value as SyncQueueEntry);
      cursor.continue();
    };
    req.onerror = () =>
      reject(req.error ?? new Error('IndexedDB cursor failed'));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
  });
}

export async function countSyncEntries(): Promise<number> {
  return tx(STORE_SYNC_QUEUE, 'readonly', (store) => reqAsPromise(store.count()));
}

/** Wipe every record from every store. Used by the logout path so a
 *  user signing in on a shared device doesn't inherit the previous
 *  user's offline library. */
export async function clearAll(): Promise<void> {
  const db = await openDB();
  const stores = [
    STORE_TRACKS,
    STORE_ALBUMS,
    STORE_PLAYLISTS,
    STORE_META,
    STORE_SYNC_QUEUE,
  ];
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(stores, 'readwrite');
    for (const name of stores) {
      transaction.objectStore(name).clear();
    }
    transaction.oncomplete = () => resolve();
    transaction.onabort = () =>
      reject(transaction.error ?? new Error('IndexedDB clear aborted'));
    transaction.onerror = () =>
      reject(transaction.error ?? new Error('IndexedDB clear failed'));
  });
}

/** Sum the byteLength of every saved track. Used by the settings card
 *  in PR #6 to show "Занято: 1.2 GB" and (eventually) by the LRU
 *  eviction path. */
export async function totalCacheBytes(): Promise<number> {
  const tracks = await listTracks();
  return tracks.reduce((sum, t) => sum + (t.byteLength ?? 0), 0);
}
