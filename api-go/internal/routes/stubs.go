package routes

import (
	"net/http"

	"github.com/bratan-corp/bratan-music/api-go/internal/app"
	"github.com/bratan-corp/bratan-music/api-go/internal/httpx"
	"github.com/go-chi/chi/v5"
)

// Each Mount-er below returns a chi sub-router configured for one
// resource prefix in worker/src/index.ts. The body of each handler
// is the real port from the corresponding worker/src/routes/<x>.ts
// file. Anything that isn't ported yet returns 501 with a clear
// message — the legacy worker stays up as a fallback in this PR so
// the user-facing app doesn't break.

func notImplemented(w http.ResponseWriter, _ *http.Request) {
	httpx.Err(w, http.StatusNotImplemented, "Маршрут не реализован")
}

// Auth — see routes/auth.go
func Auth(a *app.App) func(chi.Router) { return mountAuth(a) }

// User — see routes/user.go
func User(a *app.App) func(chi.Router) { return mountUser(a) }

// Search — Tidal search proxy.
func Search(a *app.App) func(chi.Router) { return mountSearch(a) }

// Tracks — track metadata + audio stream resolver + overrides.
func Tracks(a *app.App) func(chi.Router) { return mountTracks(a) }

// Covers — proxied cover art cache.
func Covers(a *app.App) func(chi.Router) { return mountCovers(a) }

// Albums — album metadata.
func Albums(a *app.App) func(chi.Router) { return mountAlbums(a) }

// Artists — artist metadata, top tracks, releases.
func Artists(a *app.App) func(chi.Router) { return mountArtists(a) }

// Playlists — full CRUD.
func Playlists(a *app.App) func(chi.Router) { return mountPlaylists(a) }

// Library — likes (track / album / artist) + listing.
func Library(a *app.App) func(chi.Router) { return mountLibrary(a) }

// Uploads — user-uploaded custom tracks.
func Uploads(a *app.App) func(chi.Router) { return mountUploads(a) }

// Webhook — Telegram bot webhook (HMAC verified).
func Webhook(a *app.App) func(chi.Router) { return mountWebhook(a) }

// Admin — admin-only operations.
func Admin(a *app.App) func(chi.Router) { return mountAdmin(a) }

// Explore — Tidal homepage modules (mood / genre / what's new).
func Explore(a *app.App) func(chi.Router) { return mountExplore(a) }

// Recommendations — wave / radio / personalised.
func Recommendations(a *app.App) func(chi.Router) { return mountRecommendations(a) }

// DailyPlaylists — list / preview / mark-seen.
func DailyPlaylists(a *app.App) func(chi.Router) { return mountDailyPlaylists(a) }

// History — listening history.
func History(a *app.App) func(chi.Router) { return mountHistory(a) }

// Rooms — listening rooms (REST + WS upgrade).
func Rooms(a *app.App) func(chi.Router) { return mountRooms(a) }

// AIPlaylists — on-demand AI-generated playlists (Yandex GPT).
func AIPlaylists(a *app.App) func(chi.Router) { return mountAIPlaylists(a) }
