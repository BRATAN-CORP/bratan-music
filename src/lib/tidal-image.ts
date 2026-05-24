/**
 * Build a Tidal CDN image URL from an `imageId` returned by the
 * `/v1/pages` API. Tidal stores covers, genre tiles and mood
 * artwork on the same CDN — the only thing that changes is the
 * size suffix.
 *
 * The id format is a UUID with dashes; the path uses slashes
 * instead so the CDN can shard. Mirrors the server-side `coverUrl`
 * helper in `worker/src/services/tidal/TidalService.ts` — kept
 * client-side so we don't need a round-trip just to render a
 * thumbnail.
 *
 * Common sizes: 480 (default), 320, 1080. Tidal serves any width
 * that's been pre-rendered; if you ask for an unknown size the CDN
 * returns 404, so stick to documented values.
 */
/**
 * Internal: wrap a tidal-CDN URL with our `/covers/proxy?url=...`
 * endpoint. See worker/src/services/tidal/TidalService.ts for the
 * full rationale — short version: hitting `resources.tidal.com`
 * directly from the browser produces 403s for many clients, while
 * the same URL works server-side from the API container, so we
 * route through the worker proxy.
 */
function proxied(raw: string): string {
  // Use a relative path so the browser resolves against the current
  // origin (works for both `bratan-music.eu.cc` and any future
  // hostnames without a rebuild).
  return `/api/covers/proxy?url=${encodeURIComponent(raw)}`;
}

export function tidalImageUrl(imageId: string | undefined | null, size: 320 | 480 | 640 | 1080 = 480): string | undefined {
  if (!imageId) return undefined;
  return proxied(`https://resources.tidal.com/images/${imageId.replace(/-/g, '/')}/${size}x${size}.jpg`);
}

/**
 * Same as {@link tidalImageUrl} but produces a wide (16:10-ish)
 * landscape variant that Tidal also pre-renders for genre / mood
 * cards. Useful for hero rows where we want a cinema-strip ratio
 * instead of a square thumbnail.
 */
export function tidalImageUrlWide(imageId: string | undefined | null, width: 320 | 640 | 1080 = 640): string | undefined {
  if (!imageId) return undefined;
  // 1.6:1 keeps the focal point centred for portraits/album art.
  const height = Math.round(width / 1.6);
  return proxied(`https://resources.tidal.com/images/${imageId.replace(/-/g, '/')}/${width}x${height}.jpg`);
}
