package services

import (
	"context"
	"encoding/json"
	"errors"
	"math/rand"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/bratan-corp/bratan-music/api-go/internal/app"
	"github.com/bratan-corp/bratan-music/api-go/internal/tidal"
)

// DailyPlaylistService is the Go port of
// worker/src/services/DailyPlaylistService.ts.
//
// Three nightly-regenerated playlists per active user:
//
//   • familiar — "Знакомое":  taste-aligned wave biased to known
//     favourites; padded with liked-seed track-radio when the wave
//     pool is thin.
//   • discover — "Открытия":  wave with the discover character +
//     known-track filter; padded with unknown liked-seed radio,
//     then user genre seeds.
//   • mood     — "Под настроение":  pulls from a mood explore page
//     picked from the user's last-30-days play quadrant, falling
//     back to wall-clock hour for cold-start users. Backfilled by
//     other mood slugs → mood-tinted wave → liked-radio → user
//     genre seeds.
//
// Variants are built in canonical order with a cross-variant
// "claimed" set so familiar/discover/mood don't ship the same track —
// the same fix that landed in the TS service after the "playlist 1
// and 3 are the same" report.
//
// JSON shapes / column names / cache keys are the same as the TS
// implementation so a Go and a TS deploy can read each other's rows
// during cutover without a migration. The variant order, the
// PLAYLIST_LENGTH cap, the 4-phase backfill and the 7-day GC window
// are all 1:1 ports.

const (
	dailyPlaylistLength      = 50
	dailyBackfillRadioSeeds  = 8
	dailyGCDays              = 7
	dailyMoodHistoryWindowMS = int64(30 * 24 * 60 * 60 * 1000)
	dailyMoodMinPlays        = 20
	dailyMoodPeakShare       = 0.4
)

var dailyVariants = []string{"familiar", "discover", "mood"}

type dailyVariantSpec struct {
	variant         string
	name            string
	description     string
	fallbackGenres  []string
}

var dailyVariantSpecs = map[string]dailyVariantSpec{
	"familiar": {
		variant:        "familiar",
		name:           "Знакомое",
		description:    "Любимые артисты и близкие к ним новинки",
		fallbackGenres: []string{"genre_pop", "genre_rap"},
	},
	"discover": {
		variant:        "discover",
		name:           "Открытия",
		description:    "То, что ты ещё не слушал, но точно зайдёт",
		fallbackGenres: []string{"genre_indie", "genre_electronic"},
	},
	"mood": {
		variant:        "mood",
		name:           "Под настроение",
		description:    "Подобрано под твой обычный вайб",
		fallbackGenres: []string{"mood_chill", "mood_focus"},
	},
}

// Final-phase global genre sweep — the worker uses the same flat list.
var dailyAllGenres = []string{
	"genre_pop", "genre_rap", "genre_rnb", "genre_rock",
	"genre_indie", "genre_electronic", "genre_latin",
	"genre_kpop", "genre_metal", "genre_jazz",
	"mood_chill", "mood_workout", "mood_focus",
	"mood_party", "mood_throwback",
}

var dailyAllMoodSlugs = []string{
	"mood_chill", "mood_workout", "mood_focus", "mood_party", "mood_throwback",
}

// DailyPlaylist is the externally-visible per-day playlist row.
// JSON tags mirror the TS DailyPlaylist shape so the frontend
// (src/lib/recommendations.ts → DailyPlaylist) round-trips cleanly.
type DailyPlaylist struct {
	ID                 string        `json:"id"`
	Variant            string        `json:"variant"`
	Name               string        `json:"name"`
	Description        string        `json:"description"`
	CoverURL           string        `json:"coverUrl,omitempty"`
	Tracks             []tidal.Track `json:"tracks"`
	GeneratedAt        int64         `json:"generatedAt"`
	SavedToPlaylistID  string        `json:"savedToPlaylistId,omitempty"`
}

// DailyPlaylistService bundles getToday / regenerate / gc + the
// admin-side single-user reset entry point. Built on top of the
// existing RecommendationService + TasteService + TidalService — no
// new caches, no parallel HTTP client.
type DailyPlaylistService struct {
	app   *app.App
	rec   *RecommendationService
	taste *TasteService
	tidal *TidalService
}

// NewDailyPlaylistService wires up its peer services from app. The
// services-on-app pattern (vs constructing each peer inline) is
// already used by RecommendationService and keeps the cron + handler
// layers off the explicit-construction hot path.
func NewDailyPlaylistService(a *app.App) *DailyPlaylistService {
	return &DailyPlaylistService{
		app:   a,
		rec:   NewRecommendationService(a),
		taste: NewTasteService(a),
		tidal: NewTidalService(a),
	}
}

// ---- public API ---------------------------------------------------------

// GetToday returns the three daily playlists for today, lazily
// generating any variants that are missing (first-day users, post-
// dislike resets, brand-new sign-ups before the cron tick).
func (s *DailyPlaylistService) GetToday(ctx context.Context, userID string) ([]DailyPlaylist, error) {
	today := isoDate(time.Now().UnixMilli())
	existing, err := s.fetchByDate(ctx, userID, today)
	if err != nil {
		return nil, err
	}
	got := map[string]bool{}
	for _, p := range existing {
		got[p.Variant] = true
	}
	missing := make([]string, 0, len(dailyVariants))
	for _, v := range dailyVariants {
		if !got[v] {
			missing = append(missing, v)
		}
	}
	if len(missing) == 0 {
		return existing, nil
	}
	generated, err := s.generateVariants(ctx, userID, missing)
	if err != nil {
		return nil, err
	}
	out := append(existing, generated...)
	sortByVariantOrder(out)
	return out, nil
}

// Regenerate rebuilds all three variants for the user. Cron entry
// point + admin force-refresh both delegate here. Returns the freshly-
// written rows.
func (s *DailyPlaylistService) Regenerate(ctx context.Context, userID string) ([]DailyPlaylist, error) {
	out, err := s.generateVariants(ctx, userID, append([]string(nil), dailyVariants...))
	if err != nil {
		return nil, err
	}
	sortByVariantOrder(out)
	return out, nil
}

// SaveToLibrary promotes a daily-playlist row into the user's
// permanent library. Copies tracks into a regular playlists row +
// playlist_tracks rows and records the link back on the daily-
// playlist row so the home page can render a persistent "Сохранено"
// badge across reloads.
//
// Returns the new playlists.id + the human-readable name (the worker
// appends a "#N от <today>" suffix so a user can save multiple
// variants on the same day without colliding).
func (s *DailyPlaylistService) SaveToLibrary(ctx context.Context, userID, dailyID string) (string, string, error) {
	var (
		variant     string
		name        string
		description string
		coverURL    *string
		tracksJSON  string
	)
	err := s.app.DB.QueryRow(ctx,
		`SELECT variant, name, description, cover_url, tracks
		   FROM daily_playlists
		  WHERE id = $1 AND user_id = $2`,
		dailyID, userID,
	).Scan(&variant, &name, &description, &coverURL, &tracksJSON)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", "", ErrInvalid
	}
	if err != nil {
		return "", "", err
	}
	_ = variant
	_ = description

	tracks := parseDailyTracks(tracksJSON)

	today := isoDate(time.Now().UnixMilli())
	playlistID := uuid.NewString()
	now := time.Now().UnixMilli()

	// Append a "#N от <date>" suffix so a user saving multiple days'
	// worth doesn't collide on the (very common) "Плейлист дня" names.
	var seq int
	if err := s.app.DB.QueryRow(ctx,
		`SELECT COUNT(*) FROM playlists WHERE user_id = $1 AND name LIKE $2`,
		userID, name+" #%",
	).Scan(&seq); err != nil {
		return "", "", err
	}
	seq++
	finalName := name + " #" + itoa(seq) + " от " + today

	tx, err := s.app.DB.Begin(ctx)
	if err != nil {
		return "", "", err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var coverArg interface{}
	if coverURL != nil {
		coverArg = *coverURL
	}
	if _, err := tx.Exec(ctx,
		`INSERT INTO playlists (id, user_id, name, is_liked, cover_url, created_at, updated_at)
		 VALUES ($1, $2, $3, 0, $4, $5, $5)`,
		playlistID, userID, finalName, coverArg, now,
	); err != nil {
		return "", "", err
	}

	if _, err := tx.Exec(ctx,
		`UPDATE daily_playlists SET saved_to_playlist_id = $1 WHERE id = $2 AND user_id = $3`,
		playlistID, dailyID, userID,
	); err != nil {
		return "", "", err
	}

	for i, t := range tracks {
		snapshot, _ := json.Marshal(map[string]any{
			"title":         t.Title,
			"artist":        t.Artist,
			"artistId":      t.ArtistID,
			"artists":       t.Artists,
			"album":         t.Album,
			"coverUrl":      t.CoverURL,
			"coverVideoUrl": t.CoverVideoURL,
			"duration":      t.Duration,
		})
		src := t.Source
		if src == "" {
			src = "tidal"
		}
		if _, err := tx.Exec(ctx,
			`INSERT INTO playlist_tracks (playlist_id, track_id, source, position, added_at, snapshot)
			 VALUES ($1, $2, $3, $4, $5, $6)
			 ON CONFLICT (playlist_id, track_id) DO NOTHING`,
			playlistID, t.ID, src, i, now, string(snapshot),
		); err != nil {
			return "", "", err
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return "", "", err
	}
	return playlistID, finalName, nil
}

// GC drops daily-playlists older than 7 days (anything the user
// never promoted into their library — the saved_to_playlist_id link
// doesn't carry it over). Called by the cron orchestrator.
func (s *DailyPlaylistService) GC(ctx context.Context) error {
	cutoff := isoDate(time.Now().UnixMilli() - int64(dailyGCDays)*24*60*60*1000)
	_, err := s.app.DB.Exec(ctx, `DELETE FROM daily_playlists WHERE date < $1`, cutoff)
	return err
}

// RegenerateForActive walks the same active-user set the worker's
// cron picks (14-day play-history window + seed-only users who
// haven't listened yet). Best-effort: per-user errors are logged
// and the loop carries on.
func (s *DailyPlaylistService) RegenerateForActive(ctx context.Context) {
	cutoff := time.Now().UnixMilli() - 14*24*60*60*1000

	active, err := s.activeUserIDs(ctx, cutoff)
	if err != nil {
		s.app.Logger.Error("daily.RegenerateForActive active query", "err", err)
		return
	}
	seedOnly, err := s.seedOnlyUserIDs(ctx, cutoff)
	if err != nil {
		s.app.Logger.Error("daily.RegenerateForActive seed query", "err", err)
		return
	}
	all := uniqueStrings(append(active, seedOnly...))

	for _, uid := range all {
		if _, err := s.Regenerate(ctx, uid); err != nil {
			s.app.Logger.Error("daily.RegenerateForActive user", "user", uid, "err", err)
		}
	}
	if err := s.GC(ctx); err != nil {
		s.app.Logger.Error("daily.GC", "err", err)
	}
}

// ResetForActive is the admin force-refresh entry point. Returns the
// (processed, errors, total) counters the admin handler reports back.
// Recomputes taste + regenerates daily for every active+seed user,
// same set as the cron picks.
func (s *DailyPlaylistService) ResetForActive(ctx context.Context) (processed, errCnt, total int) {
	cutoff := time.Now().UnixMilli() - 14*24*60*60*1000
	active, err := s.activeUserIDs(ctx, cutoff)
	if err != nil {
		s.app.Logger.Error("daily.ResetForActive active", "err", err)
		return 0, 0, 0
	}
	seedOnly, err := s.seedOnlyUserIDs(ctx, cutoff)
	if err != nil {
		s.app.Logger.Error("daily.ResetForActive seed", "err", err)
		return 0, 0, 0
	}
	all := uniqueStrings(append(active, seedOnly...))
	for _, uid := range all {
		if err := s.taste.Recompute(ctx, uid); err != nil {
			s.app.Logger.Error("daily.ResetForActive recompute", "user", uid, "err", err)
			errCnt++
			continue
		}
		if _, err := s.Regenerate(ctx, uid); err != nil {
			s.app.Logger.Error("daily.ResetForActive regenerate", "user", uid, "err", err)
			errCnt++
			continue
		}
		processed++
	}
	return processed, errCnt, len(all)
}

// ResetForUser is the admin single-user variant: recomputes taste +
// regenerates daily for the given user only. Returns the freshly-
// written variants for the handler to summarise.
func (s *DailyPlaylistService) ResetForUser(ctx context.Context, userID string) ([]DailyPlaylist, error) {
	if err := s.taste.Recompute(ctx, userID); err != nil {
		return nil, err
	}
	return s.Regenerate(ctx, userID)
}

// ---- generation ---------------------------------------------------------

func (s *DailyPlaylistService) generateVariants(ctx context.Context, userID string, variants []string) ([]DailyPlaylist, error) {
	snap, err := s.taste.GetOrCompute(ctx, userID)
	if err != nil {
		return nil, err
	}
	dislikes, err := s.rec.LoadDislikes(ctx, userID)
	if err != nil {
		return nil, err
	}

	today := isoDate(time.Now().UnixMilli())
	claimed := map[string]bool{}
	out := make([]DailyPlaylist, 0, len(variants))

	// Sort the input list into the canonical variant order so the
	// claim semantics stay deterministic regardless of which subset
	// the caller asked for (cron passes all three; lazy on-read can
	// pass a subset).
	ordered := variantsInOrder(variants)

	for _, variant := range ordered {
		spec, ok := dailyVariantSpecs[variant]
		if !ok {
			continue
		}
		built := s.buildVariantTracks(ctx, variant, userID, snap, claimed, dislikes)
		// buildVariantTracks already applies dislike + claim filtering
		// internally so its padding loops see the real deficit. This
		// belt-and-braces pass catches any edge-case leaks.
		tracks := filterCleanTracks(built, dislikes, claimed)

		// Multi-phase backfill — see TS DailyPlaylistService for the
		// reasoning behind each phase. The phases run in increasing
		// breadth until we hit dailyPlaylistLength.
		if len(tracks) < dailyPlaylistLength {
			tracks = s.backfillPhase1Genres(ctx, tracks, snap.GenreSeeds, spec.fallbackGenres, claimed, dislikes)
		}
		if len(tracks) < dailyPlaylistLength {
			tracks = s.backfillPhase2BroadWave(ctx, tracks, userID, claimed, dislikes)
		}
		if len(tracks) < dailyPlaylistLength {
			tracks = s.backfillPhase3TasteRadio(ctx, tracks, snap.Profile.LikedTrackIDs, snap.Profile.CompletedTrackIDs, snap.GenreSeeds, claimed, dislikes)
		}
		if len(tracks) < dailyPlaylistLength {
			tracks = s.backfillPhase4AllGenres(ctx, tracks, snap.GenreSeeds, spec.fallbackGenres, claimed, dislikes)
		}

		if len(tracks) > dailyPlaylistLength {
			tracks = tracks[:dailyPlaylistLength]
		}
		if len(tracks) == 0 {
			continue
		}

		// Claim every track shipped in this variant so the next
		// variant in `ordered` can't ship the same id again. Has to
		// run AFTER the slice/cap so partial-playlist fallbacks
		// don't pre-claim tracks they ended up not using.
		for _, t := range tracks {
			claimed[TrackKey(t)] = true
		}

		cover := pickDailyCover(tracks)
		id := uuid.NewString()
		generatedAt := time.Now().UnixMilli()

		serialised, err := json.Marshal(tracks)
		if err != nil {
			return nil, err
		}
		var coverArg interface{}
		if cover != "" {
			coverArg = cover
		}
		if _, err := s.app.DB.Exec(ctx,
			`INSERT INTO daily_playlists
			   (id, user_id, date, variant, name, description, cover_url, tracks, generated_at)
			 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
			 ON CONFLICT (user_id, date, variant) DO UPDATE SET
			   id = excluded.id,
			   name = excluded.name,
			   description = excluded.description,
			   cover_url = excluded.cover_url,
			   tracks = excluded.tracks,
			   generated_at = excluded.generated_at`,
			id, userID, today, variant, spec.name, spec.description, coverArg, string(serialised), generatedAt,
		); err != nil {
			return nil, err
		}

		out = append(out, DailyPlaylist{
			ID:          id,
			Variant:     variant,
			Name:        spec.name,
			Description: spec.description,
			CoverURL:    cover,
			Tracks:      tracks,
			GeneratedAt: generatedAt,
		})
	}

	sortByVariantOrder(out)
	return out, nil
}

// buildVariantTracks returns the initial (pre-backfill) candidate pool
// for a single variant. Each variant calls into wave with its own
// character/mood so the underlying rerank produces distinct results,
// and isClean drops tracks already claimed by a higher-priority
// variant + tracks the user has disliked.
func (s *DailyPlaylistService) buildVariantTracks(
	ctx context.Context,
	variant, userID string,
	snap TasteSnapshot,
	claimed map[string]bool,
	dislikes DislikeSet,
) []tidal.Track {
	hasHistory := len(snap.Profile.CompletedTrackIDs) > 0
	isClean := func(t tidal.Track) bool {
		if claimed[TrackKey(t)] || dislikes.Tracks[t.ID] {
			return false
		}
		if t.ArtistID != "" && dislikes.Artists[t.ArtistID] {
			return false
		}
		for _, a := range t.Artists {
			if a.ID != "" && dislikes.Artists[a.ID] {
				return false
			}
		}
		return true
	}

	switch variant {
	case "familiar":
		wave, _ := s.rec.Wave(ctx, userID, WaveOptions{
			Limit:     dailyPlaylistLength * 4,
			Character: "familiar",
		})
		clean := filterFn(wave, isClean)
		if len(clean) >= dailyPlaylistLength {
			return clean[:dailyPlaylistLength]
		}
		// Pad from liked + completed-track radio.
		padSeeds := uniqueStrings(append(append([]string{}, snap.Profile.LikedTrackIDs...), snap.Profile.CompletedTrackIDs...))
		padPool := s.radioFromSeeds(ctx, padSeeds, 15)
		return MergeUnique(clean, filterFn(padPool, isClean), dailyPlaylistLength)

	case "discover":
		wave, _ := s.rec.Wave(ctx, userID, WaveOptions{
			Limit:     dailyPlaylistLength * 6,
			Character: "discover",
		})
		clean := filterFn(wave, isClean)
		known := map[string]bool{}
		for _, id := range snap.Profile.CompletedTrackIDs {
			known[id] = true
		}
		unknown := make([]tidal.Track, 0, len(clean))
		for _, t := range clean {
			if !known[t.ID] {
				unknown = append(unknown, t)
			}
		}
		if len(unknown) >= dailyPlaylistLength {
			return unknown[:dailyPlaylistLength]
		}
		likedRadio := s.radioFromSeeds(ctx, snap.Profile.LikedTrackIDs, 10)
		likedClean := make([]tidal.Track, 0, len(likedRadio))
		for _, t := range likedRadio {
			if !known[t.ID] && isClean(t) {
				likedClean = append(likedClean, t)
			}
		}
		padded := MergeUnique(unknown, likedClean, dailyPlaylistLength)
		if len(padded) >= dailyPlaylistLength {
			return padded
		}
		tried := map[string]bool{}
		for _, slug := range snap.GenreSeeds {
			if len(padded) >= dailyPlaylistLength {
				break
			}
			if tried[slug] {
				continue
			}
			tried[slug] = true
			filler := s.rec.CandidatesFromGenres(ctx, []string{slug})
			fillerClean := make([]tidal.Track, 0, len(filler))
			for _, t := range filler {
				if !known[t.ID] && isClean(t) {
					fillerClean = append(fillerClean, t)
				}
			}
			padded = MergeUnique(padded, fillerClean, dailyPlaylistLength)
		}
		return padded

	default: // "mood"
		moodSlug := s.pickPersonalMoodSlug(ctx, userID, hasHistory)
		mood := filterFn(s.rec.CandidatesFromGenres(ctx, []string{moodSlug}), isClean)
		if len(mood) < dailyPlaylistLength {
			tried := map[string]bool{moodSlug: true}
			for _, slug := range dailyAllMoodSlugs {
				if len(mood) >= dailyPlaylistLength {
					break
				}
				if tried[slug] {
					continue
				}
				tried[slug] = true
				extra := filterFn(s.rec.CandidatesFromGenres(ctx, []string{slug}), isClean)
				mood = MergeUnique(mood, extra, dailyPlaylistLength)
			}
		}
		if len(mood) >= dailyPlaylistLength {
			return mood[:dailyPlaylistLength]
		}
		// Mood-tinted wave.
		moodEnum := moodSlugToWaveMood(moodSlug)
		filler, _ := s.rec.Wave(ctx, userID, WaveOptions{
			Limit: dailyPlaylistLength * 8,
			Mood:  moodEnum,
		})
		mood = MergeUnique(mood, filterFn(filler, isClean), dailyPlaylistLength)
		if len(mood) >= dailyPlaylistLength {
			return mood
		}
		// Liked-radio backfill.
		likedRadio := s.radioFromSeeds(ctx, snap.Profile.LikedTrackIDs, 10)
		mood = MergeUnique(mood, filterFn(likedRadio, isClean), dailyPlaylistLength)
		if len(mood) >= dailyPlaylistLength {
			return mood
		}
		// User's genre seeds as final padding.
		for _, slug := range snap.GenreSeeds {
			if len(mood) >= dailyPlaylistLength {
				break
			}
			extra := filterFn(s.rec.CandidatesFromGenres(ctx, []string{slug}), isClean)
			mood = MergeUnique(mood, extra, dailyPlaylistLength)
		}
		return mood
	}
}

// ---- backfill phases ---------------------------------------------------

func (s *DailyPlaylistService) backfillPhase1Genres(
	ctx context.Context,
	have []tidal.Track,
	userGenres, fallback []string,
	claimed map[string]bool,
	dislikes DislikeSet,
) []tidal.Track {
	tried := map[string]bool{}
	for _, slug := range append(append([]string{}, userGenres...), fallback...) {
		if len(have) >= dailyPlaylistLength {
			break
		}
		if tried[slug] {
			continue
		}
		tried[slug] = true
		filler := FilterByDislikes(s.rec.CandidatesFromGenres(ctx, []string{slug}), dislikes)
		filler = dropClaimed(filler, claimed)
		have = MergeUnique(have, filler, dailyPlaylistLength)
	}
	return have
}

func (s *DailyPlaylistService) backfillPhase2BroadWave(
	ctx context.Context,
	have []tidal.Track,
	userID string,
	claimed map[string]bool,
	dislikes DislikeSet,
) []tidal.Track {
	broad, _ := s.rec.Wave(ctx, userID, WaveOptions{Limit: dailyPlaylistLength * 4})
	filtered := dropClaimed(FilterByDislikes(broad, dislikes), claimed)
	return MergeUnique(have, filtered, dailyPlaylistLength)
}

func (s *DailyPlaylistService) backfillPhase3TasteRadio(
	ctx context.Context,
	have []tidal.Track,
	likedIDs, completedIDs, genreSeeds []string,
	claimed map[string]bool,
	dislikes DislikeSet,
) []tidal.Track {
	needed := dailyPlaylistLength - len(have)
	if needed <= 0 {
		return have
	}
	// Shuffle liked+completed seeds (liked first by upstream taste
	// ordering — strongest signal) and fan out radio across the
	// top dailyBackfillRadioSeeds.
	seeds := uniqueStrings(append(append([]string{}, likedIDs...), completedIDs...))
	rand.Shuffle(len(seeds), func(i, j int) { seeds[i], seeds[j] = seeds[j], seeds[i] })
	if len(seeds) > dailyBackfillRadioSeeds {
		seeds = seeds[:dailyBackfillRadioSeeds]
	}
	pool := make([]tidal.Track, 0, len(seeds)*50)
	for _, id := range seeds {
		radio, err := s.rec.CachedTrackRadio(ctx, id)
		if err != nil {
			continue
		}
		pool = append(pool, radio...)
	}
	// Pad from user genre seeds when radio still leaves a deficit.
	if len(pool) < needed {
		for _, slug := range genreSeeds {
			pool = append(pool, s.rec.CandidatesFromGenres(ctx, []string{slug})...)
		}
	}
	pool = dropClaimed(FilterByDislikes(pool, dislikes), claimed)
	return MergeUnique(have, pool, dailyPlaylistLength)
}

func (s *DailyPlaylistService) backfillPhase4AllGenres(
	ctx context.Context,
	have []tidal.Track,
	userGenres, fallback []string,
	claimed map[string]bool,
	dislikes DislikeSet,
) []tidal.Track {
	tried := map[string]bool{}
	for _, slug := range userGenres {
		tried[slug] = true
	}
	for _, slug := range fallback {
		tried[slug] = true
	}
	for _, slug := range dailyAllGenres {
		if len(have) >= dailyPlaylistLength {
			break
		}
		if tried[slug] {
			continue
		}
		tried[slug] = true
		filler := dropClaimed(FilterByDislikes(s.rec.CandidatesFromGenres(ctx, []string{slug}), dislikes), claimed)
		have = MergeUnique(have, filler, dailyPlaylistLength)
	}
	return have
}

// ---- helpers -----------------------------------------------------------

// radioFromSeeds fans track-radio out across `cap` random seeds and
// returns the flattened, deduped pool. Mirrors the TS helper of the
// same name. Errors per-seed are swallowed (Tidal can rate-limit
// individual seeds without poisoning the whole call).
func (s *DailyPlaylistService) radioFromSeeds(ctx context.Context, ids []string, cap int) []tidal.Track {
	if len(ids) == 0 {
		return nil
	}
	limited := ids
	if len(limited) > cap {
		limited = limited[:cap]
	}
	out := make([]tidal.Track, 0, len(limited)*50)
	for _, id := range limited {
		radio, err := s.rec.CachedTrackRadio(ctx, id)
		if err != nil {
			continue
		}
		out = append(out, radio...)
	}
	return dedupTracks(out)
}

// pickPersonalMoodSlug returns the mood slug for *now* biased by the
// user's actual listening pattern over the last 30 days. Mirrors the
// TS implementation 1:1: 6-hour quadrants, ≥20 plays threshold,
// >40% peak concentration → stick to the peak's mood, otherwise
// use the current quadrant's mood. Cold-start users fall back to
// wall-clock hour.
func (s *DailyPlaylistService) pickPersonalMoodSlug(ctx context.Context, userID string, hasHistory bool) string {
	wall := moodSlugByHour(time.Now().UTC().Hour())
	if !hasHistory {
		return wall
	}
	since := time.Now().UnixMilli() - dailyMoodHistoryWindowMS
	rows, err := s.app.DB.Query(ctx,
		`SELECT played_at FROM play_history WHERE user_id = $1 AND played_at >= $2`,
		userID, since,
	)
	if err != nil {
		return wall
	}
	defer rows.Close()
	buckets := [4]int{}
	total := 0
	for rows.Next() {
		var ts int64
		if err := rows.Scan(&ts); err != nil {
			continue
		}
		h := time.UnixMilli(ts).UTC().Hour()
		buckets[h/6]++
		total++
	}
	if total < dailyMoodMinPlays {
		return wall
	}
	nowQuadrant := time.Now().UTC().Hour() / 6
	quadrantMood := []string{"mood_chill", "mood_focus", "mood_workout", "mood_chill"}
	peakQuadrant := 0
	for i := 1; i < len(buckets); i++ {
		if buckets[i] > buckets[peakQuadrant] {
			peakQuadrant = i
		}
	}
	peakShare := float64(buckets[peakQuadrant]) / float64(total)
	if peakShare > dailyMoodPeakShare {
		return quadrantMood[peakQuadrant]
	}
	return quadrantMood[nowQuadrant]
}

// ---- read path ---------------------------------------------------------

func (s *DailyPlaylistService) fetchByDate(ctx context.Context, userID, date string) ([]DailyPlaylist, error) {
	rows, err := s.app.DB.Query(ctx,
		`SELECT id, variant, name, description, cover_url, tracks,
		        generated_at, saved_to_playlist_id
		   FROM daily_playlists
		  WHERE user_id = $1 AND date = $2`,
		userID, date,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]DailyPlaylist, 0, 3)
	for rows.Next() {
		var (
			id, variant, name, description, tracksRaw string
			coverURL, savedTo                           *string
			generatedAt                                 int64
		)
		if err := rows.Scan(&id, &variant, &name, &description, &coverURL, &tracksRaw, &generatedAt, &savedTo); err != nil {
			return nil, err
		}
		p := DailyPlaylist{
			ID:          id,
			Variant:     variant,
			Name:        name,
			Description: description,
			Tracks:      parseDailyTracks(tracksRaw),
			GeneratedAt: generatedAt,
		}
		if coverURL != nil {
			p.CoverURL = *coverURL
		}
		if savedTo != nil {
			p.SavedToPlaylistID = *savedTo
		}
		out = append(out, p)
	}
	sortByVariantOrder(out)
	return out, rows.Err()
}

func (s *DailyPlaylistService) activeUserIDs(ctx context.Context, cutoffMS int64) ([]string, error) {
	rows, err := s.app.DB.Query(ctx,
		`SELECT DISTINCT user_id FROM play_history WHERE played_at >= $1 LIMIT 500`,
		cutoffMS)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]string, 0, 64)
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}

func (s *DailyPlaylistService) seedOnlyUserIDs(ctx context.Context, cutoffMS int64) ([]string, error) {
	rows, err := s.app.DB.Query(ctx,
		`SELECT user_id FROM user_taste_profile
		  WHERE genre_seeds != '[]' AND user_id NOT IN
		    (SELECT DISTINCT user_id FROM play_history WHERE played_at >= $1)
		  LIMIT 500`,
		cutoffMS)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]string, 0, 64)
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}

// ---- file-local helpers ------------------------------------------------

func isoDate(ms int64) string {
	return time.UnixMilli(ms).UTC().Format("2006-01-02")
}

func sortByVariantOrder(ps []DailyPlaylist) {
	order := map[string]int{}
	for i, v := range dailyVariants {
		order[v] = i
	}
	// Stable insertion sort — input is at most 3 items.
	for i := 1; i < len(ps); i++ {
		for j := i; j > 0 && order[ps[j-1].Variant] > order[ps[j].Variant]; j-- {
			ps[j-1], ps[j] = ps[j], ps[j-1]
		}
	}
}

func variantsInOrder(in []string) []string {
	out := make([]string, 0, len(in))
	seen := map[string]bool{}
	for _, v := range dailyVariants {
		for _, x := range in {
			if x == v && !seen[v] {
				out = append(out, v)
				seen[v] = true
			}
		}
	}
	return out
}

func parseDailyTracks(raw string) []tidal.Track {
	var out []tidal.Track
	if raw == "" {
		return nil
	}
	if err := json.Unmarshal([]byte(raw), &out); err != nil {
		return nil
	}
	return out
}

func pickDailyCover(tracks []tidal.Track) string {
	for _, t := range tracks {
		if t.CoverURL != "" {
			return t.CoverURL
		}
	}
	return ""
}

func filterCleanTracks(in []tidal.Track, dislikes DislikeSet, claimed map[string]bool) []tidal.Track {
	out := make([]tidal.Track, 0, len(in))
	for _, t := range in {
		if claimed[TrackKey(t)] {
			continue
		}
		if dislikes.Tracks[t.ID] {
			continue
		}
		if t.ArtistID != "" && dislikes.Artists[t.ArtistID] {
			continue
		}
		drop := false
		for _, a := range t.Artists {
			if a.ID != "" && dislikes.Artists[a.ID] {
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

func dropClaimed(in []tidal.Track, claimed map[string]bool) []tidal.Track {
	out := make([]tidal.Track, 0, len(in))
	for _, t := range in {
		if claimed[TrackKey(t)] {
			continue
		}
		out = append(out, t)
	}
	return out
}

func filterFn(in []tidal.Track, keep func(tidal.Track) bool) []tidal.Track {
	out := make([]tidal.Track, 0, len(in))
	for _, t := range in {
		if keep(t) {
			out = append(out, t)
		}
	}
	return out
}

func moodSlugByHour(hour int) string {
	switch {
	case hour < 8:
		return "mood_chill"
	case hour < 13:
		return "mood_focus"
	case hour < 19:
		return "mood_workout"
	default:
		return "mood_chill"
	}
}

func moodSlugToWaveMood(slug string) string {
	switch slug {
	case "mood_chill":
		return "chill"
	case "mood_workout":
		return "workout"
	case "mood_focus":
		return "focus"
	case "mood_party":
		return "party"
	case "mood_throwback":
		return "throwback"
	default:
		return ""
	}
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	neg := n < 0
	if neg {
		n = -n
	}
	var buf [20]byte
	i := len(buf)
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		i--
		buf[i] = '-'
	}
	return string(buf[i:])
}
