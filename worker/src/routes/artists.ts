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

  const [topTracks, artistAlbums, similar] = await Promise.all([
    tidal.getArtistTopTracks(id),
    tidal.getArtistReleases(id),
    tidal.getSimilarArtists(id),
  ]);

  return c.json({
    ...artist,
    topTracks,
    albums: artistAlbums,
    similarArtists: similar,
  });
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
