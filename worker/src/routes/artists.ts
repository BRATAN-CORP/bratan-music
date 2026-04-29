import { Hono } from 'hono';
import type { Env, Variables } from '../types/env';
import { jwtAuth } from '../middleware/auth';
import { TidalService } from '../services/tidal/TidalService';

const artists = new Hono<{ Bindings: Env; Variables: Variables }>();

artists.use('/*', jwtAuth);

artists.get('/:id', async (c) => {
  const id = c.req.param('id');
  const tidal = new TidalService(c.env);

  // Each Tidal sub-call is independent, but Tidal occasionally
  // returns 451 / 5xx on individual artist records (regional blocks,
  // intermittent partial outages) while still serving the artist's
  // albums and singles. The previous handler awaited `getArtist`
  // first and then `Promise.all`'d everything else — a single
  // failure took down the whole page, so users got "artist not
  // found" even though the catalogue was reachable.
  // Run everything together with `Promise.allSettled`, fall back
  // gracefully per-bucket, and synthesise an artist record from
  // the albums credit list when the dedicated `/v1/artists/{id}`
  // endpoint refuses to play.
  const [artistRes, topTracksRes, releasesRes, similarRes] = await Promise.allSettled([
    tidal.getArtist(id),
    tidal.getArtistTopTracks(id),
    tidal.getArtistAlbumsAndSingles(id),
    tidal.getSimilarArtists(id),
  ]);

  const releases = releasesRes.status === 'fulfilled'
    ? releasesRes.value
    : { albums: [], singles: [], albumsMore: undefined, albumsMoreTotal: undefined, singlesMore: undefined, singlesMoreTotal: undefined };

  let artist = artistRes.status === 'fulfilled' ? artistRes.value : undefined;
  if (!artist) {
    if (artistRes.status === 'rejected') {
      console.error('[artist:get] /v1/artists/' + id + ' failed:', artistRes.reason);
    }
    // Synthesise from any release that credits this artist — the
    // contributors list is reliable even when the artist record is
    // unavailable. Image is unfortunately lost, but name+id is
    // enough for the page header to render.
    const allReleases = [...releases.albums, ...releases.singles];
    for (const r of allReleases) {
      const match = r.artists?.find((a) => a.id === id);
      if (match) {
        artist = { id, source: 'tidal', name: match.name };
        break;
      }
    }
  }

  if (!artist) {
    return c.json({ error: 'Artist not found' }, 404);
  }

  if (topTracksRes.status === 'rejected') {
    console.error('[artist:get] topTracks failed for ' + id + ':', topTracksRes.reason);
  }
  if (similarRes.status === 'rejected') {
    console.error('[artist:get] similar failed for ' + id + ':', similarRes.reason);
  }

  return c.json({
    ...artist,
    topTracks: topTracksRes.status === 'fulfilled' ? topTracksRes.value : [],
    albums: releases.albums,
    singles: releases.singles,
    albumsMore: releases.albumsMore,
    albumsMoreTotal: releases.albumsMoreTotal,
    singlesMore: releases.singlesMore,
    singlesMoreTotal: releases.singlesMoreTotal,
    similarArtists: similarRes.status === 'fulfilled' ? similarRes.value : [],
  });
});

/**
 * Paginated "all albums" feed for the artist. First call returns the
 * editorial ARTIST_ALBUMS + ARTIST_COMPILATIONS modules from
 * `/v1/pages/artist`; subsequent pages use the opaque `dataApiPath`
 * the artist page handed back, paginating with limit/offset.
 */
artists.get('/:id/albums', async (c) => {
  const id = c.req.param('id');
  const limit = Math.min(50, Math.max(1, Number(c.req.query('limit')) || 50));
  const offset = Math.max(0, Number(c.req.query('offset')) || 0);
  const morePath = c.req.query('morePath');
  const tidal = new TidalService(c.env);
  if (morePath) {
    // Thread the artist id so the paginated bucket can drop
    // compilations where this artist is only a featured contributor
    // (`isOwnedByArtist`) — same filter the first-page bucket
    // applies. Otherwise Tidal happily returns 100+ "Various Artists"
    // sets that include the artist as a guest.
    const page = await tidal.getArtistReleasesPage(morePath, { limit, offset }, id);
    return c.json(page);
  }
  const { albums, albumsMore, albumsMoreTotal } = await tidal.getArtistAlbumsAndSingles(id);
  const slice = albums.slice(offset, offset + limit);
  return c.json({
    items: slice,
    totalItems: albumsMoreTotal ?? albums.length,
    morePath: albumsMore,
  });
});

/**
 * Paginated "all singles" feed for the artist. Mirrors /albums above
 * — first hop is the ARTIST_TOP_SINGLES module, then the opaque
 * dataApiPath for further pages.
 */
artists.get('/:id/singles', async (c) => {
  const id = c.req.param('id');
  const limit = Math.min(50, Math.max(1, Number(c.req.query('limit')) || 50));
  const offset = Math.max(0, Number(c.req.query('offset')) || 0);
  const morePath = c.req.query('morePath');
  const tidal = new TidalService(c.env);
  if (morePath) {
    // Pass artist id so paginated singles get the same
    // ownership filter as the first-page bucket (see /albums above).
    const page = await tidal.getArtistReleasesPage(morePath, { limit, offset }, id);
    return c.json(page);
  }
  const { singles, singlesMore, singlesMoreTotal } = await tidal.getArtistAlbumsAndSingles(id);
  const slice = singles.slice(offset, offset + limit);
  return c.json({
    items: slice,
    totalItems: singlesMoreTotal ?? singles.length,
    morePath: singlesMore,
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
