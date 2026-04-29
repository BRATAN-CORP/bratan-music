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

  // Pagination. Default limit stays at 25 for the combined "all" view
  // (where each bucket is previewed) so we don't explode the initial
  // payload, but the single-type views ask for 50 by default and
  // accept values up to 100 via ?limit=.
  const limitRaw = c.req.query('limit');
  const offsetRaw = c.req.query('offset');
  const defaultLimit = filter === 'all' ? 25 : 50;
  const limit = limitRaw ? Math.min(100, Math.max(1, Number(limitRaw) | 0)) : defaultLimit;
  const offset = offsetRaw ? Math.max(0, Number(offsetRaw) | 0) : 0;

  try {
    const tidal = new TidalService(c.env);
    const results = await tidal.search(query.trim(), filter, { limit, offset });
    return c.json(results);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Ошибка Tidal API';
    return c.json({ error: message }, 502);
  }
});

export { search };
