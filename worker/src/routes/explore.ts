import { Hono } from 'hono';
import type { Env, Variables } from '../types/env';
import { jwtAuth } from '../middleware/auth';
import { TidalService } from '../services/tidal/TidalService';

const explore = new Hono<{ Bindings: Env; Variables: Variables }>();

explore.use('/*', jwtAuth);

/**
 * Top-level Explore page. Returns the same modules Tidal renders on
 * https://tidal.com/view/pages/explore — Genres / Moods / Decades
 * link clouds, plus a few featured editorial rows that vary by region.
 */
explore.get('/', async (c) => {
  try {
    const tidal = new TidalService(c.env);
    const page = await tidal.getExplorePage('explore');
    return c.json(page);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Ошибка Tidal API';
    return c.json({ error: message }, 502);
  }
});

/**
 * Specific page by slug — `genre_world`, `m_1980s`, `mood_focus`,
 * `music_school`, `explore_new_music`, etc. Slug is whatever the
 * `apiPath` of a `pageLinks` item resolved to (we strip the `pages/`
 * prefix on the server side).
 */
explore.get('/page/:slug', async (c) => {
  const slug = c.req.param('slug');
  if (!slug || !/^[a-zA-Z0-9_-]+$/.test(slug)) {
    return c.json({ error: 'Неверный slug страницы' }, 400);
  }
  try {
    const tidal = new TidalService(c.env);
    const page = await tidal.getExplorePage(slug);
    return c.json(page);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Ошибка Tidal API';
    return c.json({ error: message }, 502);
  }
});

/**
 * Resolve the tracklist of a curated Tidal playlist by UUID. Used
 * when the user taps an editorial playlist from the explore grid.
 */
explore.get('/playlists/:uuid/tracks', async (c) => {
  const uuid = c.req.param('uuid');
  if (!uuid || !/^[a-fA-F0-9-]{36}$/.test(uuid)) {
    return c.json({ error: 'Неверный UUID плейлиста' }, 400);
  }
  try {
    const tidal = new TidalService(c.env);
    const tracks = await tidal.getPlaylistTracks(uuid);
    return c.json({ items: tracks });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Ошибка Tidal API';
    return c.json({ error: message }, 502);
  }
});

export { explore };
