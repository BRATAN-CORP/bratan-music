package tidal

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
)

// QualityLadder is the canonical Tidal quality order, high → low.
// Mirrors worker/TidalWeb.ts QUALITY_LADDER exactly (5 rungs incl.
// HI_RES/MQA). Lower index == higher quality.
var QualityLadder = []string{"HI_RES_LOSSLESS", "HI_RES", "LOSSLESS", "HIGH", "LOW"}

// ResolveStream returns the best playable stream for a track. Full port
// of worker/TidalWeb.ts resolveStream:
//
//   - discovers the track's published formats in ONE round trip to
//     openapi.tidal.com/v2/trackManifests/:id (Redis-cached 30d, with a
//     short negative-cache TTL so transient upstream blips self-heal —
//     this is the #488 fix that prevents the "FFmpegDemuxer: demuxer
//     seek failed" poisoning incident),
//   - picks the highest quality at-or-below the caller's cap,
//   - runs a single playbackinfopostpaywall + decodes the manifest
//     (BTS or DASH/HI_RES),
//   - falls back to legacyResolveStream (full ladder walk) whenever
//     discovery yields nothing or the picked quality lies about being
//     playable (encrypted / empty manifest).
//
// Every short-circuit is a strict regression guard: discovery is an
// optimisation, never a behaviour change for the caller.
func (a *API) ResolveStream(ctx context.Context, trackID, quality string) (*ResolvedStream, error) {
	if quality == "" {
		quality = "HIGH"
	}
	requestedIdx := indexOfQuality(strings.ToUpper(quality))
	capIdx := requestedIdx
	if capIdx < 0 {
		capIdx = indexOfQuality("HIGH")
	}

	qualities := a.discoverQualities(ctx, trackID)

	// qualities is sorted high→low (low ladder index first). Pick the
	// first rung at-or-below the requested cap (idx >= cap).
	target := ""
	for _, q := range qualities {
		if idx := indexOfQuality(q); idx >= capIdx {
			target = q
			break
		}
	}

	discoveryEmpty := len(qualities) == 0

	if target == "" {
		return a.legacyResolveStream(ctx, trackID, quality, discoveryEmpty)
	}

	info, err := a.getPlaybackInfo(ctx, trackID, target)
	if err != nil {
		return a.legacyResolveStream(ctx, trackID, quality, discoveryEmpty)
	}
	manifest, err := decodeManifest(info.Manifest, info.ManifestMimeType)
	if err != nil || len(manifest.URLs) == 0 ||
		(manifest.EncryptionType != "" && !strings.EqualFold(manifest.EncryptionType, "NONE")) {
		return a.legacyResolveStream(ctx, trackID, quality, discoveryEmpty)
	}

	// Memoise the resolved quality so a future discovery miss for this
	// track also lands in one round trip via the legacy ladder.
	a.writeCachedQuality(ctx, trackID, target, qualityCacheTTL)

	return &ResolvedStream{
		URL:      manifest.URLs[0],
		Quality:  target,
		Codec:    manifest.Codecs,
		MimeType: manifest.MimeType,
	}, nil
}

// legacyResolveStream walks QualityLadder starting at the requested cap
// (or a previously-memoised lower rung) until a non-empty, non-encrypted
// manifest comes back. Port of worker/TidalWeb.ts legacyResolveStream.
//
// shortQualityTtl pins the discovered quality with the short
// negative-cache TTL (instead of 30d) when we got here via a discovery
// miss, so the quality memo self-heals at the same cadence as the
// discovery cache.
func (a *API) legacyResolveStream(ctx context.Context, trackID, requestedQuality string, shortQualityTtl bool) (*ResolvedStream, error) {
	requestedIdx := indexOfQuality(strings.ToUpper(requestedQuality))
	capIdx := requestedIdx
	if capIdx < 0 {
		capIdx = indexOfQuality("HIGH")
	}

	startIdx := capIdx
	if cached := a.readCachedQuality(ctx, trackID); cached != "" {
		if cachedIdx := indexOfQuality(cached); cachedIdx >= capIdx {
			startIdx = cachedIdx
		}
	}

	qualityTTL := qualityCacheTTL
	if shortQualityTtl {
		qualityTTL = discoveryNegativeCacheTTL
	}

	var lastErr string
	for _, q := range QualityLadder[startIdx:] {
		info, err := a.getPlaybackInfo(ctx, trackID, q)
		if err != nil {
			lastErr = fmt.Sprintf("%s: %v", q, err)
			continue
		}
		manifest, err := decodeManifest(info.Manifest, info.ManifestMimeType)
		if err != nil {
			lastErr = fmt.Sprintf("%s: %v", q, err)
			continue
		}
		if len(manifest.URLs) == 0 {
			lastErr = q + ": empty urls"
			continue
		}
		if manifest.EncryptionType != "" && !strings.EqualFold(manifest.EncryptionType, "NONE") {
			lastErr = q + ": encrypted"
			continue
		}
		a.writeCachedQuality(ctx, trackID, q, qualityTTL)
		return &ResolvedStream{
			URL:      manifest.URLs[0],
			Quality:  q,
			Codec:    manifest.Codecs,
			MimeType: manifest.MimeType,
		}, nil
	}
	return nil, fmt.Errorf("не удалось получить поток: %s", lastErr)
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

var (
	dashBaseURLRe = regexp.MustCompile(`(?s)<BaseURL[^>]*>([^<]+)</BaseURL>`)
	dashInitRe    = regexp.MustCompile(`initialization="([^"]+)"`)
	dashCodecsRe  = regexp.MustCompile(`codecs="([^"]+)"`)
)

// decodeManifest mirrors worker/TidalWeb.ts decodeManifest. Handles both
// the common `application/vnd.tidal.bts` JSON manifest and the
// `application/dash+xml` MPEG-DASH manifest used for HI_RES/HI_RES_LOSSLESS.
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

	if strings.EqualFold(mimeType, "application/dash+xml") {
		xml := string(decoded)
		codec := "mp4a.40.2"
		if m := dashCodecsRe.FindStringSubmatch(xml); m != nil {
			codec = m[1]
		}
		if m := dashBaseURLRe.FindStringSubmatch(xml); m != nil {
			return &BtsManifest{
				URLs:           []string{strings.TrimSpace(m[1])},
				Codecs:         codec,
				MimeType:       "audio/mp4",
				EncryptionType: "NONE",
			}, nil
		}
		if m := dashInitRe.FindStringSubmatch(xml); m != nil {
			initURL := strings.ReplaceAll(m[1], "$RepresentationID$", "audio")
			return &BtsManifest{
				URLs:           []string{initURL},
				Codecs:         codec,
				MimeType:       "audio/mp4",
				EncryptionType: "NONE",
			}, nil
		}
		return nil, fmt.Errorf("dash manifest: no BaseURL/initialization found")
	}

	return nil, fmt.Errorf("unsupported manifest mime-type %q", mimeType)
}

// indexOfQuality returns the QualityLadder index for q (uppercased), or
// -1 if not found.
func indexOfQuality(q string) int {
	for i, v := range QualityLadder {
		if strings.EqualFold(v, q) {
			return i
		}
	}
	return -1
}
