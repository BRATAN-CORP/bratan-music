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

export const rateLimit = createMiddleware<{ Bindings: Env; Variables: Variables }>(async (c, next) => {
  const ip = c.req.header('CF-Connecting-IP') ?? c.req.header('X-Forwarded-For') ?? 'unknown';
  const method = c.req.method;
  const path = new URL(c.req.url).pathname;

  if (path === '/tracks/audio') {
    await next();
    return;
  }

  const config = getConfig(method, path);
  const windowStart = Math.floor(Date.now() / 1000 / config.windowSeconds);
  const key = `rl:${ip}:${method}:${path.split('/').slice(0, 3).join('/')}:${windowStart}`;

  const current = await c.env.SESSIONS.get(key);
  const count = current ? parseInt(current, 10) : 0;

  if (count >= config.limit) {
    return c.json({ error: 'Превышен лимит запросов' }, 429);
  }

  await c.env.SESSIONS.put(key, String(count + 1), { expirationTtl: config.windowSeconds });
  await next();
});
