package routes

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/bratan-corp/bratan-music/api-go/internal/app"
	"github.com/bratan-corp/bratan-music/api-go/internal/httpx"
	"github.com/bratan-corp/bratan-music/api-go/internal/services"
	"github.com/bratan-corp/bratan-music/api-go/internal/tidal"
)

// Recommendations route — port of worker/src/routes/recommendations.ts.
// The mount surface (verbs, paths, query/body shapes) is 1:1 with the
// worker so existing frontends keep working without changes. Internals
// (rerank, taste, KV→Redis cache) are described in
// internal/services/recommendations.go.

// recsService returns a fresh service per request — cheap, no per-call
// state besides the app pointer.
func recsService(a *app.App) *services.RecommendationService {
	return services.NewRecommendationService(a)
}

func recsTasteService(a *app.App) *services.TasteService {
	return services.NewTasteService(a)
}

// GET /recommendations/wave
func recsWave(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		uid := httpx.UserID(r)
		limit := queryInt(r, "limit", 25)
		if limit < 1 {
			limit = 1
		}
		if limit > 50 {
			limit = 50
		}
		mood := r.URL.Query().Get("mood")
		if !containsStr(services.WaveMoods, mood) {
			mood = ""
		}
		character := r.URL.Query().Get("character")
		if !containsStr(services.WaveCharacters, character) {
			character = ""
		}
		svc := recsService(a)
		items, err := svc.Wave(r.Context(), uid, services.WaveOptions{
			Limit: limit, Mood: mood, Character: character,
		})
		if err != nil {
			httpx.Internal(w, err)
			return
		}
		// Fire-and-forget seen-write so the response doesn't pay the
		// round-trip. Bounded context so a slow DB can't accumulate
		// goroutines.
		go func(uid string, items []tidal.Track) {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			_ = svc.RecordSeen(ctx, uid, items)
		}(uid, items)
		httpx.JSON(w, http.StatusOK, map[string]any{"items": items})
	}
}

// POST /recommendations/continue
func recsContinue(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		uid := httpx.UserID(r)
		var body struct {
			SeedTrackID string `json:"seedTrackId"`
			Limit       int    `json:"limit"`
		}
		_ = httpx.BindJSON(r, &body, 64*1024)
		if body.SeedTrackID == "" {
			httpx.Err(w, http.StatusBadRequest, "seedTrackId обязателен")
			return
		}
		if body.Limit <= 0 {
			body.Limit = 20
		}
		if body.Limit > 50 {
			body.Limit = 50
		}
		svc := recsService(a)
		items, err := svc.ContinueFromTrack(r.Context(), uid, body.SeedTrackID, body.Limit)
		if err != nil {
			httpx.Internal(w, err)
			return
		}
		go func(uid string, items []tidal.Track) {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			_ = svc.RecordSeen(ctx, uid, items)
		}(uid, items)
		httpx.JSON(w, http.StatusOK, map[string]any{"items": items})
	}
}

// POST /recommendations/genre-seeds
func recsSetGenreSeeds(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		uid := httpx.UserID(r)
		var body struct {
			Slugs []string `json:"slugs"`
		}
		if err := httpx.BindJSON(r, &body, 64*1024); err != nil || body.Slugs == nil {
			httpx.Err(w, http.StatusBadRequest, "slugs обязателен")
			return
		}
		out := make([]string, 0, len(body.Slugs))
		for _, s := range body.Slugs {
			if s != "" {
				out = append(out, s)
			}
			if len(out) >= 8 {
				break
			}
		}
		if err := recsTasteService(a).SetGenreSeeds(r.Context(), uid, out); err != nil {
			httpx.Internal(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]any{"ok": true, "slugs": out})
	}
}

// GET /recommendations/genre-seeds
func recsGetGenreSeeds(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		uid := httpx.UserID(r)
		snap, err := recsTasteService(a).GetOrCompute(r.Context(), uid)
		if err != nil {
			httpx.Internal(w, err)
			return
		}
		slugs := snap.GenreSeeds
		if slugs == nil {
			slugs = []string{}
		}
		httpx.JSON(w, http.StatusOK, map[string]any{
			"slugs":      slugs,
			"hasHistory": snap.Profile.TotalPlays > 0,
		})
	}
}

// GET /recommendations/dislikes
func recsDislikesList(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		uid := httpx.UserID(r)
		rows, err := a.DB.Query(r.Context(),
			`SELECT item_id, kind FROM user_dislikes WHERE user_id = $1 ORDER BY created_at DESC`,
			uid)
		if err != nil {
			httpx.Internal(w, err)
			return
		}
		defer rows.Close()
		tracks, artists := []string{}, []string{}
		for rows.Next() {
			var id, kind string
			if err := rows.Scan(&id, &kind); err != nil {
				continue
			}
			if kind == "artist" {
				artists = append(artists, id)
			} else {
				tracks = append(tracks, id)
			}
		}
		httpx.JSON(w, http.StatusOK, map[string]any{"tracks": tracks, "artists": artists})
	}
}

// GET /recommendations/dislikes/details — hydrated variant for the
// profile "Скрытые" panel.
func recsDislikesDetails(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		uid := httpx.UserID(r)
		rows, err := a.DB.Query(r.Context(),
			`SELECT item_id, kind, created_at FROM user_dislikes WHERE user_id = $1 ORDER BY created_at DESC`,
			uid)
		if err != nil {
			httpx.Internal(w, err)
			return
		}
		defer rows.Close()
		type row struct {
			ID, Kind string
			At       int64
		}
		var trackRows, artistRows []row
		for rows.Next() {
			var rr row
			if err := rows.Scan(&rr.ID, &rr.Kind, &rr.At); err != nil {
				continue
			}
			if rr.Kind == "artist" {
				artistRows = append(artistRows, rr)
			} else {
				trackRows = append(trackRows, rr)
			}
		}

		svc := tidalSvc(a)
		// Hydrate in parallel — bounded concurrency would be safer, but
		// the dislike-details panel typically holds tens of items, not
		// thousands. Match the TS Promise.all behaviour.
		type trackOut struct {
			ID          string  `json:"id"`
			Title       string  `json:"title"`
			Artist      string  `json:"artist"`
			ArtistID    *string `json:"artistId"`
			CoverURL    *string `json:"coverUrl"`
			Duration    int     `json:"duration"`
			AddedAt     int64   `json:"addedAt"`
			Unavailable bool    `json:"unavailable"`
			Explicit    bool    `json:"explicit,omitempty"`
		}
		type artistOut struct {
			ID          string  `json:"id"`
			Name        string  `json:"name"`
			ImageURL    *string `json:"imageUrl"`
			AddedAt     int64   `json:"addedAt"`
			Unavailable bool    `json:"unavailable"`
		}

		tracks := make([]trackOut, len(trackRows))
		artists := make([]artistOut, len(artistRows))

		var wg sync.WaitGroup
		for i, rr := range trackRows {
			wg.Add(1)
			go func(i int, rr row) {
				defer wg.Done()
				ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
				defer cancel()
				raw, err := svc.API.GetTrack(ctx, rr.ID)
				if err != nil || raw == nil {
					tracks[i] = trackOut{ID: rr.ID, Title: rr.ID, AddedAt: rr.At, Unavailable: true}
					return
				}
				t := tidal.MapTrack(raw)
				var aid, cov *string
				if t.ArtistID != "" {
					v := t.ArtistID
					aid = &v
				}
				if t.CoverURL != "" {
					v := t.CoverURL
					cov = &v
				}
				tracks[i] = trackOut{
					ID: t.ID, Title: t.Title, Artist: t.Artist,
					ArtistID: aid, CoverURL: cov, Duration: t.Duration,
					AddedAt: rr.At, Explicit: t.Explicit,
				}
			}(i, rr)
		}
		for i, rr := range artistRows {
			wg.Add(1)
			go func(i int, rr row) {
				defer wg.Done()
				ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
				defer cancel()
				raw, err := svc.API.GetArtist(ctx, rr.ID)
				if err != nil || raw == nil {
					artists[i] = artistOut{ID: rr.ID, Name: rr.ID, AddedAt: rr.At, Unavailable: true}
					return
				}
				ar := tidal.MapArtist(raw)
				var img *string
				if ar.ImageURL != "" {
					v := ar.ImageURL
					img = &v
				}
				artists[i] = artistOut{ID: ar.ID, Name: ar.Name, ImageURL: img, AddedAt: rr.At}
			}(i, rr)
		}
		wg.Wait()

		httpx.JSON(w, http.StatusOK, map[string]any{"tracks": tracks, "artists": artists})
	}
}

// POST /recommendations/dislikes — insert a dislike row.
func recsDislikePost(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		uid := httpx.UserID(r)
		var body struct {
			ItemID string `json:"itemId"`
			Kind   string `json:"kind"`
			Source string `json:"source"`
		}
		_ = httpx.BindJSON(r, &body, 64*1024)
		if body.ItemID == "" || (body.Kind != "track" && body.Kind != "artist") {
			httpx.Err(w, http.StatusBadRequest, "itemId и kind обязательны")
			return
		}
		src := body.Source
		if src == "" {
			src = "tidal"
		}
		_, err := a.DB.Exec(r.Context(),
			`INSERT INTO user_dislikes (user_id, item_id, kind, source, created_at)
			 VALUES ($1,$2,$3,$4,$5)
			 ON CONFLICT (user_id, item_id, kind) DO NOTHING`,
			uid, body.ItemID, body.Kind, src, time.Now().UnixMilli())
		if err != nil {
			httpx.Internal(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]any{"ok": true})
	}
}

// POST /recommendations/seed-artists
func recsSetSeedArtists(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		uid := httpx.UserID(r)
		var body struct {
			ArtistIDs []string `json:"artistIds"`
		}
		_ = httpx.BindJSON(r, &body, 64*1024)
		if len(body.ArtistIDs) == 0 {
			httpx.Err(w, http.StatusBadRequest, "artistIds обязателен")
			return
		}
		out := make([]string, 0, len(body.ArtistIDs))
		for _, id := range body.ArtistIDs {
			id = strings.TrimSpace(id)
			if id != "" {
				out = append(out, id)
			}
			if len(out) >= 12 {
				break
			}
		}
		if len(out) == 0 {
			httpx.Err(w, http.StatusBadRequest, "нужен хотя бы один artistId")
			return
		}
		if err := recsTasteService(a).SetSeedArtists(r.Context(), uid, out); err != nil {
			httpx.Internal(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]any{"ok": true, "artistIds": out})
	}
}

// GET /recommendations/seed-artists
func recsGetSeedArtists(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		uid := httpx.UserID(r)
		snap, err := recsTasteService(a).GetOrCompute(r.Context(), uid)
		if err != nil {
			httpx.Internal(w, err)
			return
		}
		ids := snap.SeedArtistIDs
		if ids == nil {
			ids = []string{}
		}
		httpx.JSON(w, http.StatusOK, map[string]any{
			"artistIds":  ids,
			"hasHistory": snap.Profile.TotalPlays > 0,
		})
	}
}

// GET /recommendations/artists/search?q=
func recsArtistsSearch(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		q := strings.TrimSpace(r.URL.Query().Get("q"))
		if len(q) < 2 {
			httpx.JSON(w, http.StatusOK, map[string]any{"items": []any{}})
			return
		}
		raw, err := tidalSvc(a).API.Search(r.Context(), q, "ARTISTS", 24, 0)
		if err != nil || raw == nil {
			a.Logger.Warn("artists/search failed", "err", err)
			httpx.JSON(w, http.StatusOK, map[string]any{"items": []any{}})
			return
		}
		// Search returns SearchResponse with an Artists bucket of
		// ArtistRaw items; map each.
		artists := tidal.UnwrapBucket[tidal.ArtistRaw](raw.Artists)
		out := make([]tidal.Artist, 0, len(artists))
		for i := range artists {
			out = append(out, tidal.MapArtist(&artists[i]))
		}
		httpx.JSON(w, http.StatusOK, map[string]any{"items": out})
	}
}

// GET /recommendations/artists/suggested — cold-start picker pool.
// 7-day Redis cache to match the TS TTL.
func recsArtistsSuggested(a *app.App) http.HandlerFunc {
	const cacheKey = "rec_suggested_artists:v1"
	const cacheTTL = 7 * 24 * time.Hour
	return func(w http.ResponseWriter, r *http.Request) {
		if a.Redis != nil {
			if raw, ok, _ := a.Redis.KVGet(r.Context(), cacheKey); ok && raw != "" {
				var cached []map[string]any
				if json.Unmarshal([]byte(raw), &cached) == nil {
					httpx.JSON(w, http.StatusOK, map[string]any{"items": cached})
					return
				}
			}
		}
		svc := tidalSvc(a)
		seen := map[string]bool{}
		out := make([]map[string]any, 0, 24)
		slugs := []string{"genre_pop", "genre_rap", "genre_rock", "genre_electronic"}
	outer:
		for _, slug := range slugs {
			page, err := svc.API.GetPage(r.Context(), slug)
			if err != nil {
				continue
			}
			for _, row := range page.Rows {
				for i := range row.Modules {
					m := row.Modules[i]
					if m.Type != "ARTIST_LIST" || m.PagedList == nil {
						continue
					}
					for _, raw := range m.PagedList.Items {
						ar, err := tidal.UnwrapItem[tidal.ArtistRaw](raw)
						if err != nil || ar == nil || ar.ID == 0 {
							continue
						}
						mapped := tidal.MapArtist(ar)
						if seen[mapped.ID] || mapped.ImageURL == "" {
							continue
						}
						seen[mapped.ID] = true
						out = append(out, map[string]any{
							"id":       mapped.ID,
							"name":     mapped.Name,
							"imageUrl": mapped.ImageURL,
						})
						if len(out) >= 24 {
							break outer
						}
					}
				}
			}
		}
		if a.Redis != nil {
			if js, err := json.Marshal(out); err == nil {
				_ = a.Redis.KVSet(r.Context(), cacheKey, string(js), cacheTTL)
			}
		}
		httpx.JSON(w, http.StatusOK, map[string]any{"items": out})
	}
}

// DELETE /recommendations/dislikes/{kind}/{itemId}
func recsDislikeDelete(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		uid := httpx.UserID(r)
		kind := chi.URLParam(r, "kind")
		itemID := chi.URLParam(r, "itemId")
		if kind != "track" && kind != "artist" {
			httpx.Err(w, http.StatusBadRequest, "Неверный kind")
			return
		}
		_, err := a.DB.Exec(r.Context(),
			`DELETE FROM user_dislikes WHERE user_id = $1 AND item_id = $2 AND kind = $3`,
			uid, itemID, kind)
		if err != nil {
			httpx.Internal(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]any{"ok": true})
	}
}

func containsStr(arr []string, v string) bool {
	if v == "" {
		return false
	}
	for _, x := range arr {
		if x == v {
			return true
		}
	}
	return false
}
