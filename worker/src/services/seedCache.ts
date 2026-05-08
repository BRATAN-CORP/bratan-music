import type { Env } from '../types/env';
import type { Track } from '../types/music';
import type { TidalService } from './tidal/TidalService';

/**
 * Shared `genre_seed_tracks:<slug>` KV cache used by both
 * {@link RecommendationService.candidatesFromGenres} and
 * {@link DailyPlaylistService.tracksFromGenre}.
 *
 * Background — the free-tier Cloudflare Workers KV namespace is capped
 * at 1000 writes/day. The previous shape duplicated this cache across
 * two callers (with the same key prefix and TTL) plus three other
 * 12h/24h slots in `RecommendationService` and `routes/recommendations.ts`.
 * On a normally active day each `wave()` and each daily-playlist
 * regeneration was paying ~5–15 cold writes here, plus the same again
 * for `track_radio:` / `artist_seed_tracks:` / `rec_suggested_artists:`,
 * which alone burned 80–90% of the daily quota and started returning
 * 429s mid-day for every other write site too. See
 * `docs/daily-changes/2026-05-08.md` (PR "kv-write-budget") for the
 * full audit.
 *
 * The fix is two-pronged:
 *
 *   1. Hoist the `genre_seed_tracks` write path into one helper so
 *      future TTL / shape tweaks happen in exactly one place — and so
 *      the read-then-write pattern can be tightened (e.g. per-isolate
 *      memo) in a second step without touching either caller.
 *   2. Bump the per-slot TTLs from 12h/24h up to {@link CACHE_TTL_S}
 *      (7 days). The upstream pages that back these slugs change
 *      slowly enough on Tidal's side that 7d is well within the
 *      "feels fresh" tolerance for daily-playlists / wave seeding,
 *      and it cuts the per-namespace write volume by ~5–7x in the
 *      common case where the same handful of slugs gets requested
 *      every day.
 */

/** Common TTL for the long-tail content-seeded caches in this file
 *  and in {@link RecommendationService}. 7 days is the sweet spot
 *  between "fresh enough to feel like a changing recommendation" and
 *  "infrequent enough to stay under the 1000 writes/day KV cap". */
export const CACHE_TTL_S = 7 * 24 * 60 * 60;

const KEY_PREFIX = 'genre_seed_tracks:';
const TRACK_CAP = 60;

/**
 * Read genre-seeded track pool for a Tidal explore-page slug, falling
 * back to a fresh fetch + KV write on miss. Errors return an empty
 * array so callers can fold the result into a wider candidate pool
 * without special-casing failures.
 */
export async function getCachedGenreTracks(
  env: Env,
  tidal: TidalService,
  slug: string,
): Promise<Track[]> {
  try {
    const cached = await env.SESSIONS.get(`${KEY_PREFIX}${slug}`, 'json');
    if (cached && Array.isArray(cached)) return cached as Track[];

    const page = await tidal.getExplorePage(slug);
    const tracks: Track[] = [];
    for (const m of page.modules) {
      if (m.type === 'tracks') tracks.push(...m.items);
    }
    const value = tracks.slice(0, TRACK_CAP);
    await env.SESSIONS.put(`${KEY_PREFIX}${slug}`, JSON.stringify(value), {
      expirationTtl: CACHE_TTL_S,
    });
    return tracks;
  } catch {
    return [];
  }
}
