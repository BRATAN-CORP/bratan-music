import { Hono } from 'hono';
import type { Env, Variables } from '../types/env';
import { jwtAuth } from '../middleware/auth';
import { TidalService } from '../services/tidal/TidalService';

const artists = new Hono<{ Bindings: Env; Variables: Variables }>();

artists.use('/*', jwtAuth);

artists.get('/:id', async (c) => {
  const id = c.req.param('id');
  const tidal = new TidalService(c.env);
  const artist = await tidal.getArtist(id);

  const [topTracks, releases, similar] = await Promise.all([
    tidal.getArtistTopTracks(id),
    tidal.getArtistAlbumsAndSingles(id),
    tidal.getSimilarArtists(id),
  ]);

  return c.json({
    ...artist,
    topTracks,
    albums: releases.albums,
    singles: releases.singles,
    similarArtists: similar,
  });
});

/**
 * Paginated "all albums" feed for the artist (ALBUM + EP +
 * COMPILATION buckets, deduped). Tidal caps each filter bucket at 50
 * items per request so we ask the service for up to 200 in one shot
 * and let the frontend paginate client-side.
 */
artists.get('/:id/albums', async (c) => {
  const id = c.req.param('id');
  const limit = Math.min(200, Math.max(1, Number(c.req.query('limit')) || 200));
  const tidal = new TidalService(c.env);
  const { albums } = await tidal.getArtistAlbumsAndSingles(id, limit);
  return c.json({ items: albums, totalItems: albums.length });
});

/**
 * Paginated "all singles" feed for the artist. Same shape as the
 * /albums route above — kept on a separate URL so the frontend can
 * route the two "Показать все" links to dedicated pages.
 */
artists.get('/:id/singles', async (c) => {
  const id = c.req.param('id');
  const limit = Math.min(200, Math.max(1, Number(c.req.query('limit')) || 200));
  const tidal = new TidalService(c.env);
  const { singles } = await tidal.getArtistAlbumsAndSingles(id, limit);
  return c.json({ items: singles, totalItems: singles.length });
});

/**
 * Artist radio. Returned as a flat track list ready to drop straight
 * into the player queue. Errors are surfaced to the frontend as an
 * empty list — this endpoint is purely additive and shouldn't break
 * the artist page if upstream is degraded.
 */
artists.get('/:id/radio', async (c) => {
  const id = c.req.param('id');
  const limit = Number(c.req.query('limit')) || 50;
  const tidal = new TidalService(c.env);
  try {
    const items = await tidal.getArtistRadio(id, Math.min(100, Math.max(1, limit)));
    return c.json({ items });
  } catch (err) {
    console.error('[artist-radio]', err);
    return c.json({ items: [] satisfies unknown[] }, 200);
  }
});

export { artists };
