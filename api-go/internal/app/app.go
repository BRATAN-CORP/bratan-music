// Package app holds the dependency container shared by every route.
//
// Wiring lives here so individual handler files can take a `*App`
// receiver and reach for whatever they need (DB, Redis, Storage,
// Tidal client, services) without re-plumbing constructor lists.
package app

import (
	"context"
	"log/slog"

	"github.com/bratan-corp/bratan-music/api-go/internal/config"
	"github.com/bratan-corp/bratan-music/api-go/internal/db"
	"github.com/bratan-corp/bratan-music/api-go/internal/redisx"
	"github.com/bratan-corp/bratan-music/api-go/internal/storage"
)

// App is the live, request-time application state.
type App struct {
	Cfg    *config.Config
	DB     *db.DB
	Redis  *redisx.Client
	Store  *storage.Store
	Logger *slog.Logger

	// Service handles are intentionally `any`-erased here to avoid a
	// circular import cycle (services use *App). Use the *services.*
	// helpers to fetch the typed value when you need it.
	Tidal     any
	Auth      any
	Users     any
	Subs      any
	Sessions  any
	Rooms     any
	Email     any
	Taste     any
	Recs      any
	Daily     any
	AI        any
	Brevo     any
	History   any
	Playlists any
	Library   any
	Health    any
	Bot       any
}

// Shutdown releases the underlying resources. Safe to call multiple
// times — each component handles already-closed gracefully.
func (a *App) Shutdown(ctx context.Context) {
	if a.DB != nil {
		a.DB.Close()
	}
	if a.Redis != nil {
		_ = a.Redis.Close()
	}
	_ = ctx
}
