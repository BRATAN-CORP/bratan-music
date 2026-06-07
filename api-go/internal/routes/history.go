package routes

import (
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"github.com/bratan-corp/bratan-music/api-go/internal/app"
	"github.com/bratan-corp/bratan-music/api-go/internal/httpx"
)

// historyPlay records a single play in `play_history`. The frontend's
// `usePlayHistoryLogger` hook calls this with the full track snapshot
// so the home-page recent strip and the recommendation pipeline have
// everything they need without a Tidal round-trip.
func historyPlay(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			TrackID         string `json:"track_id"`
			Source          string `json:"source"`
			ArtistID        string `json:"artist_id"`
			ArtistName      string `json:"artist_name"`
			Title           string `json:"title"`
			AlbumID         string `json:"album_id"`
			CoverURL        string `json:"cover_url"`
			Duration        int    `json:"duration"`
			ListenedSeconds int    `json:"listened_seconds"`
			Completed       bool   `json:"completed"`
			ArtistsJSON     string `json:"artists_json"`
			Explicit        bool   `json:"explicit"`
		}
		if err := httpx.BindJSON(r, &body, 8*1024); err != nil {
			httpx.Err(w, http.StatusBadRequest, "Некорректное тело")
			return
		}
		if body.TrackID == "" {
			httpx.Err(w, http.StatusBadRequest, "track_id обязателен")
			return
		}
		if body.Source == "" {
			body.Source = "tidal"
		}
		completedInt := 0
		if body.Completed {
			completedInt = 1
		}
		explicitInt := 0
		if body.Explicit {
			explicitInt = 1
		}
		_, err := a.DB.Exec(r.Context(),
			`INSERT INTO play_history (
			   user_id, track_id, source, artist_id, artist_name, title,
			   album_id, cover_url, duration, listened_seconds, completed,
			   played_at, artists_json, explicit
			 ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
			httpx.UserID(r), body.TrackID, body.Source,
			body.ArtistID, body.ArtistName, body.Title,
			body.AlbumID, body.CoverURL, body.Duration, body.ListenedSeconds,
			completedInt, time.Now().UnixMilli(),
			body.ArtistsJSON, explicitInt,
		)
		if err != nil {
			httpx.Internal(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]any{"ok": true})
	}
}

// historyRecent returns the last N plays for the current user,
// deduplicated by track id (most recent wins) — same shape the home
// page's recent strip expects.
func historyRecent(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		limitStr := r.URL.Query().Get("limit")
		limit, _ := strconv.Atoi(limitStr)
		if limit <= 0 || limit > 100 {
			limit = 20
		}
		rows, err := a.DB.Query(r.Context(),
			`SELECT DISTINCT ON (track_id)
			        track_id, source, COALESCE(artist_id,''), COALESCE(artist_name,''),
			        title, COALESCE(album_id,''), COALESCE(cover_url,''), duration,
			        played_at, COALESCE(artists_json,''),
			        MAX(explicit) OVER (PARTITION BY track_id) AS exp
			   FROM play_history
			  WHERE user_id = $1
			  ORDER BY track_id, played_at DESC
			  LIMIT $2`,
			httpx.UserID(r), limit*4)
		if err != nil {
			httpx.Internal(w, err)
			return
		}
		defer rows.Close()

		// Each item is a Track-shaped camelCase object, mirroring the
		// worker's GET /history/recent. The previous body emitted DB
		// snake_case (track_id, artist_name, cover_url, played_at, …) so
		// the recently-played strip rendered blank cards — id/title/coverUrl
		// were all undefined on the client.
		out := []map[string]any{}
		for rows.Next() {
			var (
				trackID, source, artistID, artistName, title, albumID, coverURL string
				artistsJSON                                                     string
				duration                                                        int
				playedAt                                                        int64
				explicit                                                        int
			)
			if err := rows.Scan(&trackID, &source, &artistID, &artistName,
				&title, &albumID, &coverURL, &duration, &playedAt, &artistsJSON, &explicit); err != nil {
				continue
			}
			item := map[string]any{
				"id":       trackID,
				"source":   source,
				"title":    title,
				"artist":   artistName,
				"duration": duration,
				"explicit": explicit == 1,
				"playedAt": playedAt,
			}
			if artistID != "" {
				item["artistId"] = artistID
			}
			if albumID != "" {
				item["albumId"] = albumID
			}
			if coverURL != "" {
				item["coverUrl"] = coverURL
			}
			if artistsJSON != "" {
				var parsed []map[string]any
				if json.Unmarshal([]byte(artistsJSON), &parsed) == nil {
					artists := make([]map[string]any, 0, len(parsed))
					for _, ar := range parsed {
						idStr, _ := ar["id"].(string)
						nameStr, _ := ar["name"].(string)
						if idStr != "" && nameStr != "" {
							artists = append(artists, map[string]any{"id": idStr, "name": nameStr})
						}
					}
					if len(artists) > 0 {
						item["artists"] = artists
					}
				}
			}
			out = append(out, item)
		}
		if len(out) > limit {
			out = out[:limit]
		}
		httpx.JSON(w, http.StatusOK, map[string]any{"items": out})
	}
}

// historyClear wipes the user's history. Used by the privacy panel.
func historyClear(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		_, err := a.DB.Exec(r.Context(),
			`DELETE FROM play_history WHERE user_id = $1`, httpx.UserID(r))
		if err != nil {
			httpx.Internal(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]any{"ok": true})
	}
}
