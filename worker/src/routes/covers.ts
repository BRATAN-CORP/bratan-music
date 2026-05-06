/**
 * CORS-friendly cover-image proxy.
 *
 * Why this exists
 * ---------------
 * Tidal's image CDN (`resources.tidal.com`) does **not** send
 * `Access-Control-Allow-Origin` headers. The browser still renders
 * those URLs through `<img>` (no CORS check needed for the display
 * pipeline), but a programmatic `fetch(url)` from the page origin
 * gets rejected outright with a CORS error before the response body
 * is even seen.
 *
 * The offline-save path (`src/lib/offline/streamResolver.ts ::
 * fetchCoverBlob`) needs the actual bytes so it can stash them in
 * IndexedDB and feed `URL.createObjectURL` to `<img>` when the
 * device is offline. Its previous shape tried CORS first and fell
 * back to `mode: 'no-cors'` on rejection. The opaque response works
 * for `<img>` rendering but `.blob()` returns an empty / unreliable
 * blob in some browser/build combinations (especially when the HTTP
 * cache is cold), so saved tracks ended up with `coverBlob:
 * undefined`. While online the UI rendered the network URL and the
 * bug stayed invisible; offline the saved tile fell through to the
 * generic Disc3 / initials placeholder. Reported by the user as
 * "обложки не показываются в плеере и в списке самих треков, только
 * на загруженных плейлистах работает".
 *
 * Fix
 * ---
 * Proxy `resources.tidal.com` (and a small allowlist of related
 * Tidal-owned image hosts) through this endpoint. The worker fetches
 * the upstream image server-side, so there's no CORS check on the
 * client-side fetch, and the global `corsMiddleware` in `index.ts`
 * already attaches `Access-Control-Allow-Origin: *` to every worker
 * response. The client-side `fetchCoverBlob` therefore gets a fully
 * readable Blob with size + mime intact.
 *
 * The endpoint is intentionally unauthenticated for the same reason
 * `/tracks/audio` is: an `<img src="...">` cannot send an
 * Authorization header, and embedding tokens in cover URLs leaks
 * fresh JWTs into Referer / browser history / CF access logs per
 * tile. The hosts allowlist below is the only abuse mitigation we
 * need — it's the same shape and rationale as the audio proxy
 * (`worker/src/routes/tracks.ts :: TIDAL_CDN_ALLOWED`).
 */
import { Hono } from 'hono';
import type { Env, Variables } from '../types/env';

const covers = new Hono<{ Bindings: Env; Variables: Variables }>();

// Hosts the proxy is willing to fetch from. Mirrors the audio
// proxy's allowlist intent: Tidal-owned CDNs only, no wildcard
// CloudFront / Akamai entries that would let an attacker point this
// endpoint at arbitrary public infrastructure.
const COVER_HOSTS_ALLOWED: RegExp[] = [
  /^resources\.tidal\.com$/i,
  /^(.+\.)?tidal\.com$/i,
];

covers.get('/proxy', async (c) => {
  const target = c.req.query('url');
  if (!target) return c.json({ error: 'missing url' }, 400);

  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    return c.json({ error: 'invalid url' }, 400);
  }
  if (parsed.protocol !== 'https:') {
    return c.json({ error: 'https only' }, 400);
  }
  const host = parsed.hostname.toLowerCase();
  if (!COVER_HOSTS_ALLOWED.some((re) => re.test(host))) {
    return c.json({ error: `host not allowed: ${host}` }, 400);
  }

  // Forward an `If-None-Match` so the worker → upstream → 304 short
  // circuit stays intact when the browser already has the cover in
  // its HTTP cache.
  const upstreamHeaders = new Headers();
  const ifNoneMatch = c.req.header('If-None-Match');
  if (ifNoneMatch) upstreamHeaders.set('If-None-Match', ifNoneMatch);

  const upstream = await fetch(target, { headers: upstreamHeaders });

  // Long-cache the proxied image at the edge. Cover URLs include the
  // image-id in the path (`/{uuid}/640x640.jpg`) and the upstream
  // never updates a given path — the only way to "change" a cover is
  // to mint a new image-id. So a 30-day cache is safe and slashes
  // origin traffic for popular tiles.
  const out = new Headers();
  for (const k of [
    'content-type',
    'content-length',
    'etag',
    'last-modified',
  ]) {
    const v = upstream.headers.get(k);
    if (v) out.set(k, v);
  }
  out.set('cache-control', 'public, max-age=2592000, immutable');
  // Mirror the audio proxy's CORS exposure so the client can read
  // content-length for progress reporting if it ever wants to.
  out.set('access-control-expose-headers', 'Content-Length, Content-Type, ETag');

  return new Response(upstream.body, { status: upstream.status, headers: out });
});

export { covers };
