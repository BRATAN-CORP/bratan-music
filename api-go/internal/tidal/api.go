package tidal

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"time"
)

const apiBase = "https://api.tidal.com"

// API is the catalogue client (port of worker/TidalApi.ts).
//
// Authentication: every request injects the current access token via
// Auth.GetAccessToken; on 401 the token is force-refreshed and the
// request is retried exactly once.
type API struct {
	auth *Auth
	http *http.Client
}

// NewAPI wires an API backed by the given Auth.
func NewAPI(a *Auth) *API {
	return &API{auth: a, http: &http.Client{Timeout: 25 * time.Second}}
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

	token, err := a.auth.GetAccessToken(ctx, false)
	if err != nil {
		return err
	}
	res, err := doFetch(token)
	if err != nil {
		return err
	}
	if res.StatusCode == 401 {
		res.Body.Close()
		token, err = a.auth.GetAccessToken(ctx, true)
		if err != nil {
			return err
		}
		res, err = doFetch(token)
		if err != nil {
			return err
		}
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
		"query":               {query},
		"limit":               {strconv.Itoa(limit)},
		"offset":              {strconv.Itoa(offset)},
		"types":               {types},
		"includeContributors": {"true"},
		"includeUserPlaylists": {"false"},
		"supportsUserData":    {"true"},
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
	if limit <= 0 {
		limit = 50
	}
	if filter == "" {
		filter = "ALBUMS"
	}
	params := a.commonParams(ctx, url.Values{
		"limit":  {strconv.Itoa(limit)},
		"offset": {"0"},
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
// Tidal has no lyrics (404 — surfaced as nil, not error).
func (a *API) GetTrackLyrics(ctx context.Context, trackID string) (*LyricsRaw, error) {
	params := a.commonParams(ctx, nil)
	var t LyricsRaw
	err := a.get(ctx, "/v1/tracks/"+trackID+"/lyrics?"+params.Encode(), &t)
	if err != nil {
		// Map 404s to nil so callers can show "no lyrics" without
		// surfacing it as an error.
		if isNotFound(err) {
			return nil, nil
		}
		return nil, err
	}
	return &t, nil
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
