import type { Env } from '../types/env';
import type { Track } from '../types/music';
import { TidalService } from './tidal/TidalService';
import { TasteService, type TasteProfile, detectScript } from './TasteService';
import { CACHE_TTL_S as SEED_CACHE_TTL_S, getCachedGenreTracks } from './seedCache';

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

/** Track-radio seed pools change slowly on Tidal's side and the
 *  Cloudflare Workers KV free tier caps writes at 1000/day for the
 *  whole namespace. Bumping from 24h → 7d cuts the steady-state
 *  write rate per unique seed by 7x, which is what keeps cold-track
 *  spikes (a download burst, the cron, a curious user replaying their
 *  history) from blowing the daily budget. See
 *  `services/seedCache.ts` for the full rationale. */
const RADIO_CACHE_TTL_S = SEED_CACHE_TTL_S;
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
 *  the absolute scale only matters in comparison between candidates.
 *
 *  Tuned 2026-05 after user feedback "Polish rap leaks into wave despite
 *  100% RU/EN listening". The fix was twofold: (1) drown out random
 *  novelty so it can't out-score taste signal for cold artists, by
 *  bumping W_TASTE up and trimming W_NOVELTY; (2) introduce a hard
 *  W_LANG_MISMATCH penalty on the user's underrepresented scripts. */
const W_TASTE = 0.85;
const W_NOVELTY = 0.10;
const W_DISLIKE_ARTIST = -1.0;
const W_RECENT_SEEN_PENALTY = -0.50;
const W_FAMILIAR_BONUS = 0.10;
const W_DIVERSITY_PENALTY = -0.15;
/** Per-genre slug bonus when a candidate's track was pulled from a
 *  Tidal explore page slug that matches one of the user's strong
 *  genres (see `TasteProfile.genreWeights`). Scaled by the genre's
 *  normalised weight so the user's dominant genre gets the full
 *  bonus and weaker matches get a proportional slice. */
const W_GENRE_MATCH = 0.20;
/** Penalty applied when the candidate's artist name is in a script
 *  the user almost never listens to. Built from `TasteProfile.scriptMix`
 *  — we only apply the penalty when the user has enough history that
 *  the distribution is meaningful (`min total signal` gate inside
 *  `rerank`). Polish rap surfaces in latin-script artist names; a
 *  user who listens 95% Cyrillic and 5% Latin gets a -0.40 hit on
 *  every Latin candidate, which is enough to push the cleaner Cyrillic
 *  candidates above them. */
const W_LANG_MISMATCH = -0.40;
/** A user's script counts as "underrepresented" (i.e. eligible for
 *  the W_LANG_MISMATCH penalty) when its share is below this. We pick
 *  10% as the floor because Russian rap fans typically have ~5-10%
 *  English in their listening and we DON'T want to penalise that
 *  long-tail; we only want to nuke the genuine misfires (Polish,
 *  German, French rap leaking through Tidal track-radio for the same
 *  user). */
const LANG_MIN_SHARE = 0.10;
/** Minimum total play signal before we trust `scriptMix` enough to
 *  apply a language penalty. Cold-start users (0 plays) and very-thin
 *  users (a handful) get the neutral treatment so we don't lock them
 *  into one region from an accidental first-play. */
const LANG_MIN_HISTORY_PLAYS = 50;
/** Bonus added to candidates pulled from the requested mood's explore
 *  page. Big enough to bias the top of the wave toward that mood,
 *  small enough that taste signal still wins for the user's strongest
 *  artists. The same constant is reused for the "popular" character —
 *  also a slug pulled from the explore endpoint. */
const W_MOOD_BONUS = 0.30;

/** Multiplier applied to W_FAMILIAR_BONUS when the user picks the
 *  "familiar" character: lean harder into stuff already in the
 *  history. */
const FAMILIAR_BIAS = 2.0;

/** When the user picks "discover" the familiar bonus flips to a
 *  similarly-sized penalty so anything they've heard recently gets
 *  pushed down. We don't go fully `-1` — that would zero out the wave
 *  for users with thin libraries. */
const DISCOVER_BIAS = -1.5;

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

/** "Character" of the wave — high-level dial over the rerank gates.
 *
 *  - `familiar`  — boost W_FAMILIAR_BONUS (more stuff I already know).
 *  - `discover`  — flip W_FAMILIAR_BONUS negative + skip the
 *                  familiarity bias (only fresh stuff).
 *  - `popular`   — pull from a "popular" explore-page slug as an extra
 *                  candidate pool with the same +W_MOOD_BONUS as a
 *                  mood pool. */
export const WAVE_CHARACTERS = ['familiar', 'discover', 'popular'] as const;
export type WaveCharacter = typeof WAVE_CHARACTERS[number];

/** Tidal explore page used when `popular` character is requested.
 *  Kept as a constant so a future repo-wide source switch (e.g.
 *  pointing at a curated D1 row instead of a Tidal slug) is one
 *  edit. */
const POPULAR_EXPLORE_SLUG = 'top_popular';

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
    options: {
      limit?: number;
      mood?: WaveMood | null;
      character?: WaveCharacter | null;
    } = {},
  ): Promise<Track[]> {
    const limit = options.limit ?? 25;
    const mood = options.mood ?? null;
    const character = options.character ?? null;
    const { profile, genreSeeds, seedArtistIds } = await this.taste.getOrCompute(userId);
    const dislikes = await this.loadDislikes(userId);
    const seen = await this.loadSeen(userId);

    const pools: Track[][] = [];
    const moodIds = new Set<string>();
    // Provenance map: which Tidal explore-page slug introduced a
    // candidate. Used by rerank to award `W_GENRE_MATCH` when the
    // slug aligns with the user's `genreWeights`. Track-radio /
    // artist-radio sources don't have a single canonical slug so
    // they're left absent (treated as neutral by rerank).
    const genreProvenance = new Map<string, string>();

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

    // Always co-include genre-seed explore pages so the candidate pool
    // reflects the user's declared genre preferences even after history
    // accumulates. The old cold-start-only gate meant users with history
    // never got genre-aligned candidates in the pool, leaving the rerank
    // to work entirely off track-radio serendipity. W_GENRE_MATCH in
    // rerank scores these proportionally to the user's genre affinity.
    if (genreSeeds.length > 0) {
      const genrePool = await this.candidatesFromGenres(genreSeeds);
      const tagSlug = genreSeeds[0];
      if (tagSlug) {
        for (const t of genrePool) genreProvenance.set(trackKey(t), tagSlug);
      }
      pools.push(genrePool);
    }

    // Mood pool — only when explicitly requested. Tagged via `moodIds`
    // so re-rank can hand out a bonus to anything from this slice.
    if (mood && MOOD_SLUG[mood]) {
      const moodPool = await this.candidatesFromGenres([MOOD_SLUG[mood]]);
      for (const t of moodPool) {
        moodIds.add(trackKey(t));
        genreProvenance.set(trackKey(t), MOOD_SLUG[mood]);
      }
      pools.push(moodPool);
    }

    // Popular character pulls from a global popularity slice, tagged
    // with the same +W_MOOD_BONUS so it gets surfaced visibly without
    // overwriting taste-strong matches. We piggy-back on the same
    // `moodIds` set because the rerank semantics ("this candidate is
    // from a curated pool, give it a nudge") are identical.
    if (character === 'popular') {
      const popPool = await this.candidatesFromGenres([POPULAR_EXPLORE_SLUG]);
      for (const t of popPool) {
        moodIds.add(trackKey(t));
        genreProvenance.set(trackKey(t), POPULAR_EXPLORE_SLUG);
      }
      pools.push(popPool);
    }

    let candidates = dedupTracks(pools.flat());

    if (candidates.length === 0) {
      // Last-resort fallback for brand-new users with neither artist
      // picks nor genre picks. Generic global popular slice.
      candidates = await this.candidatesFromGenres(['genre_pop', 'genre_rap', 'genre_electronic']);
    }

    return this.rerank(candidates, profile, dislikes, seen, limit, moodIds, character, genreProvenance);
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
          // 7d TTL: artist top-tracks change rarely on Tidal's side
          // and KV writes are the bottleneck (1000/day free tier cap).
          await this.env.SESSIONS.put(cacheKey, JSON.stringify(combined), {
            expirationTtl: SEED_CACHE_TTL_S,
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
      slugs.slice(0, 4).map((slug) => getCachedGenreTracks(this.env, this.tidal, slug)),
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
    character: WaveCharacter | null = null,
    genreProvenance: Map<string, string> = new Map(),
  ): Track[] {
    if (candidates.length === 0) return [];
    const now = Date.now();
    const completed = new Set(profile.completedTrackIds);

    // Character biases the familiar-bonus weight at scoring time, so
    // we resolve the effective coefficient once per call.
    const familiarWeight =
      character === 'familiar'
        ? W_FAMILIAR_BONUS * FAMILIAR_BIAS
        : character === 'discover'
          ? W_FAMILIAR_BONUS * DISCOVER_BIAS
          : W_FAMILIAR_BONUS;

    // Language penalty pre-flight: only meaningful when there's enough
    // history to trust the distribution. Cold-start / thin-listening
    // users get a no-op penalty.
    const languageActive = profile.totalPlays >= LANG_MIN_HISTORY_PLAYS;
    const scriptMix = profile.scriptMix;

    interface Scored { track: Track; score: number; }
    const scored: Scored[] = [];

    for (const t of candidates) {
      if (dislikes.tracks.has(t.id)) continue;
      if (t.artistId && dislikes.artists.has(t.artistId)) continue;

      const tasteSig = t.artistId ? (profile.artistWeights[t.artistId] ?? 0) : 0;
      const key = trackKey(t);
      const seenAt = seen.get(key);
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
      const moodMatch = moodIds.has(key) ? 1 : 0;

      // Genre match: candidate gets bonus proportional to how strong
      // the user's affinity for the slug that introduced it is. Tracks
      // without provenance (track-radio, artist-radio) get 0 here
      // — they fall back to relying on tasteSig.
      const slug = genreProvenance.get(key);
      const genreSig = slug ? (profile.genreWeights[slug] ?? 0) : 0;

      // Language mismatch: penalise candidates whose artist name is in
      // a script the user demonstrably doesn't listen to. The penalty
      // is gated to userIds with non-trivial history
      // (`LANG_MIN_HISTORY_PLAYS`) so cold-start users aren't locked
      // into one region. The penalty also scales with how dominant the
      // user's preferred scripts are — someone who's truly 50/50
      // RU/EN won't get aggressive penalties on either side.
      let languagePenalty = 0;
      if (languageActive) {
        const candidateScript = detectScript(t.artist ?? '');
        const candidateShare = scriptMix[candidateScript];
        if (candidateShare < LANG_MIN_SHARE) {
          // Scale the penalty by how dominant the OTHER scripts are.
          // If user is 70% cyrillic / 25% latin / 5% other, a candidate
          // in `other` gets penalised at full -0.40. If user is more
          // diffuse (say 40% / 35% / 25%), the penalty softens because
          // the deficit (0.25 — a quarter of the user's listening)
          // suggests they DO listen to that region occasionally.
          const deficit = LANG_MIN_SHARE - candidateShare;
          languagePenalty = W_LANG_MISMATCH * (deficit / LANG_MIN_SHARE);
        }
      }

      const score =
        W_TASTE * tasteSig +
        W_NOVELTY * novelty +
        W_RECENT_SEEN_PENALTY * seenPenalty +
        familiarWeight * familiar +
        W_MOOD_BONUS * moodMatch +
        W_GENRE_MATCH * genreSig +
        languagePenalty;

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
      const already = new Set(out.map(trackKey));
      for (const { track } of scored) {
        const k = trackKey(track);
        if (already.has(k)) continue;
        // Apply soft diversity penalty (already filtered above) — but at
        // this point we accept anything not duplicated.
        out.push(track);
        already.add(k);
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

/**
 * Canonical cross-table key for a track. Mirrors the helper in
 * `DailyPlaylistService` (they should ALWAYS produce the same key for
 * the same track or anti-overlap logic across services breaks). Pulled
 * out here so the wave / rerank / seen-map / mood-set / genre-
 * provenance code paths all share one source of truth instead of
 * the inline template literals they had before.
 */
function trackKey(t: Track): string {
  return `${t.source ?? 'tidal'}:${t.id}`;
}

function dedupTracks(tracks: Track[]): Track[] {
  const seen = new Set<string>();
  const out: Track[] = [];
  for (const t of tracks) {
    const key = trackKey(t);
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
