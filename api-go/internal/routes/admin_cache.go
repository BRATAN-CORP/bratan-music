package routes

import (
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/bratan-corp/bratan-music/api-go/internal/app"
	"github.com/bratan-corp/bratan-music/api-go/internal/httpx"
)

// adminFlushQualityCache removes the quality + discovery cache entries
// for one or more tracks so the next stream request re-probes Tidal.
//
//	POST /admin/cache/flush?tracks=115464510,115464511
//
// Designed for quick recovery from cache-poisoning incidents (e.g. a
// transient Tidal outage that cached LOW quality with a long TTL).
func adminFlushQualityCache(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ts := tidalSvc(a)
		if ts == nil {
			httpx.Err(w, http.StatusServiceUnavailable, "tidal service not available")
			return
		}

		raw := r.URL.Query().Get("tracks")
		if raw == "" {
			httpx.Err(w, http.StatusBadRequest, "tracks query param required (comma-separated IDs)")
			return
		}

		ids := strings.Split(raw, ",")
		flushed := make([]string, 0, len(ids))
		for _, id := range ids {
			id = strings.TrimSpace(id)
			if id == "" {
				continue
			}
			ts.API.FlushTrackCache(r.Context(), id)
			flushed = append(flushed, id)
		}

		httpx.JSON(w, 200, map[string]any{
			"flushed": flushed,
			"count":   len(flushed),
		})
	}
}

// streamTrackFresh is a variant of streamTrack that flushes the quality
// + discovery cache before resolving. Handy for debugging or recovering
// a single track from a poisoned cache without the admin panel.
//
//	GET /tracks/{id}/stream/fresh?quality=HIGH
func streamTrackFresh(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := chi.URLParam(r, "id")
		if id == "" {
			httpx.Err(w, http.StatusBadRequest, "missing track id")
			return
		}
		ts := tidalSvc(a)
		if ts == nil {
			httpx.Err(w, http.StatusServiceUnavailable, "tidal service not available")
			return
		}

		// Flush cache, then resolve fresh.
		ts.API.FlushTrackCache(r.Context(), id)

		quality := strings.ToUpper(r.URL.Query().Get("quality"))
		if quality == "" {
			quality = "HIGH"
		}
		resolved, err := ts.API.ResolveStream(r.Context(), id, quality)
		if err != nil {
			httpx.Err(w, http.StatusBadGateway, "resolve stream: "+err.Error())
			return
		}

		httpx.JSON(w, 200, map[string]any{
			"url":     proxiedAudioURL(r, resolved.URL),
			"direct":  resolved.URL,
			"quality": resolved.Quality,
			"source":  "tidal",
		})
	}
}
