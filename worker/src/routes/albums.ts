import { Hono } from 'hono';
import type { Env, Variables } from '../types/env';
import { jwtAuth } from '../middleware/auth';
import { TidalService } from '../services/tidal/TidalService';

const albums = new Hono<{ Bindings: Env; Variables: Variables }>();

albums.use('/*', jwtAuth);

albums.get('/:id', async (c) => {
  const id = c.req.param('id');
  const tidal = new TidalService(c.env);
  const album = await tidal.getAlbum(id);
  return c.json(album);
});

export { albums };
