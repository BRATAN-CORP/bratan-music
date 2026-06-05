package routes

import (
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/bratan-corp/bratan-music/api-go/internal/app"
	"github.com/bratan-corp/bratan-music/api-go/internal/httpx"
	"github.com/bratan-corp/bratan-music/api-go/internal/services"
)

// HTTP surface for the DailyPlaylistService — see the comment block at
// the top of internal/services/daily.go for the variant model.
//
// Endpoints (1:1 with worker/src/routes/dailyPlaylists.ts):
//
//   GET  /daily-playlists/today           → { items: DailyPlaylist[] }
//   POST /daily-playlists/save/{id}       → { playlistId, name }
//
// Both routes are JWT-gated by the mount wrapper. The save endpoint
// is intentionally a POST with no body — the daily-playlist row
// already carries everything we need (name, cover, tracks).

func dailyService(a *app.App) *services.DailyPlaylistService {
	return services.NewDailyPlaylistService(a)
}

// GET /daily-playlists/today
func dailyToday(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		uid := httpx.UserID(r)
		items, err := dailyService(a).GetToday(r.Context(), uid)
		if err != nil {
			httpx.Internal(w, err)
			return
		}
		if items == nil {
			items = []services.DailyPlaylist{}
		}
		httpx.JSON(w, http.StatusOK, map[string]any{"items": items})
	}
}

// POST /daily-playlists/save/{id}
//
// Promotes the daily-playlist row to a permanent library playlist.
// 400 when the id doesn't belong to the caller (treated as
// "validation" since the row simply doesn't exist for this user).
func dailySave(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		uid := httpx.UserID(r)
		id := chi.URLParam(r, "id")
		playlistID, name, err := dailyService(a).SaveToLibrary(r.Context(), uid, id)
		if err != nil {
			if errors.Is(err, services.ErrInvalid) {
				httpx.Err(w, http.StatusNotFound, "Плейлист не найден")
				return
			}
			httpx.Internal(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]any{
			"playlistId": playlistID,
			"name":       name,
		})
	}
}
