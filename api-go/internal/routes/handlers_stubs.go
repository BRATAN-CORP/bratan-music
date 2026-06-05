package routes

import (
	"net/http"

	"github.com/bratan-corp/bratan-music/api-go/internal/app"
)

// Stubs for handlers whose full port is scheduled for a follow-up
// commit of this PR. Each returns 501 Not Implemented so the legacy
// worker remains the source of truth for these endpoints in the
// meantime.

// search* / getTrack / streamTrack / trackLyrics / getAlbum* /
// getArtist* are implemented in tidal_routes.go.
// telegramWebhook is implemented in internal/routes/webhook.go.
func telegramWebhook(a *app.App) http.HandlerFunc { return telegramWebhookImpl(a) }
// adminTidal* implemented in tidal_routes.go.
// Admin moderation handlers implemented in internal/routes/admin_users.go
// + internal/routes/admin_health.go.
func adminHealth(a *app.App) http.HandlerFunc { return adminHealthImpl(a) }
func adminBan(a *app.App) http.HandlerFunc    { return adminBanImpl(a) }
func adminUnban(a *app.App) http.HandlerFunc  { return adminUnbanImpl(a) }
func adminGrant(a *app.App) http.HandlerFunc  { return adminGrantImpl(a) }
// adminResetDaily delegates to internal/routes/admin_daily.go.
func adminResetDaily(a *app.App) http.HandlerFunc { return adminResetDailyImpl(a) }
// dailyToday / dailySave implemented in internal/routes/daily.go.
// aiGenerate / aiSave implemented in internal/routes/ai_playlists.go.
func aiGenerate(a *app.App) http.HandlerFunc { return aiGenerateImpl(a) }
