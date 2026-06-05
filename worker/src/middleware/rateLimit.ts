import { createMiddleware } from 'hono/factory';
import type { Env, Variables } from '../types/env';

interface RateLimitConfig {
  limit: number;
  windowSeconds: number;
}

const ROUTE_LIMITS: Record<string, RateLimitConfig> = {
  // Per-IP cap on email-OTP request + verify combined. A single user
  // walking through the flow normally hits 1 /request + 1–2 /verify
  // (typo, then correct), so 10/60s gives generous headroom. The
  // service-side per-email cooldown (60s) and per-OTP attempts cap
  // (5) are the actual brute-force gates; this bucket exists so a
  // single attacker can't fan out across many addresses from one IP.
  // Must be declared BEFORE 'POST:/auth' so the more-specific path
  // matches first via startsWith().
  'POST:/auth/email': { limit: 10, windowSeconds: 60 },
  'POST:/auth': { limit: 5, windowSeconds: 60 },
  // /auth/nonce/:nonce is the deeplink-login polling endpoint. The site
  // hits it every ~1s after /start, so we need way more headroom than the
  // POST:/auth login bucket, but we still want to make brute-forcing a
  // 122-bit UUID nonce obviously infeasible per IP. 60/min handles a
  // 5-minute polling session with margin and caps a brute-forcer at
  // ~86k tries/day — irrelevant against UUID entropy.
  'GET:/auth/nonce': { limit: 60, windowSeconds: 60 },
  'GET:/search': { limit: 30, windowSeconds: 60 },
  'GET:/tracks/stream': { limit: 60, windowSeconds: 3600 },
  'GET:/tracks/download': { limit: 10, windowSeconds: 3600 },
  'PUT:/tracks/override': { limit: 5, windowSeconds: 3600 },
  'POST:/webhook': { limit: 100, windowSeconds: 60 },
};

const DEFAULT_LIMIT: RateLimitConfig = { limit: 100, windowSeconds: 60 };

function getConfig(method: string, path: string): RateLimitConfig {
  for (const [pattern, config] of Object.entries(ROUTE_LIMITS)) {
    const [m, p] = pattern.split(':');
    if (method === m && path.startsWith(p)) return config;
  }
  return DEFAULT_LIMIT;
}

// In-memory rate limit. The previous KV-based version blew through Cloudflare's
// daily KV write limit (1000/day on free tier) within hours, which made the
// whole worker return 500 "KV put() limit exceeded for the day". This map is
// per-isolate (Cloudflare can run multiple isolates concurrently) so the limit
// is approximate, but it's much better than no protection and costs nothing.
const buckets = new Map<string, { count: number; resetAt: number }>();
const MAX_BUCKETS = 5000;

function sweep(now: number) {
  if (buckets.size < MAX_BUCKETS) return;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
  // Hard cap: drop oldest if still too large after expiry sweep.
  if (buckets.size >= MAX_BUCKETS) {
    const drop = buckets.size - Math.floor(MAX_BUCKETS * 0.8);
    let i = 0;
    for (const key of buckets.keys()) {
      if (i++ >= drop) break;
      buckets.delete(key);
    }
  }
}

export const rateLimit = createMiddleware<{ Bindings: Env; Variables: Variables }>(async (c, next) => {
  const ip = c.req.header('CF-Connecting-IP') ?? c.req.header('X-Forwarded-For') ?? 'unknown';
  const method = c.req.method;
  const path = new URL(c.req.url).pathname;

  if (path === '/tracks/audio') {
    await next();
    return;
  }

  // Cover-art proxy (`/covers/proxy?url=...`) is an unauthenticated image
  // passthrough to Tidal's resources CDN. A single album or playlist view
  // fans out one request per track-cover the moment it renders — opening
  // a 50-track "playlist of the day" plus the now-playing art easily
  // crosses the default 100/min IP bucket in one navigation, which then
  // 429s a chunk of the covers and leaves the grid full of broken images.
  // The endpoint exposes no user data and writes nothing, so (like
  // `/tracks/audio`) it doesn't belong behind the IP rate limiter.
  if (path === '/covers/proxy') {
    await next();
    return;
  }

  // Room media proxies (`/rooms/:id/stream/upload/...`,
  // `/rooms/:id/stream/override/...`, `/rooms/:id/stream/tidal/...`)
  // exist purely to fan an audio source out to all participants. The
  // browser's <audio> element issues several Range requests per
  // track (initial probe + sequential body + every user-driven seek)
  // and three to four listeners in the same room would otherwise
  // burn through the default 100/min bucket inside a single song.
  // These endpoints are already authenticated AND gated by room
  // membership + active-track checks, so they don't need the IP
  // bucket on top.
  if (/^\/rooms\/[^/]+\/stream(\/|$)/.test(path)) {
    await next();
    return;
  }

  const config = getConfig(method, path);
  const now = Date.now();
  const key = `${ip}:${method}:${path.split('/').slice(0, 3).join('/')}`;

  let bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + config.windowSeconds * 1000 };
    buckets.set(key, bucket);
    sweep(now);
  }

  if (bucket.count >= config.limit) {
    return c.json({ error: 'Превышен лимит запросов' }, 429);
  }

  bucket.count += 1;
  await next();
});
