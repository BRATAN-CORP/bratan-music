package routes

import (
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5"

	"github.com/bratan-corp/bratan-music/api-go/internal/app"
	"github.com/bratan-corp/bratan-music/api-go/internal/httpx"
	"github.com/bratan-corp/bratan-music/api-go/internal/services"
)

// POST /admin/daily-playlists/reset
//
// Force-regenerate daily playlists without waiting for the nightly
// cron. Mirrors worker/src/routes/admin.ts admin.post('/daily-
// playlists/reset', ...).
//
// Body shape: { userId?: string }
//   • userId present  → recompute taste + regenerate for that one user;
//                       returns the freshly-written variants with track counts.
//   • userId absent   → recompute + regenerate for ALL active users
//                       (same 14-day play-history + seed-only set the
//                       cron picks). Returns aggregate counters.
func adminResetDailyImpl(a *app.App) http.HandlerFunc {
	type body struct {
		UserID string `json:"userId"`
	}
	type variantSummary struct {
		Variant    string `json:"variant"`
		Name       string `json:"name"`
		TrackCount int    `json:"trackCount"`
	}
	return func(w http.ResponseWriter, r *http.Request) {
		var in body
		// Empty body is valid and means "regenerate for everyone" —
		// mirror the worker behaviour. BindJSON returns nil on an
		// empty/short body via its internal Decode call.
		_ = httpx.BindJSON(r, &in, 1<<10)

		ds := services.NewDailyPlaylistService(a)

		if in.UserID != "" {
			// Verify the user exists before doing any work; 404 is
			// the same response shape the worker returns.
			var probe string
			err := a.DB.QueryRow(r.Context(),
				`SELECT id FROM users WHERE id = $1`, in.UserID,
			).Scan(&probe)
			if errors.Is(err, pgx.ErrNoRows) {
				httpx.Err(w, http.StatusNotFound, "Пользователь не найден")
				return
			}
			if err != nil {
				httpx.Internal(w, err)
				return
			}
			items, err := ds.ResetForUser(r.Context(), in.UserID)
			if err != nil {
				httpx.Internal(w, err)
				return
			}
			summary := make([]variantSummary, 0, len(items))
			for _, p := range items {
				summary = append(summary, variantSummary{
					Variant:    p.Variant,
					Name:       p.Name,
					TrackCount: len(p.Tracks),
				})
			}
			httpx.JSON(w, http.StatusOK, map[string]any{
				"ok":        true,
				"processed": 1,
				"errors":    0,
				"variants":  summary,
			})
			return
		}

		processed, errCnt, total := ds.ResetForActive(r.Context())
		httpx.JSON(w, http.StatusOK, map[string]any{
			"ok":        true,
			"processed": processed,
			"errors":    errCnt,
			"total":     total,
		})
	}
}
