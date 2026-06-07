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

// streamTrack resolves the playable stream URL for a track and returns
// the worker-compatible JSON payload `{ url, direct, source, quality }`.
//
// Parity note (was a first-pass divergence): the worker's
// `/tracks/:id/stream` ALWAYS returns JSON and the frontend
// (src/hooks/useAudioPlayer.ts) reads `res.url`. The earlier Go
// implementation defaulted to a 302 redirect to the raw CDN URL, which
// (a) broke the frontend's `api.get(...).json()` parse and (b) handed
// the client an IP-locked CDN URL that 403s off-server. We now:
//   - wrap the resolved CDN URL in the same-origin `/tracks/audio`
//     proxy so the client gets a stable, CORS-friendly, Range-capable
//     URL (see audio.go),
//   - expose the raw CDN URL as `direct` for diagnostics/parity only,
//   - keep `?redirect=1` as an explicit opt-in for native clients that
//     want a 302 to the proxied URL.
func streamTrack(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := chi.URLParam(r, "id")
		quality := strings.ToUpper(r.URL.Query().Get("quality"))
		resolved, err := tidalSvc(a).API.ResolveStream(r.Context(), id, quality)
		if err != nil {
			httpx.Err(w, http.StatusBadGateway, "resolve stream: "+err.Error())
			return
		}
		proxied := proxiedAudioURL(r, resolved.URL)
		if r.URL.Query().Get("redirect") == "1" {
			http.Redirect(w, r, proxied, http.StatusFound)
			return
		}
		httpx.JSON(w, 200, map[string]any{
			"url":     proxied,
			"direct":  resolved.URL,
			"source":  "tidal",
			"quality": resolved.Quality,
		})
	}
}

// proxiedAudioURL wraps a raw Tidal CDN URL in this server's
// same-origin `/tracks/audio` proxy. Mirrors the room-stream builder
// in rooms.go so both playback paths hand out identical, stable URLs.
func proxiedAudioURL(r *http.Request, cdnURL string) string {
	scheme := "https"
	if r.TLS == nil && r.Header.Get("X-Forwarded-Proto") == "" {
		scheme = "http"
	}
	if xf := r.Header.Get("X-Forwarded-Proto"); xf != "" {
		scheme = xf
	}
	host := r.Host
	if forwarded := r.Header.Get("X-Forwarded-Host"); forwarded != "" {
		host = forwarded
	}
	return scheme + "://" + host + "/tracks/audio?url=" + encodeQuery(cdnURL)
}

// trackRadio returns the "Similar" feed for a track. Ported from
// worker PR #485 + #487: a real fallback chain so the section is never
// empty for niche/new tracks (Tidal often 404s track-radio with
// subStatus 2001 — "Track radio cannot be generated").
//
// Chain (each layer wrapped, results deduped + seed removed):
//  1. Tidal /v1/tracks/:id/radio   — canonical seed mix
//  2. Tidal /v1/artists/:id/radio  — broader artist anchor
//  3. /v1/artists/:id/toptracks    — last-ditch, almost always works
//  4. Same-album sibling tracks    — only if still < 5 items
//
// Returns `{ items: [...] }` to match the worker shape.
func trackRadio(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := chi.URLParam(r, "id")
		ctx := r.Context()
		svc := tidalSvc(a)

		const target = 5
		seen := map[string]bool{id: true}
		out := make([]tidal.Track, 0, 25)
		add := func(items []tidal.Track) {
			for _, t := range items {
				if t.ID == "" || seen[t.ID] {
					continue
				}
				seen[t.ID] = true
				out = append(out, t)
			}
		}

		// 1. Track radio (canonical). Swallow 404/empty — niche tracks
		//    legitimately have no seed mix.
		if res, err := svc.API.GetTrackRadio(ctx, id, 25); err == nil && res != nil {
			add(mapTracks(res.Items))
		}

		// Resolve the seed track's primary artist for the artist-anchored
		// fallbacks below.
		var artistID string
		if t, err := svc.API.GetTrack(ctx, id); err == nil && t != nil {
			artistID = primaryArtistID(t)
		}

		// 2. Artist radio.
		if len(out) < target && artistID != "" {
			if res, err := svc.API.GetArtistRadio(ctx, artistID, 50); err == nil && res != nil {
				add(mapTracks(res.Items))
			}
		}

		// 3. Artist top tracks (last-ditch — almost always returns).
		if len(out) < target && artistID != "" {
			if res, err := svc.API.GetArtistTopTracks(ctx, artistID, 50); err == nil && res != nil {
				add(mapTracks(res.Items))
			}
		}

		// 4. Same-album siblings (only if we're still short).
		if len(out) < target {
			if t, err := svc.API.GetTrack(ctx, id); err == nil && t != nil {
				if albumID := albumIDOf(t); albumID != "" {
					if res, err := svc.API.GetAlbumTracks(ctx, albumID, 50); err == nil && res != nil {
						add(mapTracks(res.Items))
					}
				}
			}
		}

		httpx.JSON(w, 200, map[string]any{"items": out})
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

// getArtist returns the rich artist-page composite, mirroring the worker's
// GET /artists/:id (worker/src/routes/artists.ts). The frontend artist page
// (src/app/artist/page.tsx) reads `topTracks`, `albums`, `singles`,
// `similarArtists` and the `*MoreTotal` counts straight off this response;
// the old Go handler returned only the bare {id,name,imageUrl}, so every
// section came back undefined and the page rendered empty ("карточки
// артистов пустые"). Each Tidal sub-call is independent and tolerated
// per-bucket (allSettled semantics): a single 451/5xx must not blank the
// whole page.
func getArtist(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := chi.URLParam(r, "id")
		api := tidalSvc(a).API
		ctx := r.Context()

		artistRaw, artErr := api.GetArtist(ctx, id)

		topTracks := []tidal.Track{}
		if tt, err := api.GetArtistTopTracks(ctx, id, 10); err == nil && tt != nil {
			for i := range tt.Items {
				topTracks = append(topTracks, tidal.MapTrack(&tt.Items[i]))
			}
		}

		albums := []tidal.Album{}
		var albumsTotal int
		if al, err := api.GetArtistAlbums(ctx, id, 50, "ALBUMS"); err == nil && al != nil {
			for i := range al.Items {
				albums = append(albums, tidal.MapAlbum(&al.Items[i], nil))
			}
			albumsTotal = al.TotalNumberOfItems
		}

		singles := []tidal.Album{}
		var singlesTotal int
		if sg, err := api.GetArtistAlbums(ctx, id, 50, "EPSANDSINGLES"); err == nil && sg != nil {
			for i := range sg.Items {
				singles = append(singles, tidal.MapAlbum(&sg.Items[i], nil))
			}
			singlesTotal = sg.TotalNumberOfItems
		}

		similar := []tidal.Artist{}
		if sm, err := api.GetSimilarArtists(ctx, id, 20); err == nil && sm != nil {
			for i := range sm.Items {
				similar = append(similar, tidal.MapArtist(&sm.Items[i]))
			}
		}

		// Resolve the artist header. If the dedicated record is unavailable,
		// synthesise {id,name} from a release that credits this artist —
		// enough for the page header to render (image is lost, same as TS).
		var artist tidal.Artist
		if artErr == nil && artistRaw != nil {
			artist = tidal.MapArtist(artistRaw)
		} else {
			artist = tidal.Artist{ID: id, Source: "tidal"}
			for _, rel := range append(append([]tidal.Album{}, albums...), singles...) {
				for _, ar := range rel.Artists {
					if ar.ID == id {
						artist.Name = ar.Name
						break
					}
				}
				if artist.Name != "" {
					break
				}
			}
			if artist.Name == "" {
				httpx.Err(w, http.StatusNotFound, "Artist not found")
				return
			}
		}

		out := map[string]any{
			"id":             artist.ID,
			"source":         artist.Source,
			"name":           artist.Name,
			"topTracks":      topTracks,
			"albums":         albums,
			"singles":        singles,
			"similarArtists": similar,
		}
		if artist.ImageURL != "" {
			out["imageUrl"] = artist.ImageURL
		}
		// Expose the catalogue totals so the page can decide whether to show
		// a "view all" affordance (FE: `(albumsMoreTotal ?? albums.length) > 10`).
		if albumsTotal > len(albums) {
			out["albumsMoreTotal"] = albumsTotal
		}
		if singlesTotal > len(singles) {
			out["singlesMoreTotal"] = singlesTotal
		}
		httpx.JSON(w, 200, out)
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

// getArtistAlbums / getArtistSingles back the paginated "view all" feeds on
// the artist page. The frontend (useArtistAlbumsInfinite) expects
// `{ items, totalItems }` and pages with offset/limit — the old handlers
// returned a bare array, so `lastPage.items` was undefined and the feed
// broke. Offset is honoured so subsequent pages actually advance.
func getArtistReleasesFeed(a *app.App, filter string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := chi.URLParam(r, "id")
		limit := queryInt(r, "limit", 50)
		offset := queryInt(r, "offset", 0)
		raw, err := tidalSvc(a).API.GetArtistAlbumsPaged(r.Context(), id, limit, offset, filter)
		if err != nil {
			httpx.Internal(w, err)
			return
		}
		items := make([]tidal.Album, 0, len(raw.Items))
		for i := range raw.Items {
			items = append(items, tidal.MapAlbum(&raw.Items[i], nil))
		}
		out := map[string]any{"items": items}
		if raw.TotalNumberOfItems > 0 {
			out["totalItems"] = raw.TotalNumberOfItems
		}
		httpx.JSON(w, 200, out)
	}
}

func getArtistAlbums(a *app.App) http.HandlerFunc {
	return getArtistReleasesFeed(a, "ALBUMS")
}

func getArtistSingles(a *app.App) http.HandlerFunc {
	return getArtistReleasesFeed(a, "EPSANDSINGLES")
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

// ---- radio helpers ----------------------------------------------------

// mapTracks normalises a slice of upstream TrackRaw into API Tracks.
func mapTracks(items []tidal.TrackRaw) []tidal.Track {
	out := make([]tidal.Track, 0, len(items))
	for i := range items {
		out = append(out, tidal.MapTrack(&items[i]))
	}
	return out
}

// primaryArtistID returns the seed track's main artist id (string),
// preferring the explicit `artist` field then the first `artists[]`.
func primaryArtistID(t *tidal.TrackRaw) string {
	if t == nil {
		return ""
	}
	if t.Artist != nil && t.Artist.ID != 0 {
		return strconv.FormatInt(t.Artist.ID, 10)
	}
	if len(t.Artists) > 0 && t.Artists[0].ID != 0 {
		return strconv.FormatInt(t.Artists[0].ID, 10)
	}
	return ""
}

// albumIDOf returns the seed track's album id (string) or "".
func albumIDOf(t *tidal.TrackRaw) string {
	if t == nil || t.Album == nil || t.Album.ID == 0 {
		return ""
	}
	return strconv.FormatInt(t.Album.ID, 10)
}
