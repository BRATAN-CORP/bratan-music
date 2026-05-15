import type { Env } from '../types/env';

/**
 * Per-user "taste vector" stored under user_taste_profile.profile.
 *
 * Conceptually a sparse weighted vector over Tidal artist ids: an artist's
 * weight encodes how much affinity the user has shown for them in the
 * recent listening window. Built from THREE positive signals:
 *
 *   1. Listening history (`play_history`) — exponentially decayed.
 *      Completed play = 1.0, partial (≥30s) = 0.4, half-life 30 days.
 *      Captures "what you actually listen to right now".
 *   2. Liked tracks (rows in the user's is_liked playlist) — flat 1.5
 *      per liked track, no decay. A like is an explicit, durable
 *      preference; we don't want it to fade just because the user
 *      hasn't replayed it in a month. Per-artist credit comes from
 *      the snapshot.artistId saved when the like was created.
 *   3. Cold-start artist picks (`seed_artist_ids`) — flat 0.6 per
 *      pick, no decay. Lets the onboarding choices keep nudging the
 *      vector even after the user has built history, instead of
 *      switching off the moment the first completed play lands.
 *
 * After accumulation everything is rescaled to [0, 1] so the rerank
 * pipeline can mix tasteSig with other 0..1 signals safely.
 *
 * Disliked artists/tracks are clamped to 0 and filtered out by the
 * recommendation candidate pipeline.
 *
 * We also stash up to 50 of the user's most-completed track ids — those
 * are the seeds the wave / continue endpoints feed into Tidal track-radio
 * to generate the candidate pool.
 *
 * Rebuilt nightly by the scheduled handler. Recomputed on-demand if the
 * stored snapshot is older than 24h or doesn't exist yet.
 */
/**
 * Distribution of writing systems across the user's listening history
 * (i.e. what scripts dominate `play_history.artist_name`). Used by the
 * recommendation reranker to penalise candidates from a region whose
 * language the user demonstrably doesn't listen to — the historical
 * symptom was Polish rap surfacing for a Russian/English-rap listener
 * via Tidal's track-radio cross-pollination. Sums to 1 when there's
 * any history; all-zero when there isn't (cold start, treated as
 * neutral by the reranker).
 */
export interface ScriptMix {
  cyrillic: number;
  latin: number;
  cjk: number;
  other: number;
}

export interface TasteProfile {
  artistWeights: Record<string, number>;
  /** Track ids the user has played to completion at least once, ordered
   *  by descending recency-weighted completion count. Truncated to 50. */
  completedTrackIds: string[];
  /** Total play_history rows considered. Used to gate cold-start. */
  totalPlays: number;
  /** Per-script share of the user's listening (decay-weighted same as
   *  `artistWeights`). Source: `play_history.artist_name`. Cold-start
   *  users get a zero distribution and the reranker treats them
   *  neutrally (no language penalty). */
  scriptMix: ScriptMix;
  /** Per-genre weight (genre slug as in Tidal explore-page format,
   *  e.g. `genre_rap`) summed from (a) onboarding genre picks and
   *  (b) the user's seed artists' implicit genres. Values are
   *  normalised to [0, 1]. Empty for users with no seeds and no
   *  history that touched genre pages. */
  genreWeights: Record<string, number>;
  /** Version stamp. Bumped from 1 → 2 when we added `scriptMix` /
   *  `genreWeights` (PR "recs-country-genre-vector"): any v1 profile
   *  read from the cache is treated as stale and recomputed so the
   *  new signals start populating before the 24h cron sweep. */
  version: 2;
}

const HALF_LIFE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const COMPLETED_WEIGHT = 1.0;
const PARTIAL_WEIGHT = 0.4;
/** Each liked track contributes this to its artist's weight. Slightly
 *  higher than a single completed play because liking is an explicit,
 *  durable preference signal. No decay. */
const LIKED_WEIGHT = 1.5;
/** Each onboarding-picked artist gets this baseline weight, no decay,
 *  so the cold-start picks keep nudging the vector forever (instead of
 *  switching off after the first completed play). */
const SEED_ARTIST_WEIGHT = 0.6;

/** When summing `play_history.artist_name` chars into `scriptMix`, we
 *  treat each play row with the same exponential decay used for
 *  `artistWeights` (more recent listening = higher impact on the
 *  distribution). Liked tracks contribute their primary script too,
 *  weighted by `LIKED_WEIGHT`, so a user who liked a lot of Russian
 *  rap two years ago still reads as "prefers Cyrillic" even after
 *  the play-history decay nears zero. */

/** Genre slugs assumed when an onboarding-picked seed artist's id is
 *  in this map. Empty for now — future PR can hydrate this from a
 *  cached Tidal lookup. Kept as a constant so the wire-up is one
 *  edit when we add the mapping. */
const SEED_ARTIST_GENRE_MAP: Record<string, string[]> = {};

interface PlayHistoryRow {
  track_id: string;
  artist_id: string | null;
  artist_name: string;
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
        `SELECT track_id, artist_id, artist_name, completed, played_at
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
    // Raw script counters — normalised at the bottom of recompute()
    // into a {sum=1} distribution stored on the profile. Cyrillic /
    // latin / cjk / other; see `detectScript` for the buckets.
    const scriptCounters: ScriptMix = { cyrillic: 0, latin: 0, cjk: 0, other: 0 };

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
      // Script signal: derive from artist_name (column populated by
      // every PlaybackEventsService write since migration 0011). The
      // null/empty fallback drops into `other` so a malformed row
      // can't blow up the distribution — mostly defensive against
      // historical rows from before artist_name became NOT NULL.
      const script = detectScript(row.artist_name);
      scriptCounters[script] += w;
    }

    // Pull liked tracks (rows in the user's is_liked playlist). The
    // snapshot column carries `artistId` (and `artists[]` for multi-
    // artist credits) saved at the moment of liking. We read both so
    // featured artists also get credit, matching what the UI shows.
    const likedRes = await this.env.DB
      .prepare(
        `SELECT pt.snapshot
           FROM playlist_tracks pt
           JOIN playlists p ON p.id = pt.playlist_id
          WHERE p.user_id = ? AND p.is_liked = 1`,
      )
      .bind(userId)
      .all<{ snapshot: string | null }>();
    for (const row of likedRes.results ?? []) {
      const ids = extractArtistIdsFromSnapshot(row.snapshot);
      for (const aid of ids) {
        if (!aid || dislikedArtists.has(aid)) continue;
        artistWeights[aid] = (artistWeights[aid] ?? 0) + LIKED_WEIGHT;
      }
    }

    // Cold-start picks contribute a flat baseline that never decays.
    // This is what fixes the "after one completed play the wave forgets
    // who I picked" problem — picks always land in the vector and only
    // get *outweighed* once heavy listening on someone else builds up.
    const seedRow = await this.env.DB
      .prepare(`SELECT seed_artist_ids, genre_seeds FROM user_taste_profile WHERE user_id = ?`)
      .bind(userId)
      .first<{ seed_artist_ids: string; genre_seeds: string }>();
    for (const aid of parseStringArray(seedRow?.seed_artist_ids ?? '[]')) {
      if (dislikedArtists.has(aid)) continue;
      artistWeights[aid] = (artistWeights[aid] ?? 0) + SEED_ARTIST_WEIGHT;
    }

    // Genre vector: blend (a) onboarding genre picks (full LIKED_WEIGHT
    // per slug because they're explicit declarations of taste) and (b)
    // a future per-artist genre lookup (empty map for now). The result
    // is normalised to [0, 1] so the reranker can mix it with other
    // 0..1 signals safely. Empty for users with no genre seeds and no
    // mapped seed artists.
    const genreWeights: Record<string, number> = {};
    const genreSeedSlugs = parseStringArray(seedRow?.genre_seeds ?? '[]');
    for (const slug of genreSeedSlugs) {
      genreWeights[slug] = (genreWeights[slug] ?? 0) + LIKED_WEIGHT;
    }
    for (const aid of parseStringArray(seedRow?.seed_artist_ids ?? '[]')) {
      for (const slug of SEED_ARTIST_GENRE_MAP[aid] ?? []) {
        genreWeights[slug] = (genreWeights[slug] ?? 0) + SEED_ARTIST_WEIGHT;
      }
    }
    normaliseInPlace(genreWeights);

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

    // Normalise script counters into a distribution that sums to 1.
    // Cold-start users (zero history) get an all-zero distribution —
    // the reranker checks for that and applies no language penalty.
    const scriptTotal = scriptCounters.cyrillic + scriptCounters.latin + scriptCounters.cjk + scriptCounters.other;
    const scriptMix: ScriptMix = scriptTotal > 0
      ? {
          cyrillic: scriptCounters.cyrillic / scriptTotal,
          latin: scriptCounters.latin / scriptTotal,
          cjk: scriptCounters.cjk / scriptTotal,
          other: scriptCounters.other / scriptTotal,
        }
      : { cyrillic: 0, latin: 0, cjk: 0, other: 0 };

    const profile: TasteProfile = {
      artistWeights,
      completedTrackIds,
      totalPlays: playsRes.results?.length ?? 0,
      scriptMix,
      genreWeights,
      version: 2,
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
      const parsed = JSON.parse(row.profile) as Partial<TasteProfile>;
      // Force a recompute when the cached profile predates the
      // scriptMix / genreWeights signals (version: 2). Without this
      // the rerank would treat every existing user as cold-start for
      // language penalties until their next nightly cron sweep.
      if (parsed.version === 2) {
        return {
          profile: parsed as TasteProfile,
          genreSeeds: parseStringArray(row.genre_seeds),
          seedArtistIds: parseStringArray(row.seed_artist_ids),
        };
      }
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

  /** Replace the cold-start artist seeds. Used by the onboarding flow
   *  where the user picks 1–15 artists they like; we then seed Tidal
   *  track-radio off those artist ids and also bake them into the
   *  taste vector at a flat baseline (see `recompute`). */
  async setSeedArtists(userId: string, artistIds: string[]): Promise<void> {
    await this.upsertSeedColumn(userId, 'seed_artist_ids', artistIds.slice(0, 15));
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
      // Placeholder so the row exists and the next `recompute()` can
      // do an `UPDATE` instead of a duplicate insert. scriptMix /
      // genreWeights are all-zero / empty because the user hasn't yet
      // produced enough history for them to mean anything; the next
      // recompute will refill from `play_history` + seed picks.
      const empty: TasteProfile = {
        artistWeights: {},
        completedTrackIds: [],
        totalPlays: 0,
        scriptMix: { cyrillic: 0, latin: 0, cjk: 0, other: 0 },
        genreWeights: {},
        version: 2,
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

/**
 * Detect which writing system dominates a short string of text. Used
 * on `play_history.artist_name` to derive a per-user script
 * distribution that the rerank then turns into a language-mismatch
 * penalty. We bucket into four broad regions; finer-grained sub-
 * detection (Greek, Arabic, Hebrew, Thai, Devanagari etc.) all go to
 * `other` so they don't accidentally collide with the four major
 * buckets we DO act on.
 *
 * Exported so callers (rerank) can run the same detection on candidate
 * artist names without re-deriving the heuristic. Keeps the algorithm
 * a single source of truth.
 */
export function detectScript(name: string): keyof ScriptMix {
  if (!name) return 'other';
  let cyr = 0;
  let lat = 0;
  let cjk = 0;
  let other = 0;
  for (const ch of name) {
    const cp = ch.codePointAt(0) ?? 0;
    // Cyrillic block + Cyrillic Supplement.
    if ((cp >= 0x0400 && cp <= 0x04FF) || (cp >= 0x0500 && cp <= 0x052F)) {
      cyr += 1;
      continue;
    }
    // Basic Latin letters + Latin-1 Supplement + Latin Extended-A/B.
    if (
      (cp >= 0x0041 && cp <= 0x005A) || // A-Z
      (cp >= 0x0061 && cp <= 0x007A) || // a-z
      (cp >= 0x00C0 && cp <= 0x024F)
    ) {
      lat += 1;
      continue;
    }
    // CJK ideographs + Hangul + Hiragana + Katakana (rough union).
    if (
      (cp >= 0x3040 && cp <= 0x30FF) || // Hiragana + Katakana
      (cp >= 0x3400 && cp <= 0x9FFF) || // CJK Unified Ideographs + Ext A
      (cp >= 0xAC00 && cp <= 0xD7AF)    // Hangul Syllables
    ) {
      cjk += 1;
      continue;
    }
    // Whitespace, digits, punctuation, ASCII punctuation, etc. don't
    // count toward any bucket; everything else falls into `other`.
    if (/\s|\d|[!-/:-@[-`{-~]/.test(ch)) continue;
    other += 1;
  }
  const max = Math.max(cyr, lat, cjk, other);
  if (max === 0) return 'other';
  if (max === cyr) return 'cyrillic';
  if (max === lat) return 'latin';
  if (max === cjk) return 'cjk';
  return 'other';
}

/**
 * Rescale a sparse `Record<string, number>` so the largest value lands
 * at 1.0 (and everything else proportionally below). Mutates the
 * argument in place; no-op when the record is empty or all zeros.
 */
function normaliseInPlace(weights: Record<string, number>): void {
  const max = Object.values(weights).reduce((a, b) => Math.max(a, b), 0);
  if (max <= 0) return;
  for (const k of Object.keys(weights)) {
    weights[k] = (weights[k] ?? 0) / max;
  }
}

function parseStringArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) return parsed.filter((x): x is string => typeof x === 'string');
  } catch { /* ignore */ }
  return [];
}

interface SnapshotShape {
  artistId?: string | null;
  artists?: Array<{ id?: string | null } | null> | null;
}

/**
 * Pull every plausible artist id out of a `playlist_tracks.snapshot`
 * blob. We accept both the legacy single `artistId` and the newer
 * `artists[]` array (added when Tidal track snapshots started carrying
 * the full credit list). Falls back to an empty array on malformed JSON
 * so a single bad row never blows up the whole recompute.
 */
function extractArtistIdsFromSnapshot(raw: string | null | undefined): string[] {
  if (!raw) return [];
  let parsed: SnapshotShape;
  try {
    parsed = JSON.parse(raw) as SnapshotShape;
  } catch {
    return [];
  }
  const out = new Set<string>();
  if (typeof parsed.artistId === 'string' && parsed.artistId) out.add(parsed.artistId);
  if (Array.isArray(parsed.artists)) {
    for (const a of parsed.artists) {
      if (a && typeof a.id === 'string' && a.id) out.add(a.id);
    }
  }
  return [...out];
}
