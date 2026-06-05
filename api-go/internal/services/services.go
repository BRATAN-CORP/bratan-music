// Package services contains business-logic objects shared between
// HTTP handlers, the WebSocket hub, and the cron orchestrator. Each
// service takes a *app.App and exposes methods that operate on
// db / redis / storage with a single responsibility area.
//
// Service objects are intentionally small and don't own state of
// their own beyond the *app.App reference — testability follows
// from passing real or stubbed dependencies through `*app.App`.
package services

import (
	"context"

	"github.com/bratan-corp/bratan-music/api-go/internal/app"
)

// Of returns the typed service objects attached to a. Callers cast
// because *app.App stores them as `any` to dodge import cycles.
func Of(a *app.App) Bundle {
	return Bundle{
		Auth:      a.Auth.(*AuthService),
		Users:     a.Users.(*UserService),
		Subs:      a.Subs.(*SubscriptionService),
		Sessions:  a.Sessions.(*SessionService),
		Email:     a.Email.(*EmailOtpService),
		Brevo:     a.Brevo.(*BrevoService),
		History:   a.History.(*HistoryService),
		Playlists: a.Playlists.(*PlaylistService),
		Library:   a.Library.(*LibraryService),
		Health:    a.Health.(*HealthService),
		Tidal:     a.Tidal.(*TidalService),
		Taste:     a.Taste.(*TasteService),
		Recs:      a.Recs.(*RecommendationService),
		Daily:     a.Daily.(*DailyPlaylistService),
		AI:        a.AI.(*AIPlaylistService),
		Rooms:     a.Rooms.(*RoomService),
		Bot:       a.Bot.(*BotService),
	}
}

// Bundle groups the live service handles for a request.
type Bundle struct {
	Auth      *AuthService
	Users     *UserService
	Subs      *SubscriptionService
	Sessions  *SessionService
	Email     *EmailOtpService
	Brevo     *BrevoService
	History   *HistoryService
	Playlists *PlaylistService
	Library   *LibraryService
	Health    *HealthService
	Tidal     *TidalService
	Taste     *TasteService
	Recs      *RecommendationService
	Daily     *DailyPlaylistService
	AI        *AIPlaylistService
	Rooms     *RoomService
	Bot       *BotService
}

// RunScheduledJobs is the cron-trigger entry point. Mirrors
// `runScheduledJobs(env)` from worker/src/cron.ts.
func RunScheduledJobs(ctx context.Context, a *app.App) {
	b := Of(a)
	// 1. Recompute taste vectors for active users.
	b.Taste.RecomputeActive(ctx)
	// 2. Regenerate daily playlists.
	b.Daily.RegenerateForActive(ctx)
	// 3. GC stale recommendation_seen rows + cron run record.
	b.Recs.GCStale(ctx)
}
