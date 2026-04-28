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

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

app.use('*', corsMiddleware);
app.use('*', rateLimit);

app.get('/health', (c) => c.json({ status: 'ok', timestamp: Date.now() }));

app.get('/health/tidal', async (c) => {
  try {
    const { TidalAuth } = await import('./services/tidal/TidalAuth');
    const auth = new TidalAuth(c.env);
    const token = await auth.getAccessToken();
    return c.json({
      status: 'ok',
      hasToken: Boolean(token),
      tokenPrefix: token ? `${token.slice(0, 12)}...` : null,
      countryCode: await auth.getCountryCode(),
    });
  } catch (err) {
    return c.json(
      { status: 'error', message: err instanceof Error ? err.message : String(err) },
      503
    );
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

app.notFound((c) => c.json({ error: 'Маршрут не найден' }, 404));

app.onError((err, c) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error('Unhandled error:', message, err instanceof Error ? err.stack : '');
  return c.json({ error: message || 'Внутренняя ошибка сервера', detail: message }, 500);
});

export default app;
