import { Hono } from 'hono';
import type { Env, Variables } from '../types/env';
import { jwtAuth } from '../middleware/auth';
import { RecommendationService } from '../services/RecommendationService';
import { TasteService } from '../services/TasteService';

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
