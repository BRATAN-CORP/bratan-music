package tidal

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"sort"
	"time"
)

// Quality-discovery + caching layer. Full port of the discovery half of
// worker/TidalWeb.ts. See stream.go ResolveStream for how it's used.
//
// The whole point of this layer is the #488 self-heal behaviour: a
// transient openapi.tidal.com blip must NOT poison a track's resolution
// for 24h (which surfaced as "FFmpegDemuxer: demuxer seek failed"). We
// negative-cache empty results for only 10 minutes so the cache clears
// itself within a coffee break.

const (
	qualityCacheTTL   = 30 * 24 * time.Hour
	qualityCacheKey   = "tidal-track-quality:"
	discoveryCacheTTL = 30 * 24 * time.Hour
	discoveryCacheKey = "tidal-track-formats:"
	// Empty discovery results self-heal in 10 minutes (was 24h — the
	// bug). Short enough that a transient blip clears within a coffee
	// break, long enough that a genuinely-broken track doesn't fan a
	// fresh openapi round trip on every play.
	discoveryNegativeCacheTTL = 10 * time.Minute
	// Global circuit breaker: when openapi returns 401/403 (bearer
	// revoked / region-block — a GLOBAL failure), suppress all
	// discovery calls for an hour. 404 does NOT trip it (that's a
	// per-track condition handled by the per-track negative cache).
	discoveryBreakerKey = "tidal-discovery-breaker"
	discoveryBreakerTTL = time.Hour
)

// formatToQuality maps openapi.tidal.com format names to QualityLadder
// values. HI_RES (MQA) is intentionally absent — trackManifests doesn't
// surface MQA as its own format.
var formatToQuality = map[string]string{
	"FLAC_HIRES": "HI_RES_LOSSLESS",
	"FLAC":       "LOSSLESS",
	"AACLC":      "HIGH",
	"HEAACV1":    "LOW",
}

type trackManifestResponse struct {
	Data struct {
		Attributes struct {
			Formats []string        `json:"formats"`
			DrmData json.RawMessage `json:"drmData"`
		} `json:"attributes"`
	} `json:"data"`
}

// discoverQualities probes openapi.tidal.com for the formats a track
// actually publishes, returning a high→low (low ladder index first)
// slice of QualityLadder values. Errors and unknown shapes resolve to
// an empty slice so the caller falls back to the legacy ladder rather
// than failing hard. Results are cached in Redis: populated → 30d,
// empty → 10min (self-heal).
func (a *API) discoverQualities(ctx context.Context, trackID string) []string {
	// Global breaker first.
	if a.isDiscoveryBreakerOpen(ctx) {
		return nil
	}

	if cached, ok := a.readDiscoveryCache(ctx, trackID); ok {
		return cached
	}

	u, _ := url.Parse(openapiBase + "/trackManifests/" + url.PathEscape(trackID))
	q := u.Query()
	q.Set("adaptive", "false")
	q.Set("manifestType", "MPEG_DASH")
	q.Set("uriScheme", "DATA")
	q.Set("usage", "PLAYBACK")
	for _, f := range []string{"HEAACV1", "AACLC", "FLAC", "FLAC_HIRES"} {
		q.Add("formats", f)
	}
	u.RawQuery = q.Encode()

	doFetch := func(token string) (*http.Response, error) {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
		if err != nil {
			return nil, err
		}
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set("Accept", "application/json")
		req.Header.Set("User-Agent", "TIDAL/"+defaultClientVersion+" CFNetwork/1494.0.7 Darwin/23.4.0")
		req.Header.Set("x-tidal-client-version", a.auth.GetClientVersion())
		return a.http.Do(req)
	}

	// finalize always caches before returning, so a failed discovery
	// doesn't replay the wasted RTT on every cold listen.
	finalize := func(qualities []string) []string {
		ttl := discoveryCacheTTL
		if len(qualities) == 0 {
			ttl = discoveryNegativeCacheTTL
		}
		a.writeDiscoveryCache(ctx, trackID, qualities, ttl)
		return qualities
	}

	token, err := a.auth.GetAccessToken(ctx, false)
	if err != nil {
		return finalize(nil)
	}
	res, err := doFetch(token)
	if err != nil {
		return finalize(nil)
	}
	if res.StatusCode == 401 {
		res.Body.Close()
		if token, err = a.auth.GetAccessToken(ctx, true); err != nil {
			return finalize(nil)
		}
		if res, err = doFetch(token); err != nil {
			return finalize(nil)
		}
	}
	defer res.Body.Close()

	if res.StatusCode < 200 || res.StatusCode >= 300 {
		io.Copy(io.Discard, io.LimitReader(res.Body, 1<<14))
		// Trip the global breaker only on 401/403 (global auth failure),
		// never on 404 (per-track condition).
		if res.StatusCode == 401 || res.StatusCode == 403 {
			a.tripDiscoveryBreaker(ctx)
		}
		return finalize(nil)
	}

	var body trackManifestResponse
	if err := json.NewDecoder(io.LimitReader(res.Body, 1<<20)).Decode(&body); err != nil {
		return finalize(nil)
	}

	// drmData != null → format only delivered behind Widevine, which a
	// bare <audio> tag can't speak. Treat as no-discovery so the legacy
	// ladder can still find a clear HIGH/LOW rung.
	drm := len(body.Data.Attributes.DrmData) > 0 && string(body.Data.Attributes.DrmData) != "null"
	formats := body.Data.Attributes.Formats
	if drm {
		formats = nil
	}

	seen := map[string]bool{}
	mapped := make([]string, 0, len(formats))
	for _, f := range formats {
		if q, ok := formatToQuality[f]; ok && !seen[q] {
			seen[q] = true
			mapped = append(mapped, q)
		}
	}
	// Sort high→low (low ladder index first).
	sort.Slice(mapped, func(i, j int) bool {
		return indexOfQuality(mapped[i]) < indexOfQuality(mapped[j])
	})
	return finalize(mapped)
}

// ---- cache helpers (all nil-safe via the helpers in kv.go) -----------

func (a *API) readDiscoveryCache(ctx context.Context, trackID string) ([]string, bool) {
	raw, ok := a.kvGet(ctx, discoveryCacheKey+trackID)
	if !ok {
		return nil, false
	}
	var v struct {
		Qualities []string `json:"qualities"`
	}
	if err := json.Unmarshal([]byte(raw), &v); err != nil {
		return nil, false
	}
	out := make([]string, 0, len(v.Qualities))
	for _, q := range v.Qualities {
		if indexOfQuality(q) >= 0 {
			out = append(out, q)
		}
	}
	return out, true
}

func (a *API) writeDiscoveryCache(ctx context.Context, trackID string, qualities []string, ttl time.Duration) {
	if qualities == nil {
		qualities = []string{}
	}
	b, err := json.Marshal(struct {
		Qualities []string `json:"qualities"`
	}{qualities})
	if err != nil {
		return
	}
	a.kvSet(ctx, discoveryCacheKey+trackID, string(b), ttl)
}

func (a *API) readCachedQuality(ctx context.Context, trackID string) string {
	raw, ok := a.kvGet(ctx, qualityCacheKey+trackID)
	if !ok {
		return ""
	}
	if indexOfQuality(raw) >= 0 {
		return raw
	}
	return ""
}

func (a *API) writeCachedQuality(ctx context.Context, trackID, quality string, ttl time.Duration) {
	a.kvSet(ctx, qualityCacheKey+trackID, quality, ttl)
}

func (a *API) isDiscoveryBreakerOpen(ctx context.Context) bool {
	_, ok := a.kvGet(ctx, discoveryBreakerKey)
	return ok
}

func (a *API) tripDiscoveryBreaker(ctx context.Context) {
	a.kvSet(ctx, discoveryBreakerKey, "1", discoveryBreakerTTL)
}
