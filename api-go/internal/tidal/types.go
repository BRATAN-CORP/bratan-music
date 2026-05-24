// Package tidal is the Go port of worker/src/services/tidal/.
//
// First-pass scope (this file + auth.go + api.go + stream.go + device.go):
//   - Single-account session loading (legacy `tidal_session` row 1)
//     with env TIDAL_REFRESH_TOKEN as fallback. Pool support
//     (`tidal_accounts`) is a TODO.
//   - Token refresh against three known candidate clients.
//   - Catalogue endpoints used by search / tracks / albums / artists.
//   - playbackinfopostpaywall -> manifest -> stream URL (HIGH only;
//     quality-ladder discovery from worker/TidalWeb is a TODO).
//   - Device authorization (admin login flow).
//
// Out of scope for now (still served by `worker/`):
//   - TidalExplicitFilter (account-side explicit toggle).
//   - Active explicit-twin lookup (`swapInExplicitTwins`).
//   - Web cookies fallback for catalogue endpoints.
//   - Multi-account pool with LRU picker.
//
// These TODOs are tracked in api-go/STATUS.md and will land in
// follow-up commits on this same branch before cut-over.
package tidal

import "encoding/json"

// TrackRaw is the upstream Tidal /v1/tracks/* shape.
type TrackRaw struct {
	ID             int64       `json:"id"`
	Title          string      `json:"title"`
	Duration       int         `json:"duration"`
	Version        *string     `json:"version,omitempty"`
	Explicit       bool        `json:"explicit,omitempty"`
	Popularity     int         `json:"popularity,omitempty"`
	TrackNumber    int         `json:"trackNumber,omitempty"`
	VolumeNumber   int         `json:"volumeNumber,omitempty"`
	StreamReady    bool        `json:"streamReady,omitempty"`
	AllowStreaming bool        `json:"allowStreaming,omitempty"`
	AudioQuality   string      `json:"audioQuality,omitempty"`
	AudioModes     []string    `json:"audioModes,omitempty"`
	Artist         *ArtistMin  `json:"artist,omitempty"`
	Artists        []ArtistMin `json:"artists,omitempty"`
	Album          *AlbumMin   `json:"album,omitempty"`
}

// AlbumRaw is the upstream Tidal /v1/albums/* shape.
type AlbumRaw struct {
	ID             int64       `json:"id"`
	Title          string      `json:"title"`
	Duration       int         `json:"duration,omitempty"`
	NumberOfTracks int         `json:"numberOfTracks,omitempty"`
	ReleaseDate    string      `json:"releaseDate,omitempty"`
	Cover          *string     `json:"cover,omitempty"`
	VideoCover     *string     `json:"videoCover,omitempty"`
	Artist         *ArtistMin  `json:"artist,omitempty"`
	Artists        []ArtistMin `json:"artists,omitempty"`
	AudioQuality   string      `json:"audioQuality,omitempty"`
	Explicit       bool        `json:"explicit,omitempty"`
	Type           string      `json:"type,omitempty"`
}

// ArtistRaw is the upstream Tidal /v1/artists/* shape.
type ArtistRaw struct {
	ID         int64   `json:"id"`
	Name       string  `json:"name"`
	Picture    *string `json:"picture,omitempty"`
	Popularity int     `json:"popularity,omitempty"`
}

// ArtistMin is the embedded {id,name,type?} reference Tidal threads
// through tracks / albums.
type ArtistMin struct {
	ID   int64  `json:"id"`
	Name string `json:"name"`
	Type string `json:"type,omitempty"`
}

// AlbumMin is the embedded {id,title,cover,videoCover?} reference
// Tidal threads through track responses.
type AlbumMin struct {
	ID         int64   `json:"id"`
	Title      string  `json:"title"`
	Cover      *string `json:"cover,omitempty"`
	VideoCover *string `json:"videoCover,omitempty"`
}

// LyricsRaw is the upstream /v1/tracks/:id/lyrics shape.
type LyricsRaw struct {
	TrackID               int64  `json:"trackId"`
	LyricsProvider        string `json:"lyricsProvider,omitempty"`
	ProviderCommontrackID string `json:"providerCommontrackId,omitempty"`
	ProviderLyricsID      string `json:"providerLyricsId,omitempty"`
	Lyrics                string `json:"lyrics,omitempty"`
	Subtitles             string `json:"subtitles,omitempty"`
	IsRightToLeft         bool   `json:"isRightToLeft,omitempty"`
}

// SearchResponse is the upstream /v1/search shape — each bucket
// optionally wraps every item as `{item: ...}` or `{value: ...}`.
type SearchResponse struct {
	Artists *SearchBucket `json:"artists,omitempty"`
	Albums  *SearchBucket `json:"albums,omitempty"`
	Tracks  *SearchBucket `json:"tracks,omitempty"`
}

// SearchBucket holds a paginated bucket of raw items + total count.
// We unmarshal items as raw JSON and let unwrapItem() figure out
// the actual shape since Tidal switches between flat and wrapped
// items across endpoints.
type SearchBucket struct {
	Items              []json.RawMessage `json:"items,omitempty"`
	TotalNumberOfItems int               `json:"totalNumberOfItems,omitempty"`
}

// PlaybackInfo is the upstream /v1/tracks/:id/playbackinfopostpaywall
// response. Only fields we actually need are listed.
type PlaybackInfo struct {
	TrackID          int64  `json:"trackId"`
	AudioQuality     string `json:"audioQuality"`
	AudioMode        string `json:"audioMode"`
	StreamingSession string `json:"streamingSessionId"`
	Manifest         string `json:"manifest"`
	ManifestMimeType string `json:"manifestMimeType"`
}

// BtsManifest is the decoded `application/vnd.tidal.bts` manifest
// payload (base64-decoded JSON). DASH (`application/dash+xml`) is
// intentionally not handled in the first-pass port — the worker
// also only decoded BTS in the common path; DASH was a rare-case
// branch for HiRes.
type BtsManifest struct {
	URLs           []string `json:"urls"`
	Codecs         string   `json:"codecs,omitempty"`
	MimeType       string   `json:"mimeType,omitempty"`
	EncryptionType string   `json:"encryptionType,omitempty"`
	KeyID          string   `json:"keyId,omitempty"`
}

// ListItems is the upstream `{items: [...]}` wrapper Tidal returns
// for paginated catalogue endpoints (albums, top tracks, etc).
type ListItems[T any] struct {
	Items              []T `json:"items"`
	TotalNumberOfItems int `json:"totalNumberOfItems,omitempty"`
}

// ResolvedStream is what stream.go returns to the routes layer.
type ResolvedStream struct {
	URL      string
	Quality  string
	Codec    string
	MimeType string
}
