/**
 * Stream-URL + Tidal-discovery cache helpers.
 *
 * Background — the free-tier Cloudflare Workers KV write quota is
 * 1000 writes/day across the whole namespace. The previous shape
 * stored four kinds of values in `env.SESSIONS` (a KV namespace):
 *
 *   1) `tidal-stream-url:<id>:<quality>` — TTL 300s, written on
 *      every cold `/tracks/:id/stream` hit. ~1 write per song play.
 *      Volume: dominant. The single biggest contributor to KV
 *      writes by an order of magnitude.
 *   2) `tidal-track-formats:<id>` — TTL 30 days, written once per
 *      never-discovered-before track. Volume: medium on cold
 *      catalogue spelunks, near-zero on a stable rotation.
 *   3) `tidal-discovery-breaker` — TTL 1h, written when
 *      `openapi.tidal.com` rejects the bearer. Volume: very low.
 *   4) `tidal-track-quality:<id>` — TTL 30 days, written once per
 *      track with the actual playable quality. Volume: medium,
 *      same order as (2).
 *
 * Cumulatively, an active user playing 30-50 unique tracks/day is
 * enough to put the project over the 1000/day write cap because the
 * stream-URL slot writes ~1 per click, and the long-TTL slots
 * stack on top of that on cold tracks. Once we hit the cap KV
 * writes get rejected, the resolver can't memoise anything, and
 * /tracks/:id/stream pays the full 800ms playbackinfopostpaywall
 * RTT on every play (the user-visible "стриминг поломался" symptom).
 *
 * Two strategies replace the writes:
 *
 *   A. {@link StreamUrlMemoCache} — in-memory `Map` per isolate for
 *      the short-lived (300s) stream-URL slot. We don't need this
 *      to survive isolate eviction; even at a 50% miss rate (a
 *      conservative estimate for a single-region deployment) we
 *      still avoid the KV write entirely. Trade-off: a fresh
 *      isolate has a cold cache. Acceptable because the alternative
 *      (KV writes) is now a hard-blocker once the 1000 cap is hit.
 *
 *   B. {@link CacheApiStore} — Cloudflare's `caches.default`
 *      (the Cache API) for the long-lived (30d / 1h) slots. The
 *      Cache API has NO daily write limits and is the documented
 *      escape hatch for exactly this kind of high-volume ephemeral
 *      cache. We synthesise a stable `Request` URL per key so the
 *      cache layer can hash / shard normally:
 *
 *          https://cache.bratan.local/track-formats/<id>
 *
 *      The hostname is private; the URL is never fetched, only
 *      used as a cache key. We store JSON-encoded values with a
 *      `Cache-Control: public, max-age=<ttl>` header so the cache
 *      respects our TTLs.
 */

/* ────────── A. In-memory stream-URL memo ────────── */

interface StreamUrlEntry {
  url: string;
  quality: string;
  /** Wall-clock millisecond timestamp at which this entry expires. */
  expiresAt: number;
}

/**
 * Per-isolate `Map` keyed by `tidal-stream-url:<id>:<quality>`.
 * Values include a wall-clock `expiresAt` so a slow request that
 * picked up a near-expiry entry can still bail before serving a
 * stale URL to the audio element.
 */
const streamUrlMemo = new Map<string, StreamUrlEntry>();

/**
 * Bookkeeping cap so a runaway isolate (rare, but possible if a
 * single deployment somehow accumulates millions of entries before
 * eviction) can't OOM the worker. 5000 entries × ~120 bytes ≈ 600 KB
 * upper bound.
 */
const STREAM_MEMO_MAX_ENTRIES = 5000;

export const StreamUrlMemoCache = {
  get(key: string): StreamUrlEntry | null {
    const entry = streamUrlMemo.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      streamUrlMemo.delete(key);
      return null;
    }
    return entry;
  },

  set(key: string, entry: StreamUrlEntry): void {
    if (streamUrlMemo.size >= STREAM_MEMO_MAX_ENTRIES) {
      // Cheapest possible eviction: drop the oldest insertion (Map
      // iteration order is insertion order). Fine for this cache —
      // the values are 300s TTL anyway, so absolute LRU behaviour
      // isn't worth a wrapper class.
      const firstKey = streamUrlMemo.keys().next().value;
      if (firstKey !== undefined) streamUrlMemo.delete(firstKey);
    }
    streamUrlMemo.set(key, entry);
  },
};

/* ────────── B. Cache-API helpers for long-lived slots ────────── */

/**
 * Synthetic origin used to build cache-key URLs. The hostname is
 * never resolved or fetched — `caches.default.put/match` only use
 * the URL as an opaque key.
 */
const CACHE_KEY_ORIGIN = 'https://cache.bratan.local';

function buildCacheRequest(key: string): Request {
  // `key` already includes its semantic prefix (e.g.
  // `track-formats/<id>`) so the URL is human-readable in the
  // Cache API dashboard / wrangler tail.
  return new Request(`${CACHE_KEY_ORIGIN}/${key}`, { method: 'GET' });
}

/**
 * Read a JSON value from the Cache API. Returns `null` on miss,
 * malformed entries, or any error — callers must treat this as a
 * best-effort optimisation and have a fallback path.
 */
export async function cacheGetJson<T>(key: string): Promise<T | null> {
  try {
    const cache = caches.default;
    const hit = await cache.match(buildCacheRequest(key));
    if (!hit) return null;
    return (await hit.json()) as T;
  } catch {
    return null;
  }
}

/**
 * Read a plain string value from the Cache API. Same error handling
 * as {@link cacheGetJson}.
 */
export async function cacheGetText(key: string): Promise<string | null> {
  try {
    const cache = caches.default;
    const hit = await cache.match(buildCacheRequest(key));
    if (!hit) return null;
    return await hit.text();
  } catch {
    return null;
  }
}

/**
 * Write a JSON value to the Cache API with the given TTL.
 *
 * Wraps the value in a `Response` with `Cache-Control:
 * public, max-age=<ttlSeconds>` so the underlying cache layer
 * respects the same expiry the previous KV `expirationTtl` did.
 */
export async function cachePutJson(
  key: string,
  value: unknown,
  ttlSeconds: number,
): Promise<void> {
  try {
    const cache = caches.default;
    const body = JSON.stringify(value);
    const response = new Response(body, {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': `public, max-age=${Math.max(1, Math.floor(ttlSeconds))}`,
      },
    });
    await cache.put(buildCacheRequest(key), response);
  } catch {
    /* ignore — cache is best-effort */
  }
}

/**
 * Write a plain string value to the Cache API with the given TTL.
 */
export async function cachePutText(
  key: string,
  value: string,
  ttlSeconds: number,
): Promise<void> {
  try {
    const cache = caches.default;
    const response = new Response(value, {
      headers: {
        'Content-Type': 'text/plain',
        'Cache-Control': `public, max-age=${Math.max(1, Math.floor(ttlSeconds))}`,
      },
    });
    await cache.put(buildCacheRequest(key), response);
  } catch {
    /* ignore — cache is best-effort */
  }
}
