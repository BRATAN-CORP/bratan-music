/**
 * Resolves a CDN-fetchable URL for a track at a target quality and
 * walks the same `HI_RES_LOSSLESS → LOSSLESS → HIGH → LOW` ladder the
 * online player walks (`useAudioPlayer.ts`). The point is that
 * everything the player has historically played correctly — including
 * user uploads (`upload:<uuid>`) and user overrides of Tidal tracks —
 * also saves correctly offline through this single seam.
 *
 * Why duplicate the resolution logic from `useAudioPlayer.ts`? The
 * player's resolver is bound up with a hot-path streaming cache that
 * caches signed CDN URLs for live playback. We don't want a download
 * to evict a freshly-resolved play URL or vice versa, so the offline
 * path runs its own plain `api.get(...)` against the same endpoint.
 *
 * Override behaviour: the worker's `/tracks/:id/stream` already inlines
 * the override-vs-tidal decision (see `worker/src/routes/tracks.ts`).
 * For tracks the user has overridden with their own upload, this
 * resolver therefore receives the override URL automatically and the
 * caller stores the user's version of the track offline — exactly what
 * the user asked for.
 */

import { api, ApiError } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import type { TidalQuality } from '@/store/settings';

const API_BASE =
  import.meta.env.VITE_API_URL ?? 'https://bratan-music-api.bratan-corp.workers.dev';

/** Same ladder as `useAudioPlayer.ts`. Defining it here (instead of
 *  importing from the hook) keeps the offline module free of any
 *  hook / React dependencies so it can be invoked from a Service
 *  Worker context in the future without dragging the audio engine
 *  along. */
export const QUALITY_FALLBACK_ORDER: TidalQuality[] = [
  'HI_RES_LOSSLESS',
  'LOSSLESS',
  'HIGH',
  'LOW',
];

/** Build the ordered list of qualities we should attempt for a given
 *  user-requested quality. Starts at the requested quality and walks
 *  down the ladder so we never silently upgrade past the user's
 *  configured ceiling. */
export function fallbackChain(start: TidalQuality): TidalQuality[] {
  const idx = QUALITY_FALLBACK_ORDER.indexOf(start);
  if (idx < 0) return QUALITY_FALLBACK_ORDER.slice();
  return QUALITY_FALLBACK_ORDER.slice(idx);
}

export interface ResolvedStream {
  /** CDN-fetchable URL — already proxied through our worker if it
   *  was a Tidal-origin URL. Suitable for plain `fetch()`. */
  url: string;
  /** Quality the worker actually returned. May be lower than the
   *  request when the proxy account couldn't deliver the requested
   *  level. */
  quality: TidalQuality;
}

/**
 * Resolve a single track's stream URL at exactly one quality.
 * Returns `null` on a quality that isn't available so the caller
 * can step down the ladder. Anything else (network errors, 5xx,
 * 401-after-refresh) is rethrown so the download manager can
 * surface a real error to the user.
 */
async function resolveOnce(
  trackId: string,
  source: string | undefined,
  quality: TidalQuality,
): Promise<ResolvedStream | null> {
  // Upload tracks are served from the worker's R2-backed
  // `/uploads/:id/stream` endpoint and don't participate in the
  // Tidal quality ladder — there's exactly one bitrate per upload,
  // whatever the user uploaded. We still report the track as
  // saved at HI_RES_LOSSLESS because that's the highest qualifier
  // we have for "the user's own master file".
  if (trackId.startsWith('upload:') || source === 'upload') {
    const rawId = trackId.startsWith('upload:')
      ? trackId.slice('upload:'.length)
      : trackId;
    const token = useAuthStore.getState().accessToken ?? '';
    return {
      url: `${API_BASE}/uploads/${rawId}/stream?token=${encodeURIComponent(token)}`,
      quality: 'HI_RES_LOSSLESS',
    };
  }

  try {
    // `download=1` tells the worker this resolution is part of an
    // offline-save batch, so it should READ but not WRITE the
    // per-track KV caches (`tidal-track-formats:` /
    // `tidal-track-quality:`). Without the flag a 200-track playlist
    // save burns ~400 of the 1000 daily KV writes the free Cloudflare
    // tier permits namespace-wide; once that quota is exhausted every
    // write site across the worker starts failing and the service is
    // effectively offline for every other user for the rest of the
    // day. See `worker/src/services/tidal/TidalWeb.ts ::
    // setSkipCacheWrites` for the full rationale.
    const res = await api.get<{ url: string }>(
      `/tracks/${trackId}/stream?quality=${encodeURIComponent(quality)}&download=1`,
    );
    return { url: res.url, quality };
  } catch (err) {
    if (err instanceof ApiError) {
      // 404 / 422 / 502 from the upstream when this quality isn't
      // available — caller should try the next rung. 402 is the
      // free-tier paywall and is genuinely fatal for THIS track.
      if (err.status === 402) throw err;
      if (err.status === 404 || err.status === 422 || err.status === 502) {
        return null;
      }
    }
    throw err;
  }
}

/**
 * Walk the fallback ladder from the requested quality downwards and
 * return the first quality the worker can deliver. Throws on a
 * definitive failure (paywall, auth) so the download job can be
 * marked `failed`.
 */
export async function resolveStreamForDownload(
  trackId: string,
  source: string | undefined,
  desiredQuality: TidalQuality,
): Promise<ResolvedStream> {
  const chain = fallbackChain(desiredQuality);
  let lastError: unknown = null;
  for (const q of chain) {
    try {
      const resolved = await resolveOnce(trackId, source, q);
      if (resolved) return resolved;
    } catch (err) {
      lastError = err;
      // Auth / paywall errors short-circuit the ladder — there's no
      // point trying a different quality if the worker has rejected
      // the user wholesale.
      if (err instanceof ApiError && (err.status === 401 || err.status === 402)) {
        throw err;
      }
    }
  }
  if (lastError) throw lastError;
  throw new Error(`No streamable quality found for track ${trackId}`);
}

/**
 * Pull the audio body for a resolved stream URL. Reports progress in
 * 0…1 to the optional callback as bytes arrive — the UI uses this
 * for the spinning ring on the 3-dot menu (PR #2).
 *
 * `Content-Length` isn't always present (the proxy does range-aware
 * streaming and may omit it for chunked responses), so when it's
 * missing we fall back to a synthetic indeterminate progress (alternating
 * 0.5 / 0.95 so the UI ring never looks frozen).
 */
export async function fetchAudioBlob(
  url: string,
  opts?: {
    signal?: AbortSignal;
    onProgress?: (received: number, total: number | null) => void;
  },
): Promise<{ blob: Blob; mimeType: string }> {
  const res = await fetch(url, { signal: opts?.signal });
  if (!res.ok) {
    throw new Error(`Stream fetch failed: ${res.status} ${res.statusText}`);
  }
  const mimeType = res.headers.get('content-type') ?? 'audio/flac';
  const totalHeader = res.headers.get('content-length');
  const total = totalHeader ? Number.parseInt(totalHeader, 10) : null;

  const reader = res.body?.getReader();
  if (!reader) {
    // No streaming reader (e.g. older browsers, or response.body
    // intercepted by a service worker) — fall back to a single
    // `.blob()` call and report 100% on completion.
    const blob = await res.blob();
    opts?.onProgress?.(blob.size, blob.size);
    return { blob, mimeType };
  }

  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      received += value.byteLength;
      opts?.onProgress?.(received, total);
    }
  }
  const blob = new Blob(chunks as BlobPart[], { type: mimeType });
  return { blob, mimeType };
}

/** Fetch a cover image as a blob so the saved track / album / playlist
 *  renders offline.
 *
 *  Cover URLs almost always live on `resources.tidal.com` (Tidal's
 *  CloudFront-fronted S3 image bucket) which does **not** send
 *  `Access-Control-Allow-Origin` headers. The previous shape used a
 *  default-mode `fetch(url)` (mode: 'cors'), which the browser
 *  rejected outright with a CORS error — the catch swallowed it and
 *  the track was stored with `coverBlob: undefined`. Hours later,
 *  with the device offline, `useOfflineCoverUrl` had nothing to hand
 *  to `<img src>`, the network URL fallback failed, and the user
 *  saw the generic Disc3 / initials fallback. That's the
 *  "обложки в офлайне не работают" bug.
 *
 *  Strategy:
 *    1. Try CORS first. Hosts that *do* send ACAO (our own worker
 *       proxy, user-uploaded R2 covers with the right CORS rules,
 *       a few CloudFront covers when configured) succeed and we
 *       get a fully-typed `image/jpeg` Blob with size + mime.
 *    2. On CORS rejection (the dominant case for resources.tidal.com),
 *       retry as `mode: 'no-cors'`. The response is opaque — we
 *       can't read headers / status / `.text()` — but `.blob()`
 *       still returns the actual binary. The opaque Blob is fine
 *       to put in IndexedDB and feed to `URL.createObjectURL` for
 *       `<img>` rendering offline.
 *
 *  Best-effort throughout — any error returns null and the caller
 *  saves the track without a local cover. */
/** Hosts whose cover URLs we proxy through `/covers/proxy` to bypass
 *  the missing `Access-Control-Allow-Origin` headers on the upstream
 *  CDN. See `worker/src/routes/covers.ts` for the full rationale. */
const COVER_PROXY_HOSTS = /^(?:resources\.tidal\.com|.+\.tidal\.com)$/i;

/** Number of attempts we make per cover URL before giving up. The
 *  Tidal CDN occasionally 5xxs individual image URLs under load
 *  (especially during a multi-track album save which fans out a few
 *  dozen requests in a tight burst). One isolated failure used to
 *  permanently store the track without a cover, so the next online
 *  cover-backfill pass had to refetch — and if backfill itself hit
 *  the same blip the user could end up with covers missing for the
 *  whole session. With short retries the per-track save almost
 *  always lands on the first attempt and the user never sees a
 *  cover-less row. */
const COVER_FETCH_MAX_ATTEMPTS = 3;
const COVER_FETCH_RETRY_BASE_MS = 200;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Try a single cover fetch path once. Returns the resolved bytes
 *  on a 200-with-non-empty-body, or `null` for any failure mode
 *  (network, CORS, opaque-zero-body) so the caller can move on to
 *  the next path. Centralised so retries can re-issue a path
 *  without duplicating the response-shape parsing. */
async function tryCoverFetchOnce(
  url: string,
  init?: RequestInit,
): Promise<{ blob: Blob; bytes: ArrayBuffer; mimeType: string } | null> {
  try {
    const res = await fetch(url, init);
    // For `mode: 'no-cors'` the response is opaque — `.ok` and
    // `.status` always read as `false` / `0`. Still valid: the body
    // bytes can usually be read via `.arrayBuffer()` on Chromium /
    // Firefox. Treat any non-empty body as success.
    if (init?.mode === 'no-cors') {
      const bytes = await res.arrayBuffer();
      if (bytes.byteLength === 0) return null;
      const mimeType = 'image/jpeg';
      return { blob: new Blob([bytes], { type: mimeType }), bytes, mimeType };
    }
    if (!res.ok) return null;
    const bytes = await res.arrayBuffer();
    if (bytes.byteLength === 0) return null;
    const mimeType = res.headers.get('content-type') ?? 'image/jpeg';
    return { blob: new Blob([bytes], { type: mimeType }), bytes, mimeType };
  } catch {
    return null;
  }
}

/** Retry wrapper around `tryCoverFetchOnce`. Drops the
 *  `cache: 'force-cache'` hint on retries so a poisoned negative
 *  HTTP cache entry from a prior failed attempt doesn't keep
 *  serving null on every retry. */
async function tryCoverFetchWithRetries(
  url: string,
  init: RequestInit,
): Promise<{ blob: Blob; bytes: ArrayBuffer; mimeType: string } | null> {
  for (let attempt = 0; attempt < COVER_FETCH_MAX_ATTEMPTS; attempt++) {
    const opts: RequestInit = { ...init };
    if (attempt > 0) {
      delete (opts as { cache?: RequestCache }).cache;
    }
    const result = await tryCoverFetchOnce(url, opts);
    if (result) return result;
    if (attempt + 1 < COVER_FETCH_MAX_ATTEMPTS) {
      await sleep(COVER_FETCH_RETRY_BASE_MS * (attempt + 1));
    }
  }
  return null;
}

/** Rewrite a cover URL so the worker fetches it server-side and re-
 *  serves it with proper CORS headers. URLs that already point at
 *  our worker (R2-uploaded covers, our own proxy) are returned
 *  unchanged. URLs on hosts outside the allowlist are also returned
 *  unchanged so user-uploaded R2 covers / future CDN hosts continue
 *  working without a worker round-trip. */
function maybeProxyCoverUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  if (!COVER_PROXY_HOSTS.test(parsed.hostname)) return url;
  return `${API_BASE}/covers/proxy?url=${encodeURIComponent(url)}`;
}

/**
 *  The returned shape carries BOTH a `Blob` and the same bytes as a
 *  raw `ArrayBuffer`. iOS Safari (15-17, including the standalone PWA
 *  WKWebView) occasionally evicts a Blob's backing bytes while
 *  keeping the Blob shell alive — `URL.createObjectURL` on the
 *  resurrected Blob then yields a URL that `<img>` can no longer
 *  decode and the user reverts to the placeholder glyph offline. By
 *  also handing the caller the structured-cloneable `ArrayBuffer`
 *  we let `db.putAlbum` / `db.putTrack` persist a path that doesn't
 *  rely on the Blob backing store at all; `useOfflineCoverUrl`
 *  reconstructs an in-memory `Blob` from those bytes at render time
 *  and the cover survives the WebKit eviction cycle.
 */
export async function fetchCoverBlob(
  url: string | undefined | null,
): Promise<{ blob: Blob; bytes: ArrayBuffer; mimeType: string } | null> {
  if (!url) return null;
  const fetchUrl = maybeProxyCoverUrl(url);
  // 1) CORS path through the worker proxy. The worker's
  //    `corsMiddleware` attaches `ACAO: *` to every response, so a
  //    `fetch(...)` from the page origin reads body + headers
  //    cleanly. `cache: 'force-cache'` reuses any HTTP cache entry
  //    populated by an earlier `<img>` render of the same URL; a
  //    poisoned negative entry is dropped on retries inside
  //    `tryCoverFetchWithRetries`.
  const proxied = await tryCoverFetchWithRetries(fetchUrl, {
    cache: 'force-cache',
  });
  if (proxied) return proxied;
  // 2) Direct CORS path against the original URL. R2-uploaded covers
  //    on our own bucket, custom-CDN covers, and a few CloudFront
  //    edges with permissive ACAO succeed here.
  if (fetchUrl !== url) {
    const direct = await tryCoverFetchWithRetries(url, {
      cache: 'force-cache',
    });
    if (direct) return direct;
  }
  // 3) No-cors last-ditch. Returns an opaque response — body bytes
  //    are technically readable via `.arrayBuffer()` on Chromium
  //    and Firefox, but the size / mime are unreliable so any
  //    zero-byte result is treated as a hard miss inside
  //    `tryCoverFetchOnce`.
  const opaque = await tryCoverFetchWithRetries(url, {
    mode: 'no-cors',
    cache: 'force-cache',
  });
  if (opaque) return opaque;
  return null;
}
