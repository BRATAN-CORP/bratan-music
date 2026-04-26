import { Hono } from 'hono';
import type { Env, Variables } from '../types/env';
import { jwtAuth } from '../middleware/auth';
import { TidalService } from '../services/tidal/TidalService';

const search = new Hono<{ Bindings: Env; Variables: Variables }>();

search.use('/*', jwtAuth);

search.get('/', async (c) => {
  const query = c.req.query('q');
  const filter = (c.req.query('filter') ?? 'all') as 'all' | 'tracks' | 'albums' | 'artists';

  if (!query || query.trim().length === 0) {
    return c.json({ error: 'Параметр q обязателен' }, 400);
  }

  if (!['all', 'tracks', 'albums', 'artists'].includes(filter)) {
    return c.json({ error: 'Допустимые значения filter: all, tracks, albums, artists' }, 400);
  }

  try {
    const tidal = new TidalService(c.env);
    const results = await tidal.search(query.trim(), filter);
    return c.json(results);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Ошибка Tidal API';
    return c.json({ error: message }, 502);
  }
});

export { search };
