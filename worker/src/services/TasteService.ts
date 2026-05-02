import type { Env } from '../types/env';

/**
 * Per-user "taste vector" stored under user_taste_profile.profile.
 *
 * Conceptually a sparse weighted vector over Tidal artist ids: an artist's
 * weight encodes how much affinity the user has shown for them in the
 * recent listening window. Built from `play_history` with a few simple
 * but-effective rules:
 *   - Each completed play (listened ≥ 80% / hit `ended`) contributes 1.0.
 *   - Each ≥30s but uncompleted play contributes 0.4.
 *   - Plays decay exponentially in time with a 30-day half-life.
 *   - The artist of an explicit dislike gets clamped to 0 (and excluded
 *     from candidate generation in RecommendationService).
 *
 * We also stash up to 50 of the user's most-completed track ids — those
 * are the seeds the wave / continue endpoints feed into Tidal track-radio
 * to generate the candidate pool.
 *
 * Rebuilt nightly by the scheduled handler. Recomputed on-demand if the
 * stored snapshot is older than 24h or doesn't exist yet.
 */
export interface TasteProfile {
  artistWeights: Record<string, number>;
  /** Track ids the user has played to completion at least once, ordered
   *  by descending recency-weighted completion count. Truncated to 50. */
  completedTrackIds: string[];
  /** Total play_history rows considered. Used to gate cold-start. */
  totalPlays: number;
  version: 1;
}

const HALF_LIFE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const COMPLETED_WEIGHT = 1.0;
const PARTIAL_WEIGHT = 0.4;

interface PlayHistoryRow {
  track_id: string;
  artist_id: string | null;
  completed: number;
  played_at: number;
}

interface DislikeRow {
  item_id: string;
  kind: 'track' | 'artist';
}

export class TasteService {
  constructor(private env: Env) {}

  /**
   * Rebuild and persist the taste profile for one user. Returns the new
   * profile so callers can use it inline without an extra round trip.
   */
  async recompute(userId: string): Promise<TasteProfile> {
    const now = Date.now();
    // 90-day window: we want enough data to produce a stable vector but
    // also want listeners' tastes to drift over time. The half-life
    // weighting handles "more recent matters more" inside this window.
    const ninetyDaysAgo = now - 90 * 24 * 60 * 60 * 1000;
    // Honor the per-user "Сбросить рекомендации" checkpoint: plays before
    // `users.recommendations_reset_at` don't count toward the taste vector.
    // Without this filter recompute would happily rebuild the same profile
    // from the preserved play_history immediately after a reset, and the
    // wave / daily playlists would feel unchanged. The reset endpoint
    // wipes user_taste_profile and stamps this column simultaneously, so
    // the next recompute genuinely starts cold.
    const resetRow = await this.env.DB
      .prepare(`SELECT recommendations_reset_at FROM users WHERE id = ?`)
      .bind(userId)
      .first<{ recommendations_reset_at: number }>();
    const resetAt = resetRow?.recommendations_reset_at ?? 0;
    const since = Math.max(ninetyDaysAgo, resetAt);

    const playsRes = await this.env.DB
      .prepare(
        `SELECT track_id, artist_id, completed, played_at
           FROM play_history
          WHERE user_id = ? AND played_at >= ?
          ORDER BY played_at DESC
          LIMIT 5000`,
      )
      .bind(userId, since)
      .all<PlayHistoryRow>();

    const dislikesRes = await this.env.DB
      .prepare(`SELECT item_id, kind FROM user_dislikes WHERE user_id = ?`)
      .bind(userId)
      .all<DislikeRow>();

    const dislikedArtists = new Set<string>();
    const dislikedTracks = new Set<string>();
    for (const d of dislikesRes.results ?? []) {
      if (d.kind === 'artist') dislikedArtists.add(d.item_id);
      else dislikedTracks.add(d.item_id);
    }

    const artistWeights: Record<string, number> = {};
    // Track-id → recency-weighted score. We pick the top N as
    // `completedTrackIds` — these are the seeds that feed track-radio.
    const trackScores: Record<string, number> = {};

    for (const row of playsRes.results ?? []) {
      if (dislikedTracks.has(row.track_id)) continue;
      const decay = Math.pow(0.5, (now - row.played_at) / HALF_LIFE_MS);
      const w = (row.completed ? COMPLETED_WEIGHT : PARTIAL_WEIGHT) * decay;

      if (row.artist_id && !dislikedArtists.has(row.artist_id)) {
        artistWeights[row.artist_id] = (artistWeights[row.artist_id] ?? 0) + w;
      }
      if (row.completed) {
        trackScores[row.track_id] = (trackScores[row.track_id] ?? 0) + w;
      }
    }

    // Normalise artist weights to [0, 1] so re-rank can mix them with
    // other 0..1 signals without any one user's heavy listening pulling
    // the vector to weird scales.
    const maxArtist = Object.values(artistWeights).reduce((a, b) => Math.max(a, b), 0);
    if (maxArtist > 0) {
      for (const k of Object.keys(artistWeights)) {
        artistWeights[k] = (artistWeights[k] ?? 0) / maxArtist;
      }
    }

    const completedTrackIds = Object.entries(trackScores)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 50)
      .map(([id]) => id);

    const profile: TasteProfile = {
      artistWeights,
      completedTrackIds,
      totalPlays: playsRes.results?.length ?? 0,
      version: 1,
    };

    await this.env.DB
      .prepare(
        `INSERT INTO user_taste_profile
             (user_id, profile, genre_seeds, seed_artist_ids, computed_at, updated_at)
         VALUES (
           ?, ?,
           COALESCE((SELECT genre_seeds     FROM user_taste_profile WHERE user_id = ?), '[]'),
           COALESCE((SELECT seed_artist_ids FROM user_taste_profile WHERE user_id = ?), '[]'),
           ?, ?
         )
         ON CONFLICT(user_id) DO UPDATE SET
           profile     = excluded.profile,
           computed_at = excluded.computed_at,
           updated_at  = excluded.updated_at`,
      )
      .bind(userId, JSON.stringify(profile), userId, userId, now, now)
      .run();

    return profile;
  }

  /**
   * Read the cached profile or rebuild it if stale / missing. We
   * consider a profile "fresh" if recomputed in the last 24h. The
   * recommendation hot path uses this to amortise the recompute cost
   * across all users (cron-driven recompute + lazy refresh on first
   * request of the day).
   */
  async getOrCompute(
    userId: string,
  ): Promise<{ profile: TasteProfile; genreSeeds: string[]; seedArtistIds: string[] }> {
    const row = await this.env.DB
      .prepare(
        `SELECT profile, genre_seeds, seed_artist_ids, computed_at
           FROM user_taste_profile WHERE user_id = ?`,
      )
      .bind(userId)
      .first<{
        profile: string;
        genre_seeds: string;
        seed_artist_ids: string;
        computed_at: number;
      }>();

    const now = Date.now();
    if (row && now - row.computed_at < 24 * 60 * 60 * 1000) {
      return {
        profile: JSON.parse(row.profile) as TasteProfile,
        genreSeeds: parseStringArray(row.genre_seeds),
        seedArtistIds: parseStringArray(row.seed_artist_ids),
      };
    }

    const profile = await this.recompute(userId);
    const seedsRow = await this.env.DB
      .prepare(
        `SELECT genre_seeds, seed_artist_ids FROM user_taste_profile WHERE user_id = ?`,
      )
      .bind(userId)
      .first<{ genre_seeds: string; seed_artist_ids: string }>();
    return {
      profile,
      genreSeeds: parseStringArray(seedsRow?.genre_seeds ?? '[]'),
      seedArtistIds: parseStringArray(seedsRow?.seed_artist_ids ?? '[]'),
    };
  }

  /** Replace the cold-start genre seeds. Kept for back-compat; the
   *  current onboarding flow prefers `setSeedArtists` for tighter
   *  signal. */
  async setGenreSeeds(userId: string, slugs: string[]): Promise<void> {
    await this.upsertSeedColumn(userId, 'genre_seeds', slugs.slice(0, 8));
  }

  /** Replace the cold-start artist seeds. Used by the new onboarding
   *  flow where the user picks 1–6 artists they like; we then seed
   *  Tidal track-radio off those artist ids. */
  async setSeedArtists(userId: string, artistIds: string[]): Promise<void> {
    await this.upsertSeedColumn(userId, 'seed_artist_ids', artistIds.slice(0, 12));
  }

  private async upsertSeedColumn(
    userId: string,
    column: 'genre_seeds' | 'seed_artist_ids',
    values: string[],
  ): Promise<void> {
    const now = Date.now();
    const json = JSON.stringify(values);
    const exists = await this.env.DB
      .prepare(`SELECT user_id FROM user_taste_profile WHERE user_id = ?`)
      .bind(userId)
      .first();
    if (exists) {
      // Column name is constrained to a literal union above, so
      // string-interpolation here is safe and unavoidable (D1's
      // prepare() doesn't bind identifiers).
      await this.env.DB
        .prepare(
          `UPDATE user_taste_profile SET ${column} = ?, updated_at = ? WHERE user_id = ?`,
        )
        .bind(json, now, userId)
        .run();
    } else {
      const empty: TasteProfile = {
        artistWeights: {},
        completedTrackIds: [],
        totalPlays: 0,
        version: 1,
      };
      const otherCol = column === 'genre_seeds' ? 'seed_artist_ids' : 'genre_seeds';
      await this.env.DB
        .prepare(
          `INSERT INTO user_taste_profile
             (user_id, profile, ${column}, ${otherCol}, computed_at, updated_at)
           VALUES (?, ?, ?, '[]', ?, ?)`,
        )
        .bind(userId, JSON.stringify(empty), json, now, now)
        .run();
    }
  }
}

function parseStringArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) return parsed.filter((x): x is string => typeof x === 'string');
  } catch { /* ignore */ }
  return [];
}
