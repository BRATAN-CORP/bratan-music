/**
 * Client-side memo of resolved Tidal stream URLs.
 *
 * The worker side already memoises the resolved CDN URL in KV
 * (`tidal-stream-url:<id>:<quality>`, TTL 300 s — see
 * `worker/src/routes/tracks.ts`), so the second hit is ~50 ms instead
 * of ~800 ms. This client-side cache turns those ~50 ms into ~0 ms
 * for the rest of the session: as long as the URL hasn't expired we
 * skip the worker entirely and hand the audio element a URL we
 * already verified once.
 *
 * The cache keys mirror the worker's: `(trackId, quality)`. We store
 * an `expiresAt` derived from the worker's TTL minus a small slop
 * window so we never hand out a URL that could expire mid-decode.
 *
 * The cache is in-memory only — there is intentionally no localStorage
 * persistence:
 *
 *   - Tidal URLs are signed with a short-lived timestamp; persisting
 *     across reloads would just hand out an expired URL on next visit.
 *   - The user might switch accounts; URLs scoped to a previous session
 *     should not leak into the new one.
 *
 * Concurrent prefetches for the same key share a single in-flight
 * Promise so a hover + click on the same row don't fire two requests.
 */

interface CachedEntry {
  url: string;
  expiresAt: number;
}

interface PendingEntry {
  promise: Promise<string>;
}

const CACHE: Map<string, CachedEntry> = new Map();
const PENDING: Map<string, PendingEntry> = new Map();

/** TTL for an entry written via `set()` when no `expiresAt` is supplied.
 *  Mirrors the worker's `STREAM_URL_TTL_S` (300 s) minus the same 30 s
 *  slop the worker bakes in. We keep the client window tighter still
 *  to absorb any clock skew between the user's device and the worker. */
const DEFAULT_TTL_MS = 4 * 60 * 1000;

/** Only treat upload/override URLs as cacheable if they're scoped to the
 *  same access token. The worker rebuilds them on every request, so
 *  caching them per-token is fine, but a re-login would invalidate the
 *  token in the URL — we drop those entries on logout (see
 *  `clearStreamUrlCache`). */

export function streamCacheKey(trackId: string, quality: string): string {
  return `${trackId}::${quality}`;
}

export function getCachedStreamUrl(
  trackId: string,
  quality: string,
): string | null {
  const key = streamCacheKey(trackId, quality);
  const entry = CACHE.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    CACHE.delete(key);
    return null;
  }
  return entry.url;
}

export function setCachedStreamUrl(
  trackId: string,
  quality: string,
  url: string,
  ttlMs: number = DEFAULT_TTL_MS,
): void {
  const key = streamCacheKey(trackId, quality);
  CACHE.set(key, { url, expiresAt: Date.now() + ttlMs });
}

/** Coordinate a single in-flight resolver promise per (track, quality)
 *  key. Subsequent callers (e.g. hover prefetch + click play) await the
 *  same promise instead of stampeding the worker. */
export function getOrStartInFlight(
  trackId: string,
  quality: string,
  resolver: () => Promise<string>,
): Promise<string> {
  const key = streamCacheKey(trackId, quality);
  const pending = PENDING.get(key);
  if (pending) return pending.promise;
  const promise = resolver()
    .then((url) => {
      setCachedStreamUrl(trackId, quality, url);
      return url;
    })
    .finally(() => {
      PENDING.delete(key);
    });
  PENDING.set(key, { promise });
  return promise;
}

/** Drop everything — used on logout / token rotation so a previously
 *  signed CDN URL doesn't accidentally play on a different account. */
export function clearStreamUrlCache(): void {
  CACHE.clear();
  PENDING.clear();
}
