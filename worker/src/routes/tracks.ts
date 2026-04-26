import { Hono } from 'hono';
import type { Env, Variables } from '../types/env';
import { jwtAuth } from '../middleware/auth';
import { TidalService } from '../services/tidal/TidalService';

const tracks = new Hono<{ Bindings: Env; Variables: Variables }>();

const TIDAL_CDN_ALLOWED: RegExp[] = [
  /^(.+\.)?audio\.tidal\.com$/i,
  /^(.+\.)?tidal\.com$/i,
  /^(.+\.)?akamaized\.net$/i,
  /^(.+\.)?cloudfront\.net$/i,
  /^(.+\.)?fa-v\d+\.tidal\.com$/i,
  /^sp-[a-z0-9-]+\.audio\.tidal\.com$/i,
  /^resources\.tidal\.com$/i,
];

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
  out.set('access-control-allow-origin', '*');
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

  if (!isAdmin) {
    const now = Math.floor(Date.now() / 1000);
    const sub = await c.env.DB.prepare(
      'SELECT id FROM subscriptions WHERE user_id = ? AND status = ? AND expires_at > ? LIMIT 1'
    ).bind(userId, 'active', now).first();

    if (!sub) {
      const today = new Date().toISOString().split('T')[0];
      const listen = await c.env.DB.prepare(
        'SELECT count FROM daily_listens WHERE user_id = ? AND date = ?'
      ).bind(userId, today).first<{ count: number }>();

      const used = listen?.count ?? 0;
      if (used >= 3) {
        return c.json({ error: 'Лимит 3 трека в сутки исчерпан. Оформите подписку.' }, 403);
      }

      if (listen) {
        await c.env.DB.prepare(
          'UPDATE daily_listens SET count = count + 1 WHERE user_id = ? AND date = ?'
        ).bind(userId, today).run();
      } else {
        await c.env.DB.prepare(
          'INSERT INTO daily_listens (user_id, date, count) VALUES (?, ?, 1)'
        ).bind(userId, today).run();
      }
    }
  }

  const override = await c.env.DB.prepare(
    'SELECT r2_key, mime_type FROM track_overrides WHERE user_id = ? AND track_id = ? LIMIT 1'
  ).bind(userId, id).first<{ r2_key: string; mime_type: string }>();

  const origin = new URL(c.req.url).origin;

  if (override) {
    // The audio element can't send Authorization headers, so we hand it
    // the override-stream endpoint with the user's access token in the
    // query string. The middleware accepts ?token= as a fallback.
    const auth = c.req.header('Authorization');
    const token = auth?.startsWith('Bearer ') ? auth.slice(7) : '';
    const url = `${origin}/tracks/${id}/override/stream?token=${encodeURIComponent(token)}`;
    return c.json({ url, mimeType: override.mime_type, source: 'override' });
  }

  const tidal = new TidalService(c.env);
  const direct = await tidal.getStreamUrl(id);
  const proxied = `${origin}/tracks/audio?url=${encodeURIComponent(direct)}`;
  return c.json({ url: proxied, direct, source: 'tidal' });
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
