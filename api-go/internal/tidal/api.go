package tidal

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math/rand"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

const apiBase = "https://api.tidal.com"

// openapiBase exposes the full quality matrix for a track in one shot
// via `/v2/trackManifests/:id` (see discovery.go). Port of the same
// constant in worker/TidalWeb.ts.
const openapiBase = "https://openapi.tidal.com/v2"

// KV is the minimal key/value contract the streaming discovery layer
// needs (Redis in prod). It mirrors the Cloudflare-KV surface the
// worker used (`tidal-track-formats:`, `tidal-track-quality:`,
// `tidal-discovery-breaker`). *redisx.Client satisfies it. All cache
// access is nil-safe: a nil KV simply means "always a cache miss, never
// write", so the resolver still works (just without self-heal memo).
type KV interface {
	KVGet(ctx context.Context, key string) (string, bool, error)
	KVSet(ctx context.Context, key, value string, ttl time.Duration) error
	KVDel(ctx context.Context, key string) error
}

// API is the catalogue client (port of worker/TidalApi.ts).
//
// Authentication: every request injects the current access token via
// Auth.GetAccessToken; on 401 the token is force-refreshed and the
// request is retried exactly once.
type API struct {
	auth  *Auth
	http  *http.Client
	cache KV // optional; nil-safe (see KV doc)
}

// NewAPI wires an API backed by the given Auth. cache may be nil (the
// streaming discovery/quality memo degrades to no-cache in that case).
func NewAPI(a *Auth, cache KV) *API {
	return &API{auth: a, http: &http.Client{Timeout: 25 * time.Second}, cache: cache}
}

// commonParams threads through the parameters Tidal Web sets on every
// request. `includeExplicit=true` + `explicitContent=true` are
// per-request overrides that some catalogue endpoints honour when the
// request "looks like" Tidal Web (UA / Origin / Referer headers
// below). See worker/TidalApi.ts:commonParams for the long rationale.
func (a *API) commonParams(ctx context.Context, extra url.Values) url.Values {
	v := url.Values{}
	v.Set("countryCode", a.auth.GetCountryCode(ctx))
	v.Set("locale", a.auth.GetLocale())
	v.Set("deviceType", "BROWSER")
	v.Set("includeExplicit", "true")
	v.Set("explicitContent", "true")
	for k, vv := range extra {
		for _, val := range vv {
			v.Set(k, val)
		}
	}
	return v
}

// get is the single GET path with 401 → force-refresh retry.
func (a *API) get(ctx context.Context, path string, out any) error {
	doFetch := func(token string) (*http.Response, error) {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, apiBase+path, nil)
		if err != nil {
			return nil, err
		}
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set("Accept", "application/json")
		// Pose as Tidal Web so the per-request `includeExplicit` /
		// `explicitContent` overrides actually take effect.
		req.Header.Set("User-Agent",
			"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "+
				"(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")
		req.Header.Set("Accept-Language", "en-US,en;q=0.9")
		req.Header.Set("Origin", "https://listen.tidal.com")
		req.Header.Set("Referer", "https://listen.tidal.com/")
		req.Header.Set("x-tidal-client-version", a.auth.GetClientVersion())
		return a.http.Do(req)
	}

	// Light retry policy for transient Tidal upstream errors (ported from
	// the TS worker's TidalApi wrapper — PR #484). Tidal's catalogue API
	// occasionally returns 5xx / 429 for a single request even when the
	// surrounding burst is fine; without a retry every such blip surfaces
	// to the user as a hard error (the search?filter=artists 502 incident
	// on 2026-05-28 was exactly this). Strategy:
	//   • 401  → force a token refresh, single retry (existing behaviour).
	//   • 5xx / 429 / network throw → up to 3 retries with backoff
	//                                 (150ms, 400ms, 800ms + small jitter).
	// We deliberately do NOT retry 4xx other than 429 — those are
	// deterministic (404 missing track, 400 bad params) and a retry would
	// just waste time. Stream-URL resolution goes through this same path,
	// so the extra retry tier directly cuts transient playback failures.
	const maxTransientRetries = 3
	isTransient := func(s int) bool { return s == 429 || (s >= 500 && s <= 599) }
	backoff := func(n int) time.Duration {
		base := 150 * time.Millisecond
		switch n {
		case 0:
			base = 150 * time.Millisecond
		case 1:
			base = 400 * time.Millisecond
		default:
			base = 800 * time.Millisecond
		}
		return base + time.Duration(rand.Intn(100))*time.Millisecond
	}

	token, err := a.auth.GetAccessToken(ctx, false)
	if err != nil {
		return err
	}

	var res *http.Response
	var lastErr error
	for attempt := 0; attempt <= maxTransientRetries; attempt++ {
		res, err = doFetch(token)
		if err != nil {
			// Network-level failure (DNS, TCP reset, abort). Treat as transient.
			lastErr = err
			if attempt >= maxTransientRetries {
				return err
			}
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(backoff(attempt)):
			}
			continue
		}
		if res.StatusCode == 401 {
			res.Body.Close()
			token, err = a.auth.GetAccessToken(ctx, true)
			if err != nil {
				return err
			}
			res, err = doFetch(token)
			if err != nil {
				lastErr = err
				if attempt >= maxTransientRetries {
					return err
				}
				select {
				case <-ctx.Done():
					return ctx.Err()
				case <-time.After(backoff(attempt)):
				}
				continue
			}
		}
		if isTransient(res.StatusCode) && attempt < maxTransientRetries {
			// Drain + close so the connection can be reused, then back off.
			io.Copy(io.Discard, io.LimitReader(res.Body, 1<<14))
			res.Body.Close()
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(backoff(attempt)):
			}
			continue
		}
		break
	}
	if res == nil {
		if lastErr != nil {
			return lastErr
		}
		return fmt.Errorf("tidal %s: no response", path)
	}

	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(res.Body, 1<<14))
		return fmt.Errorf("tidal %s %d: %s", path, res.StatusCode, truncate(string(body), 300))
	}
	return json.NewDecoder(res.Body).Decode(out)
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n]
}

// Search executes /v1/search with the given query.
func (a *API) Search(ctx context.Context, query, types string, limit, offset int) (*SearchResponse, error) {
	if types == "" {
		types = "ARTISTS,ALBUMS,TRACKS"
	}
	if limit <= 0 {
		limit = 25
	}
	params := a.commonParams(ctx, url.Values{
		"query":                {query},
		"limit":                {strconv.Itoa(limit)},
		"offset":               {strconv.Itoa(offset)},
		"types":                {types},
		"includeContributors":  {"true"},
		"includeUserPlaylists": {"false"},
		"supportsUserData":     {"true"},
	})
	var resp SearchResponse
	if err := a.get(ctx, "/v1/search?"+params.Encode(), &resp); err != nil {
		return nil, err
	}
	return &resp, nil
}

// GetTrack returns a single track.
func (a *API) GetTrack(ctx context.Context, trackID string) (*TrackRaw, error) {
	params := a.commonParams(ctx, nil)
	var t TrackRaw
	if err := a.get(ctx, "/v1/tracks/"+trackID+"?"+params.Encode(), &t); err != nil {
		return nil, err
	}
	return &t, nil
}

// GetAlbum returns an album header (without tracks).
func (a *API) GetAlbum(ctx context.Context, albumID string) (*AlbumRaw, error) {
	params := a.commonParams(ctx, nil)
	var t AlbumRaw
	if err := a.get(ctx, "/v1/albums/"+albumID+"?"+params.Encode(), &t); err != nil {
		return nil, err
	}
	return &t, nil
}

// GetAlbumTracks returns the album's track list.
func (a *API) GetAlbumTracks(ctx context.Context, albumID string, limit int) (*ListItems[TrackRaw], error) {
	if limit <= 0 {
		limit = 100
	}
	params := a.commonParams(ctx, url.Values{
		"limit":  {strconv.Itoa(limit)},
		"offset": {"0"},
	})
	var t ListItems[TrackRaw]
	if err := a.get(ctx, "/v1/albums/"+albumID+"/tracks?"+params.Encode(), &t); err != nil {
		return nil, err
	}
	return &t, nil
}

// GetArtist returns an artist header.
func (a *API) GetArtist(ctx context.Context, artistID string) (*ArtistRaw, error) {
	params := a.commonParams(ctx, nil)
	var t ArtistRaw
	if err := a.get(ctx, "/v1/artists/"+artistID+"?"+params.Encode(), &t); err != nil {
		return nil, err
	}
	return &t, nil
}

// GetArtistTopTracks returns the artist's top tracks.
func (a *API) GetArtistTopTracks(ctx context.Context, artistID string, limit int) (*ListItems[TrackRaw], error) {
	if limit <= 0 {
		limit = 10
	}
	params := a.commonParams(ctx, url.Values{
		"limit":  {strconv.Itoa(limit)},
		"offset": {"0"},
	})
	var t ListItems[TrackRaw]
	if err := a.get(ctx, "/v1/artists/"+artistID+"/toptracks?"+params.Encode(), &t); err != nil {
		return nil, err
	}
	return &t, nil
}

// GetArtistAlbums returns albums for the artist filtered by `ALBUMS`,
// `EPSANDSINGLES`, or `COMPILATIONS`.
func (a *API) GetArtistAlbums(ctx context.Context, artistID string, limit int, filter string) (*ListItems[AlbumRaw], error) {
	return a.GetArtistAlbumsPaged(ctx, artistID, limit, 0, filter)
}

// GetArtistAlbumsPaged is GetArtistAlbums with an explicit offset so the
// "view all albums / singles" feed can paginate (the frontend falls back
// to offset-based paging when no opaque morePath is available).
func (a *API) GetArtistAlbumsPaged(ctx context.Context, artistID string, limit, offset int, filter string) (*ListItems[AlbumRaw], error) {
	if limit <= 0 {
		limit = 50
	}
	if offset < 0 {
		offset = 0
	}
	if filter == "" {
		filter = "ALBUMS"
	}
	params := a.commonParams(ctx, url.Values{
		"limit":  {strconv.Itoa(limit)},
		"offset": {strconv.Itoa(offset)},
		"filter": {filter},
	})
	var t ListItems[AlbumRaw]
	if err := a.get(ctx, "/v1/artists/"+artistID+"/albums?"+params.Encode(), &t); err != nil {
		return nil, err
	}
	return &t, nil
}

// GetSimilarArtists returns Tidal's similar-artists list.
func (a *API) GetSimilarArtists(ctx context.Context, artistID string, limit int) (*ListItems[ArtistRaw], error) {
	if limit <= 0 {
		limit = 10
	}
	params := a.commonParams(ctx, url.Values{"limit": {strconv.Itoa(limit)}})
	var t ListItems[ArtistRaw]
	if err := a.get(ctx, "/v1/artists/"+artistID+"/similar?"+params.Encode(), &t); err != nil {
		return nil, err
	}
	return &t, nil
}

// GetTrackRadio returns the track-seeded radio feed.
func (a *API) GetTrackRadio(ctx context.Context, trackID string, limit int) (*ListItems[TrackRaw], error) {
	if limit <= 0 {
		limit = 25
	}
	params := a.commonParams(ctx, url.Values{
		"limit":  {strconv.Itoa(limit)},
		"offset": {"0"},
	})
	var t ListItems[TrackRaw]
	if err := a.get(ctx, "/v1/tracks/"+trackID+"/radio?"+params.Encode(), &t); err != nil {
		return nil, err
	}
	return &t, nil
}

// GetArtistRadio returns the artist-seeded radio feed.
func (a *API) GetArtistRadio(ctx context.Context, artistID string, limit int) (*ListItems[TrackRaw], error) {
	if limit <= 0 {
		limit = 50
	}
	params := a.commonParams(ctx, url.Values{
		"limit":  {strconv.Itoa(limit)},
		"offset": {"0"},
	})
	var t ListItems[TrackRaw]
	if err := a.get(ctx, "/v1/artists/"+artistID+"/radio?"+params.Encode(), &t); err != nil {
		return nil, err
	}
	return &t, nil
}

// GetPlaylistTracks returns the tracks in a Tidal editorial playlist
// identified by UUID.
func (a *API) GetPlaylistTracks(ctx context.Context, uuid string, limit int) (*ListItems[TrackRaw], error) {
	if limit <= 0 {
		limit = 100
	}
	params := a.commonParams(ctx, url.Values{
		"limit":  {strconv.Itoa(limit)},
		"offset": {"0"},
	})
	var t ListItems[TrackRaw]
	if err := a.get(ctx, "/v1/playlists/"+uuid+"/tracks?"+params.Encode(), &t); err != nil {
		return nil, err
	}
	return &t, nil
}

// GetTrackLyrics returns the lyrics record for a track or nil when
// Tidal has no lyrics.
//
// Port of worker/TidalApi.ts:getTrackLyrics — three-variant fallback
// chain so we get uncensored lyrics even when the pool account's
// "Explicit Content" filter is ON:
//
//  1. v1 + includeExplicit + explicitContent + useEditedLyrics=false
//  2. v2 + includeExplicit (v2 endpoint sometimes returns lyrics when
//     v1 refuses)
//  3. v1 plain (legacy fallback)
//
// First response with non-empty Lyrics or Subtitles wins. 404s are
// silently skipped; any other error is captured and surfaced only if
// every variant fails.
func (a *API) GetTrackLyrics(ctx context.Context, trackID string) (*LyricsRaw, error) {
	cc := a.auth.GetCountryCode(ctx)
	locale := a.auth.GetLocale()

	variants := []string{
		fmt.Sprintf("/v1/tracks/%s/lyrics?countryCode=%s&locale=%s&deviceType=BROWSER&includeExplicit=true&explicitContent=true&useEditedLyrics=false",
			trackID, url.QueryEscape(cc), url.QueryEscape(locale)),
		fmt.Sprintf("/v2/tracks/%s/lyrics?countryCode=%s&locale=%s&deviceType=BROWSER&includeExplicit=true",
			trackID, url.QueryEscape(cc), url.QueryEscape(locale)),
		fmt.Sprintf("/v1/tracks/%s/lyrics?countryCode=%s&locale=%s&deviceType=BROWSER",
			trackID, url.QueryEscape(cc), url.QueryEscape(locale)),
	}

	var lastErr error
	for _, path := range variants {
		var t LyricsRaw
		err := a.get(ctx, path, &t)
		if err != nil {
			if isNotFound(err) {
				continue // this variant just isn't supported, try next
			}
			lastErr = err
			continue
		}
		if t.Lyrics != "" || t.Subtitles != "" {
			return &t, nil
		}
		// Empty payload — try next variant.
	}

	if lastErr != nil {
		// None of the variants returned a payload AND at least one
		// failed with a non-404 error — surface it.
		if isNotFound(lastErr) {
			return nil, nil
		}
		return nil, lastErr
	}
	return nil, nil
}

func isNotFound(err error) bool {
	if err == nil {
		return false
	}
	// Our error format from get(): "tidal /path 404: body"
	return contains(err.Error(), " 404:")
}

func contains(s, sub string) bool {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return true
		}
	}
	return false
}

// GetPage fetches a Tidal "page" — the structured tree of modules
// (PLAYLIST_LIST, TRACK_LIST, PAGE_LINKS_CLOUD, …) the Tidal web/desktop
// apps render for Explore, Genre, Mood, Decade etc. screens.
func (a *API) GetPage(ctx context.Context, slug string) (*PageRaw, error) {
	params := a.commonParams(ctx, nil)
	var p PageRaw
	if err := a.get(ctx, "/v1/pages/"+slug+"?"+params.Encode(), &p); err != nil {
		return nil, err
	}
	return &p, nil
}

// GetPageData paginates a single module's `dataApiPath`. Tidal accepts
// limit/offset windows up to 50 items.
func (a *API) GetPageData(ctx context.Context, dataAPIPath string, limit, offset int) (*PagedListRaw, error) {
	extra := url.Values{}
	if limit > 0 {
		extra.Set("limit", strconv.Itoa(limit))
	}
	if offset > 0 {
		extra.Set("offset", strconv.Itoa(offset))
	}
	params := a.commonParams(ctx, extra)
	clean := dataAPIPath
	if !strings.HasPrefix(clean, "/") {
		clean = "/" + clean
	}
	var p PagedListRaw
	if err := a.get(ctx, "/v1"+clean+"?"+params.Encode(), &p); err != nil {
		return nil, err
	}
	return &p, nil
}
