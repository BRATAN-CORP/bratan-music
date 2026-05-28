import { Hono } from 'hono';
import type { Env, Variables } from '../types/env';
import type { Track } from '../types/music';
import { jwtAuth } from '../middleware/auth';
import { TidalService } from '../services/tidal/TidalService';
import { StreamUrlMemoCache } from '../services/streamCache';

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
  // Per-isolate in-memory memo replaces the previous KV slot for the
  // 300s stream-URL cache. KV's free tier caps writes at 1000/day
  // namespace-wide, and the previous shape spent ~1 write per song
  // play — enough to brick stream resolution after a couple dozen
  // active users. The memo lookup is synchronous, so we don't need
  // to put it in the parallel-await fan-out below.
  const cached = StreamUrlMemoCache.get(cacheKey);

  const [sub, override] = await Promise.all([
    subPromise,
    overridePromise,
  ]);

  if (!isAdmin && !sub) {
    const today = new Date().toISOString().split('T')[0];
    // Per-track dedup: the free quota is "3 unique tracks per day".
    // The previous shape incremented `daily_listens.count` on every
    // hit to this endpoint, which had two problems:
    //   1) the frontend's quality-fallback ladder retries the same
    //      track at lower qualities on load failure (HI_RES_LOSSLESS
    //      → LOSSLESS → HIGH → LOW) and every retry hit this
    //      endpoint independently, so one user-perceived play could
    //      consume 2-4 quota slots — reports of "лимит 3, а отдают
    //      2 трека" all trace to this
    //   2) replaying a track the user already heard today (refresh
    //      the page, play it again) also charged a slot
    // Deduping by (user, date, track_id) fixes both: a given track
    // costs exactly one slot per day, no matter how many times it's
    // resolved or how many qualities the fallback ladder tries.
    //
    // The INSERT + COUNT pair runs as a D1 batch so it's atomic
    // — without that, two concurrent first-time plays on different
    // tracks could both observe count=3 and slip past the gate.
    // `RETURNING 1` reports whether the row was newly inserted (a
    // first play of this track today) or whether the ON CONFLICT
    // DO NOTHING fired (a replay we want to let through unconditionally).
    const insertStmt = c.env.DB.prepare(
      `INSERT INTO daily_listen_tracks (user_id, date, track_id) VALUES (?, ?, ?)
       ON CONFLICT DO NOTHING
       RETURNING 1 AS inserted`
    ).bind(userId, today, id);
    const countStmt = c.env.DB.prepare(
      `SELECT COUNT(*) AS cnt FROM daily_listen_tracks WHERE user_id = ? AND date = ?`
    ).bind(userId, today);
    const [insertResult, countResult] = await c.env.DB.batch<{ cnt?: number; inserted?: number }>([
      insertStmt,
      countStmt,
    ]);
    const wasNew = (insertResult.results?.length ?? 0) > 0;
    const cnt = countResult.results?.[0]?.cnt ?? 0;
    if (wasNew && cnt > 3) {
      // The just-inserted row pushed the user over the quota — roll
      // it back so this trackId doesn't permanently squat a slot they
      // were never allowed to consume. The `wasNew` guard makes sure
      // we never accidentally delete one of the first 3 tracks the
      // user actually paid for: a replay (ON CONFLICT DO NOTHING)
      // never reaches this branch.
      await c.env.DB.prepare(
        `DELETE FROM daily_listen_tracks WHERE user_id = ? AND date = ? AND track_id = ?`
      ).bind(userId, today, id).run();
      // Status MUST be 402 Payment Required: the client (`useAudioPlayer`)
      // branches on `ApiError.status === 402` to surface the global
      // subscription paywall dialog.
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
  //
  // `?download=1` is set by the offline-download client path
  // (`src/lib/offline/streamResolver.ts`). It switches the underlying
  // TidalWeb resolver to read-only against the per-track cache so a
  // bulk save (album / playlist) doesn't fan a write storm into the
  // KV namespace. With Cloudflare's free 1000-writes/day cap a single
  // 200-track playlist save would otherwise burn 400 of those slots
  // and brick stream resolution for every other user for the rest of
  // the day. See `TidalWeb.setSkipCacheWrites` for the full
  // rationale.
  const isDownload = c.req.query('download') === '1';
  const resolved = await tidal.resolveStream(id, quality, isDownload);
  const proxied = `${origin}/tracks/audio?url=${encodeURIComponent(resolved.url)}`;

  // Memoise the resolved URL in-process for the next play of this
  // track on the same isolate. Replaces the previous KV write —
  // see `streamCache.ts` for the full rationale (KV free-tier
  // 1000-writes/day cap, dominated by this slot).
  const STREAM_URL_TTL_S = 300;
  StreamUrlMemoCache.set(cacheKey, {
    url: resolved.url,
    quality: resolved.quality,
    expiresAt: Date.now() + (STREAM_URL_TTL_S - 30) * 1000,
  });

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

/**
 * Track radio — recommendations anchored to a specific track. Tidal's
 * `/v1/tracks/:id/radio` is the canonical seed mix, but it 404s with
 * `subStatus 2001 "Track radio cannot be generated"` for niche or
 * freshly-ingested tracks (small Russian rap, new releases, etc.) —
 * AND it can come back 200 but empty for artists Tidal has no mix for
 * (e.g. ROCKET / 39469657). Returning an empty list there is bad UX:
 * the "Similar" section on /track/:id silently disappears for a
 * meaningful slice of the catalogue.
 *
 * Fallback chain so the user always gets *something* musically
 * relevant on the track page:
 *   1. Tidal track radio (the real thing).
 *   2. Artist radio for the seed track's primary artist.
 *   3. Artist's top tracks (almost always populated for any
 *      Tidal-known artist, even when both radio endpoints are gated).
 *   4. Sibling tracks from the same album, only if we still have
 *      < 5 items — cheap final padding so the section never looks
 *      embarrassingly thin.
 *
 * Dedupes across all sources and excludes the seed track itself.
 * Each layer is wrapped individually so one upstream failure
 * doesn't take down the rest of the chain.
 */
tracks.get('/:id/radio', async (c) => {
  const id = c.req.param('id');
  const tidal = new TidalService(c.env);
  const TARGET = 25;

  const collected: Track[] = [];
  const seen = new Set<string>([id]);
  const pushUnique = (items: Track[]): void => {
    for (const t of items) {
      if (collected.length >= TARGET) return;
      if (!seen.has(t.id)) {
        seen.add(t.id);
        collected.push(t);
      }
    }
  };

  // 1. Tidal track radio. Short-circuit if it returns a full mix.
  try {
    pushUnique(await tidal.getTrackRadio(id));
    if (collected.length >= TARGET) return c.json({ items: collected });
  } catch (err) {
    console.error('[track-radio] tidal seed failed for', id, err);
  }

  // Need the seed track's artist/album for the fallback layers.
  // Cheap if it's cached, single Tidal hit otherwise.
  let artistId: string | undefined;
  let albumId: string | undefined;
  try {
    const seedTrack = await tidal.getTrack(id);
    artistId = seedTrack.artistId;
    albumId = seedTrack.albumId;
  } catch (err) {
    console.error('[track-radio] seed metadata failed for', id, err);
  }

  // 2. Artist radio — broader anchor.
  if (artistId && collected.length < TARGET) {
    try {
      pushUnique(await tidal.getArtistRadio(artistId, TARGET));
    } catch (err) {
      console.error('[track-radio] artist radio failed for', artistId, err);
    }
  }

  // 3. Artist top tracks — last-ditch but reliable.
  if (artistId && collected.length < TARGET) {
    try {
      pushUnique(await tidal.getArtistTopTracks(artistId));
    } catch (err) {
      console.error('[track-radio] top tracks failed for', artistId, err);
    }
  }

  // 4. Album siblings — only if the section would otherwise look bare.
  if (albumId && collected.length < 5) {
    try {
      const album = await tidal.getAlbum(albumId);
      pushUnique(album.tracks);
    } catch (err) {
      console.error('[track-radio] album fallback failed for', albumId, err);
    }
  }

  return c.json({ items: collected });
});

export { tracks };
