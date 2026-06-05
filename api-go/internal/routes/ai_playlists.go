package routes

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/bratan-corp/bratan-music/api-go/internal/app"
	"github.com/bratan-corp/bratan-music/api-go/internal/httpx"
	"github.com/bratan-corp/bratan-music/api-go/internal/services"
	"github.com/bratan-corp/bratan-music/api-go/internal/tidal"
)

// HTTP surface for AIPlaylistService — see worker/src/routes/aiPlaylists.ts.
//
// Endpoints (1:1 with worker; mount root is /ai/playlists):
//
//   POST /generate  → AIPlaylistPreview (non-persistent; the FE renders
//                     the returned tracks and lets the user confirm)
//   POST /save      → { id, name, description, trackCount }
//
// JWT middleware is applied at mount time.

const (
	aiPromptMaxRouteChars = 200 // input-layer cap; service applies a defence-in-depth 1000 cap.
	aiSaveMaxTracks       = 100
)

type aiGenerateBody struct {
	Prompt string `json:"prompt"`
	Size   int    `json:"size"`
}

// POST /ai/playlists/generate
func aiGenerateImpl(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		uid := httpx.UserID(r)

		var body aiGenerateBody
		_ = httpx.BindJSON(r, &body, 1<<12)
		prompt := strings.TrimSpace(body.Prompt)
		if prompt == "" {
			httpx.Err(w, http.StatusBadRequest, "Промпт обязателен")
			return
		}
		if len(prompt) > aiPromptMaxRouteChars {
			httpx.Err(w, http.StatusBadRequest, "Промпт слишком длинный (максимум 200 символов)")
			return
		}

		svc := services.NewAIPlaylistService(a)
		preview, err := svc.Generate(r.Context(), prompt, body.Size)
		if err != nil {
			if aiErr, ok := services.AsAIError(err); ok {
				httpx.Err(w, aiErr.Status, aiErr.Message)
				return
			}
			a.Logger.Error("ai/generate unhandled", "err", err)
			httpx.Err(w, http.StatusInternalServerError, "Не удалось сгенерировать плейлист")
			return
		}

		// Strip user-banned tracks/artists so the preview matches what
		// the user would hear if they saved+played; the wave path
		// already does this filtering, AI used to leak banned items.
		rec := services.NewRecommendationService(a)
		dislikes, err := rec.LoadDislikes(r.Context(), uid)
		if err == nil {
			preview.Tracks = services.FilterByDislikes(preview.Tracks, dislikes)
		}
		if preview.Tracks == nil {
			preview.Tracks = []tidal.Track{}
		}

		httpx.JSON(w, http.StatusOK, preview)
	}
}

type aiSaveBody struct {
	Name        string        `json:"name"`
	Description string        `json:"description"`
	Tracks      []tidal.Track `json:"tracks"`
	Prompt      string        `json:"prompt"`
}

type aiSaveResponse struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	TrackCount  int    `json:"trackCount"`
}

// POST /ai/playlists/save
//
// Mirrors the TS save flow: validate, dedupe by track_id (PK is
// (playlist_id, track_id) so two sources of the same id would blow up
// the batch with a UNIQUE violation), snapshot the track shape we
// promise to the FE, insert playlists + playlist_tracks in a tx.
func aiSave(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		uid := httpx.UserID(r)

		var body aiSaveBody
		_ = httpx.BindJSON(r, &body, 1<<20) // up to 1 MiB — 100 tracks fit easily.

		name := strings.TrimSpace(body.Name)
		if len(name) > 80 {
			name = name[:80]
		}
		description := strings.TrimSpace(body.Description)
		if len(description) > 280 {
			description = description[:280]
		}

		if name == "" {
			httpx.Err(w, http.StatusBadRequest, "Название обязательно")
			return
		}
		if len(body.Tracks) == 0 {
			httpx.Err(w, http.StatusBadRequest, "Нужен хотя бы один трек")
			return
		}
		if len(body.Tracks) > aiSaveMaxTracks {
			httpx.Err(w, http.StatusBadRequest, "Максимум 100 треков")
			return
		}

		// Cover = first track that has one.
		var cover any
		for _, t := range body.Tracks {
			if t.CoverURL != "" {
				cover = t.CoverURL
				break
			}
		}

		now := time.Now().Unix()
		playlistID := uuid.NewString()

		tx, err := a.DB.Begin(r.Context())
		if err != nil {
			httpx.Internal(w, err)
			return
		}
		defer func() { _ = tx.Rollback(r.Context()) }()

		var descArg any
		if description != "" {
			descArg = description
		}
		if _, err := tx.Exec(r.Context(),
			`INSERT INTO playlists (id, user_id, name, description, is_liked,
			                        cover_url, created_at, updated_at)
			 VALUES ($1, $2, $3, $4, 0, $5, $6, $6)`,
			playlistID, uid, name, descArg, cover, now,
		); err != nil {
			httpx.Internal(w, err)
			return
		}

		seen := map[string]bool{}
		position := 0
		for _, t := range body.Tracks {
			if t.ID == "" || seen[t.ID] {
				continue
			}
			seen[t.ID] = true
			src := t.Source
			if src == "" {
				src = "tidal"
			}
			snapshot, _ := json.Marshal(map[string]any{
				"id":       t.ID,
				"source":   src,
				"title":    t.Title,
				"artist":   t.Artist,
				"artistId": t.ArtistID,
				"artists":  t.Artists,
				"album":    t.Album,
				"albumId":  t.AlbumID,
				"duration": t.Duration,
				"coverUrl": t.CoverURL,
				"explicit": t.Explicit,
				"quality":  t.Quality,
			})
			if _, err := tx.Exec(r.Context(),
				`INSERT INTO playlist_tracks (playlist_id, track_id, source, position,
				                              added_at, snapshot)
				 VALUES ($1, $2, $3, $4, $5, $6)`,
				playlistID, t.ID, src, position, now, string(snapshot),
			); err != nil {
				a.Logger.Error("ai/save playlist_tracks insert", "err", err)
				httpx.Err(w, http.StatusInternalServerError, "Не удалось сохранить плейлист")
				return
			}
			position++
		}

		if err := tx.Commit(r.Context()); err != nil {
			a.Logger.Error("ai/save commit", "err", err)
			httpx.Err(w, http.StatusInternalServerError, "Не удалось сохранить плейлист")
			return
		}

		httpx.JSON(w, http.StatusCreated, aiSaveResponse{
			ID:          playlistID,
			Name:        name,
			Description: description,
			TrackCount:  position,
		})
	}
}

