import { Hono } from 'hono';
import type { Env, Variables } from './types/env';
import { corsMiddleware } from './middleware/cors';
import { rateLimit } from './middleware/rateLimit';
import { auth } from './routes/auth';
import { user } from './routes/user';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

app.use('*', corsMiddleware);
app.use('*', rateLimit);

app.get('/health', (c) => c.json({ status: 'ok', timestamp: Date.now() }));

app.route('/auth', auth);
app.route('/user', user);

app.notFound((c) => c.json({ error: 'Маршрут не найден' }, 404));

app.onError((err, c) => {
  console.error('Unhandled error:', err.message);
  return c.json({ error: 'Внутренняя ошибка сервера' }, 500);
});

export default app;
