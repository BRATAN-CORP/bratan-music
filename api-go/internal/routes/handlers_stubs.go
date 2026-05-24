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
func searchPlaylists(a *app.App) http.HandlerFunc    { _ = a; return notImplemented }
func createUpload(a *app.App) http.HandlerFunc       { _ = a; return notImplemented }
func listUploads(a *app.App) http.HandlerFunc        { _ = a; return notImplemented }
func deleteUpload(a *app.App) http.HandlerFunc       { _ = a; return notImplemented }
func telegramWebhook(a *app.App) http.HandlerFunc    { _ = a; return notImplemented }
// adminTidal* implemented in tidal_routes.go.
func adminHealth(a *app.App) http.HandlerFunc        { _ = a; return notImplemented }
func adminBan(a *app.App) http.HandlerFunc           { _ = a; return notImplemented }
func adminUnban(a *app.App) http.HandlerFunc         { _ = a; return notImplemented }
func adminGrant(a *app.App) http.HandlerFunc         { _ = a; return notImplemented }
func adminResetDaily(a *app.App) http.HandlerFunc    { _ = a; return notImplemented }
func exploreHome(a *app.App) http.HandlerFunc        { _ = a; return notImplemented }
func explorePage(a *app.App) http.HandlerFunc        { _ = a; return notImplemented }
func explorePlaylist(a *app.App) http.HandlerFunc    { _ = a; return notImplemented }
func recsWave(a *app.App) http.HandlerFunc           { _ = a; return notImplemented }
func recsTrackRadio(a *app.App) http.HandlerFunc     { _ = a; return notImplemented }
func recsDislikesDetails(a *app.App) http.HandlerFunc { _ = a; return notImplemented }
func recsDislike(a *app.App) http.HandlerFunc        { _ = a; return notImplemented }
func recsUndislike(a *app.App) http.HandlerFunc      { _ = a; return notImplemented }
func listDaily(a *app.App) http.HandlerFunc          { _ = a; return notImplemented }
func getDaily(a *app.App) http.HandlerFunc           { _ = a; return notImplemented }
func markDailySeen(a *app.App) http.HandlerFunc      { _ = a; return notImplemented }
func aiGenerate(a *app.App) http.HandlerFunc         { _ = a; return notImplemented }
