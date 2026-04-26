import { createMiddleware } from 'hono/factory';
import type { Env, Variables } from '../types/env';

interface RateLimitConfig {
  limit: number;
  windowSeconds: number;
}

const ROUTE_LIMITS: Record<string, RateLimitConfig> = {
  'POST:/auth': { limit: 5, windowSeconds: 60 },
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
