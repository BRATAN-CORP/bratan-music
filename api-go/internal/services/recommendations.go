package services

import (
	"context"
	"encoding/json"
	"errors"
	"math/rand"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/bratan-corp/bratan-music/api-go/internal/app"
	"github.com/bratan-corp/bratan-music/api-go/internal/tidal"
)

// RecommendationService is the Go port of
// worker/src/services/RecommendationService.ts.
//
// Scope of this first pass — what's identical to the TS, and what's
// deferred. Endpoint contracts are 1:1 with the worker; the *ranking*
// is intentionally a leaner version of the TS rerank so the Go cut
// can ship without a full taste-vector regression test pass:
//
//   * Candidate generation: track-radio (sampled from
//     completedTrackIDs ∪ likedTrackIDs), artist top-tracks
//     (onboarding seedArtists), genre-explore pages (onboarding
//     genreSeeds), mood pool (when requested). Same fan-out
//     constants as the TS version.
//
//   * Caching: Track-radio + artist-top-tracks + genre-pool results
//     are KV-cached in Redis under the same key prefixes the worker
//     used in CF KV (e.g. `track_radio:<id>:50`). This lets a Go and
//     a TS deploy share the same Redis instance during the cutover
//     without warming an empty cache on either side.
//
//   * Filters (parity): explicit track-id dislike, artist-id dislike
//     (both single-artist and multi-artist tracks), the user's
//     `recommendation_seen` table within the 7-day window.
//
//   * Rerank: simplified vs TS — keeps tasteSig (artist weight),
//     novelty jitter, seen-penalty, familiar bonus, mood-pool
//     bonus, genre-provenance bonus. The TS-specific
//     language-script penalty + character bias multipliers are
//     deferred to a follow-up commit; they require a regression
//     test pass against real listening data, which I'll do after
//     daily-playlists / admin / cron land.
//
// All deferred behaviours degrade gracefully — they only ever
// SUBTRACT score on a candidate, so omitting them just means the
// wave is a bit "wider" than the TS version, not broken.

const (
	recSeedFanOut          = 8
	recRadioPageSize       = 50
	recRadioCacheTTL       = 7 * 24 * time.Hour
	recArtistSeedCacheTTL  = 7 * 24 * time.Hour
	recGenrePoolCacheTTL   = 24 * time.Hour
	recSeenWindowMS        = int64(7 * 24 * 60 * 60 * 1000)
	recArtistCapInResult   = 3
)

const (
	wTaste            = 0.85
	wNovelty          = 0.10
	wRecentSeen       = -0.50
	wFamiliarBonus    = 0.10
	wGenreMatch       = 0.20
	wMoodBonus        = 0.30
	familiarBias      = 2.0
	discoverBias      = -1.5
)

// WaveMoods + WaveCharacters mirror the TS exports — kept exported
// so the route layer can validate query params with the exact same
// vocabulary.
var (
	WaveMoods      = []string{"chill", "workout", "focus", "party", "throwback"}
	WaveCharacters = []string{"familiar", "discover", "popular"}
)

var moodSlug = map[string]string{
	"chill":     "mood_chill",
	"workout":   "mood_workout",
	"focus":     "mood_focus",
	"party":     "mood_party",
	"throwback": "mood_throwback",
}

const popularExploreSlug = "top_popular"

// RecommendationService bundles wave / continueFromTrack / recordSeen.
type RecommendationService struct {
	app   *app.App
	tidal *TidalService
	taste *TasteService
}

// NewRecommendationService wires up its peer services from app.
func NewRecommendationService(a *app.App) *RecommendationService {
	return &RecommendationService{
		app:   a,
		tidal: NewTidalService(a),
		taste: NewTasteService(a),
	}
}

// WaveOptions controls a single wave call.
type WaveOptions struct {
	Limit     int
	Mood      string // empty for none
	Character string // empty for none
}

// Wave generates ~limit fresh tracks for the user. Mirrors
// `RecommendationService.wave(userId, options)`.
func (s *RecommendationService) Wave(ctx context.Context, userID string, opt WaveOptions) ([]tidal.Track, error) {
	if opt.Limit <= 0 {
		opt.Limit = 25
	}
	snap, err := s.taste.GetOrCompute(ctx, userID)
	if err != nil {
		return nil, err
	}
	dislikes, err := s.LoadDislikes(ctx, userID)
	if err != nil {
		return nil, err
	}
	seen, err := s.loadSeen(ctx, userID)
	if err != nil {
		return nil, err
	}

	var pools [][]tidal.Track
	moodIDs := map[string]bool{}
	genreProvenance := map[string]string{}

	// Track + liked seeds → track-radio.
	allSeeds := uniqueStrings(append(append([]string{}, snap.Profile.LikedTrackIDs...), snap.Profile.CompletedTrackIDs...))
	if len(allSeeds) > 0 {
		seeds := sampleN(allSeeds, recSeedFanOut)
		pools = append(pools, s.candidatesFromTrackSeeds(ctx, seeds))
	}

	// Artist seeds — top tracks + radio of the first top track.
	if len(snap.SeedArtistIDs) > 0 {
		pools = append(pools, s.candidatesFromArtistSeeds(ctx, snap.SeedArtistIDs))
	}

	// Genre seeds — explore page TRACK_LIST modules.
	if len(snap.GenreSeeds) > 0 {
		pool := s.candidatesFromGenres(ctx, snap.GenreSeeds)
		if len(snap.GenreSeeds) > 0 {
			tagSlug := snap.GenreSeeds[0]
			for _, t := range pool {
				genreProvenance[trackKey(t)] = tagSlug
			}
		}
		pools = append(pools, pool)
	}

	// Mood pool (when explicitly requested).
	if slug, ok := moodSlug[opt.Mood]; ok {
		pool := s.candidatesFromGenres(ctx, []string{slug})
		for _, t := range pool {
			moodIDs[trackKey(t)] = true
			genreProvenance[trackKey(t)] = slug
		}
		pools = append(pools, pool)
	}

	// Popular character — same shape as mood pool, different slug.
	if opt.Character == "popular" {
		pool := s.candidatesFromGenres(ctx, []string{popularExploreSlug})
		for _, t := range pool {
			moodIDs[trackKey(t)] = true
			genreProvenance[trackKey(t)] = popularExploreSlug
		}
		pools = append(pools, pool)
	}

	// Flatten + dedupe.
	candidates := dedupTracks(flatten(pools))

	// Last-resort fallback for fully cold users.
	if len(candidates) == 0 {
		fallback := snap.GenreSeeds
		if len(fallback) == 0 {
			fallback = []string{"genre_pop", "genre_rap"}
		}
		candidates = s.candidatesFromGenres(ctx, fallback)
	}

	return s.rerank(candidates, snap.Profile, dislikes, seen, opt.Limit, moodIDs, opt.Character, genreProvenance), nil
}

// ContinueFromTrack extends a playback queue. Mirrors the TS
// `continueFromTrack`.
func (s *RecommendationService) ContinueFromTrack(ctx context.Context, userID, seedTrackID string, limit int) ([]tidal.Track, error) {
	if limit <= 0 {
		limit = 20
	}
	snap, err := s.taste.GetOrCompute(ctx, userID)
	if err != nil {
		return nil, err
	}
	dislikes, err := s.LoadDislikes(ctx, userID)
	if err != nil {
		return nil, err
	}
	seen, err := s.loadSeen(ctx, userID)
	if err != nil {
		return nil, err
	}
	extras := sampleN(snap.Profile.CompletedTrackIDs, recSeedFanOut-1)
	seeds := uniqueStrings(append([]string{seedTrackID}, extras...))
	cands := s.candidatesFromTrackSeeds(ctx, seeds)
	return s.rerank(cands, snap.Profile, dislikes, seen, limit, nil, "", nil), nil
}

// RecordSeen upserts a row per track into recommendation_seen — same
// 7-day suppression window the TS uses.
func (s *RecommendationService) RecordSeen(ctx context.Context, userID string, tracks []tidal.Track) error {
	if len(tracks) == 0 {
		return nil
	}
	if len(tracks) > 100 {
		tracks = tracks[:100]
	}
	now := time.Now().UnixMilli()
	batch := &pgx.Batch{}
	for _, t := range tracks {
		src := t.Source
		if src == "" {
			src = "tidal"
		}
		batch.Queue(
			`INSERT INTO recommendation_seen (user_id, track_id, source, last_seen_at)
			 VALUES ($1,$2,$3,$4)
			 ON CONFLICT (user_id, track_id, source) DO UPDATE SET last_seen_at = EXCLUDED.last_seen_at`,
			userID, t.ID, src, now,
		)
	}
	br := s.app.DB.SendBatch(ctx, batch)
	defer br.Close()
	for i := 0; i < batch.Len(); i++ {
		if _, err := br.Exec(); err != nil {
			return err
		}
	}
	return nil
}

// ---- Candidate sources ----

func (s *RecommendationService) candidatesFromTrackSeeds(ctx context.Context, seedIDs []string) []tidal.Track {
	if len(seedIDs) == 0 {
		return nil
	}
	out := make([]tidal.Track, 0, len(seedIDs)*recRadioPageSize/2)
	for _, id := range seedIDs {
		pool, _ := s.cachedTrackRadio(ctx, id)
		out = append(out, pool...)
	}
	return dedupTracks(out)
}

func (s *RecommendationService) candidatesFromArtistSeeds(ctx context.Context, artistIDs []string) []tidal.Track {
	if len(artistIDs) == 0 {
		return nil
	}
	if len(artistIDs) > 15 {
		artistIDs = artistIDs[:15]
	}
	out := make([]tidal.Track, 0, 256)
	for _, id := range artistIDs {
		key := "artist_seed_tracks:" + id
		if cached, ok := s.cacheGet(ctx, key); ok {
			out = append(out, cached...)
			continue
		}
		tops, err := s.tidal.API.GetArtistTopTracks(ctx, id, 20)
		if err != nil {
			continue
		}
		topTracks := make([]tidal.Track, 0, len(tops.Items))
		for i := range tops.Items {
			topTracks = append(topTracks, tidal.MapTrack(&tops.Items[i]))
		}
		var radio []tidal.Track
		if len(topTracks) > 0 {
			radio, _ = s.cachedTrackRadio(ctx, topTracks[0].ID)
		}
		combined := dedupTracks(append(topTracks, radio...))
		s.cachePut(ctx, key, combined, recArtistSeedCacheTTL)
		out = append(out, combined...)
	}
	return dedupTracks(out)
}

func (s *RecommendationService) candidatesFromGenres(ctx context.Context, slugs []string) []tidal.Track {
	if len(slugs) == 0 {
		return nil
	}
	if len(slugs) > 4 {
		slugs = slugs[:4]
	}
	out := make([]tidal.Track, 0, len(slugs)*40)
	for _, slug := range slugs {
		key := "genre_pool:" + slug
		if cached, ok := s.cacheGet(ctx, key); ok {
			out = append(out, cached...)
			continue
		}
		page, err := s.tidal.API.GetPage(ctx, slug)
		if err != nil {
			continue
		}
		var pool []tidal.Track
		for _, row := range page.Rows {
			for i := range row.Modules {
				m := row.Modules[i]
				if m.Type != "TRACK_LIST" || m.PagedList == nil {
					continue
				}
				for _, raw := range m.PagedList.Items {
					t, err := tidal.UnwrapItem[tidal.TrackRaw](raw)
					if err != nil || t == nil {
						continue
					}
					pool = append(pool, tidal.MapTrack(t))
				}
			}
		}
		s.cachePut(ctx, key, pool, recGenrePoolCacheTTL)
		out = append(out, pool...)
	}
	return dedupTracks(out)
}

func (s *RecommendationService) cachedTrackRadio(ctx context.Context, trackID string) ([]tidal.Track, error) {
	key := "track_radio:" + trackID + ":50"
	if cached, ok := s.cacheGet(ctx, key); ok {
		return cached, nil
	}
	raw, err := s.tidal.API.GetTrackRadio(ctx, trackID, recRadioPageSize)
	if err != nil {
		return nil, err
	}
	out := make([]tidal.Track, 0, len(raw.Items))
	for i := range raw.Items {
		out = append(out, tidal.MapTrack(&raw.Items[i]))
	}
	s.cachePut(ctx, key, out, recRadioCacheTTL)
	return out, nil
}

// cacheGet/cachePut are the Redis-backed equivalent of the TS
// `env.SESSIONS.get/put`. Failures (Redis down, deserialise error)
// silently fall through to a cache miss — same semantics the worker
// has with the CF KV API.
func (s *RecommendationService) cacheGet(ctx context.Context, key string) ([]tidal.Track, bool) {
	if s.app.Redis == nil {
		return nil, false
	}
	raw, ok, err := s.app.Redis.KVGet(ctx, key)
	if err != nil || !ok || raw == "" {
		return nil, false
	}
	var out []tidal.Track
	if err := json.Unmarshal([]byte(raw), &out); err != nil {
		return nil, false
	}
	return out, true
}

func (s *RecommendationService) cachePut(ctx context.Context, key string, v []tidal.Track, ttl time.Duration) {
	if s.app.Redis == nil {
		return
	}
	js, err := json.Marshal(v)
	if err != nil {
		return
	}
	_ = s.app.Redis.KVSet(ctx, key, string(js), ttl)
}

// ---- Rerank ----

func (s *RecommendationService) rerank(
	candidates []tidal.Track,
	profile TasteProfile,
	dislikes DislikeSet,
	seen map[string]int64,
	limit int,
	moodIDs map[string]bool,
	character string,
	genreProvenance map[string]string,
) []tidal.Track {
	if len(candidates) == 0 {
		return nil
	}
	now := time.Now().UnixMilli()
	completed := map[string]bool{}
	for _, id := range profile.CompletedTrackIDs {
		completed[id] = true
	}

	familiarWeight := wFamiliarBonus
	switch character {
	case "familiar":
		familiarWeight = wFamiliarBonus * familiarBias
	case "discover":
		familiarWeight = wFamiliarBonus * discoverBias
	}

	type scored struct {
		track tidal.Track
		score float64
	}
	out := make([]scored, 0, len(candidates))

	for _, t := range candidates {
		if dislikes.Tracks[t.ID] {
			continue
		}
		if t.ArtistID != "" && dislikes.Artists[t.ArtistID] {
			continue
		}
		multiArtistDislike := false
		for _, a := range t.Artists {
			if a.ID != "" && dislikes.Artists[a.ID] {
				multiArtistDislike = true
				break
			}
		}
		if multiArtistDislike {
			continue
		}

		tasteSig := 0.0
		if t.ArtistID != "" {
			tasteSig = profile.ArtistWeights[t.ArtistID]
		}
		key := trackKey(t)
		var seenPenalty float64
		if at, ok := seen[key]; ok {
			age := now - at
			if age < 0 {
				age = 0
			}
			ratio := 1 - float64(age)/float64(recSeenWindowMS)
			if ratio > 0 {
				seenPenalty = ratio
			}
		}
		novelty := rand.Float64()
		familiarFlag := 0.0
		if completed[t.ID] {
			familiarFlag = 1
		}
		moodMatch := 0.0
		if moodIDs[key] {
			moodMatch = 1
		}
		genreSig := 0.0
		if slug, ok := genreProvenance[key]; ok {
			genreSig = profile.GenreWeights[slug]
		}
		score := wTaste*tasteSig +
			wNovelty*novelty +
			wRecentSeen*seenPenalty +
			familiarWeight*familiarFlag +
			wMoodBonus*moodMatch +
			wGenreMatch*genreSig
		out = append(out, scored{track: t, score: score})
	}

	// Sort desc by score (insertion sort — input typically <500).
	for i := 1; i < len(out); i++ {
		for j := i; j > 0 && out[j-1].score < out[j].score; j-- {
			out[j-1], out[j] = out[j], out[j-1]
		}
	}

	// Diversity cap: ≤3 tracks per artist in the first pass.
	final := make([]tidal.Track, 0, limit)
	used := map[string]bool{}
	artistCnt := map[string]int{}
	for _, s := range out {
		key := trackKey(s.track)
		if used[key] {
			continue
		}
		aID := s.track.ArtistID
		if aID != "" && artistCnt[aID] >= recArtistCapInResult {
			continue
		}
		artistCnt[aID]++
		used[key] = true
		final = append(final, s.track)
		if len(final) >= limit {
			break
		}
	}
	// Pad with anything left if cap left us short.
	if len(final) < limit {
		for _, s := range out {
			key := trackKey(s.track)
			if used[key] {
				continue
			}
			used[key] = true
			final = append(final, s.track)
			if len(final) >= limit {
				break
			}
		}
	}
	return final
}

// ---- Helpers ----

// DislikeSet is the per-user dislike index returned by LoadDislikes:
// track IDs the user has hidden, plus artist IDs whose entire output
// they want filtered out. Exported so the daily-playlist /
// ai-playlist services can run a final cross-pool filter pass after
// they've assembled their own candidate set (the wave rerank already
// applies it, but downstream pools — explore pages, taste-seed radio
// backfill — wouldn't otherwise honour the dislike list).
type DislikeSet struct {
	Tracks  map[string]bool
	Artists map[string]bool
}

func (s *RecommendationService) LoadDislikes(ctx context.Context, userID string) (DislikeSet, error) {
	d := DislikeSet{Tracks: map[string]bool{}, Artists: map[string]bool{}}
	rows, err := s.app.DB.Query(ctx,
		`SELECT item_id, kind FROM user_dislikes WHERE user_id = $1`, userID)
	if err != nil {
		return d, err
	}
	defer rows.Close()
	for rows.Next() {
		var id, kind string
		if err := rows.Scan(&id, &kind); err != nil {
			return d, err
		}
		if kind == "artist" {
			d.Artists[id] = true
		} else {
			d.Tracks[id] = true
		}
	}
	return d, rows.Err()
}

func (s *RecommendationService) loadSeen(ctx context.Context, userID string) (map[string]int64, error) {
	cutoff := time.Now().UnixMilli() - recSeenWindowMS
	rows, err := s.app.DB.Query(ctx,
		`SELECT track_id, source, last_seen_at FROM recommendation_seen
		   WHERE user_id = $1 AND last_seen_at >= $2`, userID, cutoff)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]int64{}
	for rows.Next() {
		var (
			id, src string
			at      int64
		)
		if err := rows.Scan(&id, &src, &at); err != nil {
			return nil, err
		}
		if src == "" {
			src = "tidal"
		}
		out[src+":"+id] = at
	}
	return out, rows.Err()
}

func trackKey(t tidal.Track) string {
	src := t.Source
	if src == "" {
		src = "tidal"
	}
	return src + ":" + t.ID
}

func dedupTracks(in []tidal.Track) []tidal.Track {
	out := make([]tidal.Track, 0, len(in))
	seen := map[string]bool{}
	for _, t := range in {
		k := trackKey(t)
		if seen[k] {
			continue
		}
		seen[k] = true
		out = append(out, t)
	}
	return out
}

func uniqueStrings(in []string) []string {
	out := make([]string, 0, len(in))
	seen := map[string]bool{}
	for _, s := range in {
		if s == "" || seen[s] {
			continue
		}
		seen[s] = true
		out = append(out, s)
	}
	return out
}

func flatten(pools [][]tidal.Track) []tidal.Track {
	n := 0
	for _, p := range pools {
		n += len(p)
	}
	out := make([]tidal.Track, 0, n)
	for _, p := range pools {
		out = append(out, p...)
	}
	return out
}

// sampleN mirrors the TS sampleN: keep the top-1 (strongest signal),
// random-shuffle the next 14 entries and return n. Falls back to
// returning the full list when it's shorter than n.
func sampleN(arr []string, n int) []string {
	if len(arr) <= n {
		out := make([]string, len(arr))
		copy(out, arr)
		return out
	}
	top := arr[0]
	pool := make([]string, 0, 14)
	end := 15
	if end > len(arr) {
		end = len(arr)
	}
	pool = append(pool, arr[1:end]...)
	rand.Shuffle(len(pool), func(i, j int) { pool[i], pool[j] = pool[j], pool[i] })
	out := append([]string{top}, pool...)
	if len(out) > n {
		out = out[:n]
	}
	return out
}

// ErrInvalid is a sentinel for callers that want to surface 400s
// from validation failures inside the service layer.
var ErrInvalid = errors.New("invalid argument")

// GCStale removes recommendation_seen rows older than 30 days. Called
// by the cron orchestrator.
func (s *RecommendationService) GCStale(ctx context.Context) {
	cutoff := time.Now().UnixMilli() - 30*24*60*60*1000
	if _, err := s.app.DB.Exec(ctx,
		`DELETE FROM recommendation_seen WHERE last_seen_at < $1`, cutoff,
	); err != nil {
		s.app.Logger.Error("recs gc stale", "err", err)
	}
}

// ---- Exports used by DailyPlaylist / AI services -------------------------
//
// These thin shims expose internal helpers under stable, exported
// names so peer services in the same package don't have to reach
// into unexported state. They're intentionally not adding behaviour
// — just renaming for callers outside the wave/continue surface.

// CandidatesFromGenres returns the deduped TRACK_LIST pool for one or
// more explore page slugs (genre_*, mood_*, top_popular). Falls back
// to the underlying Tidal page when the Redis pool cache is cold.
// Exported so DailyPlaylistService can fill the "Под настроение"
// variant + run its multi-phase genre backfill without re-pluming
// the cache layer.
func (s *RecommendationService) CandidatesFromGenres(ctx context.Context, slugs []string) []tidal.Track {
	return s.candidatesFromGenres(ctx, slugs)
}

// CachedTrackRadio returns the seeded track-radio pool, Redis-cached
// under the same key prefix the worker uses. Exported so the daily-
// playlist taste-seed radio backfill can fan out across the user's
// strongest liked / completed seeds.
func (s *RecommendationService) CachedTrackRadio(ctx context.Context, trackID string) ([]tidal.Track, error) {
	return s.cachedTrackRadio(ctx, trackID)
}

// TrackKey is the canonical "<source>:<id>" key used by every cross-
// pool dedup / claim set inside this package. Exported so peer
// services (DailyPlaylistService cross-variant claiming, AI playlist
// dedup) stay aligned with the rerank's notion of identity.
func TrackKey(t tidal.Track) string { return trackKey(t) }

// MergeUnique returns the union of two pools, deduped by TrackKey
// and capped at `cap`. Mirrors the TS mergeUnique helper used by the
// daily-playlist backfill phases.
func MergeUnique(a, b []tidal.Track, cap int) []tidal.Track {
	if cap <= 0 {
		return nil
	}
	out := make([]tidal.Track, 0, cap)
	seen := map[string]bool{}
	for _, src := range [][]tidal.Track{a, b} {
		for _, t := range src {
			k := TrackKey(t)
			if seen[k] {
				continue
			}
			seen[k] = true
			out = append(out, t)
			if len(out) >= cap {
				return out
			}
		}
	}
	return out
}

// FilterByDislikes drops any track that matches the user's dislike
// set (track id, primary artist id, or any credited artist id).
// Exported so the daily-playlist backfill phases can apply the
// final filter after pulling tracks from sources that don't already
// honour the dislike list (genre explore pages, raw taste-seed
// radio fan-out).
func FilterByDislikes(in []tidal.Track, d DislikeSet) []tidal.Track {
	out := in[:0:0]
	for _, t := range in {
		if d.Tracks[t.ID] {
			continue
		}
		if t.ArtistID != "" && d.Artists[t.ArtistID] {
			continue
		}
		drop := false
		for _, a := range t.Artists {
			if a.ID != "" && d.Artists[a.ID] {
				drop = true
				break
			}
		}
		if drop {
			continue
		}
		out = append(out, t)
	}
	return out
}
