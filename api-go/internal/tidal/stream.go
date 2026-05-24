package tidal

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
)

// QualityLadder is the canonical Tidal quality order, high → low. Used
// when the caller passes a custom cap; the legacy quality-discovery
// fast path from worker/TidalWeb (one-shot trackManifests probe) is
// still a TODO — first-pass we always request `LOSSLESS` and let
// Tidal return whatever the account actually supports.
var QualityLadder = []string{"HI_RES_LOSSLESS", "LOSSLESS", "HIGH", "LOW"}

// ResolveStream returns the playable URL + decoded quality for a track.
// First-pass implementation:
//   - issues a single playbackinfopostpaywall call at the requested quality
//   - decodes the `application/vnd.tidal.bts` manifest
//   - returns the first URL
//
// Quality-ladder discovery, DASH manifest decoding, and the
// `tidal-track-quality:` KV memo are TODOs (handled by worker/TidalWeb
// today; see api-go/STATUS.md).
func (a *API) ResolveStream(ctx context.Context, trackID, quality string) (*ResolvedStream, error) {
	if quality == "" {
		quality = "LOSSLESS"
	}
	info, err := a.getPlaybackInfo(ctx, trackID, quality)
	if err != nil {
		// Soft-retry one rung down before giving up. Some accounts
		// reject HI_RES_LOSSLESS with 401/403 even though the catalogue
		// advertised it.
		if next := nextLowerQuality(quality); next != "" && next != quality {
			info, err = a.getPlaybackInfo(ctx, trackID, next)
			if err != nil {
				return nil, err
			}
			quality = next
		} else {
			return nil, err
		}
	}
	manifest, err := decodeManifest(info.Manifest, info.ManifestMimeType)
	if err != nil {
		return nil, fmt.Errorf("decode manifest: %w", err)
	}
	if len(manifest.URLs) == 0 {
		return nil, fmt.Errorf("manifest has no URLs (mime=%s)", info.ManifestMimeType)
	}
	if manifest.EncryptionType != "" && !strings.EqualFold(manifest.EncryptionType, "NONE") {
		return nil, fmt.Errorf("encrypted manifest (%s); TODO web fallback", manifest.EncryptionType)
	}
	return &ResolvedStream{
		URL:      manifest.URLs[0],
		Quality:  info.AudioQuality,
		Codec:    manifest.Codecs,
		MimeType: manifest.MimeType,
	}, nil
}

func (a *API) getPlaybackInfo(ctx context.Context, trackID, quality string) (*PlaybackInfo, error) {
	params := url.Values{
		"audioquality":      {quality},
		"playbackmode":      {"STREAM"},
		"assetpresentation": {"FULL"},
		"countryCode":       {a.auth.GetCountryCode(ctx)},
	}
	doFetch := func(token string) (*http.Response, error) {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet,
			apiBase+"/v1/tracks/"+trackID+"/playbackinfopostpaywall?"+params.Encode(), nil)
		if err != nil {
			return nil, err
		}
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set("Accept", "application/json")
		req.Header.Set("User-Agent", "TIDAL/"+defaultClientVersion+" CFNetwork/1494.0.7 Darwin/23.4.0")
		req.Header.Set("x-tidal-client-version", a.auth.GetClientVersion())
		return a.http.Do(req)
	}
	token, err := a.auth.GetAccessToken(ctx, false)
	if err != nil {
		return nil, err
	}
	res, err := doFetch(token)
	if err != nil {
		return nil, err
	}
	if res.StatusCode == 401 {
		res.Body.Close()
		token, err = a.auth.GetAccessToken(ctx, true)
		if err != nil {
			return nil, err
		}
		res, err = doFetch(token)
		if err != nil {
			return nil, err
		}
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(res.Body, 1<<14))
		return nil, fmt.Errorf("playbackinfo %d: %s", res.StatusCode, truncate(string(body), 300))
	}
	var p PlaybackInfo
	if err := json.NewDecoder(res.Body).Decode(&p); err != nil {
		return nil, err
	}
	return &p, nil
}

// decodeManifest mirrors worker/TidalWeb.decodeManifest — only the
// `application/vnd.tidal.bts` path is implemented in this first pass.
// DASH manifests fall through with an explicit error so callers can
// route to the worker/ fallback during the transition window.
func decodeManifest(manifestB64, mimeType string) (*BtsManifest, error) {
	decoded, err := base64.StdEncoding.DecodeString(manifestB64)
	if err != nil {
		return nil, fmt.Errorf("manifest base64: %w", err)
	}
	if strings.EqualFold(mimeType, "application/vnd.tidal.bts") {
		var m BtsManifest
		if err := json.Unmarshal(decoded, &m); err != nil {
			return nil, fmt.Errorf("bts manifest unmarshal: %w", err)
		}
		return &m, nil
	}
	return nil, fmt.Errorf("unsupported manifest mime-type %q (TODO: DASH/HI_RES decoding)", mimeType)
}

func nextLowerQuality(q string) string {
	for i, v := range QualityLadder {
		if strings.EqualFold(v, q) && i+1 < len(QualityLadder) {
			return QualityLadder[i+1]
		}
	}
	return ""
}
