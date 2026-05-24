// Package router builds the chi mux and exposes the cron loop runner.
// Service wiring (the *App.* fields) is bootstrapped here once at
// startup so handlers can grab dependencies via the typed accessors
// in `services`.
package router

import (
	"context"
	"net/http"
	"time"

	"github.com/bratan-corp/bratan-music/api-go/internal/app"
	"github.com/bratan-corp/bratan-music/api-go/internal/httpx"
	"github.com/bratan-corp/bratan-music/api-go/internal/middleware"
	"github.com/bratan-corp/bratan-music/api-go/internal/routes"
	"github.com/bratan-corp/bratan-music/api-go/internal/services"
	"github.com/go-chi/chi/v5"
	chimw "github.com/go-chi/chi/v5/middleware"
)

// Wire builds the service objects and stores them on `*app.App`. This
// is split from Build() so route handlers can call `services.Of(a)`
// without worrying about init order.
func Wire(a *app.App) {
	a.Auth = services.NewAuthService(a)
	a.Users = services.NewUserService(a)
	a.Subs = services.NewSubscriptionService(a)
	a.Sessions = services.NewSessionService(a)
	a.Email = services.NewEmailOtpService(a)
	a.Brevo = services.NewBrevoService(a)
	a.History = services.NewHistoryService(a)
	a.Playlists = services.NewPlaylistService(a)
	a.Library = services.NewLibraryService(a)
	a.Health = services.NewHealthService(a)
	a.Tidal = services.NewTidalService(a)
	a.Taste = services.NewTasteService(a)
	a.Recs = services.NewRecommendationService(a)
	a.Daily = services.NewDailyPlaylistService(a)
	a.AI = services.NewAIPlaylistService(a)
	a.Rooms = services.NewRoomService(a)
	a.RoomHub = services.NewRoomHub()
	a.Bot = services.NewBotService(a)
}

// Build returns the configured top-level handler. Mount paths
// intentionally mirror worker/src/index.ts so the frontend doesn't
// need to change.
func Build(a *app.App) http.Handler {
	r := chi.NewRouter()

	r.Use(chimw.Recoverer)
	r.Use(chimw.RequestID)
	r.Use(chimw.RealIP)

	// CORS allow-list mirrors the legacy worker. APP_URL is always
	// allowed; localhost variants for dev.
	r.Use(middleware.CORS([]string{
		a.Cfg.AppURL,
		"http://localhost:5173",
		"http://localhost:4173",
		"http://localhost:3000",
		"https://" + a.Cfg.Domain,
	}))

	// Rate-limit everything except the audio stream proxy (range
	// requests would trip the bucket on every keypress).
	r.Use(middleware.RateLimit(a.Redis, []string{
		"/tracks/", "/covers/", "/rooms/ws", "/uploads/raw",
	}))

	r.Get("/health", routes.Health(a))
	r.Get("/health/tidal", routes.HealthTidal(a))

	r.Route("/auth", routes.Auth(a))
	r.Route("/user", routes.User(a))
	r.Route("/search", routes.Search(a))
	r.Route("/tracks", routes.Tracks(a))
	r.Route("/covers", routes.Covers(a))
	r.Route("/albums", routes.Albums(a))
	r.Route("/artists", routes.Artists(a))
	r.Route("/playlists", routes.Playlists(a))
	r.Route("/library", routes.Library(a))
	r.Route("/uploads", routes.Uploads(a))
	r.Route("/webhook", routes.Webhook(a))
	r.Route("/admin", routes.Admin(a))
	r.Route("/explore", routes.Explore(a))
	r.Route("/recommendations", routes.Recommendations(a))
	r.Route("/daily-playlists", routes.DailyPlaylists(a))
	r.Route("/history", routes.History(a))
	r.Route("/rooms", routes.Rooms(a))
	r.Route("/ai/playlists", routes.AIPlaylists(a))

	r.NotFound(func(w http.ResponseWriter, _ *http.Request) {
		httpx.NotFound(w)
	})
	r.MethodNotAllowed(func(w http.ResponseWriter, _ *http.Request) {
		httpx.Err(w, http.StatusMethodNotAllowed, "Метод не разрешён")
	})

	return r
}

// RunCronLoop sleeps until the next 04:30 UTC and runs the scheduled
// jobs, then repeats. Mirrors `scheduleCron()` in worker/src/node-entry.ts.
func RunCronLoop(ctx context.Context, a *app.App) {
	for {
		next := nextCronTime()
		delay := time.Until(next)
		a.Logger.Info("cron scheduled", "next", next.Format(time.RFC3339))
		select {
		case <-ctx.Done():
			return
		case <-time.After(delay):
		}
		a.Logger.Info("cron tick start")
		services.RunScheduledJobs(ctx, a)
		a.Logger.Info("cron tick done")
	}
}

func nextCronTime() time.Time {
	now := time.Now().UTC()
	next := time.Date(now.Year(), now.Month(), now.Day(), 4, 30, 0, 0, time.UTC)
	if !next.After(now) {
		next = next.Add(24 * time.Hour)
	}
	return next
}
