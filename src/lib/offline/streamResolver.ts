/**
 * Resolves a CDN-fetchable URL for a track at a target quality,
 * walking the same `HI_RES_LOSSLESS → LOSSLESS → HIGH → LOW` ladder
 * as the online player. Runs against the same endpoint as the player
 * but with its own plain `api.get(...)` so a download doesn't evict
 * a freshly-resolved play URL from the player's hot-path cache (and
 * vice versa). Track overrides are handled server-side, so this
 * resolver receives the override URL automatically.
 */

import { api, ApiError } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import type { TidalQuality } from '@/store/settings';
import type { OfflineLyrics } from './types';

/** Network shape for `/tracks/:id/lyrics`. Kept local so this
 *  file stays React-free (the public hook in `@/hooks/useLyrics`
 *  re-exports its own copy of the same interface for consumers). */
interface LyricsApiResponse {
  available: boolean;
  provider?: string | null;
  isRightToLeft?: boolean;
  lyrics?: string | null;
  subtitles?: string | null;
  error?: string;
}

const API_BASE =
  import.meta.env.VITE_API_URL ?? 'https://bratan-music-api.bratan-corp.workers.dev';

/** Same ladder as `useAudioPlayer.ts`. Defined locally so this
 *  module stays React-free and can be called from a Service Worker. */
export const QUALITY_FALLBACK_ORDER: TidalQuality[] = [
  'HI_RES_LOSSLESS',
  'LOSSLESS',
  'HIGH',
  'LOW',
];

/** Qualities to attempt, starting at the user's requested ceiling
 *  and walking down — never silently upgrades past it. */
export function fallbackChain(start: TidalQuality): TidalQuality[] {
  const idx = QUALITY_FALLBACK_ORDER.indexOf(start);
  if (idx < 0) return QUALITY_FALLBACK_ORDER.slice();
  return QUALITY_FALLBACK_ORDER.slice(idx);
}

export interface ResolvedStream {
  /** CDN-fetchable URL — worker-proxied when origin was Tidal. */
  url: string;
  /** Quality the worker actually returned (may be lower than
   *  requested). */
  quality: TidalQuality;
}

/**
 * Resolve a single track's stream URL at exactly one quality.
 * Returns null when the quality isn't available so the caller can
 * step down the ladder. Network / 5xx / auth errors are rethrown.
 */
async function resolveOnce(
  trackId: string,
  source: string | undefined,
  quality: TidalQuality,
): Promise<ResolvedStream | null> {
  // Upload tracks come from `/uploads/:id/stream` (R2-backed) and
  // have a single bitrate per upload — reported as HI_RES_LOSSLESS.
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
    // `download=1` tells the worker to READ but not WRITE the
    // per-track KV caches — a 200-track playlist save would
    // otherwise burn through the daily KV write quota and break
    // every other user. See `TidalWeb.ts :: setSkipCacheWrites`.
    const res = await api.get<{ url: string }>(
      `/tracks/${trackId}/stream?quality=${encodeURIComponent(quality)}&download=1`,
    );
    return { url: res.url, quality };
  } catch (err) {
    if (err instanceof ApiError) {
      // 404/422/502 → quality not available, caller tries next rung.
      // 402 → paywall, fatal for THIS track.
      if (err.status === 402) throw err;
      if (err.status === 404 || err.status === 422 || err.status === 502) {
        return null;
      }
    }
    throw err;
  }
}

/**
 * Walk the fallback ladder and return the first deliverable quality.
 * Throws on definitive failures (paywall, auth) so the download job
 * can be marked `failed`.
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
      // Auth/paywall short-circuits the ladder — a different
      // quality won't fix a wholesale rejection.
      if (err instanceof ApiError && (err.status === 401 || err.status === 402)) {
        throw err;
      }
    }
  }
  if (lastError) throw lastError;
  throw new Error(`No streamable quality found for track ${trackId}`);
}

/**
 * Pull the audio body for a resolved stream URL. Reports 0…1
 * progress as bytes arrive. `Content-Length` may be absent for
 * chunked / range-aware responses; the caller's progress fallback
 * synthesises an indeterminate value so the UI ring isn't frozen.
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
    // No streaming reader (older browsers / service-worker
    // interception) — single `.blob()` and report 100% at end.
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

/** Hosts whose covers we proxy through `/covers/proxy` to bypass the
 *  missing ACAO headers on the upstream CDN. */
const COVER_PROXY_HOSTS = /^(?:resources\.tidal\.com|.+\.tidal\.com)$/i;

/** Retry budget per cover URL — Tidal CDN 5xxs individual images
 *  under burst load (multi-track album save), so one blip used to
 *  store a coverless row that the backfill might also miss. */
const COVER_FETCH_MAX_ATTEMPTS = 3;
const COVER_FETCH_RETRY_BASE_MS = 200;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** One-shot cover fetch. Returns null on any failure mode (network,
 *  CORS, opaque-zero-body) so the caller moves to the next path. */
async function tryCoverFetchOnce(
  url: string,
  init?: RequestInit,
): Promise<{ blob: Blob; bytes: ArrayBuffer; mimeType: string } | null> {
  try {
    const res = await fetch(url, init);
    // `mode: 'no-cors'` responses are opaque — `.ok`/`.status` are
    // always false/0. `.arrayBuffer()` still yields the bytes on
    // Chromium/Firefox, so treat any non-empty body as success.
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

/** Retry wrapper. Drops `cache: 'force-cache'` on retries so a
 *  poisoned negative HTTP cache entry can't pin every retry to null. */
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

/** Route through `/covers/proxy` for hosts that lack ACAO. Worker
 *  URLs and out-of-allowlist hosts pass through unchanged. */
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
 * Returns BOTH a `Blob` and a raw `ArrayBuffer`. iOS Safari (15-17,
 * including the standalone PWA WKWebView) occasionally evicts a
 * Blob's backing bytes while keeping the shell alive — the bytes
 * field gives `useOfflineCoverUrl` something it can rebuild a fresh
 * in-memory Blob from, surviving the eviction.
 */
export async function fetchCoverBlob(
  url: string | undefined | null,
): Promise<{ blob: Blob; bytes: ArrayBuffer; mimeType: string } | null> {
  if (!url) return null;
  const fetchUrl = maybeProxyCoverUrl(url);
  // Worker proxy (always sends ACAO).
  const proxied = await tryCoverFetchWithRetries(fetchUrl, {
    cache: 'force-cache',
  });
  if (proxied) return proxied;
  // Direct CORS against the original URL (R2 / permissive CDNs).
  if (fetchUrl !== url) {
    const direct = await tryCoverFetchWithRetries(url, {
      cache: 'force-cache',
    });
    if (direct) return direct;
  }
  // No-cors last-ditch — opaque response, bytes still readable on
  // Chromium/Firefox; zero-byte is treated as a hard miss.
  const opaque = await tryCoverFetchWithRetries(url, {
    mode: 'no-cors',
    cache: 'force-cache',
  });
  if (opaque) return opaque;
  return null;
}

/**
 * Best-effort fetch of a track's lyrics for offline storage. Used by
 * the downloads manager so a saved track's `LyricsPanel` can render
 * even with no network (PWA installed on a plane / metro / etc.).
 *
 * Always resolves — never throws. On any failure (network, 5xx,
 * upstream provider unavailable) we return `null` and the caller
 * leaves the offline track row's `lyrics` unset; the next online
 * view of the track will hydrate via the regular React-Query path.
 *
 * Upload tracks (`upload:<uuid>` or `source === 'upload'`) don't
 * have lyrics — there is no `/tracks/upload:.../lyrics` endpoint —
 * so we short-circuit to `null` for them instead of burning a
 * round trip that would always 404.
 */
export async function fetchLyricsPayload(
  trackId: string,
  source?: string,
): Promise<OfflineLyrics | null> {
  if (trackId.startsWith('upload:') || source === 'upload') return null;
  try {
    const res = await api.get<LyricsApiResponse>(`/tracks/${trackId}/lyrics`);
    // The worker returns `{ available: false }` when Tidal hasn't
    // matched a provider — still cache that "negative" answer so
    // the offline panel can show "Текст не найден" without a
    // network call instead of a generic loading spinner that
    // never resolves.
    return {
      available: Boolean(res.available),
      provider: res.provider ?? null,
      isRightToLeft: Boolean(res.isRightToLeft),
      lyrics: res.lyrics ?? null,
      subtitles: res.subtitles ?? null,
      fetchedAt: Date.now(),
    };
  } catch (err) {
    // 4xx/5xx/network: don't persist anything. We treat lyrics as a
    // strictly best-effort enhancement of the offline track — never
    // a reason to fail the download itself.
    if (err instanceof ApiError) {
      // Auth still bubbles to the caller for visibility, but we
      // don't rethrow because the caller is already inside the
      // download try/catch and we don't want a missing-lyrics
      // 401 to mark the audio download as failed.
      return null;
    }
    return null;
  }
}
