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
 *      never-discovered-before track. Volume: near-zero on a
 *      stable rotation.
 *   3) `tidal-discovery-breaker` — TTL 1h, written when
 *      `openapi.tidal.com` rejects the bearer. Volume: ≤1/h.
 *   4) `tidal-track-quality:<id>` — TTL 30 days, written once per
 *      track with the actual playable quality. Volume: same order
 *      as (2).
 *
 * The dominant slot was (1). Once you take it out of KV the other
 * three slots are nowhere near the 1000/day cap on any realistic
 * traffic shape (a busy day cold-discovers maybe a few hundred new
 * tracks; warm days are near-zero). So:
 *
 *   A. {@link StreamUrlMemoCache} — in-memory `Map` per isolate for
 *      the short-lived (300s) stream-URL slot. We don't need this
 *      to survive isolate eviction; even at a 50% miss rate (a
 *      conservative estimate for a single-region deployment) we
 *      still avoid the KV write entirely. Trade-off: a fresh
 *      isolate has a cold cache. Acceptable because the alternative
 *      (KV writes) was the actual hard-blocker once the 1000 cap
 *      was hit.
 *
 *   B. {@link kvGetJson}/{@link kvPutJson}/{@link kvGetText}/
 *      {@link kvPutText} — thin wrappers over `env.SESSIONS` (the
 *      KV namespace) for the long-lived (30d / 1h) slots. KV's
 *      writes-per-day quota is namespace-wide, but the volume on
 *      these slots is bounded by the cold-track discovery rate
 *      (which is itself bounded by ~Tidal's catalogue × users), so
 *      this never re-introduces the 1k/day failure mode. Reads are
 *      free.
 *
 * History — an earlier revision of this file (PR #344) routed the
 * long-lived slots through `caches.default` (the Workers Cache API)
 * to escape KV's write cap entirely. That works on a Worker bound
 * to a custom domain or zone route, but the production deploy
 * lives on `bratan-music-api.bratan-corp.workers.dev` (a workers.dev
 * subdomain) and on workers.dev `caches.default.put()` is documented
 * as a no-op (refer to Cloudflare's "Cache · Workers" docs:
 * "any Cache API operations [...] will have no impact" outside of a
 * custom-domain Worker). The symptom was the discovery breaker
 * tripping on every cold call instead of staying tripped for 1h —
 * confirmed in `wrangler tail` logs where every `/tracks/:id/stream`
 * was emitting `[TidalWeb] discovery breaker tripped` repeatedly,
 * and every cold play paid an extra wasted RTT to openapi.tidal.com
 * before falling through to the legacy ladder.
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

/* ────────── B. KV helpers for long-lived slots ────────── */

/**
 * Minimal subset of `KVNamespace` used by the helpers below. Lets
 * call sites typecheck without dragging the full `Env` shape into
 * this file (and lets unit tests drop in a stub).
 */
export interface KvLike {
  get(key: string): Promise<string | null>;
  put(
    key: string,
    value: string,
    options?: { expirationTtl?: number },
  ): Promise<void>;
}

/**
 * Read a JSON value from KV. Returns `null` on miss, malformed
 * entries, or any error — callers must treat this as a best-effort
 * optimisation and have a fallback path.
 */
export async function kvGetJson<T>(kv: KvLike, key: string): Promise<T | null> {
  try {
    const raw = await kv.get(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/**
 * Read a plain string value from KV. Same error handling as
 * {@link kvGetJson}.
 */
export async function kvGetText(kv: KvLike, key: string): Promise<string | null> {
  try {
    return await kv.get(key);
  } catch {
    return null;
  }
}

/**
 * Write a JSON value to KV with the given TTL. Errors are swallowed
 * — the caches are best-effort and a write failure (e.g. the rare
 * KV-quota-exhausted case) must not leak up into the request path.
 */
export async function kvPutJson(
  kv: KvLike,
  key: string,
  value: unknown,
  ttlSeconds: number,
): Promise<void> {
  try {
    await kv.put(key, JSON.stringify(value), {
      expirationTtl: Math.max(60, Math.floor(ttlSeconds)),
    });
  } catch {
    /* ignore — cache is best-effort */
  }
}

/**
 * Write a plain string value to KV with the given TTL.
 */
export async function kvPutText(
  kv: KvLike,
  key: string,
  value: string,
  ttlSeconds: number,
): Promise<void> {
  try {
    await kv.put(key, value, {
      expirationTtl: Math.max(60, Math.floor(ttlSeconds)),
    });
  } catch {
    /* ignore — cache is best-effort */
  }
}
