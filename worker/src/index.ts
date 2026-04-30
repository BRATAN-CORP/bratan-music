import { Hono } from 'hono';
import type { Env, Variables } from './types/env';
import { corsMiddleware } from './middleware/cors';
import { rateLimit } from './middleware/rateLimit';
import { auth } from './routes/auth';
import { user } from './routes/user';
import { search } from './routes/search';
import { tracks } from './routes/tracks';
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
import { runScheduledJobs } from './cron';

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

app.notFound((c) => c.json({ error: 'Маршрут не найден' }, 404));

app.onError((err, c) => {
  // Log the full error+stack server-side so wrangler tail still sees it,
  // but never echo `error.message` to the client. Internal SQLite/Tidal
  // exceptions routinely contain query fragments, upstream URLs and
  // schema details that map the worker's internals for an attacker.
  const message = err instanceof Error ? err.message : String(err);
  console.error('Unhandled error:', message, err instanceof Error ? err.stack : '');
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
