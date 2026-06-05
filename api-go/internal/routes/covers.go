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

// Ported from worker/src/routes/covers.ts.
//
// CORS-friendly cover-image proxy. Tidal's image CDN
// (resources.tidal.com) does not send
// `Access-Control-Allow-Origin` headers, so a programmatic
// `fetch(url)` from the page origin is rejected with a CORS error
// before the response body is even visible. The offline-save path
// (src/lib/offline/streamResolver.ts :: fetchCoverBlob) needs the
// actual bytes so it can stash them in IndexedDB. Routing the
// request through this endpoint sidesteps the CORS check because
// the global CORS middleware on the API attaches
// `Access-Control-Allow-Origin: *` to every response.
//
// The endpoint is intentionally unauthenticated for the same reason
// the audio proxy is: an `<img src="...">` cannot send an
// Authorization header, and embedding tokens in cover URLs would
// leak fresh JWTs into Referer / browser history / access logs.
// The host allowlist below is the only abuse mitigation we need,
// mirroring the audio proxy's TIDAL_CDN_ALLOWED.

var coverHostsAllowed = []*regexp.Regexp{
	regexp.MustCompile(`(?i)^resources\.tidal\.com$`),
	regexp.MustCompile(`(?i)^(.+\.)?tidal\.com$`),
}

// HTTP client reused across cover-proxy calls. Disable redirect
// auto-follow control — Tidal's image CDN doesn't redirect, but we
// keep the default 10-hop limit which is fine if the policy ever
// changes upstream. A shared client gets us pooled keep-alives, so
// hot covers reuse a single TCP/TLS session.
var coverHTTPClient = &http.Client{
	Timeout: 20 * time.Second,
}

// proxyCover fetches `?url=<upstream>` and streams the response
// back to the caller with long edge-cache headers when the upstream
// returned a 2xx. Non-2xx responses get `cache-control: no-store`
// so a transient upstream 403 / 5xx never gets cached for a month.
func proxyCover(a *app.App) http.HandlerFunc {
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
		for _, re := range coverHostsAllowed {
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
		// Forward `If-None-Match` so the upstream 304 short-circuit
		// stays intact when the browser already has the cover in
		// its HTTP cache.
		if inm := r.Header.Get("If-None-Match"); inm != "" {
			req.Header.Set("If-None-Match", inm)
		}

		resp, err := coverHTTPClient.Do(req)
		if err != nil {
			httpx.Err(w, http.StatusBadGateway, "upstream fetch failed")
			return
		}
		defer resp.Body.Close()

		out := w.Header()
		for _, k := range []string{"Content-Type", "Content-Length", "ETag", "Last-Modified"} {
			if v := resp.Header.Get(k); v != "" {
				out.Set(k, v)
			}
		}
		// Only long-cache successful responses. Cover URLs include
		// the image-id in the path (`/{uuid}/640x640.jpg`) and the
		// upstream never updates a given path — the only way to
		// change a cover is to mint a new image-id — so 30 days
		// is safe and slashes origin traffic for popular tiles.
		if resp.StatusCode >= 200 && resp.StatusCode < 300 {
			out.Set("Cache-Control", "public, max-age=2592000, immutable")
		} else {
			out.Set("Cache-Control", "no-store")
		}
		// Mirror the audio proxy's CORS exposure so the client can
		// read Content-Length for progress reporting if it ever
		// wants to.
		out.Set("Access-Control-Expose-Headers", "Content-Length, Content-Type, ETag")

		w.WriteHeader(resp.StatusCode)
		// `io.Copy` is fine here — the body is streamed straight to
		// the client without a full in-memory buffer.
		_, _ = io.Copy(w, resp.Body)
	}
}
