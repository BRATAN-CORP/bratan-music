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
    // Map upstream Tidal failures to 503 instead of 502.
    //
    // Why 503 not 502:
    //   • Cloudflare substitutes its own branded HTML page for an origin
    //     502 response (the user-reported "Bad Gateway" screenshot from
    //     2026-05-28). 503 is passed through cleanly so the client gets
    //     our JSON body and can render a friendly retry UI.
    //   • Semantically 503 ("upstream temporarily unavailable, please
    //     retry") matches the actual condition better than 502 ("upstream
    //     returned an invalid response"). Tidal's API blip is transient.
    //
    // The Tidal-API client (`TidalApi.get`) already retries twice with
    // backoff before throwing, so reaching this catch means at least
    // three upstream attempts failed within ~600ms — a real outage from
    // the user's perspective.
    console.error('[search] upstream failed:', error instanceof Error ? error.message : error);
    c.header('Retry-After', '2');
    return c.json(
      { error: 'Поиск временно недоступен, попробуйте ещё раз' },
      503,
    );
  }
});

export { search };
