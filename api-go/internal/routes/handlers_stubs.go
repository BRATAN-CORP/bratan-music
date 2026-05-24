package routes

import (
	"net/http"

	"github.com/bratan-corp/bratan-music/api-go/internal/app"
)

// Stubs for handlers whose full port is scheduled for a follow-up
// commit of this PR. Each returns 501 Not Implemented so the legacy
// worker remains the source of truth for these endpoints in the
// meantime.

func searchAny(a *app.App) http.HandlerFunc          { _ = a; return notImplemented }
func searchTracks(a *app.App) http.HandlerFunc       { _ = a; return notImplemented }
func searchAlbums(a *app.App) http.HandlerFunc       { _ = a; return notImplemented }
func searchArtists(a *app.App) http.HandlerFunc      { _ = a; return notImplemented }
func searchPlaylists(a *app.App) http.HandlerFunc    { _ = a; return notImplemented }
func getTrack(a *app.App) http.HandlerFunc           { _ = a; return notImplemented }
func streamTrack(a *app.App) http.HandlerFunc        { _ = a; return notImplemented }
func trackLyrics(a *app.App) http.HandlerFunc        { _ = a; return notImplemented }
func uploadOverride(a *app.App) http.HandlerFunc     { _ = a; return notImplemented }
func deleteOverride(a *app.App) http.HandlerFunc     { _ = a; return notImplemented }
func proxyCover(a *app.App) http.HandlerFunc         { _ = a; return notImplemented }
func getAlbum(a *app.App) http.HandlerFunc           { _ = a; return notImplemented }
func getAlbumTracks(a *app.App) http.HandlerFunc     { _ = a; return notImplemented }
func getArtist(a *app.App) http.HandlerFunc          { _ = a; return notImplemented }
func getArtistTopTracks(a *app.App) http.HandlerFunc { _ = a; return notImplemented }
func getArtistAlbums(a *app.App) http.HandlerFunc    { _ = a; return notImplemented }
func getArtistSingles(a *app.App) http.HandlerFunc   { _ = a; return notImplemented }
func getArtistReleases(a *app.App) http.HandlerFunc  { _ = a; return notImplemented }
func createUpload(a *app.App) http.HandlerFunc       { _ = a; return notImplemented }
func listUploads(a *app.App) http.HandlerFunc        { _ = a; return notImplemented }
func deleteUpload(a *app.App) http.HandlerFunc       { _ = a; return notImplemented }
func telegramWebhook(a *app.App) http.HandlerFunc    { _ = a; return notImplemented }
func adminTidalAccounts(a *app.App) http.HandlerFunc { _ = a; return notImplemented }
func adminTidalStart(a *app.App) http.HandlerFunc    { _ = a; return notImplemented }
func adminTidalPoll(a *app.App) http.HandlerFunc     { _ = a; return notImplemented }
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
func roomWS(a *app.App) http.HandlerFunc             { _ = a; return notImplemented }
func createRoom(a *app.App) http.HandlerFunc         { _ = a; return notImplemented }
func getRoom(a *app.App) http.HandlerFunc            { _ = a; return notImplemented }
func joinRoom(a *app.App) http.HandlerFunc           { _ = a; return notImplemented }
func leaveRoom(a *app.App) http.HandlerFunc          { _ = a; return notImplemented }
func roomControl(a *app.App) http.HandlerFunc        { _ = a; return notImplemented }
func aiGenerate(a *app.App) http.HandlerFunc         { _ = a; return notImplemented }
