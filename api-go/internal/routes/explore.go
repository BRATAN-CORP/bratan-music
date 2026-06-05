package routes

import (
	"encoding/json"
	"net/http"
	"regexp"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/bratan-corp/bratan-music/api-go/internal/app"
	"github.com/bratan-corp/bratan-music/api-go/internal/httpx"
	"github.com/bratan-corp/bratan-music/api-go/internal/tidal"
)

// unwrapJSON is a thin wrapper around tidal.UnwrapItem so this file
// can stay readable without sprinkling the package prefix on every
// call site.
func unwrapJSON[T any](msg []byte) (*T, error) {
	return tidal.UnwrapItem[T](json.RawMessage(msg))
}

// Ported from worker/src/routes/explore.ts + the explore-related
// methods of worker/src/services/tidal/TidalService.ts
// (getExplorePage / getExploreList / mapPageModule).
//
//   GET /explore                              top-level Explore page
//   GET /explore/page/:slug                   specific page (genre/mood/decade)
//   GET /explore/list?path=…&type=…           paginate a module ("View all")
//   GET /explore/playlists/:uuid/tracks       tracks of an editorial playlist
//
// The active "explicit twin swap" pass the worker runs on tracks/albums
// is intentionally not ported in this first pass — that logic lives in
// the TidalService and depends on KV-memoised twin lookups, which we'll
// port together with the recommendation service. The explore payload
// shape stays identical either way; clean editions will simply remain
// in place until the twin-swap port lands.

var (
	exploreSlugRE = regexp.MustCompile(`^[a-zA-Z0-9_-]+$`)
	exploreUUIDRE = regexp.MustCompile(`^[a-fA-F0-9-]{36}$`)
	// `dataApiPath` from Tidal always starts with `pages/…`. The
	// allowlist below pins the proxy to that prefix so this endpoint
	// can't be abused to SSRF into arbitrary upstream Tidal API
	// routes via the `path` query param.
	exploreListPathRE = regexp.MustCompile(`^pages/[a-zA-Z0-9/_-]+$`)
)

// exploreModule mirrors the worker's ExploreModule discriminated union
// as a single concrete shape. The frontend reads `type` and uses it to
// pick the right item renderer.
type exploreModule struct {
	Type        string `json:"type"`
	Title       string `json:"title"`
	Items       any    `json:"items"`
	MoreAPIPath string `json:"moreApiPath,omitempty"`
	TotalItems  *int   `json:"totalItems,omitempty"`
}

type explorePageDTO struct {
	Title   string          `json:"title"`
	Modules []exploreModule `json:"modules"`
}

// mapPageModule normalises a single raw Tidal page module into our
// frontend-facing shape. Returns nil for module types we don't render
// (VIDEO_LIST, FEATURED, MIX_HEADER, …) — same rule as the worker.
func mapPageModule(raw *tidal.PageModuleRaw) *exploreModule {
	if raw == nil {
		return nil
	}
	title := raw.Title
	var total int
	var list []any
	var raws = []byte{} // unused — silence linter, see below
	_ = raws
	dataAPIPath := ""
	listLen := 0
	if raw.PagedList != nil {
		dataAPIPath = raw.PagedList.DataAPIPath
		total = raw.PagedList.TotalNumberOfItems
		listLen = len(raw.PagedList.Items)
	}
	// Only advertise `moreApiPath` when more items exist beyond what
	// the initial page window already returned — matches worker
	// parity so the UI doesn't show a non-functional "see all" link.
	more := ""
	if total > listLen {
		more = dataAPIPath
	}
	var totalPtr *int
	if raw.PagedList != nil {
		t := total
		totalPtr = &t
	}
	switch raw.Type {
	case "PAGE_LINKS", "PAGE_LINKS_CLOUD":
		out := make([]explorePageLink, 0, listLen)
		for _, msg := range pagedItems(raw) {
			p, err := unwrapJSON[tidal.PageLinkRaw](msg)
			if err != nil || p == nil {
				continue
			}
			if link := mapPageLink(p); link != nil {
				out = append(out, *link)
			}
		}
		if len(out) == 0 {
			return nil
		}
		return &exploreModule{Type: "pageLinks", Title: title, Items: out, MoreAPIPath: more, TotalItems: totalPtr}
	case "TRACK_LIST":
		out := make([]tidal.Track, 0, listLen)
		for _, msg := range pagedItems(raw) {
			t, err := unwrapJSON[tidal.TrackRaw](msg)
			if err != nil || t == nil {
				continue
			}
			out = append(out, tidal.MapTrack(t))
		}
		if len(out) == 0 {
			return nil
		}
		return &exploreModule{Type: "tracks", Title: title, Items: out, MoreAPIPath: more, TotalItems: totalPtr}
	case "ALBUM_LIST":
		out := make([]tidal.Album, 0, listLen)
		for _, msg := range pagedItems(raw) {
			a, err := unwrapJSON[tidal.AlbumRaw](msg)
			if err != nil || a == nil {
				continue
			}
			out = append(out, tidal.MapAlbum(a, nil))
		}
		if len(out) == 0 {
			return nil
		}
		return &exploreModule{Type: "albums", Title: title, Items: out, MoreAPIPath: more, TotalItems: totalPtr}
	case "ARTIST_LIST":
		out := make([]tidal.Artist, 0, listLen)
		for _, msg := range pagedItems(raw) {
			ar, err := unwrapJSON[tidal.ArtistRaw](msg)
			if err != nil || ar == nil {
				continue
			}
			out = append(out, tidal.MapArtist(ar))
		}
		if len(out) == 0 {
			return nil
		}
		return &exploreModule{Type: "artists", Title: title, Items: out, MoreAPIPath: more, TotalItems: totalPtr}
	case "PLAYLIST_LIST", "MIX_LIST":
		out := make([]tidal.Playlist, 0, listLen)
		for _, msg := range pagedItems(raw) {
			p, err := unwrapJSON[tidal.PlaylistRaw](msg)
			if err != nil || p == nil || p.UUID == "" {
				continue
			}
			out = append(out, tidal.MapPlaylist(p))
		}
		if len(out) == 0 {
			return nil
		}
		return &exploreModule{Type: "playlists", Title: title, Items: out, MoreAPIPath: more, TotalItems: totalPtr}
	default:
		// VIDEO_LIST, FEATURED, MIX_HEADER, … — drop until we ship
		// the corresponding UI.
		_ = list
		return nil
	}
}

// explorePageLink is the app-level "page link" tile shape.
type explorePageLink struct {
	Title   string `json:"title"`
	Slug    string `json:"slug"`
	Icon    string `json:"icon,omitempty"`
	ImageID string `json:"imageId,omitempty"`
}

// mapPageLink mirrors worker/TidalService.ts:mapPageLink. The slug is
// everything after `pages/`; rows without an apiPath get dropped.
func mapPageLink(raw *tidal.PageLinkRaw) *explorePageLink {
	api := raw.APIPath
	slug := strings.TrimPrefix(api, "pages/")
	if slug == "" {
		return nil
	}
	return &explorePageLink{
		Title:   raw.Title,
		Slug:    slug,
		Icon:    raw.Icon,
		ImageID: raw.ImageID,
	}
}

func pagedItems(raw *tidal.PageModuleRaw) [][]byte {
	if raw == nil || raw.PagedList == nil {
		return nil
	}
	out := make([][]byte, 0, len(raw.PagedList.Items))
	for _, m := range raw.PagedList.Items {
		out = append(out, []byte(m))
	}
	return out
}

func mapPage(raw *tidal.PageRaw) explorePageDTO {
	page := explorePageDTO{Title: raw.Title, Modules: []exploreModule{}}
	for _, row := range raw.Rows {
		for i := range row.Modules {
			if m := mapPageModule(&row.Modules[i]); m != nil {
				page.Modules = append(page.Modules, *m)
			}
		}
	}
	return page
}

// exploreHome handles GET /explore — defaults to the `explore` slug.
func exploreHome(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		raw, err := tidalSvc(a).API.GetPage(r.Context(), "explore")
		if err != nil {
			httpx.Err(w, http.StatusBadGateway, "Ошибка Tidal API: "+err.Error())
			return
		}
		httpx.JSON(w, http.StatusOK, mapPage(raw))
	}
}

// explorePage handles GET /explore/page/:slug.
func explorePage(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		slug := chi.URLParam(r, "slug")
		if slug == "" || !exploreSlugRE.MatchString(slug) {
			httpx.Err(w, http.StatusBadRequest, "Неверный slug страницы")
			return
		}
		raw, err := tidalSvc(a).API.GetPage(r.Context(), slug)
		if err != nil {
			httpx.Err(w, http.StatusBadGateway, "Ошибка Tidal API: "+err.Error())
			return
		}
		httpx.JSON(w, http.StatusOK, mapPage(raw))
	}
}

// exploreList handles GET /explore/list?path=&type=&limit=&offset=.
func exploreList(a *app.App) http.HandlerFunc {
	allowedTypes := map[string]bool{
		"tracks": true, "albums": true, "artists": true,
		"playlists": true, "pageLinks": true,
	}
	return func(w http.ResponseWriter, r *http.Request) {
		path := r.URL.Query().Get("path")
		typ := r.URL.Query().Get("type")
		if path == "" {
			httpx.Err(w, http.StatusBadRequest, "Параметр path обязателен")
			return
		}
		if !exploreListPathRE.MatchString(path) {
			httpx.Err(w, http.StatusBadRequest, "Неверный path")
			return
		}
		if !allowedTypes[typ] {
			httpx.Err(w, http.StatusBadRequest, "Допустимые значения type: tracks, albums, artists, playlists, pageLinks")
			return
		}
		limit := queryInt(r, "limit", 50)
		if limit > 50 {
			limit = 50
		}
		if limit < 1 {
			limit = 1
		}
		offset := queryInt(r, "offset", 0)

		raw, err := tidalSvc(a).API.GetPageData(r.Context(), path, limit, offset)
		if err != nil {
			httpx.Err(w, http.StatusBadGateway, "Ошибка Tidal API: "+err.Error())
			return
		}
		out := map[string]any{
			"totalItems": raw.TotalNumberOfItems,
		}
		switch typ {
		case "tracks":
			items := make([]tidal.Track, 0, len(raw.Items))
			for _, msg := range raw.Items {
				t, err := unwrapJSON[tidal.TrackRaw](msg)
				if err != nil || t == nil {
					continue
				}
				items = append(items, tidal.MapTrack(t))
			}
			out["items"] = items
		case "albums":
			items := make([]tidal.Album, 0, len(raw.Items))
			for _, msg := range raw.Items {
				al, err := unwrapJSON[tidal.AlbumRaw](msg)
				if err != nil || al == nil {
					continue
				}
				items = append(items, tidal.MapAlbum(al, nil))
			}
			out["items"] = items
		case "artists":
			items := make([]tidal.Artist, 0, len(raw.Items))
			for _, msg := range raw.Items {
				ar, err := unwrapJSON[tidal.ArtistRaw](msg)
				if err != nil || ar == nil {
					continue
				}
				items = append(items, tidal.MapArtist(ar))
			}
			out["items"] = items
		case "playlists":
			items := make([]tidal.Playlist, 0, len(raw.Items))
			for _, msg := range raw.Items {
				p, err := unwrapJSON[tidal.PlaylistRaw](msg)
				if err != nil || p == nil || p.UUID == "" {
					continue
				}
				items = append(items, tidal.MapPlaylist(p))
			}
			out["items"] = items
		case "pageLinks":
			items := make([]explorePageLink, 0, len(raw.Items))
			for _, msg := range raw.Items {
				p, err := unwrapJSON[tidal.PageLinkRaw](msg)
				if err != nil || p == nil {
					continue
				}
				if link := mapPageLink(p); link != nil {
					items = append(items, *link)
				}
			}
			out["items"] = items
		}
		httpx.JSON(w, http.StatusOK, out)
	}
}

// explorePlaylist handles GET /explore/playlists/:uuid/tracks.
func explorePlaylist(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		uuid := chi.URLParam(r, "uuid")
		if uuid == "" || !exploreUUIDRE.MatchString(uuid) {
			httpx.Err(w, http.StatusBadRequest, "Неверный UUID плейлиста")
			return
		}
		raw, err := tidalSvc(a).API.GetPlaylistTracks(r.Context(), uuid, 100)
		if err != nil {
			httpx.Err(w, http.StatusBadGateway, "Ошибка Tidal API: "+err.Error())
			return
		}
		tracks := make([]tidal.Track, 0, len(raw.Items))
		for i := range raw.Items {
			tracks = append(tracks, tidal.MapTrack(&raw.Items[i]))
		}
		httpx.JSON(w, http.StatusOK, map[string]any{"items": tracks})
	}
}
