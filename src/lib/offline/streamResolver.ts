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
export async function fetchCoverBlob(
  url: string | undefined | null,
): Promise<{ blob: Blob; mimeType: string } | null> {
  if (!url) return null;
  // 1) CORS path. Pulls from the HTTP cache when the same URL was
  //    rendered by an earlier `<img>` so we don't pay the bandwidth
  //    twice on save.
  try {
    const res = await fetch(url, { cache: 'force-cache' });
    if (res.ok) {
      const blob = await res.blob();
      if (blob.size > 0) {
        const mimeType = res.headers.get('content-type') ?? blob.type ?? 'image/jpeg';
        return { blob, mimeType };
      }
    }
  } catch {
    // CORS rejected — fall through to no-cors below.
  }
  // 2) No-cors fallback. Required for resources.tidal.com which
  //    serves images without ACAO headers. Opaque response, but
  //    `.blob()` returns the actual binary on every browser we
  //    target (Chrome / Firefox / Safari / iOS Safari / Telegram
  //    WebView).
  try {
    const res = await fetch(url, { mode: 'no-cors', cache: 'force-cache' });
    const blob = await res.blob();
    if (blob.size === 0) return null;
    const mimeType = blob.type || 'image/jpeg';
    return { blob, mimeType };
  } catch {
    return null;
  }
}
