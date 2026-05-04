import type { Env } from '../types/env';
import type { Track } from '../types/music';

/**
 * Per-user dislike sets. Used everywhere we surface tracks the
 * recommender has shortlisted — the wave/rerank pipeline already
 * filters at scoring time (see `RecommendationService.rerank`), but
 * the daily-playlists generator and the AI-playlist generator also
 * need to honour the same lists so banned items don't leak in
 * through those alternative entry points.
 *
 * Loaded as one D1 round trip and shaped as a pair of sets so the
 * downstream `filterTracksByDislikes(...)` helper is a tight O(N)
 * pass over the candidate list.
 */
export interface DislikeSets {
  tracks: Set<string>;
  artists: Set<string>;
}

interface DislikeRow {
  item_id: string;
  kind: 'track' | 'artist';
}

export async function loadDislikes(env: Env, userId: string): Promise<DislikeSets> {
  const res = await env.DB
    .prepare(`SELECT item_id, kind FROM user_dislikes WHERE user_id = ?`)
    .bind(userId)
    .all<DislikeRow>();
  const tracks = new Set<string>();
  const artists = new Set<string>();
  for (const r of res.results ?? []) {
    if (r.kind === 'artist') artists.add(r.item_id);
    else tracks.add(r.item_id);
  }
  return { tracks, artists };
}

export function filterTracksByDislikes<T extends Pick<Track, 'id' | 'artistId' | 'artists'>>(
  tracks: T[],
  dislikes: DislikeSets,
): T[] {
  if (dislikes.tracks.size === 0 && dislikes.artists.size === 0) return tracks;
  return tracks.filter((t) => {
    if (dislikes.tracks.has(t.id)) return false;
    if (t.artistId && dislikes.artists.has(t.artistId)) return false;
    if (Array.isArray(t.artists)) {
      // Multi-credit tracks: drop if ANY credited artist is banned.
      // Matches the user's intent — "не рекомендовать тех, кого я
      // забанил" should not be circumvented by a feature credit.
      for (const a of t.artists) {
        if (a.id && dislikes.artists.has(a.id)) return false;
      }
    }
    return true;
  });
}
