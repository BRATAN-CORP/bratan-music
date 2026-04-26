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
    tidal.getArtistAlbums(id),
    tidal.getSimilarArtists(id),
  ]);

  return c.json({
    ...artist,
    topTracks,
    albums: artistAlbums,
    similarArtists: similar,
  });
});

export { artists };
