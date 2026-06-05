package routes

import (
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"

	"github.com/bratan-corp/bratan-music/api-go/internal/app"
	"github.com/bratan-corp/bratan-music/api-go/internal/httpx"
	"github.com/bratan-corp/bratan-music/api-go/internal/tidal"
	"github.com/go-chi/chi/v5"
)

// artistRadio — GET /artists/:id/radio. Flat track list ready to drop into
// the player queue. Purely additive: upstream failures degrade to an empty
// list so the artist page never breaks. Mirrors worker artists.ts.
func artistRadio(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := chi.URLParam(r, "id")
		limit := clampInt(queryIntDefault(r, "limit", 50), 1, 100)
		res, err := tidalSvc(a).API.GetArtistRadio(r.Context(), id, limit)
		if err != nil || res == nil {
			httpx.JSON(w, http.StatusOK, map[string]any{"items": []any{}})
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]any{"items": mapTracks(res.Items)})
	}
}

// trackFile — GET /tracks/:id/file. Streams the full LOSSLESS file through
// this server with an attachment disposition so the browser downloads it.
// Mirrors worker tracks.ts /:id/file.
func trackFile(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := chi.URLParam(r, "id")
		ctx := r.Context()
		svc := tidalSvc(a)

		var title, artist string
		if t, err := svc.API.GetTrack(ctx, id); err == nil && t != nil {
			if mt := mapTracks([]tidal.TrackRaw{*t}); len(mt) > 0 {
				title, artist = mt[0].Title, mt[0].Artist
			}
		}

		resolved, err := svc.API.ResolveStream(ctx, id, "LOSSLESS")
		if err != nil || resolved == nil || resolved.URL == "" {
			msg := "resolve stream"
			if err != nil {
				msg += ": " + err.Error()
			}
			httpx.Err(w, http.StatusBadGateway, msg)
			return
		}

		req, err := http.NewRequestWithContext(ctx, http.MethodGet, resolved.URL, nil)
		if err != nil {
			httpx.Err(w, http.StatusBadGateway, err.Error())
			return
		}
		upstream, err := http.DefaultClient.Do(req)
		if err != nil {
			httpx.Err(w, http.StatusBadGateway, err.Error())
			return
		}
		defer upstream.Body.Close()
		if upstream.StatusCode != http.StatusOK {
			body, _ := io.ReadAll(io.LimitReader(upstream.Body, 200))
			httpx.Err(w, http.StatusBadGateway, fmt.Sprintf("upstream %d: %s", upstream.StatusCode, string(body)))
			return
		}

		ct := upstream.Header.Get("Content-Type")
		if ct == "" {
			ct = "audio/flac"
		}
		ext := "flac"
		switch {
		case strings.Contains(ct, "mpeg"), strings.Contains(ct, "mp3"):
			ext = "mp3"
		case strings.Contains(ct, "mp4"), strings.Contains(ct, "m4a"), strings.Contains(ct, "aac"):
			ext = "m4a"
		}
		base := fmt.Sprintf("track-%s", id)
		if artist != "" && title != "" {
			base = artist + " — " + title
		}
		base = sanitizeFilename(base)

		w.Header().Set("Content-Type", ct)
		w.Header().Set("Content-Disposition", "attachment; filename*=UTF-8''"+url.QueryEscape(base)+"."+ext)
		w.Header().Set("Cache-Control", "private, max-age=60")
		if cl := upstream.Header.Get("Content-Length"); cl != "" {
			w.Header().Set("Content-Length", cl)
		}
		w.WriteHeader(http.StatusOK)
		_, _ = io.Copy(w, upstream.Body)
	}
}

// sanitizeFilename strips characters illegal in filenames and bounds length.
func sanitizeFilename(s string) string {
	replacer := func(r rune) rune {
		switch r {
		case '\\', '/', ':', '*', '?', '"', '<', '>', '|':
			return '_'
		}
		return r
	}
	out := strings.Map(replacer, s)
	if len([]rune(out)) > 180 {
		out = string([]rune(out)[:180])
	}
	return out
}
