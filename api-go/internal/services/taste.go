package services

import (
	"context"
	"encoding/json"
	"errors"
	"math"
	"strings"
	"time"
	"unicode"

	"github.com/jackc/pgx/v5"

	"github.com/bratan-corp/bratan-music/api-go/internal/app"
)

// TasteService is the Go port of worker/src/services/TasteService.ts.
//
// First-pass scope (parity goals):
//
//   * Onboarding storage:  setGenreSeeds, setSeedArtists.
//   * GetOrCompute:        returns the user's taste profile, rebuilding
//                          from play_history when missing or stale (≥24h).
//   * Profile shape:       matches the TS TasteProfile (v3) so the
//                          downstream RecommendationService can read
//                          the exact same JSON the worker wrote without
//                          a migration.
//
// What's intentionally simpler than the TS version, and why:
//
//   * Genre weights are derived only from onboarding `genre_seeds` (one
//     flat 1.0 per slug). The TS version also pulled implicit genre
//     signal from the seed artists' Tidal pages; that round-tripped
//     through the Tidal API and was the slowest part of the nightly
//     taste rebuild. We can layer it back in once recommendation parity
//     is verified — the downstream rerank already handles a missing
//     `genreWeights` map gracefully (it treats it as zero).
//
//   * Script mix is computed from `play_history.artist_name` exactly
//     like the worker does (cyrillic / latin / cjk / other, decay-
//     weighted) since the rerank gate depends on it.
//
//   * Liked-track signal is computed by reading the user's
//     `is_liked` playlist via `playlist_tracks` (same schema the
//     library/playlist endpoints already write to).
//
// Profile JSON column reuse: we read/write the same `profile` JSON
// shape the worker used so a deploy can hot-swap without a data
// migration step.

const (
	tasteHalfLifeMS         = int64(30 * 24 * 60 * 60 * 1000) // 30 days
	tasteCompletedWeight    = 1.0
	tastePartialWeight      = 0.4
	tasteLikedWeight        = 1.5
	tasteSeedArtistWeight   = 0.6
	tasteRecomputeStaleMS   = int64(24 * 60 * 60 * 1000) // 24 hours
	tasteVersion            = 3
	tasteCompletedCap       = 50
	tasteLikedCap           = 100
)

// ScriptMix mirrors worker ScriptMix; sums to ~1.0 when any history.
type ScriptMix struct {
	Cyrillic float64 `json:"cyrillic"`
	Latin    float64 `json:"latin"`
	CJK      float64 `json:"cjk"`
	Other    float64 `json:"other"`
}

// TasteProfile mirrors worker TasteProfile (version 3).
type TasteProfile struct {
	ArtistWeights     map[string]float64 `json:"artistWeights"`
	CompletedTrackIDs []string           `json:"completedTrackIds"`
	LikedTrackIDs     []string           `json:"likedTrackIds"`
	TotalPlays        int                `json:"totalPlays"`
	ScriptMix         ScriptMix          `json:"scriptMix"`
	GenreWeights      map[string]float64 `json:"genreWeights"`
	Version           int                `json:"version"`
}

// TasteSnapshot is the cached row returned by GetOrCompute.
type TasteSnapshot struct {
	Profile        TasteProfile
	GenreSeeds     []string
	SeedArtistIDs  []string
}

// TasteService bundles read/write of user_taste_profile + onboarding
// state mutations.
type TasteService struct {
	app *app.App
}

// NewTasteService builds a TasteService bound to an app container.
func NewTasteService(a *app.App) *TasteService {
	return &TasteService{app: a}
}

// SetGenreSeeds clamps the slug list to 8 + writes it to the row.
func (s *TasteService) SetGenreSeeds(ctx context.Context, userID string, slugs []string) error {
	out := make([]string, 0, len(slugs))
	for _, sl := range slugs {
		sl = strings.TrimSpace(sl)
		if sl == "" {
			continue
		}
		out = append(out, sl)
		if len(out) >= 8 {
			break
		}
	}
	js, _ := json.Marshal(out)
	now := time.Now().UnixMilli()
	_, err := s.app.DB.Exec(ctx,
		`INSERT INTO user_taste_profile
		   (user_id, profile, genre_seeds, computed_at, updated_at, seed_artist_ids)
		   VALUES ($1, '{}', $2, 0, $3, '[]')
		 ON CONFLICT (user_id) DO UPDATE
		   SET genre_seeds = EXCLUDED.genre_seeds, updated_at = EXCLUDED.updated_at`,
		userID, string(js), now,
	)
	return err
}

// SetSeedArtists clamps the id list to 12 + writes it.
func (s *TasteService) SetSeedArtists(ctx context.Context, userID string, ids []string) error {
	out := make([]string, 0, len(ids))
	seen := map[string]bool{}
	for _, id := range ids {
		id = strings.TrimSpace(id)
		if id == "" || seen[id] {
			continue
		}
		seen[id] = true
		out = append(out, id)
		if len(out) >= 12 {
			break
		}
	}
	js, _ := json.Marshal(out)
	now := time.Now().UnixMilli()
	_, err := s.app.DB.Exec(ctx,
		`INSERT INTO user_taste_profile
		   (user_id, profile, genre_seeds, computed_at, updated_at, seed_artist_ids)
		   VALUES ($1, '{}', '[]', 0, $2, $3)
		 ON CONFLICT (user_id) DO UPDATE
		   SET seed_artist_ids = EXCLUDED.seed_artist_ids, updated_at = EXCLUDED.updated_at`,
		userID, now, string(js),
	)
	return err
}

// GetOrCompute returns the cached profile or rebuilds it from
// play_history + onboarding seeds when the snapshot is missing or
// older than tasteRecomputeStaleMS.
func (s *TasteService) GetOrCompute(ctx context.Context, userID string) (TasteSnapshot, error) {
	var (
		profileJSON   string
		seedsJSON     string
		seedArtsJSON  string
		computedAt    int64
	)
	err := s.app.DB.QueryRow(ctx,
		`SELECT profile, genre_seeds, seed_artist_ids, computed_at
		   FROM user_taste_profile WHERE user_id = $1`,
		userID,
	).Scan(&profileJSON, &seedsJSON, &seedArtsJSON, &computedAt)
	fresh := false
	var snap TasteSnapshot
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return snap, err
	}
	if err == nil {
		_ = json.Unmarshal([]byte(seedsJSON), &snap.GenreSeeds)
		_ = json.Unmarshal([]byte(seedArtsJSON), &snap.SeedArtistIDs)
		if profileJSON != "" && profileJSON != "{}" {
			_ = json.Unmarshal([]byte(profileJSON), &snap.Profile)
			ageMS := time.Now().UnixMilli() - computedAt
			if snap.Profile.Version == tasteVersion && ageMS < tasteRecomputeStaleMS {
				fresh = true
			}
		}
	}
	if fresh {
		return snap, nil
	}
	prof, err := s.computeProfile(ctx, userID, snap.SeedArtistIDs, snap.GenreSeeds)
	if err != nil {
		return snap, err
	}
	snap.Profile = prof
	js, _ := json.Marshal(prof)
	now := time.Now().UnixMilli()
	_, _ = s.app.DB.Exec(ctx,
		`INSERT INTO user_taste_profile
		   (user_id, profile, genre_seeds, computed_at, updated_at, seed_artist_ids)
		   VALUES ($1, $2, $3, $4, $4, $5)
		 ON CONFLICT (user_id) DO UPDATE
		   SET profile = EXCLUDED.profile,
		       computed_at = EXCLUDED.computed_at,
		       updated_at  = EXCLUDED.updated_at`,
		userID, string(js),
		mustJSON(snap.GenreSeeds),
		now,
		mustJSON(snap.SeedArtistIDs),
	)
	return snap, nil
}

// Recompute forces a fresh taste profile rebuild for one user,
// bypassing the 24h freshness window GetOrCompute observes. Used by
// the cron and the admin "force-refresh" endpoint so manual
// regenerations always start from the freshest play_history snapshot.
func (s *TasteService) Recompute(ctx context.Context, userID string) error {
	// Pull current seeds so the recompute carries them through. A
	// missing user_taste_profile row is fine — recompute then runs
	// against empty seed sets, same as cold-start.
	var (
		seedsJSON    string
		seedArtsJSON string
	)
	err := s.app.DB.QueryRow(ctx,
		`SELECT genre_seeds, seed_artist_ids FROM user_taste_profile WHERE user_id = $1`,
		userID,
	).Scan(&seedsJSON, &seedArtsJSON)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	var (
		genreSeeds   []string
		seedArtists  []string
	)
	_ = json.Unmarshal([]byte(seedsJSON), &genreSeeds)
	_ = json.Unmarshal([]byte(seedArtsJSON), &seedArtists)

	prof, err := s.computeProfile(ctx, userID, seedArtists, genreSeeds)
	if err != nil {
		return err
	}
	js, _ := json.Marshal(prof)
	now := time.Now().UnixMilli()
	_, err = s.app.DB.Exec(ctx,
		`INSERT INTO user_taste_profile
		   (user_id, profile, genre_seeds, computed_at, updated_at, seed_artist_ids)
		   VALUES ($1, $2, $3, $4, $4, $5)
		 ON CONFLICT (user_id) DO UPDATE
		   SET profile = EXCLUDED.profile,
		       computed_at = EXCLUDED.computed_at,
		       updated_at  = EXCLUDED.updated_at`,
		userID, string(js),
		mustJSON(genreSeeds),
		now,
		mustJSON(seedArtists),
	)
	return err
}

// computeProfile is the worker's TasteService.compute() ported with
// the simplifications documented at the top of this file.
func (s *TasteService) computeProfile(
	ctx context.Context, userID string,
	seedArtists, genreSeeds []string,
) (TasteProfile, error) {
	now := time.Now().UnixMilli()
	prof := TasteProfile{
		ArtistWeights:     map[string]float64{},
		CompletedTrackIDs: []string{},
		LikedTrackIDs:     []string{},
		ScriptMix:         ScriptMix{},
		GenreWeights:      map[string]float64{},
		Version:           tasteVersion,
	}

	// 1. play_history -> artistWeights + completedTrackIDs + scriptMix.
	rows, err := s.app.DB.Query(ctx,
		`SELECT track_id, artist_id, artist_name, completed, played_at
		   FROM play_history WHERE user_id = $1 ORDER BY played_at DESC LIMIT 5000`,
		userID)
	if err != nil {
		return prof, err
	}
	defer rows.Close()
	completedMap := map[string]*completedAgg{}
	var scriptTotal float64
	for rows.Next() {
		var (
			trackID    string
			artistID   *string
			artistName string
			completedI int
			playedAt   int64
		)
		if err := rows.Scan(&trackID, &artistID, &artistName, &completedI, &playedAt); err != nil {
			return prof, err
		}
		prof.TotalPlays++
		ageMS := now - playedAt
		if ageMS < 0 {
			ageMS = 0
		}
		decay := math.Pow(0.5, float64(ageMS)/float64(tasteHalfLifeMS))
		completed := completedI != 0
		wRow := tastePartialWeight
		if completed {
			wRow = tasteCompletedWeight
		}
		w := wRow * decay

		if artistID != nil && *artistID != "" {
			prof.ArtistWeights[*artistID] += w
		}
		if completed {
			ag, ok := completedMap[trackID]
			if !ok {
				ag = &completedAgg{}
				completedMap[trackID] = ag
			}
			ag.score += decay
			if playedAt > ag.latest {
				ag.latest = playedAt
			}
		}
		if artistName != "" {
			addScript(&prof.ScriptMix, artistName, w)
			scriptTotal += w
		}
	}
	if err := rows.Err(); err != nil {
		return prof, err
	}

	// 2. Liked tracks: the user's `is_liked` playlist tracks. The
	//    artist credit comes from the snapshot column the playlist
	//    write path captured.
	likedRows, err := s.app.DB.Query(ctx,
		`SELECT pt.track_id, pt.snapshot
		   FROM playlists p
		   JOIN playlist_tracks pt ON pt.playlist_id = p.id
		   WHERE p.user_id = $1 AND p.is_liked = 1
		   ORDER BY pt.position ASC
		   LIMIT $2`,
		userID, tasteLikedCap)
	if err == nil {
		defer likedRows.Close()
		for likedRows.Next() {
			var (
				trackID  string
				snapshot *string
			)
			if err := likedRows.Scan(&trackID, &snapshot); err != nil {
				continue
			}
			prof.LikedTrackIDs = append(prof.LikedTrackIDs, trackID)
			// Decode artistId from snapshot if present.
			if snapshot != nil && *snapshot != "" {
				var snap struct {
					ArtistID string `json:"artistId"`
					Artist   string `json:"artist"`
				}
				if json.Unmarshal([]byte(*snapshot), &snap) == nil {
					if snap.ArtistID != "" {
						prof.ArtistWeights[snap.ArtistID] += tasteLikedWeight
					}
					if snap.Artist != "" {
						addScript(&prof.ScriptMix, snap.Artist, tasteLikedWeight)
						scriptTotal += tasteLikedWeight
					}
				}
			}
		}
	}

	// 3. Seed artists — flat baseline weight per pick.
	for _, id := range seedArtists {
		prof.ArtistWeights[id] += tasteSeedArtistWeight
	}

	// 4. Genre seeds -> flat genre weights (1.0 each, normalised below).
	for _, slug := range genreSeeds {
		prof.GenreWeights[slug] += 1.0
	}

	// Normalise artist weights to [0,1].
	if max := mapMax(prof.ArtistWeights); max > 0 {
		for k, v := range prof.ArtistWeights {
			prof.ArtistWeights[k] = v / max
		}
	}
	// Normalise genre weights to [0,1].
	if max := mapMax(prof.GenreWeights); max > 0 {
		for k, v := range prof.GenreWeights {
			prof.GenreWeights[k] = v / max
		}
	}
	// Normalise scriptMix to sum=1 (or zero if no history).
	if scriptTotal > 0 {
		prof.ScriptMix.Cyrillic /= scriptTotal
		prof.ScriptMix.Latin /= scriptTotal
		prof.ScriptMix.CJK /= scriptTotal
		prof.ScriptMix.Other /= scriptTotal
	}

	// Sort completed track ids by aggregated score desc (then recency).
	prof.CompletedTrackIDs = sortCompleted(completedMap, tasteCompletedCap)
	return prof, nil
}

// addScript classifies a string and adds the weighted contribution
// to the matching ScriptMix bucket. Matches the worker's detectScript
// rules (cyrillic / latin / CJK / other).
func addScript(m *ScriptMix, s string, w float64) {
	if w <= 0 || s == "" {
		return
	}
	// Pick the dominant script of the first ~32 letter runes.
	var cy, la, cj, ot int
	count := 0
	for _, r := range s {
		if !unicode.IsLetter(r) {
			continue
		}
		count++
		switch {
		case unicode.Is(unicode.Cyrillic, r):
			cy++
		case unicode.Is(unicode.Latin, r):
			la++
		case unicode.Is(unicode.Han, r) || unicode.Is(unicode.Hiragana, r) ||
			unicode.Is(unicode.Katakana, r) || unicode.Is(unicode.Hangul, r):
			cj++
		default:
			ot++
		}
		if count >= 32 {
			break
		}
	}
	if count == 0 {
		return
	}
	switch maxOf4(cy, la, cj, ot) {
	case 1:
		m.Cyrillic += w
	case 2:
		m.Latin += w
	case 3:
		m.CJK += w
	default:
		m.Other += w
	}
}

func maxOf4(a, b, c, d int) int {
	max := a
	idx := 1
	if b > max {
		max = b
		idx = 2
	}
	if c > max {
		max = c
		idx = 3
	}
	if d > max {
		idx = 4
	}
	return idx
}

// DetectScript exposes the worker's `detectScript` helper for
// downstream callers (the rec rerank uses it on candidate artist
// names).
func DetectScript(s string) string {
	mix := ScriptMix{}
	addScript(&mix, s, 1)
	if mix.Cyrillic > 0 {
		return "cyrillic"
	}
	if mix.Latin > 0 {
		return "latin"
	}
	if mix.CJK > 0 {
		return "cjk"
	}
	return "other"
}

// scriptShare returns the normalized share (0..1) of a given script
// bucket within a ScriptMix. Used by the rec rerank's language penalty.
func scriptShare(m ScriptMix, script string) float64 {
	switch script {
	case "cyrillic":
		return m.Cyrillic
	case "latin":
		return m.Latin
	case "cjk":
		return m.CJK
	default:
		return m.Other
	}
}

func mapMax(m map[string]float64) float64 {
	max := 0.0
	for _, v := range m {
		if v > max {
			max = v
		}
	}
	return max
}

// sortCompleted returns the top-N track ids ordered by aggregated
// recency-weighted score, breaking ties on `latest`.
func sortCompleted(m map[string]*completedAgg, n int) []string {
	type entry struct {
		id  string
		ag  *completedAgg
	}
	list := make([]entry, 0, len(m))
	for id, ag := range m {
		list = append(list, entry{id, ag})
	}
	// Simple insertion-sort-on-copy by score desc, recency desc — fine
	// for n up to a few thousand and avoids importing sort.Slice
	// just to inline a closure.
	for i := 1; i < len(list); i++ {
		for j := i; j > 0; j-- {
			a, b := list[j-1], list[j]
			if a.ag.score < b.ag.score || (a.ag.score == b.ag.score && a.ag.latest < b.ag.latest) {
				list[j-1], list[j] = b, a
				continue
			}
			break
		}
	}
	if n > len(list) {
		n = len(list)
	}
	out := make([]string, n)
	for i := 0; i < n; i++ {
		out[i] = list[i].id
	}
	return out
}

// completedAgg is module-level so sortCompleted can take it by pointer.
type completedAgg struct {
	score  float64
	latest int64
}

func mustJSON(v any) string {
	b, _ := json.Marshal(v)
	return string(b)
}

// RecomputeActive recomputes the taste profile for users who played
// at least one track in the past 7 days. Called by the cron
// orchestrator nightly.
func (s *TasteService) RecomputeActive(ctx context.Context) {
	cutoff := time.Now().UnixMilli() - 7*24*60*60*1000
	rows, err := s.app.DB.Query(ctx,
		`SELECT DISTINCT user_id FROM play_history WHERE played_at >= $1 LIMIT 5000`, cutoff)
	if err != nil {
		s.app.Logger.Error("taste recompute query", "err", err)
		return
	}
	defer rows.Close()
	var ids []string
	for rows.Next() {
		var id string
		if rows.Scan(&id) == nil {
			ids = append(ids, id)
		}
	}
	for _, id := range ids {
		if _, err := s.GetOrCompute(ctx, id); err != nil {
			s.app.Logger.Warn("taste recompute user", "user", id, "err", err)
		}
	}
}
