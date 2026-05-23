/**
 * Node.js entry point for bratan-music-api.
 *
 * Replaces `wrangler dev` / Cloudflare Workers runtime with a plain
 * Node.js HTTP server running Hono via @hono/node-server.
 *
 * All CF-specific bindings (D1, KV, R2, DO) are replaced by adapters
 * that wrap Postgres, Redis, MinIO, and a simple WS broadcast hub.
 */

import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { Pool } from 'pg';
import Redis from 'ioredis';
import { D1DatabaseAdapter } from './adapters/D1Adapter';
import { KVNamespaceAdapter } from './adapters/KVAdapter';
import { R2BucketAdapter } from './adapters/R2Adapter';
import { DurableObjectNamespaceAdapter, attachWebSocketServer } from './adapters/ChatRoomAdapter';
import type { Env, Variables } from './types/env';

/* ── Import the full Hono app tree ───────────────────── */
import { corsMiddleware } from './middleware/cors';
import { rateLimit } from './middleware/rateLimit';
import { auth } from './routes/auth';
import { user } from './routes/user';
import { search } from './routes/search';
import { tracks } from './routes/tracks';
import { covers } from './routes/covers';
import { albums } from './routes/albums';
import { artists } from './routes/artists';
import { playlists } from './routes/playlists';
import { library } from './routes/library';
import { overrides } from './routes/overrides';
import { uploads } from './routes/uploads';
import { webhook } from './routes/webhook';
import { admin } from './routes/admin';
import { explore } from './routes/explore';
import { recommendations } from './routes/recommendations';
import { dailyPlaylists } from './routes/dailyPlaylists';
import { history } from './routes/history';
import { rooms } from './routes/rooms';
import { aiPlaylists } from './routes/aiPlaylists';
import { runScheduledJobs } from './cron';

/* ── Environment ─────────────────────────────────────── */

const PORT = Number(process.env.PORT) || 3000;

/* ── Create backing services ─────────────────────────── */

const pgPool = new Pool({ connectionString: process.env.DATABASE_URL });

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

const r2 = new R2BucketAdapter({
  endPoint: process.env.MINIO_ENDPOINT || 'localhost',
  port: Number(process.env.MINIO_PORT) || 9000,
  useSSL: false,
  accessKey: process.env.MINIO_ACCESS_KEY || 'minioadmin',
  secretKey: process.env.MINIO_SECRET_KEY || 'minioadmin',
  bucket: process.env.MINIO_BUCKET || 'tracks',
});

/* ── Build the Env bindings object ───────────────────── */

const env: Env = {
  // Adapters cast to CF types — the adapter classes are interface-compatible
  DB: new D1DatabaseAdapter(pgPool) as unknown as D1Database,
  SESSIONS: new KVNamespaceAdapter(redis) as unknown as KVNamespace,
  TRACKS: r2 as unknown as R2Bucket,
  CHAT_ROOM: new DurableObjectNamespaceAdapter() as unknown as DurableObjectNamespace,

  // Plain vars from process.env
  TIDAL_CLIENT_ID: process.env.TIDAL_CLIENT_ID || '',
  TIDAL_CLIENT_SECRET: process.env.TIDAL_CLIENT_SECRET || '',
  TIDAL_SESSION_TOKEN: process.env.TIDAL_SESSION_TOKEN || '',
  TIDAL_REFRESH_TOKEN: process.env.TIDAL_REFRESH_TOKEN,
  TIDAL_CLIENT_VERSION: process.env.TIDAL_CLIENT_VERSION,
  TIDAL_COUNTRY_CODE: process.env.TIDAL_COUNTRY_CODE,
  TIDAL_LOCALE: process.env.TIDAL_LOCALE,
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || '',
  TELEGRAM_BOT_USERNAME: process.env.TELEGRAM_BOT_USERNAME || '',
  TELEGRAM_ADMIN_IDS: process.env.TELEGRAM_ADMIN_IDS || '',
  TELEGRAM_WEBHOOK_SECRET: process.env.TELEGRAM_WEBHOOK_SECRET || '',
  APP_URL: process.env.APP_URL || `https://${process.env.DOMAIN || 'localhost'}`,
  JWT_SECRET: process.env.JWT_SECRET || '',
  JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET || '',
  SESSION_ENCRYPTION_KEY: process.env.SESSION_ENCRYPTION_KEY || '',
  ENVIRONMENT: process.env.NODE_ENV || 'production',
  YANDEX_API_TOKEN: process.env.YANDEX_API_TOKEN,
  YANDEX_FOLDER_ID: process.env.YANDEX_FOLDER_ID,
  YANDEX_MODEL_URI: process.env.YANDEX_MODEL_URI,
  BREVO_API_KEY: process.env.BREVO_API_KEY,
  BREVO_SENDER_EMAIL: process.env.BREVO_SENDER_EMAIL || 'noreply.bratanmusic@gmail.com',
  BREVO_SENDER_NAME: process.env.BREVO_SENDER_NAME || 'BRATAN MUSIC',
};

/* ── Build Hono app (same structure as index.ts) ─────── */

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// Inject env into every request context so c.env.DB / c.env.SESSIONS etc work.
// Also polyfill `c.executionCtx.waitUntil` which exists in CF Workers but not
// in the Node.js runtime — several routes (webhook, recommendations, rooms)
// use it to fire-and-forget background work without blocking the response.
app.use('*', async (c, next) => {
  // Hono on Node.js doesn't automatically populate c.env — we do it manually
  Object.assign(c.env, env);

  // Polyfill executionCtx.waitUntil — just run the promise in the background.
  // In Hono v4, c.executionCtx is a getter-only property that THROWS outside
  // CF Workers. We can't read it (throws) or write it (no setter).
  // Use Object.defineProperty to replace the getter with our polyfill.
  try {
    const _ctx = c.executionCtx;
    if (typeof _ctx?.waitUntil !== 'function') throw new Error('no waitUntil');
  } catch {
    Object.defineProperty(c, 'executionCtx', {
      value: {
        waitUntil(promise: Promise<unknown>) {
          promise.catch((err) =>
            console.error('[waitUntil] background task failed:', err),
          );
        },
        passThroughOnException() { /* no-op in Node */ },
      },
      writable: true,
      configurable: true,
    });
  }

  await next();
});

// Middlewares
app.use('*', corsMiddleware);
app.use('*', rateLimit);

// Health
app.get('/health', (c) => c.json({ status: 'ok', timestamp: Date.now() }));

app.get('/health/tidal', async (c) => {
  try {
    const { TidalAuth } = await import('./services/tidal/TidalAuth');
    const tidalAuth = new TidalAuth(c.env);
    const token = await tidalAuth.getAccessToken();
    return c.json({
      status: 'ok',
      hasToken: Boolean(token),
      countryCode: await tidalAuth.getCountryCode(),
    });
  } catch (err) {
    console.error('[health/tidal] error:', err instanceof Error ? err.message : err);
    return c.json({ status: 'error' }, 503);
  }
});

// Routes — MUST match index.ts mount paths exactly
app.route('/auth', auth);
app.route('/user', user);
app.route('/search', search);
app.route('/tracks', tracks);
app.route('/covers', covers);
app.route('/albums', albums);
app.route('/artists', artists);
app.route('/playlists', playlists);
app.route('/library', library);
app.route('/tracks', overrides);      // overrides mounted under /tracks (same as index.ts)
app.route('/uploads', uploads);
app.route('/webhook', webhook);       // webhook at /webhook (telegram handler)
app.route('/admin', admin);
app.route('/explore', explore);
app.route('/recommendations', recommendations);
app.route('/daily-playlists', dailyPlaylists);
app.route('/history', history);
app.route('/rooms', rooms);
app.route('/ai/playlists', aiPlaylists);  // ai playlists at /ai/playlists

app.notFound((c) => c.json({ error: 'Маршрут не найден' }, 404));

app.onError((err, c) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error('Unhandled error:', message, err instanceof Error ? err.stack : '');
  return c.json({ error: 'Внутренняя ошибка сервера' }, 500);
});

/* ── Cron emulation via setInterval ──────────────────── */

// Run scheduled jobs at 04:30 UTC daily (same as wrangler cron)
function scheduleCron(): void {
  const now = new Date();
  const next = new Date(now);
  next.setUTCHours(4, 30, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  const delay = next.getTime() - now.getTime();

  setTimeout(async () => {
    console.log('[cron] Running scheduled jobs...');
    try {
      await runScheduledJobs(env as any);
    } catch (err) {
      console.error('[cron] Failed:', err);
    }
    // Schedule next run
    scheduleCron();
  }, delay);

  console.log(`[cron] Next run at ${next.toISOString()} (in ${Math.round(delay / 60000)}m)`);
}

/* ── Start ───────────────────────────────────────────── */

async function main(): Promise<void> {
  // Ensure MinIO bucket exists
  await r2.ensureBucket();
  console.log('[startup] MinIO bucket ready');

  // Test Postgres connection
  const pgResult = await pgPool.query('SELECT 1 as ok');
  console.log('[startup] Postgres connected:', pgResult.rows[0]);

  // Test Redis
  const pong = await redis.ping();
  console.log('[startup] Redis connected:', pong);

  // Start HTTP server
  const server = serve({ fetch: app.fetch, port: PORT }, (info) => {
    console.log(`[startup] API server running on http://0.0.0.0:${info.port}`);
  });

  // Attach WebSocket server for listening rooms
  attachWebSocketServer(server as any);
  console.log('[startup] WebSocket server attached');

  // Schedule cron
  scheduleCron();
}

main().catch((err) => {
  console.error('[startup] Fatal error:', err);
  process.exit(1);
});
