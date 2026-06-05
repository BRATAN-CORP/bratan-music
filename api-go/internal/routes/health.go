// Package routes contains HTTP route handlers. Each entry function
// returns a chi sub-router that the top-level mux mounts at a
// well-known prefix. Handlers reach for services via `services.Of(a)`.
package routes

import (
	"net/http"
	"time"

	"github.com/bratan-corp/bratan-music/api-go/internal/app"
	"github.com/bratan-corp/bratan-music/api-go/internal/httpx"
)

// Health returns 200 with status:ok plus a server timestamp. Used by
// the docker-compose healthcheck and the deploy workflow to confirm
// the new binary booted before proceeding.
func Health(a *app.App) http.HandlerFunc {
	_ = a
	return func(w http.ResponseWriter, _ *http.Request) {
		httpx.JSON(w, http.StatusOK, map[string]any{
			"status":    "ok",
			"timestamp": time.Now().UnixMilli(),
		})
	}
}

// HealthTidal checks whether Tidal is currently authenticated and
// responsive. Returns 503 on any error without echoing it so we don't
// leak upstream details to anonymous callers.
func HealthTidal(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		// Port of worker node-entry.ts `/health/tidal`: confirm we can
		// mint a Tidal access token and report the resolved country.
		auth := tidalSvc(a).Auth
		token, err := auth.GetAccessToken(ctx, false)
		if err != nil {
			httpx.JSON(w, http.StatusServiceUnavailable, map[string]any{"status": "error"})
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]any{
			"status":      "ok",
			"hasToken":    token != "",
			"countryCode": auth.GetCountryCode(ctx),
		})
	}
}
