import type { Env } from '../types/env';
import type { Track } from '../types/music';
import { TidalService } from './tidal/TidalService';
import { TasteService, type TasteProfile } from './TasteService';

/**
 * Per-user music recommender. Three public surfaces:
 *
 *   - `wave(userId)` — endless personal stream (powering the "Моя волна"
 *     button and home-page hero). Picks seeds from the user's recent
 *     completed plays, falls back to cold-start strategies if none.
 *   - `continueFromTrack(userId, seedTrack)` — extends the queue when
 *     it gets near-empty during normal playback. Same seed/re-rank
 *     pipeline, just with the explicit context track.
 *   - `recordSeen(userId, tracks)` — anti-repeat bookkeeping; called
 *     by the public routes after they've returned a wave/continue
 *     batch so the next call doesn't surface the same songs again.
 *
 * The re-rank pipeline never sends per-user signal to Tidal. We only
 * request content-seeded primitives (`tracks/{id}/radio`,
 * `pages/{slug}` for genres) which are not personalised on Tidal's
 * side, so different users on the shared proxy account don't pollute
 * each other's recommendations.
 */

const RADIO_CACHE_TTL_S = 24 * 60 * 60; // 24h
const SEEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** How many seeds we fan out into Tidal per wave/continue request. More
 *  seeds = more diversity but also more upstream calls. 4 is empirically
 *  enough to fill 50 candidates after dedup + dislike filtering. */
const SEED_FAN_OUT = 5;
/** How many tracks we ask Tidal for per seed. Larger pool → better
 *  re-rank quality, but more bytes through the proxy. 50 is the
 *  sweet spot for our scale. */
const RADIO_PAGE_SIZE = 50;

/** Re-rank weights. Hand-tuned, not learned. Sum doesn't have to be 1 —
 *  the absolute scale only matters in comparison between candidates. */
const W_TASTE = 0.55;
const W_NOVELTY = 0.20;
const W_DISLIKE_ARTIST = -1.0;
const W_RECENT_SEEN_PENALTY = -0.50;
const W_FAMILIAR_BONUS = 0.10;
const W_DIVERSITY_PENALTY = -0.15;
/** Bonus added to candidates pulled from the requested mood's explore
 *  page. Big enough to bias the top of the wave toward that mood,
 *  small enough that taste signal still wins for the user's strongest
 *  artists. */
const W_MOOD_BONUS = 0.30;

const ARTIST_CAP_IN_RESULT = 3;

/** Moods we expose to the UI. Each maps to a Tidal explore page slug
 *  (`mood_<key>`) — so adding a new mood is one row in this table. */
export const WAVE_MOODS = ['chill', 'workout', 'focus', 'party', 'throwback'] as const;
export type WaveMood = typeof WAVE_MOODS[number];

const MOOD_SLUG: Record<WaveMood, string> = {
  chill: 'mood_chill',
  workout: 'mood_workout',
  focus: 'mood_focus',
  party: 'mood_party',
  throwback: 'mood_throwback',
};

interface DislikeRow {
  item_id: string;
  kind: 'track' | 'artist';
}

interface SeenRow {
  track_id: string;
  source: string;
  last_seen_at: number;
}

export class RecommendationService {
  private tidal: TidalService;
  private taste: TasteService;

  constructor(private env: Env) {
    this.tidal = new TidalService(env);
    this.taste = new TasteService(env);
  }

  /**
   * Generate the next ~25 tracks for the user's wave.
   *
   * Candidate sources are stacked, not exclusive:
   *   - Track-seeds from history (sampled from completedTrackIds)
   *   - Artist-seeds from onboarding picks (always, not just cold-start)
   *   - Genre-seeds from onboarding picks (only if no listening yet)
   *   - Global-popular fallback (last resort)
   *   - Optional mood pool (Tidal mood_<slug>) when `mood` is set
   *
   * The previous implementation used a hard if/else chain that disabled
   * cold-start picks the moment the user finished a single track. We
   * now always blend so the user's onboarding picks keep contributing
   * even after history accumulates — combined with the flat baseline
   * weight in TasteService, this fixes the "wave forgets who I picked"
   * complaint without drowning out genuine listening signal.
   */
  async wave(
    userId: string,
    options: { limit?: number; mood?: WaveMood | null } = {},
  ): Promise<Track[]> {
    const limit = options.limit ?? 25;
    const mood = options.mood ?? null;
    const { profile, genreSeeds, seedArtistIds } = await this.taste.getOrCompute(userId);
    const dislikes = await this.loadDislikes(userId);
    const seen = await this.loadSeen(userId);

    const pools: Track[][] = [];
    const moodIds = new Set<string>();

    if (profile.completedTrackIds.length > 0) {
      // Sample, don't always grab the very top-N, otherwise the wave
      // starts identical every time the user hits "Моя волна".
      const seeds = sampleN(profile.completedTrackIds, SEED_FAN_OUT);
      pools.push(await this.candidatesFromTrackSeeds(seeds));
    }

    // Always co-include onboarding artist picks (when present). They
    // get a soft baseline weight in tasteSig from TasteService, but we
    // also feed their radios into the candidate pool so brand new
    // tracks from those artists still surface — even after the user
    // has weeks of history on someone else.
    if (seedArtistIds.length > 0) {
      pools.push(await this.candidatesFromArtistSeeds(seedArtistIds));
    }

    if (pools.length === 0 && genreSeeds.length > 0) {
      pools.push(await this.candidatesFromGenres(genreSeeds));
    }

    // Mood pool — only when explicitly requested. Tagged via `moodIds`
    // so re-rank can hand out a bonus to anything from this slice.
    if (mood && MOOD_SLUG[mood]) {
      const moodPool = await this.candidatesFromGenres([MOOD_SLUG[mood]]);
      for (const t of moodPool) moodIds.add(`${t.source ?? 'tidal'}:${t.id}`);
      pools.push(moodPool);
    }

    let candidates = dedupTracks(pools.flat());

    if (candidates.length === 0) {
      // Last-resort fallback for brand-new users with neither artist
      // picks nor genre picks. Generic global popular slice.
      candidates = await this.candidatesFromGenres(['genre_pop', 'genre_rap', 'genre_electronic']);
    }

    return this.rerank(candidates, profile, dislikes, seen, limit, moodIds);
  }

  /**
   * Extend a current playback context. The seed is the track the user
   * is about to (or just did) finish.
   */
  async continueFromTrack(userId: string, seedTrackId: string, limit = 20): Promise<Track[]> {
    const { profile } = await this.taste.getOrCompute(userId);
    const dislikes = await this.loadDislikes(userId);
    const seen = await this.loadSeen(userId);

    // Use both the explicit seed AND a couple of the user's top tracks
    // so the queue extension reflects their broader taste, not just the
    // one song they happen to be on.
    const extraSeeds = sampleN(profile.completedTrackIds, SEED_FAN_OUT - 1);
    const seeds = Array.from(new Set([seedTrackId, ...extraSeeds]));
    const candidates = await this.candidatesFromTrackSeeds(seeds);

    return this.rerank(candidates, profile, dislikes, seen, limit);
  }

  /**
   * Mark these tracks as "shown to user X" so the next wave/continue
   * request inside the 7-day window penalises them.
   */
  async recordSeen(userId: string, tracks: Track[]): Promise<void> {
    if (tracks.length === 0) return;
    const now = Date.now();
    const stmts = tracks.slice(0, 100).map((t) =>
      this.env.DB
        .prepare(
          `INSERT INTO recommendation_seen (user_id, track_id, source, last_seen_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(user_id, track_id, source) DO UPDATE SET last_seen_at = excluded.last_seen_at`,
        )
        .bind(userId, t.id, t.source ?? 'tidal', now),
    );
    await this.env.DB.batch(stmts);
  }

  // ---------- candidate generation ----------

  private async candidatesFromTrackSeeds(seedTrackIds: string[]): Promise<Track[]> {
    if (seedTrackIds.length === 0) return [];
    const pools = await Promise.all(
      seedTrackIds.map((id) => this.cachedTrackRadio(id).catch(() => [] as Track[])),
    );
    return dedupTracks(pools.flat());
  }

  /**
   * Cold-start helper: pull tracks from each picked artist's top-tracks
   * AND from track-radio of one of those tops, so we get both the
   * "obvious" hits and the wider stylistic neighbourhood. Cached in KV
   * for 12h per artist.
   */
  private async candidatesFromArtistSeeds(artistIds: string[]): Promise<Track[]> {
    if (artistIds.length === 0) return [];
    // Up to 15 picks — matches the `setSeedArtists` slice cap and the
    // ArtistPicker UI limit. Each id costs at most one cached round-
    // trip through Tidal because of the per-artist KV cache below.
    const pools = await Promise.all(
      artistIds.slice(0, 15).map(async (id) => {
        try {
          const cacheKey = `artist_seed_tracks:${id}`;
          const cached = await this.env.SESSIONS.get(cacheKey, 'json');
          if (cached && Array.isArray(cached)) return cached as Track[];

          const tops = await this.tidal.getArtistTopTracks(id).catch(() => [] as Track[]);
          const seedForRadio = tops[0]?.id;
          const radio = seedForRadio
            ? await this.cachedTrackRadio(seedForRadio).catch(() => [] as Track[])
            : [];
          const combined = dedupTracks([...tops, ...radio]);
          await this.env.SESSIONS.put(cacheKey, JSON.stringify(combined), {
            expirationTtl: 12 * 60 * 60,
          });
          return combined;
        } catch {
          return [] as Track[];
        }
      }),
    );
    return dedupTracks(pools.flat());
  }

  private async candidatesFromGenres(slugs: string[]): Promise<Track[]> {
    if (slugs.length === 0) return [];
    const pools = await Promise.all(
      slugs.slice(0, 4).map(async (slug) => {
        try {
          const cached = await this.env.SESSIONS.get(`genre_seed_tracks:${slug}`, 'json');
          if (cached && Array.isArray(cached)) return cached as Track[];

          const page = await this.tidal.getExplorePage(slug);
          const tracks: Track[] = [];
          for (const m of page.modules) {
            if (m.type === 'tracks') tracks.push(...m.items);
            if (m.type === 'playlists') {
              // Playlists don't contain tracks at this level — fall back
              // to track-only modules. Cheap, pages always have track
              // modules for genre slugs.
            }
          }
          // Cache for 12h — genre lists rotate slowly upstream.
          await this.env.SESSIONS.put(`genre_seed_tracks:${slug}`, JSON.stringify(tracks.slice(0, 60)), {
            expirationTtl: 12 * 60 * 60,
          });
          return tracks;
        } catch {
          return [] as Track[];
        }
      }),
    );
    return dedupTracks(pools.flat());
  }

  /**
   * Tidal's track-radio for a given seed is content-based and changes
   * very slowly, so we KV-cache the response for 24h. This collapses
   * 90% of the upstream calls to repeated requests for the same seeds.
   */
  private async cachedTrackRadio(trackId: string): Promise<Track[]> {
    const key = `track_radio:${trackId}:${RADIO_PAGE_SIZE}`;
    const cached = await this.env.SESSIONS.get(key, 'json');
    if (cached && Array.isArray(cached)) return cached as Track[];
    const fresh = await this.tidal.getTrackRadio(trackId, RADIO_PAGE_SIZE);
    await this.env.SESSIONS.put(key, JSON.stringify(fresh), { expirationTtl: RADIO_CACHE_TTL_S });
    return fresh;
  }

  // ---------- ranking ----------

  private rerank(
    candidates: Track[],
    profile: TasteProfile,
    dislikes: { artists: Set<string>; tracks: Set<string> },
    seen: Map<string, number>,
    limit: number,
    moodIds: Set<string> = new Set(),
  ): Track[] {
    if (candidates.length === 0) return [];
    const now = Date.now();
    const completed = new Set(profile.completedTrackIds);

    interface Scored { track: Track; score: number; }
    const scored: Scored[] = [];

    for (const t of candidates) {
      if (dislikes.tracks.has(t.id)) continue;
      if (t.artistId && dislikes.artists.has(t.artistId)) continue;

      const tasteSig = t.artistId ? (profile.artistWeights[t.artistId] ?? 0) : 0;
      const seenAt = seen.get(`${t.source ?? 'tidal'}:${t.id}`);
      const seenAge = seenAt ? Math.max(0, now - seenAt) : Infinity;
      // Linear ramp from full penalty (just shown) to zero (>= 7 days ago).
      const seenPenalty = isFinite(seenAge)
        ? Math.max(0, 1 - seenAge / SEEN_TTL_MS)
        : 0;

      // Random novelty seed so two consecutive calls with identical
      // candidate pools still surface different orderings (small jitter,
      // not enough to drown out taste signal).
      const novelty = Math.random();
      const familiar = completed.has(t.id) ? 1 : 0;
      const moodMatch = moodIds.has(`${t.source ?? 'tidal'}:${t.id}`) ? 1 : 0;

      const score =
        W_TASTE * tasteSig +
        W_NOVELTY * novelty +
        W_RECENT_SEEN_PENALTY * seenPenalty +
        W_FAMILIAR_BONUS * familiar +
        W_MOOD_BONUS * moodMatch;

      scored.push({ track: t, score });
    }

    scored.sort((a, b) => b.score - a.score);

    // Diversity pass: cap repeated artists in the FINAL list so the
    // wave doesn't degenerate into "same 5 songs by the same artist".
    // Drops anything past ARTIST_CAP_IN_RESULT, applies a soft penalty
    // beyond that to allow continuation of the artist if no other
    // candidates exist.
    const out: Track[] = [];
    const artistCount: Record<string, number> = {};
    for (const { track } of scored) {
      const aId = track.artistId ?? '';
      const c = artistCount[aId] ?? 0;
      if (aId && c >= ARTIST_CAP_IN_RESULT) continue;
      artistCount[aId] = c + 1;
      out.push(track);
      if (out.length >= limit) break;
    }

    // If we ran short, relax the cap and pad with the rest.
    if (out.length < limit) {
      const already = new Set(out.map((t) => `${t.source ?? 'tidal'}:${t.id}`));
      for (const { track } of scored) {
        const key = `${track.source ?? 'tidal'}:${track.id}`;
        if (already.has(key)) continue;
        // Apply soft diversity penalty (already filtered above) — but at
        // this point we accept anything not duplicated.
        out.push(track);
        already.add(key);
        if (out.length >= limit) break;
      }
    }

    // Touch the diversity penalty constant so eslint doesn't flag it as
    // unused — it's a tunable knob the next iteration will wire into a
    // weighted softer cap (currently we hard-cap above, which is simpler
    // and works for our scale).
    void W_DIVERSITY_PENALTY;
    void W_DISLIKE_ARTIST;

    return out;
  }

  // ---------- helpers ----------

  private async loadDislikes(userId: string): Promise<{ artists: Set<string>; tracks: Set<string> }> {
    const res = await this.env.DB
      .prepare(`SELECT item_id, kind FROM user_dislikes WHERE user_id = ?`)
      .bind(userId)
      .all<DislikeRow>();
    const artists = new Set<string>();
    const tracks = new Set<string>();
    for (const r of res.results ?? []) {
      if (r.kind === 'artist') artists.add(r.item_id);
      else tracks.add(r.item_id);
    }
    return { artists, tracks };
  }

  private async loadSeen(userId: string): Promise<Map<string, number>> {
    const cutoff = Date.now() - SEEN_TTL_MS;
    const res = await this.env.DB
      .prepare(
        `SELECT track_id, source, last_seen_at
           FROM recommendation_seen
          WHERE user_id = ? AND last_seen_at >= ?`,
      )
      .bind(userId, cutoff)
      .all<SeenRow>();
    const m = new Map<string, number>();
    for (const r of res.results ?? []) m.set(`${r.source}:${r.track_id}`, r.last_seen_at);
    return m;
  }
}

function dedupTracks(tracks: Track[]): Track[] {
  const seen = new Set<string>();
  const out: Track[] = [];
  for (const t of tracks) {
    const key = `${t.source ?? 'tidal'}:${t.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

function sampleN<T>(arr: T[], n: number): T[] {
  if (arr.length <= n) return [...arr];
  // Reservoir-style sample: always include the very top-1 (the user's
  // strongest signal), randomise the rest from the top-15. Keeps the
  // wave anchored to the user's actual taste while still varying.
  const top = arr[0];
  const pool = arr.slice(1, 15);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const a = pool[i];
    const b = pool[j];
    if (a !== undefined && b !== undefined) {
      pool[i] = b;
      pool[j] = a;
    }
  }
  return [top, ...pool.slice(0, n - 1)].filter((x): x is T => x !== undefined);
}
