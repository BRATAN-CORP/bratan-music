import { Hono } from 'hono';
import type { Env, Variables } from './types/env';
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

// Re-exported so wrangler can register the Durable Object class. The
// binding is declared in wrangler.toml under [[durable_objects.bindings]]
// and instances are addressed by `env.CHAT_ROOM.idFromName(roomId)`.
export { ChatRoomDO } from './do/ChatRoomDO';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

app.use('*', corsMiddleware);
app.use('*', rateLimit);

app.get('/health', (c) => c.json({ status: 'ok', timestamp: Date.now() }));

app.get('/health/tidal', async (c) => {
  try {
    const { TidalAuth } = await import('./services/tidal/TidalAuth');
    const auth = new TidalAuth(c.env);
    const token = await auth.getAccessToken();
    // Don't echo any portion of the token — the JWT header is the same for
    // every token but the payload starts in the next chars and gives
    // attackers a foothold for offline brute-force.
    return c.json({
      status: 'ok',
      hasToken: Boolean(token),
      countryCode: await auth.getCountryCode(),
    });
  } catch (err) {
    // Don't surface upstream error.message to anonymous callers — log it,
    // return a generic status so attackers can't fingerprint the Tidal
    // session state from the response body.
    console.error('[health/tidal] error:', err instanceof Error ? err.message : err);
    return c.json({ status: 'error' }, 503);
  }
});

app.route('/auth', auth);
app.route('/user', user);
app.route('/search', search);
app.route('/tracks', tracks);
app.route('/covers', covers);
app.route('/albums', albums);
app.route('/artists', artists);
app.route('/playlists', playlists);
app.route('/library', library);
app.route('/tracks', overrides);
app.route('/uploads', uploads);
app.route('/webhook', webhook);
app.route('/admin', admin);
app.route('/explore', explore);
app.route('/recommendations', recommendations);
app.route('/daily-playlists', dailyPlaylists);
app.route('/history', history);
app.route('/rooms', rooms);
app.route('/ai/playlists', aiPlaylists);

app.notFound((c) => c.json({ error: 'Маршрут не найден' }, 404));

app.onError((err, c) => {
  // Log the full error+stack server-side so wrangler tail still sees it,
  // but never echo `error.message` to the client. Internal SQLite/Tidal
  // exceptions routinely contain query fragments, upstream URLs and
  // schema details that map the worker's internals for an attacker.
  const message = err instanceof Error ? err.message : String(err);
  console.error('Unhandled error:', message, err instanceof Error ? err.stack : '');

  // Classify Tidal upstream failures (and the pool "no active session"
  // state) as 503 instead of 500. Reasons:
  //   1. They are transient by definition — the right user action is a
  //      retry, not a "report a bug" flow.
  //   2. Cloudflare swaps the response body for its branded HTML page
  //      on origin 502 specifically, but lets 503 through. By picking
  //      503 we keep the JSON body intact for client-side toast UI.
  //   3. Routes that don't have their own try/catch (albums/:id,
  //      artists/:id, tracks/:id, …) now get the same friendly
  //      treatment as the search route without per-handler boilerplate.
  // The match is intentionally narrow: the explicit string we throw in
  // `TidalApi.get` and the pool-no-session message from `TidalAuth`.
  // SQLite/runtime errors stay as 500.
  const isUpstreamTidal =
    message.startsWith('Tidal API ') ||
    message.includes('Нет активной сессии Tidal') ||
    message.includes('TIDAL_REFRESH_TOKEN');
  if (isUpstreamTidal) {
    c.header('Retry-After', '2');
    return c.json(
      { error: 'Каталог временно недоступен, попробуйте ещё раз' },
      503,
    );
  }

  return c.json({ error: 'Внутренняя ошибка сервера' }, 500);
});

export default {
  fetch: app.fetch,
  /**
   * Cloudflare cron-trigger entrypoint. Runs the recommendation jobs:
   * recompute taste profiles for active users, regenerate daily-
   * playlists, GC stale entries. Schedule is wired in wrangler.toml.
   */
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runScheduledJobs(env));
  },
};
