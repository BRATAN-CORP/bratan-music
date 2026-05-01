import { Hono } from 'hono';
import type { Env, Variables } from '../types/env';
import { jwtAuth } from '../middleware/auth';
import { TidalService } from '../services/tidal/TidalService';

const tracks = new Hono<{ Bindings: Env; Variables: Variables }>();

// Allow-list of hosts the audio proxy is willing to fetch from. The
// list is intentionally narrow: every entry corresponds to a known
// Tidal-owned CDN. The previous version accepted `*.cloudfront.net`
// and `*.akamaized.net` which together cover huge swaths of unrelated
// public infrastructure — that turned the worker into a free
// open-relay for whatever an attacker pointed it at (free bandwidth,
// IP laundering, geo-bypass). If Tidal ever surfaces a stream URL on a
// host outside this list we'll see a 400 in the logs and can audit
// the new host before adding it.
//
// The proxy itself is intentionally left unauthenticated: the <audio>
// element fetches it directly and can't carry an Authorization header,
// and embedding access tokens in every stream URL puts a fresh JWT in
// CF access logs / Referer / browser history per track — strictly
// worse for confidentiality. With the narrow allowlist the only
// remaining "abuse" is using the worker as a passthrough to Tidal's
// own CDN, which is an order of magnitude smaller risk than the open
// relay we used to be.
const TIDAL_CDN_ALLOWED: RegExp[] = [
  /^(.+\.)?audio\.tidal\.com$/i,
  /^(.+\.)?fa-v\d+\.tidal\.com$/i,
  /^sp-[a-z0-9-]+\.audio\.tidal\.com$/i,
  /^resources\.tidal\.com$/i,
];

// `/audio` is reachable without auth (see comment above). Every other
// route below this line goes through jwtAuth.
tracks.get('/audio', async (c) => {
  const target = c.req.query('url');
  if (!target) return c.json({ error: 'missing url' }, 400);
  let parsed: URL;
  try { parsed = new URL(target); } catch { return c.json({ error: 'invalid url' }, 400); }
  if (parsed.protocol !== 'https:') return c.json({ error: 'https only' }, 400);
  const host = parsed.hostname.toLowerCase();
  if (!TIDAL_CDN_ALLOWED.some((re) => re.test(host))) {
    return c.json({ error: `host not allowed: ${host}` }, 400);
  }

  const upstreamHeaders = new Headers();
  const range = c.req.header('Range');
  if (range) upstreamHeaders.set('Range', range);

  const upstream = await fetch(target, { headers: upstreamHeaders });
  const out = new Headers();
  for (const k of [
    'content-type',
    'content-length',
    'content-range',
    'accept-ranges',
    'cache-control',
    'etag',
    'last-modified',
  ]) {
    const v = upstream.headers.get(k);
    if (v) out.set(k, v);
  }
  // CORS is already set by the global corsMiddleware; we don't need
  // wildcard ACAO here. Exposing the streaming-relevant headers is
  // still useful for the <audio> element.
  out.set('access-control-expose-headers',
    'Content-Length, Content-Type, Content-Range, Accept-Ranges');
  return new Response(upstream.body, { status: upstream.status, headers: out });
});

tracks.use('/*', jwtAuth);

tracks.get('/:id', async (c) => {
  const id = c.req.param('id');
  const tidal = new TidalService(c.env);
  const track = await tidal.getTrack(id);
  return c.json(track);
});

tracks.get('/:id/lyrics', async (c) => {
  const id = c.req.param('id');
  try {
    const { TidalAuth } = await import('../services/tidal/TidalAuth');
    const { TidalApi } = await import('../services/tidal/TidalApi');
    const auth = new TidalAuth(c.env);
    const api = new TidalApi(auth);
    const raw = await api.getTrackLyrics(id);
    if (!raw) return c.json({ available: false });
    return c.json({
      available: Boolean(raw.lyrics || raw.subtitles),
      provider: raw.lyricsProvider ?? null,
      isRightToLeft: Boolean(raw.isRightToLeft),
      lyrics: raw.lyrics ?? null,
      subtitles: raw.subtitles ?? null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Не удалось получить текст';
    return c.json({ available: false, error: message }, 502);
  }
});

tracks.get('/:id/stream', async (c) => {
  const id = c.req.param('id');
  const userId = c.get('userId');
  const isAdmin = c.get('isAdmin');

  // Per-call quality preference. The provider hierarchy is documented on
  // TidalWeb#getStreamUrl; unknown values fall back to the service default.
  const allowedQuality = ['LOW', 'HIGH', 'LOSSLESS', 'HI_RES_LOSSLESS', 'HI_RES'];
  const requested = c.req.query('quality');
  const quality = requested && allowedQuality.includes(requested) ? requested : undefined;
  const cacheKey = `tidal-stream-url:${id}:${quality ?? 'HIGH'}`;
  const origin = new URL(c.req.url).origin;

  // Fan out the three independent reads we always need into one
  // round trip instead of three sequential ones. Subscription /
  // override / KV-cached-CDN-URL are all user-scoped reads with no
  // ordering dependency between them, and on the warm-cache path
  // (the dominant case once a user has played a track in the last
  // 5 minutes) every millisecond saved here lands directly on the
  // click-to-audible budget. With Cloudflare's typical D1+KV RTTs
  // this saves ~50–150 ms per request on top of the worker's
  // existing KV memo. The previous shape was three sequential
  // awaits (subscription → daily-listens → override → KV), which
  // turned every call into a 4-trip round-robin even when nothing
  // changed.
  const now = Math.floor(Date.now() / 1000);
  const subPromise = isAdmin
    ? Promise.resolve<{ id: number } | null>({ id: 0 })
    : c.env.DB.prepare(
        'SELECT id FROM subscriptions WHERE user_id = ? AND status = ? AND expires_at > ? LIMIT 1'
      ).bind(userId, 'active', now).first<{ id: number }>();
  const overridePromise = c.env.DB.prepare(
    'SELECT r2_key, mime_type FROM track_overrides WHERE user_id = ? AND track_id = ? LIMIT 1'
  ).bind(userId, id).first<{ r2_key: string; mime_type: string }>();
  const cachedPromise = c.env.SESSIONS.get<{ url: string; quality: string; expiresAt: number }>(
    cacheKey,
    'json',
  );

  const [sub, override, cached] = await Promise.all([
    subPromise,
    overridePromise,
    cachedPromise,
  ]);

  if (!isAdmin && !sub) {
    const today = new Date().toISOString().split('T')[0];
    // Atomic increment + read-back. The previous SELECT-then-UPDATE
    // pair was racy: ten concurrent stream calls could all observe
    // count=2 and proceed past the gate, letting the user blow well
    // past the 3/day limit. SQLite's UPSERT with RETURNING gives us
    // the post-increment value in a single statement.
    const upserted = await c.env.DB.prepare(
      `INSERT INTO daily_listens (user_id, date, count)
       VALUES (?, ?, 1)
       ON CONFLICT(user_id, date) DO UPDATE SET count = count + 1
       RETURNING count`
    ).bind(userId, today).first<{ count: number }>();

    const newCount = upserted?.count ?? 1;
    if (newCount > 3) {
      // Over the limit — still recorded the attempt (so spamming
      // requests doesn't help), and refuse to hand out a stream URL.
      // Status MUST be 402 Payment Required: the client (`useAudioPlayer`)
      // branches on `ApiError.status === 402` to surface the global
      // subscription paywall dialog. Returning 403 here used to make the
      // dialog never open and the user got a generic "не удалось
      // загрузить трек" instead of the upgrade prompt.
      return c.json({ error: 'Лимит 3 трека в сутки исчерпан. Оформите подписку.' }, 402);
    }
  }

  if (override) {
    // The audio element can't send Authorization headers, so we hand it
    // the override-stream endpoint with the user's access token in the
    // query string. The middleware accepts ?token= as a fallback.
    const auth = c.req.header('Authorization');
    const token = auth?.startsWith('Bearer ') ? auth.slice(7) : '';
    const url = `${origin}/tracks/${id}/override/stream?token=${encodeURIComponent(token)}`;
    return c.json({ url, mimeType: override.mime_type, source: 'override' });
  }

  // Hot-path: the resolved Tidal CDN URL is the single biggest cost on
  // /tracks/:id/stream — the underlying `playbackinfopostpaywall` round
  // trip costs 500-700 ms even on a warm cache. Tidal CDN URLs are
  // signed with timestamps and stay valid well over an hour, so a
  // short-lived KV memo of the FULL resolved URL turns repeat plays
  // (same track, same browser tab, same quality) from ~800 ms into
  // ~50 ms. We deliberately keep the TTL well below the URL's actual
  // expiry to hide any signing-window slop and avoid handing out a
  // stale URL after a Tidal-side rotation.
  if (cached && cached.expiresAt > Date.now() && cached.url) {
    const proxied = `${origin}/tracks/audio?url=${encodeURIComponent(cached.url)}`;
    return c.json({
      url: proxied,
      direct: cached.url,
      source: 'tidal',
      quality: cached.quality,
      requestedQuality: quality ?? 'HIGH',
      cached: true,
    });
  }

  const tidal = new TidalService(c.env);

  // Use resolveStream so we can echo back the actually-resolved quality
  // (it can be lower than `requested` when the track only has clear
  // audio for HIGH/LOW). The resolver memoises the working quality in
  // KV so repeat calls for the same track skip the upper rungs.
  const resolved = await tidal.resolveStream(id, quality);
  const proxied = `${origin}/tracks/audio?url=${encodeURIComponent(resolved.url)}`;

  // Write the resolved URL back into KV for the next play of this
  // track. `waitUntil` keeps the response on the fast path — the
  // client doesn't have to wait for the KV round trip.
  const STREAM_URL_TTL_S = 300;
  c.executionCtx.waitUntil(
    c.env.SESSIONS.put(
      cacheKey,
      JSON.stringify({
        url: resolved.url,
        quality: resolved.quality,
        expiresAt: Date.now() + (STREAM_URL_TTL_S - 30) * 1000,
      }),
      { expirationTtl: STREAM_URL_TTL_S },
    ),
  );

  return c.json({
    url: proxied,
    direct: resolved.url,
    source: 'tidal',
    quality: resolved.quality,
    requestedQuality: quality ?? 'HIGH',
  });
});

tracks.get('/:id/download', async (c) => {
  const id = c.req.param('id');
  const tidal = new TidalService(c.env);
  const url = await tidal.getDownloadUrl(id);
  return c.json({ url, source: 'tidal' });
});

// Proxies the download so the file gets a stable Content-Disposition and
// no cross-origin restrictions from the Tidal CDN reach the browser.
tracks.get('/:id/file', async (c) => {
  const id = c.req.param('id');
  const tidal = new TidalService(c.env);
  let trackTitle = '';
  let trackArtist = '';
  try {
    const meta = await tidal.getTrack(id);
    trackTitle = meta.title;
    trackArtist = meta.artist;
  } catch {
    // metadata is optional — the file is still downloadable
  }
  const url = await tidal.getDownloadUrl(id);
  const upstream = await fetch(url);
  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(() => '');
    return c.json({ error: `upstream ${upstream.status}: ${text.slice(0, 200)}` }, 502);
  }
  const ct = upstream.headers.get('content-type') ?? 'audio/flac';
  const len = upstream.headers.get('content-length');
  const ext = ct.includes('mpeg') || ct.includes('mp3') ? 'mp3'
    : ct.includes('mp4') || ct.includes('m4a') || ct.includes('aac') ? 'm4a'
    : 'flac';
  const baseName = (trackArtist && trackTitle ? `${trackArtist} — ${trackTitle}` : `track-${id}`)
    .replace(/[\\/:*?"<>|]/g, '_')
    .slice(0, 180);
  const headers: Record<string, string> = {
    'Content-Type': ct,
    'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(baseName)}.${ext}`,
    'Cache-Control': 'private, max-age=60',
  };
  if (len) headers['Content-Length'] = len;
  return new Response(upstream.body, { status: 200, headers });
});

tracks.get('/:id/radio', async (c) => {
  const id = c.req.param('id');
  const tidal = new TidalService(c.env);
  const tracks = await tidal.getTrackRadio(id);
  return c.json({ items: tracks });
});

export { tracks };
