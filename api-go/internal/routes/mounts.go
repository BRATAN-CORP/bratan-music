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
			// PUT is the canonical verb (worker shape); POST is
			// kept for legacy client builds that haven't switched.
			r.Put("/{id}/override", uploadOverride(a))
			r.Post("/{id}/override", uploadOverride(a))
			r.Delete("/{id}/override", deleteOverride(a))
			r.Get("/{id}/override", getOverride(a))
			r.Get("/{id}/override/stream", streamOverride(a))
		})
	}
}

func mountCovers(a *app.App) func(chi.Router) {
	return func(r chi.Router) {
		// `/covers/proxy?url=<upstream>` mirrors the worker shape.
		// The frontend hits this from `src/lib/offline/streamResolver.ts`.
		r.Get("/proxy", proxyCover(a))
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
		r.Get("/", listUploads(a))
		r.Post("/", createUpload(a))
		r.Get("/{id}", getUpload(a))
		r.Put("/{id}", updateUploadMeta(a))
		r.Put("/{id}/file", replaceUploadFile(a))
		r.Delete("/{id}", deleteUpload(a))
		r.Get("/{id}/stream", streamUpload(a))
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
		r.Get("/list", exploreList(a))
		r.Get("/playlists/{uuid}/tracks", explorePlaylist(a))
	}
}

func mountRecommendations(a *app.App) func(chi.Router) {
	return func(r chi.Router) {
		r.Use(middleware.JWTAuth(a.Cfg.JWTSecret, a.DB))
		r.Get("/wave", recsWave(a))
		r.Post("/continue", recsContinue(a))
		r.Get("/genre-seeds", recsGetGenreSeeds(a))
		r.Post("/genre-seeds", recsSetGenreSeeds(a))
		r.Get("/seed-artists", recsGetSeedArtists(a))
		r.Post("/seed-artists", recsSetSeedArtists(a))
		r.Get("/dislikes", recsDislikesList(a))
		r.Post("/dislikes", recsDislikePost(a))
		r.Get("/dislikes/details", recsDislikesDetails(a))
		r.Delete("/dislikes/{kind}/{itemId}", recsDislikeDelete(a))
		r.Get("/artists/search", recsArtistsSearch(a))
		r.Get("/artists/suggested", recsArtistsSuggested(a))
	}
}

func mountDailyPlaylists(a *app.App) func(chi.Router) {
	return func(r chi.Router) {
		r.Use(middleware.JWTAuth(a.Cfg.JWTSecret, a.DB))
		r.Get("/today", dailyToday(a))
		r.Post("/save/{id}", dailySave(a))
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
		// WS upgrade does its own ?token=-based auth — must stay
		// outside the JWTAuth group because the browser cannot
		// attach an Authorization header to `new WebSocket(...)`.
		r.Get("/{id}/chat/ws", roomChatWS(a))
		r.Group(func(r chi.Router) {
			r.Use(middleware.JWTAuth(a.Cfg.JWTSecret, a.DB))
			r.Get("/", listRooms(a))
			r.Post("/", createRoom(a))
			r.Post("/join", joinRoom(a)) // matches worker shape: POST /rooms/join with {code}
			r.Get("/{id}", getRoom(a))
			r.Get("/{id}/state", getRoomState(a))
			r.Post("/{id}/heartbeat", roomHeartbeat(a))
			r.Get("/{id}/chat", getRoomChat(a))
			r.Post("/{id}/chat", postRoomChat(a))
			r.Post("/{id}/control", roomControl(a))
			r.Post("/{id}/leave", leaveRoom(a))
			r.Patch("/{id}/settings", patchRoomSettings(a))
			r.Delete("/{id}", deleteRoom(a))
			r.Get("/{id}/stream/{source}/{rawId}", roomStream(a))
		})
	}
}

func mountAIPlaylists(a *app.App) func(chi.Router) {
	return func(r chi.Router) {
		r.Use(middleware.JWTAuth(a.Cfg.JWTSecret, a.DB))
		r.Post("/generate", aiGenerate(a))
		r.Post("/save", aiSave(a))
	}
}
