package routes

import (
	"github.com/bratan-corp/bratan-music/api-go/internal/app"
	"github.com/bratan-corp/bratan-music/api-go/internal/middleware"
	"github.com/go-chi/chi/v5"
)

// Each mountXxx returns a func(chi.Router) configurator suitable for
// `r.Route("/prefix", ...)`. Bodies that aren't ported yet wire a
// catch-all 501 so we don't have to inline mountAll-NotImplemented
// boilerplate at every endpoint.

func mountSearch(a *app.App) func(chi.Router) {
	return func(r chi.Router) {
		r.Use(middleware.JWTAuth(a.Cfg.JWTSecret, a.DB))
		r.Get("/", searchAny(a))
		r.Get("/tracks", searchTracks(a))
		r.Get("/albums", searchAlbums(a))
		r.Get("/artists", searchArtists(a))
		r.Get("/playlists", searchPlaylists(a))
	}
}

func mountTracks(a *app.App) func(chi.Router) {
	return func(r chi.Router) {
		r.Get("/{id}", getTrack(a))
		r.Get("/{id}/stream", streamTrack(a))
		r.Get("/{id}/lyrics", trackLyrics(a))

		r.Group(func(r chi.Router) {
			r.Use(middleware.JWTAuth(a.Cfg.JWTSecret, a.DB))
			r.Post("/{id}/override", uploadOverride(a))
			r.Delete("/{id}/override", deleteOverride(a))
		})
	}
}

func mountCovers(a *app.App) func(chi.Router) {
	return func(r chi.Router) {
		r.Get("/{id}", proxyCover(a))
	}
}

func mountAlbums(a *app.App) func(chi.Router) {
	return func(r chi.Router) {
		r.Get("/{id}", getAlbum(a))
		r.Get("/{id}/tracks", getAlbumTracks(a))
	}
}

func mountArtists(a *app.App) func(chi.Router) {
	return func(r chi.Router) {
		r.Get("/{id}", getArtist(a))
		r.Get("/{id}/top-tracks", getArtistTopTracks(a))
		r.Get("/{id}/albums", getArtistAlbums(a))
		r.Get("/{id}/singles", getArtistSingles(a))
		r.Get("/{id}/releases", getArtistReleases(a))
	}
}

func mountUploads(a *app.App) func(chi.Router) {
	return func(r chi.Router) {
		r.Use(middleware.JWTAuth(a.Cfg.JWTSecret, a.DB))
		r.Post("/", createUpload(a))
		r.Get("/", listUploads(a))
		r.Delete("/{id}", deleteUpload(a))
	}
}

func mountWebhook(a *app.App) func(chi.Router) {
	return func(r chi.Router) {
		r.Post("/telegram", telegramWebhook(a))
	}
}

func mountAdmin(a *app.App) func(chi.Router) {
	return func(r chi.Router) {
		r.Use(middleware.JWTAuth(a.Cfg.JWTSecret, a.DB))
		r.Use(middleware.AdminOnly)
		r.Get("/tidal/accounts", adminTidalAccounts(a))
		r.Post("/tidal/accounts/start", adminTidalStart(a))
		r.Post("/tidal/accounts/poll", adminTidalPoll(a))
		r.Get("/health", adminHealth(a))
		r.Post("/users/{id}/ban", adminBan(a))
		r.Post("/users/{id}/unban", adminUnban(a))
		r.Post("/users/{id}/grant", adminGrant(a))
		r.Post("/daily-playlists/reset", adminResetDaily(a))
	}
}

func mountExplore(a *app.App) func(chi.Router) {
	return func(r chi.Router) {
		r.Use(middleware.JWTAuth(a.Cfg.JWTSecret, a.DB))
		r.Get("/", exploreHome(a))
		r.Get("/page/{slug}", explorePage(a))
		r.Get("/playlist/{id}", explorePlaylist(a))
	}
}

func mountRecommendations(a *app.App) func(chi.Router) {
	return func(r chi.Router) {
		r.Use(middleware.JWTAuth(a.Cfg.JWTSecret, a.DB))
		r.Get("/wave", recsWave(a))
		r.Get("/radio/track/{id}", recsTrackRadio(a))
		r.Get("/dislikes/details", recsDislikesDetails(a))
		r.Post("/dislike/{kind}/{id}", recsDislike(a))
		r.Delete("/dislike/{kind}/{id}", recsUndislike(a))
	}
}

func mountDailyPlaylists(a *app.App) func(chi.Router) {
	return func(r chi.Router) {
		r.Use(middleware.JWTAuth(a.Cfg.JWTSecret, a.DB))
		r.Get("/", listDaily(a))
		r.Get("/{variant}", getDaily(a))
		r.Post("/{variant}/seen", markDailySeen(a))
	}
}

func mountHistory(a *app.App) func(chi.Router) {
	return func(r chi.Router) {
		r.Use(middleware.JWTAuth(a.Cfg.JWTSecret, a.DB))
		r.Get("/recent", historyRecent(a))
		r.Post("/play", historyPlay(a))
		r.Delete("/", historyClear(a))
	}
}

func mountRooms(a *app.App) func(chi.Router) {
	return func(r chi.Router) {
		r.Get("/ws/{id}", roomWS(a))
		r.Group(func(r chi.Router) {
			r.Use(middleware.JWTAuth(a.Cfg.JWTSecret, a.DB))
			r.Post("/", createRoom(a))
			r.Get("/{id}", getRoom(a))
			r.Post("/{id}/join", joinRoom(a))
			r.Post("/{id}/leave", leaveRoom(a))
			r.Post("/{id}/control", roomControl(a))
		})
	}
}

func mountAIPlaylists(a *app.App) func(chi.Router) {
	return func(r chi.Router) {
		r.Use(middleware.JWTAuth(a.Cfg.JWTSecret, a.DB))
		r.Post("/", aiGenerate(a))
	}
}
