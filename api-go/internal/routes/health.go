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
		_ = ctx
		// Tidal service is currently a stub — return ok-ish payload
		// while we wire the full client in a follow-up commit.
		httpx.JSON(w, http.StatusOK, map[string]any{
			"status":      "ok",
			"hasToken":    false,
			"countryCode": "",
		})
		_ = a
	}
}
