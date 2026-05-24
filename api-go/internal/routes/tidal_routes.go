package routes

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/bratan-corp/bratan-music/api-go/internal/app"
	"github.com/bratan-corp/bratan-music/api-go/internal/httpx"
	"github.com/bratan-corp/bratan-music/api-go/internal/services"
	"github.com/bratan-corp/bratan-music/api-go/internal/tidal"
)

// tidalSvc returns the typed Tidal service from the app container.
// Held outside the handlers so each handler stays a single expression.
func tidalSvc(a *app.App) *services.TidalService {
	if t, ok := a.Tidal.(*services.TidalService); ok {
		return t
	}
	return nil
}

func queryInt(r *http.Request, key string, def int) int {
	s := r.URL.Query().Get(key)
	if s == "" {
		return def
	}
	v, err := strconv.Atoi(s)
	if err != nil || v < 0 {
		return def
	}
	return v
}

// ---- search -----------------------------------------------------------

func searchAny(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		q := strings.TrimSpace(r.URL.Query().Get("q"))
		if q == "" {
			httpx.Err(w, http.StatusBadRequest, "q is required")
			return
		}
		limit := queryInt(r, "limit", 25)
		offset := queryInt(r, "offset", 0)
		ts := tidalSvc(a)
		raw, err := ts.API.Search(r.Context(), q, "ARTISTS,ALBUMS,TRACKS", limit, offset)
		if err != nil {
			httpx.Internal(w, err)
			return
		}
		httpx.JSON(w, 200, buildSearchResult(raw))
	}
}

func searchTracks(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		q := strings.TrimSpace(r.URL.Query().Get("q"))
		if q == "" {
			httpx.Err(w, http.StatusBadRequest, "q is required")
			return
		}
		limit := queryInt(r, "limit", 25)
		offset := queryInt(r, "offset", 0)
		raw, err := tidalSvc(a).API.Search(r.Context(), q, "TRACKS", limit, offset)
		if err != nil {
			httpx.Internal(w, err)
			return
		}
		httpx.JSON(w, 200, buildSearchResult(raw))
	}
}

func searchAlbums(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		q := strings.TrimSpace(r.URL.Query().Get("q"))
		if q == "" {
			httpx.Err(w, http.StatusBadRequest, "q is required")
			return
		}
		raw, err := tidalSvc(a).API.Search(r.Context(), q, "ALBUMS",
			queryInt(r, "limit", 25), queryInt(r, "offset", 0))
		if err != nil {
			httpx.Internal(w, err)
			return
		}
		httpx.JSON(w, 200, buildSearchResult(raw))
	}
}

func searchArtists(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		q := strings.TrimSpace(r.URL.Query().Get("q"))
		if q == "" {
			httpx.Err(w, http.StatusBadRequest, "q is required")
			return
		}
		raw, err := tidalSvc(a).API.Search(r.Context(), q, "ARTISTS",
			queryInt(r, "limit", 25), queryInt(r, "offset", 0))
		if err != nil {
			httpx.Internal(w, err)
			return
		}
		httpx.JSON(w, 200, buildSearchResult(raw))
	}
}

func buildSearchResult(raw *tidal.SearchResponse) *tidal.SearchResult {
	out := &tidal.SearchResult{
		Tracks:  []tidal.Track{},
		Albums:  []tidal.Album{},
		Artists: []tidal.Artist{},
	}
	if raw.Tracks != nil {
		items := tidal.UnwrapBucket[tidal.TrackRaw](raw.Tracks)
		for i := range items {
			out.Tracks = append(out.Tracks, tidal.MapTrack(&items[i]))
		}
		tt := raw.Tracks.TotalNumberOfItems
		out.TotalTracks = &tt
	}
	if raw.Albums != nil {
		items := tidal.UnwrapBucket[tidal.AlbumRaw](raw.Albums)
		for i := range items {
			out.Albums = append(out.Albums, tidal.MapAlbum(&items[i], nil))
		}
		tt := raw.Albums.TotalNumberOfItems
		out.TotalAlbums = &tt
	}
	if raw.Artists != nil {
		items := tidal.UnwrapBucket[tidal.ArtistRaw](raw.Artists)
		for i := range items {
			out.Artists = append(out.Artists, tidal.MapArtist(&items[i]))
		}
		tt := raw.Artists.TotalNumberOfItems
		out.TotalArtists = &tt
	}
	if raw.Playlists != nil {
		items := tidal.UnwrapBucket[tidal.PlaylistRaw](raw.Playlists)
		for i := range items {
			out.Playlists = append(out.Playlists, tidal.MapPlaylist(&items[i]))
		}
		tt := raw.Playlists.TotalNumberOfItems
		out.TotalPlaylists = &tt
	}
	return out
}

// searchPlaylists handles GET /search/playlists. The worker only
// exposed playlist search through `/search?filter=playlists` — the
// Go side splits the bucket out as a dedicated endpoint so the
// per-type pagination defaults can be richer (50 by default, same
// as tracks/albums/artists).
func searchPlaylists(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		q := strings.TrimSpace(r.URL.Query().Get("q"))
		if q == "" {
			httpx.Err(w, http.StatusBadRequest, "q is required")
			return
		}
		limit := queryInt(r, "limit", 50)
		offset := queryInt(r, "offset", 0)
		raw, err := tidalSvc(a).API.Search(r.Context(), q, "PLAYLISTS", limit, offset)
		if err != nil {
			httpx.Internal(w, err)
			return
		}
		httpx.JSON(w, 200, buildSearchResult(raw))
	}
}

// ---- tracks -----------------------------------------------------------

func getTrack(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := chi.URLParam(r, "id")
		raw, err := tidalSvc(a).API.GetTrack(r.Context(), id)
		if err != nil {
			httpx.Internal(w, err)
			return
		}
		httpx.JSON(w, 200, tidal.MapTrack(raw))
	}
}

// streamTrack resolves the playable stream URL for a track and 302's
// to it. The legacy `worker/` did the same; some clients (mobile audio
// engines) prefer the redirect over the JSON payload because it lets
// them use the browser's Range-request handling unmodified.
func streamTrack(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := chi.URLParam(r, "id")
		quality := strings.ToUpper(r.URL.Query().Get("quality"))
		resolved, err := tidalSvc(a).API.ResolveStream(r.Context(), id, quality)
		if err != nil {
			httpx.Err(w, http.StatusBadGateway, "resolve stream: "+err.Error())
			return
		}
		// Respect ?json=1 for clients that want the raw URL.
		if r.URL.Query().Get("json") == "1" {
			httpx.JSON(w, 200, resolved)
			return
		}
		http.Redirect(w, r, resolved.URL, http.StatusFound)
	}
}

func trackLyrics(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := chi.URLParam(r, "id")
		lyrics, err := tidalSvc(a).API.GetTrackLyrics(r.Context(), id)
		if err != nil {
			httpx.Internal(w, err)
			return
		}
		if lyrics == nil {
			httpx.JSON(w, 200, map[string]any{
				"trackId":       id,
				"lyrics":        nil,
				"subtitles":     nil,
				"isRightToLeft": false,
			})
			return
		}
		httpx.JSON(w, 200, lyrics)
	}
}

// ---- albums -----------------------------------------------------------

func getAlbum(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := chi.URLParam(r, "id")
		raw, err := tidalSvc(a).API.GetAlbum(r.Context(), id)
		if err != nil {
			httpx.Internal(w, err)
			return
		}
		tracksRaw, err := tidalSvc(a).API.GetAlbumTracks(r.Context(), id, 100)
		if err != nil {
			httpx.Internal(w, err)
			return
		}
		tracks := make([]tidal.Track, 0, len(tracksRaw.Items))
		for i := range tracksRaw.Items {
			tracks = append(tracks, tidal.MapTrack(&tracksRaw.Items[i]))
		}
		httpx.JSON(w, 200, tidal.MapAlbum(raw, tracks))
	}
}

func getAlbumTracks(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := chi.URLParam(r, "id")
		raw, err := tidalSvc(a).API.GetAlbumTracks(r.Context(), id, queryInt(r, "limit", 100))
		if err != nil {
			httpx.Internal(w, err)
			return
		}
		out := make([]tidal.Track, 0, len(raw.Items))
		for i := range raw.Items {
			out = append(out, tidal.MapTrack(&raw.Items[i]))
		}
		httpx.JSON(w, 200, out)
	}
}

// ---- artists ----------------------------------------------------------

func getArtist(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := chi.URLParam(r, "id")
		raw, err := tidalSvc(a).API.GetArtist(r.Context(), id)
		if err != nil {
			httpx.Internal(w, err)
			return
		}
		httpx.JSON(w, 200, tidal.MapArtist(raw))
	}
}

func getArtistTopTracks(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := chi.URLParam(r, "id")
		raw, err := tidalSvc(a).API.GetArtistTopTracks(r.Context(), id, queryInt(r, "limit", 10))
		if err != nil {
			httpx.Internal(w, err)
			return
		}
		out := make([]tidal.Track, 0, len(raw.Items))
		for i := range raw.Items {
			out = append(out, tidal.MapTrack(&raw.Items[i]))
		}
		httpx.JSON(w, 200, out)
	}
}

func getArtistAlbums(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := chi.URLParam(r, "id")
		raw, err := tidalSvc(a).API.GetArtistAlbums(r.Context(), id, queryInt(r, "limit", 50), "ALBUMS")
		if err != nil {
			httpx.Internal(w, err)
			return
		}
		out := make([]tidal.Album, 0, len(raw.Items))
		for i := range raw.Items {
			out = append(out, tidal.MapAlbum(&raw.Items[i], nil))
		}
		httpx.JSON(w, 200, out)
	}
}

func getArtistSingles(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := chi.URLParam(r, "id")
		raw, err := tidalSvc(a).API.GetArtistAlbums(r.Context(), id, queryInt(r, "limit", 50), "EPSANDSINGLES")
		if err != nil {
			httpx.Internal(w, err)
			return
		}
		out := make([]tidal.Album, 0, len(raw.Items))
		for i := range raw.Items {
			out = append(out, tidal.MapAlbum(&raw.Items[i], nil))
		}
		httpx.JSON(w, 200, out)
	}
}

// getArtistReleases concatenates albums + EPs/singles + compilations.
// Matches worker/TidalService.getArtistReleases shape (one flat list).
func getArtistReleases(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := chi.URLParam(r, "id")
		limit := queryInt(r, "limit", 50)
		api := tidalSvc(a).API
		albums, err := api.GetArtistAlbums(r.Context(), id, limit, "ALBUMS")
		if err != nil {
			httpx.Internal(w, err)
			return
		}
		singles, err := api.GetArtistAlbums(r.Context(), id, limit, "EPSANDSINGLES")
		if err != nil {
			httpx.Internal(w, err)
			return
		}
		comps, _ := api.GetArtistAlbums(r.Context(), id, limit, "COMPILATIONS")
		out := make([]tidal.Album, 0, len(albums.Items)+len(singles.Items)+8)
		seen := map[string]bool{}
		add := func(items []tidal.AlbumRaw) {
			for i := range items {
				m := tidal.MapAlbum(&items[i], nil)
				if seen[m.ID] {
					continue
				}
				seen[m.ID] = true
				out = append(out, m)
			}
		}
		add(albums.Items)
		add(singles.Items)
		if comps != nil {
			add(comps.Items)
		}
		httpx.JSON(w, 200, out)
	}
}

// ---- admin tidal device flow -----------------------------------------

func adminTidalAccounts(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// Single-account first pass. Return whatever the session table
		// has so the admin UI can verify a session is wired in.
		var hasRow bool
		var updatedAt int64
		var userID int64
		_ = a.DB.QueryRow(r.Context(),
			`SELECT TRUE, updated_at, user_id FROM tidal_session WHERE id = 1`,
		).Scan(&hasRow, &updatedAt, &userID)
		httpx.JSON(w, 200, map[string]any{
			"accounts": []map[string]any{},
			"legacy": map[string]any{
				"present":   hasRow,
				"updatedAt": updatedAt,
				"userId":    userID,
			},
		})
	}
}

func adminTidalStart(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		auth := tidalSvc(a).Auth
		da, err := auth.StartDeviceAuth(r.Context())
		if err != nil {
			httpx.Err(w, http.StatusBadGateway, err.Error())
			return
		}
		httpx.JSON(w, 200, da)
	}
}

func adminTidalPoll(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			DeviceCode string `json:"deviceCode"`
		}
		if err := httpx.BindJSON(r, &body, 4096); err != nil {
			httpx.Err(w, http.StatusBadRequest, err.Error())
			return
		}
		if body.DeviceCode == "" {
			httpx.Err(w, http.StatusBadRequest, "deviceCode is required")
			return
		}
		res, err := tidalSvc(a).Auth.PollDeviceAuth(r.Context(), body.DeviceCode)
		if err != nil {
			httpx.Internal(w, err)
			return
		}
		if !res.OK {
			httpx.JSON(w, 200, map[string]any{
				"ok":      false,
				"pending": res.Pending,
				"error":   res.Error,
			})
			return
		}
		httpx.JSON(w, 200, map[string]any{
			"ok":        true,
			"expiresIn": res.ExpiresIn,
		})
	}
}
