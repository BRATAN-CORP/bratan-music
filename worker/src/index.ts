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
import { webhook } from './routes/webhook';

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

app.post('/admin/tidal/device/start', async (c) => {
  const secret = c.req.header('x-admin-secret');
  if (!secret || secret !== c.env.JWT_SECRET) {
    return c.json({ error: 'forbidden' }, 403);
  }
  try {
    const { TidalAuth } = await import('./services/tidal/TidalAuth');
    const auth = new TidalAuth(c.env);
    const data = await auth.startDeviceAuth();
    return c.json(data);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 502);
  }
});

app.post('/admin/tidal/device/poll', async (c) => {
  const secret = c.req.header('x-admin-secret');
  if (!secret || secret !== c.env.JWT_SECRET) {
    return c.json({ error: 'forbidden' }, 403);
  }
  try {
    const body = await c.req.json<{ deviceCode: string }>();
    if (!body.deviceCode) return c.json({ error: 'missing deviceCode' }, 400);
    const { TidalAuth } = await import('./services/tidal/TidalAuth');
    const auth = new TidalAuth(c.env);
    const result = await auth.pollDeviceAuth(body.deviceCode);
    return c.json(result);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 502);
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
app.route('/webhook', webhook);

app.notFound((c) => c.json({ error: 'Маршрут не найден' }, 404));

app.onError((err, c) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error('Unhandled error:', message, err instanceof Error ? err.stack : '');
  return c.json({ error: message || 'Внутренняя ошибка сервера', detail: message }, 500);
});

export default app;
