package tidal

import (
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
)

const (
	imgBase   = "https://resources.tidal.com/images"
	videoBase = "https://resources.tidal.com/videos"
)

// CoverURL builds a JPG cover URL for the given Tidal cover UUID
// (port of worker/TidalService.ts:coverUrl).
func CoverURL(coverID *string, size int) string {
	if coverID == nil || *coverID == "" {
		return ""
	}
	return fmt.Sprintf("%s/%s/%dx%d.jpg", imgBase, strings.ReplaceAll(*coverID, "-", "/"), size, size)
}

// VideoCoverURL builds an MP4 cover URL for the given Tidal video
// cover UUID (port of worker/TidalService.ts:videoCoverUrl).
func VideoCoverURL(videoID *string, size int) string {
	if videoID == nil || *videoID == "" {
		return ""
	}
	return fmt.Sprintf("%s/%s/%dx%d.mp4", videoBase, strings.ReplaceAll(*videoID, "-", "/"), size, size)
}

// ArtistImageURL builds a JPG artist picture URL.
func ArtistImageURL(pictureID *string, size int) string {
	if pictureID == nil || *pictureID == "" {
		return ""
	}
	return fmt.Sprintf("%s/%s/%dx%d.jpg", imgBase, strings.ReplaceAll(*pictureID, "-", "/"), size, size)
}

// ArtistRef is the app-level credit shape returned to the frontend.
type ArtistRef struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// Track is the app-level track shape returned to the frontend
// (matches worker/types/music.ts Track).
type Track struct {
	ID            string      `json:"id"`
	Source        string      `json:"source"`
	Title         string      `json:"title"`
	Artist        string      `json:"artist"`
	ArtistID      string      `json:"artistId,omitempty"`
	Artists       []ArtistRef `json:"artists,omitempty"`
	Album         string      `json:"album,omitempty"`
	AlbumID       string      `json:"albumId,omitempty"`
	Duration      int         `json:"duration"`
	CoverURL      string      `json:"coverUrl,omitempty"`
	CoverVideoURL string      `json:"coverVideoUrl,omitempty"`
	Explicit      bool        `json:"explicit"`
	Quality       string      `json:"quality,omitempty"`
	// ISRC identifies the underlying recording across catalogue
	// twins (album re-issues / region variants of the same track).
	// Drives recording-level dedupe and the lyrics twin-fallback.
	ISRC string `json:"isrc,omitempty"`
}

// Album is the app-level album shape (matches worker/types/music.ts).
type Album struct {
	ID            string      `json:"id"`
	Source        string      `json:"source"`
	Title         string      `json:"title"`
	Artist        string      `json:"artist"`
	ArtistID      string      `json:"artistId,omitempty"`
	Artists       []ArtistRef `json:"artists,omitempty"`
	CoverURL      string      `json:"coverUrl,omitempty"`
	CoverVideoURL string      `json:"coverVideoUrl,omitempty"`
	ReleaseDate   string      `json:"releaseDate,omitempty"`
	ReleaseType   string      `json:"releaseType,omitempty"`
	Explicit      bool        `json:"explicit,omitempty"`
	Tracks        []Track     `json:"tracks"`
}

// Artist is the app-level artist shape.
type Artist struct {
	ID       string `json:"id"`
	Source   string `json:"source"`
	Name     string `json:"name"`
	ImageURL string `json:"imageUrl,omitempty"`
}

// SearchResult is the app-level search response.
type SearchResult struct {
	Tracks         []Track    `json:"tracks"`
	Albums         []Album    `json:"albums"`
	Artists        []Artist   `json:"artists"`
	Playlists      []Playlist `json:"playlists,omitempty"`
	TotalTracks    *int       `json:"totalTracks,omitempty"`
	TotalAlbums    *int       `json:"totalAlbums,omitempty"`
	TotalArtists   *int       `json:"totalArtists,omitempty"`
	TotalPlaylists *int       `json:"totalPlaylists,omitempty"`
}

// Playlist is the app-level editorial-playlist shape (matches the
// worker's ExplorePlaylist + search result shape).
type Playlist struct {
	ID          string `json:"id"`
	Source      string `json:"source"`
	Title       string `json:"title"`
	Description string `json:"description,omitempty"`
	CoverURL    string `json:"coverUrl,omitempty"`
	Curator     string `json:"curator,omitempty"`
	TrackCount  int    `json:"trackCount,omitempty"`
	Duration    int    `json:"duration,omitempty"`
	Explicit    *bool  `json:"explicit,omitempty"`
}

// MapPlaylist converts a raw editorial-playlist record to the
// app-level Playlist shape. Square cover is preferred for grids,
// wide image is used as a fallback.
func MapPlaylist(raw *PlaylistRaw) Playlist {
	if raw == nil {
		return Playlist{}
	}
	cover := raw.SquareImage
	if cover == nil || *cover == "" {
		cover = raw.Image
	}
	curator := ""
	if raw.Creator != nil {
		curator = raw.Creator.Name
	}
	desc := ""
	if raw.Description != nil {
		desc = *raw.Description
	}
	return Playlist{
		ID:          raw.UUID,
		Source:      "tidal",
		Title:       raw.Title,
		Description: desc,
		CoverURL:    CoverURL(cover, 480),
		Curator:     curator,
		TrackCount:  raw.NumberOfTracks,
		Duration:    raw.Duration,
		Explicit:    raw.Explicit,
	}
}

// dedupeArtistRefs ports worker/TidalService.ts:dedupeArtistRefs.
func dedupeArtistRefs(list []ArtistMin) []ArtistRef {
	if len(list) == 0 {
		return nil
	}
	seen := make(map[string]bool, len(list))
	out := make([]ArtistRef, 0, len(list))
	for _, a := range list {
		id := strconv.FormatInt(a.ID, 10)
		if seen[id] {
			continue
		}
		seen[id] = true
		out = append(out, ArtistRef{ID: id, Name: a.Name})
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

// MapTrack converts a raw Tidal track record to the app-level Track
// shape (port of worker/TidalService.ts:mapTrack).
func MapTrack(raw *TrackRaw) Track {
	if raw == nil {
		return Track{}
	}
	artists := dedupeArtistRefs(raw.Artists)
	var mainArtist *ArtistMin
	if raw.Artist != nil {
		mainArtist = raw.Artist
	} else if len(raw.Artists) > 0 {
		mainArtist = &raw.Artists[0]
	}

	title := raw.Title
	if raw.Version != nil && *raw.Version != "" {
		title = title + " (" + *raw.Version + ")"
	}

	artistName := "Unknown Artist"
	if len(artists) > 0 {
		names := make([]string, 0, len(artists))
		for _, a := range artists {
			names = append(names, a.Name)
		}
		artistName = strings.Join(names, ", ")
	} else if mainArtist != nil {
		artistName = mainArtist.Name
	}

	t := Track{
		ID:       strconv.FormatInt(raw.ID, 10),
		Source:   "tidal",
		Title:    title,
		Artist:   artistName,
		Artists:  artists,
		Duration: raw.Duration,
		Explicit: raw.Explicit,
		Quality:  raw.AudioQuality,
		ISRC:     raw.ISRC,
	}
	if mainArtist != nil {
		t.ArtistID = strconv.FormatInt(mainArtist.ID, 10)
	}
	if raw.Album != nil {
		t.Album = raw.Album.Title
		t.AlbumID = strconv.FormatInt(raw.Album.ID, 10)
		t.CoverURL = CoverURL(raw.Album.Cover, 640)
		t.CoverVideoURL = VideoCoverURL(raw.Album.VideoCover, 1280)
	}
	if t.Quality == "" {
		t.Quality = "HIGH"
	}
	return t
}

// MapAlbum converts a raw Tidal album record. Pass tracks separately
// because the catalogue API returns them via a sibling endpoint.
func MapAlbum(raw *AlbumRaw, tracks []Track) Album {
	if raw == nil {
		return Album{}
	}
	artists := dedupeArtistRefs(raw.Artists)
	var mainArtist *ArtistMin
	if raw.Artist != nil {
		mainArtist = raw.Artist
	} else if len(raw.Artists) > 0 {
		mainArtist = &raw.Artists[0]
	}
	artistName := "Unknown Artist"
	if len(artists) > 0 {
		names := make([]string, 0, len(artists))
		for _, a := range artists {
			names = append(names, a.Name)
		}
		artistName = strings.Join(names, ", ")
	} else if mainArtist != nil {
		artistName = mainArtist.Name
	}
	a := Album{
		ID:            strconv.FormatInt(raw.ID, 10),
		Source:        "tidal",
		Title:         raw.Title,
		Artist:        artistName,
		Artists:       artists,
		CoverURL:      CoverURL(raw.Cover, 640),
		CoverVideoURL: VideoCoverURL(raw.VideoCover, 1280),
		ReleaseDate:   raw.ReleaseDate,
		ReleaseType:   raw.Type,
		Explicit:      raw.Explicit,
		Tracks:        tracks,
	}
	if mainArtist != nil {
		a.ArtistID = strconv.FormatInt(mainArtist.ID, 10)
	}
	if a.Tracks == nil {
		a.Tracks = []Track{}
	}
	return a
}

// MapArtist converts a raw artist record.
func MapArtist(raw *ArtistRaw) Artist {
	if raw == nil {
		return Artist{}
	}
	return Artist{
		ID:       strconv.FormatInt(raw.ID, 10),
		Source:   "tidal",
		Name:     raw.Name,
		ImageURL: ArtistImageURL(raw.Picture, 480),
	}
}

// UnwrapItem handles Tidal's flat-or-wrapped item shape. Tidal
// occasionally returns `{item: ...}` or `{value: ...}` instead of the
// raw object directly.
func UnwrapItem[T any](msg json.RawMessage) (*T, error) {
	var wrap struct {
		Item  json.RawMessage `json:"item"`
		Value json.RawMessage `json:"value"`
	}
	if err := json.Unmarshal(msg, &wrap); err == nil {
		if len(wrap.Item) > 0 {
			var t T
			if err := json.Unmarshal(wrap.Item, &t); err == nil {
				return &t, nil
			}
		}
		if len(wrap.Value) > 0 {
			var t T
			if err := json.Unmarshal(wrap.Value, &t); err == nil {
				return &t, nil
			}
		}
	}
	var t T
	if err := json.Unmarshal(msg, &t); err != nil {
		return nil, err
	}
	return &t, nil
}

// UnwrapBucket converts a SearchBucket's raw items into the typed
// items they actually contain. Drops items that fail to unmarshal
// rather than failing the whole bucket — matches the TS behaviour.
func UnwrapBucket[T any](b *SearchBucket) []T {
	if b == nil {
		return nil
	}
	out := make([]T, 0, len(b.Items))
	for _, msg := range b.Items {
		v, err := UnwrapItem[T](msg)
		if err != nil || v == nil {
			continue
		}
		out = append(out, *v)
	}
	return out
}
