package routes

import (
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/bratan-corp/bratan-music/api-go/internal/app"
	"github.com/bratan-corp/bratan-music/api-go/internal/httpx"
)

// Ported from worker/src/routes/tracks.ts (`/tracks/audio`).
//
// CORS + Range-friendly audio proxy. Tidal's stream CDN
// (amz-*.audio.tidal.com, fa-v*.tidal.com, sp-*.audio.tidal.com) hands
// out per-request signed URLs that are bound to the IP that resolved
// them (the API server) AND do not emit the CORS headers the browser
// `<audio crossOrigin="anonymous">` element requires. Handing the raw
// CDN URL to the client therefore fails two ways: (1) the client IP
// differs from the server's → CDN 403, and (2) no ACAO header → the
// media element refuses the cross-origin response.
//
// Routing playback bytes through this same-origin endpoint fixes both:
// the server (whose IP the signed URL is bound to) fetches the CDN,
// and the global CORS middleware attaches the ACAO/credentials headers
// to the streamed response. This mirrors worker PR #478 ("tidal CDN
// proxy") — without it, whole albums fail to play on the client even
// though resolution succeeds.
//
// The endpoint is intentionally unauthenticated (an `<audio src>` can't
// send an Authorization header, and embedding a JWT in the stream URL
// would leak it into Referer / history / logs). The host allowlist is
// the abuse mitigation, mirroring the cover proxy.
var audioHostsAllowed = []*regexp.Regexp{
	regexp.MustCompile(`(?i)^(.+\.)?audio\.tidal\.com$`),
	regexp.MustCompile(`(?i)^(.+\.)?fa-v\d+\.tidal\.com$`),
	regexp.MustCompile(`(?i)^sp-[a-z0-9-]+\.audio\.tidal\.com$`),
	regexp.MustCompile(`(?i)^resources\.tidal\.com$`),
}

// Longer timeout than covers — a full-track body can be several MiB and
// the client streams it progressively. The browser issues many short
// Range requests rather than one long read, so this mostly caps a
// pathological hung upstream connection.
var audioHTTPClient = &http.Client{
	Timeout: 60 * time.Second,
}

// proxyAudio streams `?url=<tidal-cdn>` back to the caller, forwarding
// the inbound Range header and echoing the streaming-relevant response
// headers (Content-Range / Accept-Ranges / Content-Length / Content-Type)
// so the browser's media element gets working seek + progressive load.
func proxyAudio(a *app.App) http.HandlerFunc {
	_ = a
	return func(w http.ResponseWriter, r *http.Request) {
		target := r.URL.Query().Get("url")
		if target == "" {
			httpx.Err(w, http.StatusBadRequest, "missing url")
			return
		}
		parsed, err := url.Parse(target)
		if err != nil {
			httpx.Err(w, http.StatusBadRequest, "invalid url")
			return
		}
		if parsed.Scheme != "https" {
			httpx.Err(w, http.StatusBadRequest, "https only")
			return
		}
		host := strings.ToLower(parsed.Hostname())
		allowed := false
		for _, re := range audioHostsAllowed {
			if re.MatchString(host) {
				allowed = true
				break
			}
		}
		if !allowed {
			httpx.Err(w, http.StatusBadRequest, "host not allowed: "+host)
			return
		}

		req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, target, nil)
		if err != nil {
			httpx.Internal(w, err)
			return
		}
		// Forward Range / If-Range so the upstream returns 206 with the
		// requested window — this is what makes <audio> seeking work.
		if rng := r.Header.Get("Range"); rng != "" {
			req.Header.Set("Range", rng)
		}
		if ir := r.Header.Get("If-Range"); ir != "" {
			req.Header.Set("If-Range", ir)
		}

		resp, err := audioHTTPClient.Do(req)
		if err != nil {
			httpx.Err(w, http.StatusBadGateway, "upstream fetch failed")
			return
		}
		defer resp.Body.Close()

		out := w.Header()
		for _, k := range []string{
			"Content-Type",
			"Content-Length",
			"Content-Range",
			"Accept-Ranges",
			"Cache-Control",
			"ETag",
			"Last-Modified",
		} {
			if v := resp.Header.Get(k); v != "" {
				out.Set(k, v)
			}
		}
		// The <audio> element reads these for seek/progress. The global
		// CORS middleware already sets Access-Control-Allow-Origin.
		out.Set("Access-Control-Expose-Headers",
			"Content-Length, Content-Type, Content-Range, Accept-Ranges")

		w.WriteHeader(resp.StatusCode)
		_, _ = io.Copy(w, resp.Body)
	}
}
