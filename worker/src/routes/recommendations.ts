import { Hono } from 'hono';
import type { Env, Variables } from '../types/env';
import { jwtAuth } from '../middleware/auth';
import { RecommendationService } from '../services/RecommendationService';
import { TasteService } from '../services/TasteService';
import { TidalService } from '../services/tidal/TidalService';

const recommendations = new Hono<{ Bindings: Env; Variables: Variables }>();

recommendations.use('/*', jwtAuth);

/**
 * Endless personal stream. The frontend "Моя волна" button hits this on
 * launch with no body; the home page also hits it on render to populate
 * the hero card preview.
 */
recommendations.get('/wave', async (c) => {
  const userId = c.get('userId');
  const limit = clampInt(c.req.query('limit'), 25, 1, 50);
  const rec = new RecommendationService(c.env);
  const items = await rec.wave(userId, limit);
  // Fire-and-forget: record what we just shipped so the next call
  // suppresses these as "recently seen". We don't await the write so
  // the response doesn't pay an extra round trip.
  c.executionCtx.waitUntil(rec.recordSeen(userId, items));
  return c.json({ items });
});

/**
 * Extend a current playback context. The audio engine pings this when
 * the queue drops below threshold and repeat is off / not in a saved
 * playlist.
 */
recommendations.post('/continue', async (c) => {
  const userId = c.get('userId');
  const body = await c.req.json<{ seedTrackId?: string; limit?: number }>().catch(() => ({} as { seedTrackId?: string; limit?: number }));
  if (!body.seedTrackId || typeof body.seedTrackId !== 'string') {
    return c.json({ error: 'seedTrackId обязателен' }, 400);
  }
  const limit = clampInt(body.limit, 20, 1, 50);
  const rec = new RecommendationService(c.env);
  const items = await rec.continueFromTrack(userId, body.seedTrackId, limit);
  c.executionCtx.waitUntil(rec.recordSeen(userId, items));
  return c.json({ items });
});

/**
 * Cold-start onboarding endpoint. The frontend lists 8–12 genres and
 * lets the user pick 3–5 — those slugs land here and seed the wave
 * until real listening history accumulates.
 */
recommendations.post('/genre-seeds', async (c) => {
  const userId = c.get('userId');
  const body = await c.req.json<{ slugs?: string[] }>().catch(() => ({} as { slugs?: string[] }));
  if (!Array.isArray(body.slugs)) {
    return c.json({ error: 'slugs обязателен' }, 400);
  }
  const slugs = body.slugs.filter((s: unknown): s is string => typeof s === 'string').slice(0, 8);
  await new TasteService(c.env).setGenreSeeds(userId, slugs);
  return c.json({ ok: true, slugs });
});

recommendations.get('/genre-seeds', async (c) => {
  const userId = c.get('userId');
  const taste = new TasteService(c.env);
  const { genreSeeds, profile } = await taste.getOrCompute(userId);
  return c.json({ slugs: genreSeeds, hasHistory: profile.totalPlays > 0 });
});

/**
 * Returns the caller's full dislike list — both banned tracks and
 * banned artists. The frontend uses this to (a) decorate kebab menus
 * with "уже скрыт / восстановить" toggles and (b) skip-on-play any
 * legacy queue items that were added before the user banned the
 * artist.
 */
recommendations.get('/dislikes', async (c) => {
  const userId = c.get('userId');
  const res = await c.env.DB
    .prepare(`SELECT item_id, kind FROM user_dislikes WHERE user_id = ? ORDER BY created_at DESC`)
    .bind(userId)
    .all<{ item_id: string; kind: 'track' | 'artist' }>();
  const tracks: string[] = [];
  const artists: string[] = [];
  for (const r of res.results ?? []) {
    if (r.kind === 'artist') artists.push(r.item_id);
    else tracks.push(r.item_id);
  }
  return c.json({ tracks, artists });
});

/**
 * Explicit dislike. The frontend hits this from the 3-dot menu's
 * "Не нравится" entry on tracks/artists.
 */
recommendations.post('/dislikes', async (c) => {
  const userId = c.get('userId');
  const body = await c.req.json<{ itemId?: string; kind?: 'track' | 'artist'; source?: string }>().catch(() => ({} as { itemId?: string; kind?: 'track' | 'artist'; source?: string }));
  if (!body.itemId || (body.kind !== 'track' && body.kind !== 'artist')) {
    return c.json({ error: 'itemId и kind обязательны' }, 400);
  }
  const source = body.source ?? 'tidal';
  await c.env.DB
    .prepare(
      `INSERT INTO user_dislikes (user_id, item_id, kind, source, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id, item_id, kind) DO NOTHING`,
    )
    .bind(userId, body.itemId, body.kind, source, Date.now())
    .run();
  return c.json({ ok: true });
});

/**
 * Cold-start onboarding (preferred): user picks 1–6 artists they like.
 * This is a tighter signal than genre slugs and lets the wave start
 * meaningfully on the user's first session.
 */
recommendations.post('/seed-artists', async (c) => {
  const userId = c.get('userId');
  const body = await c.req
    .json<{ artistIds?: unknown }>()
    .catch(() => ({} as { artistIds?: unknown }));
  if (!Array.isArray(body.artistIds) || body.artistIds.length === 0) {
    return c.json({ error: 'artistIds обязателен' }, 400);
  }
  const ids = body.artistIds
    .filter((s: unknown): s is string => typeof s === 'string' && s.length > 0)
    .slice(0, 12);
  if (ids.length === 0) {
    return c.json({ error: 'нужен хотя бы один artistId' }, 400);
  }
  await new TasteService(c.env).setSeedArtists(userId, ids);
  return c.json({ ok: true, artistIds: ids });
});

recommendations.get('/seed-artists', async (c) => {
  const userId = c.get('userId');
  const taste = new TasteService(c.env);
  const { seedArtistIds, profile } = await taste.getOrCompute(userId);
  return c.json({ artistIds: seedArtistIds, hasHistory: profile.totalPlays > 0 });
});

/**
 * Search Tidal artists for the cold-start picker. Free-text query —
 * the picker calls this on debounce as the user types.
 */
recommendations.get('/artists/search', async (c) => {
  const q = c.req.query('q')?.trim() ?? '';
  if (q.length < 2) return c.json({ items: [] });
  try {
    const tidal = new TidalService(c.env);
    const result = await tidal.search(q, 'artists', { limit: 24 });
    return c.json({ items: result.artists });
  } catch (err) {
    console.error('artists/search failed', err);
    return c.json({ items: [] });
  }
});

/**
 * "Suggested" pool the cold-start picker shows when the search input is
 * empty. Pulled from a curated explore page (popular artists across
 * genres) and KV-cached for 24h since this is a public-feeling list.
 */
recommendations.get('/artists/suggested', async (c) => {
  const cacheKey = 'rec_suggested_artists:v1';
  const cached = await c.env.SESSIONS.get(cacheKey, 'json');
  if (cached && Array.isArray(cached)) return c.json({ items: cached });
  try {
    const tidal = new TidalService(c.env);
    const seen = new Set<string>();
    const collected: Array<{ id: string; name: string; imageUrl?: string }> = [];
    for (const slug of ['genre_pop', 'genre_rap', 'genre_rock', 'genre_electronic']) {
      try {
        const page = await tidal.getExplorePage(slug);
        for (const m of page.modules) {
          if (m.type === 'artists') {
            for (const a of m.items) {
              if (!seen.has(a.id) && a.imageUrl) {
                seen.add(a.id);
                collected.push({ id: a.id, name: a.name, imageUrl: a.imageUrl });
                if (collected.length >= 24) break;
              }
            }
          }
          if (collected.length >= 24) break;
        }
      } catch { /* one bad slug shouldn't kill the whole list */ }
      if (collected.length >= 24) break;
    }
    await c.env.SESSIONS.put(cacheKey, JSON.stringify(collected), { expirationTtl: 24 * 60 * 60 });
    return c.json({ items: collected });
  } catch (err) {
    console.error('artists/suggested failed', err);
    return c.json({ items: [] });
  }
});

recommendations.delete('/dislikes/:kind/:itemId', async (c) => {
  const userId = c.get('userId');
  const kind = c.req.param('kind');
  const itemId = c.req.param('itemId');
  if (kind !== 'track' && kind !== 'artist') {
    return c.json({ error: 'Неверный kind' }, 400);
  }
  await c.env.DB
    .prepare(`DELETE FROM user_dislikes WHERE user_id = ? AND item_id = ? AND kind = ?`)
    .bind(userId, itemId, kind)
    .run();
  return c.json({ ok: true });
});

export { recommendations };

function clampInt(raw: unknown, fallback: number, min: number, max: number): number {
  const n = typeof raw === 'string' ? parseInt(raw, 10) : typeof raw === 'number' ? Math.floor(raw) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
