package routes

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"net/http"
	"regexp"
	"strings"

	"github.com/bratan-corp/bratan-music/api-go/internal/app"
	"github.com/bratan-corp/bratan-music/api-go/internal/db"
	"github.com/bratan-corp/bratan-music/api-go/internal/httpx"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

const maxCoverBytes = 256 * 1024

var (
	coverDataURLRe = regexp.MustCompile(`^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$`)
	shareTokenRe   = regexp.MustCompile(`^[A-Za-z0-9_-]+$`)
)

// generateShareToken mirrors the worker: 20 random bytes, base64url, no padding.
func generateShareToken() string {
	b := make([]byte, 20)
	_, _ = rand.Read(b)
	return base64.RawURLEncoding.EncodeToString(b)
}

// playlistRowToMap mirrors rowToPlaylist() in the worker (camelCase keys).
func playlistRowToMap(
	id, name, cover, share string,
	isLiked, isPublic int,
	pinned *int64,
	updated, created, trackCount int64,
	sourceKind, sourcePID, sourceUserID *string,
) map[string]any {
	var coverOut, shareOut any
	if cover != "" {
		coverOut = cover
	}
	if share != "" {
		shareOut = share
	}
	return map[string]any{
		"id":               id,
		"name":             name,
		"isLiked":          isLiked == 1,
		"coverUrl":         coverOut,
		"pinnedAt":         derefInt(pinned),
		"trackCount":       trackCount,
		"updatedAt":        updated,
		"createdAt":        created,
		"isPublic":         isPublic == 1,
		"shareToken":       shareOut,
		"sourceKind":       derefStr(sourceKind),
		"sourcePlaylistId": derefStr(sourcePID),
		"sourceUserId":     derefStr(sourceUserID),
	}
}

// fetchPlaylistMap loads a playlist by id and returns its rowToPlaylist map
// (with a live track_count). ok=false if no such row.
func fetchPlaylistMap(ctx context.Context, database *db.DB, id string) (map[string]any, bool) {
	var (
		pid, name, cover, share             string
		isLiked, isPublic                   int
		pinned                              *int64
		updated, created, trackCount        int64
		sourceKind, sourcePID, sourceUserID *string
	)
	err := database.QueryRow(ctx,
		`SELECT id, name, COALESCE(cover_url,''), COALESCE(share_token,''),
		        is_liked, is_public, pinned_at, updated_at, created_at,
		        source_kind, source_playlist_id, source_user_id,
		        (SELECT COUNT(*) FROM playlist_tracks WHERE playlist_id = playlists.id)
		   FROM playlists WHERE id = $1`, id,
	).Scan(&pid, &name, &cover, &share, &isLiked, &isPublic, &pinned, &updated, &created,
		&sourceKind, &sourcePID, &sourceUserID, &trackCount)
	if err != nil {
		return nil, false
	}
	return playlistRowToMap(pid, name, cover, share, isLiked, isPublic, pinned,
		updated, created, trackCount, sourceKind, sourcePID, sourceUserID), true
}

// rowToPlaylistTrack mirrors rowToTrack() in playlists.ts (includes position).
func rowToPlaylistTrack(trackID, source, snapshot string, addedAt, position int64) map[string]any {
	out := rowToLikedTrack(trackID, source, snapshot, addedAt)
	out["position"] = position
	return out
}

func playlistCoverPut(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		uid := httpx.UserID(r)
		id := chi.URLParam(r, "id")
		var body struct {
			DataURL string `json:"dataUrl"`
		}
		_ = httpx.BindJSON(r, &body, maxCoverBytes*2)
		dataURL := strings.TrimSpace(body.DataURL)
		if dataURL == "" {
			httpx.Err(w, http.StatusBadRequest, "dataUrl обязателен")
			return
		}
		if !coverDataURLRe.MatchString(dataURL) {
			httpx.Err(w, http.StatusBadRequest, "Допустимы JPEG/PNG/WebP в формате data URL")
			return
		}
		if float64(len(dataURL)) > maxCoverBytes*1.4 {
			httpx.Err(w, http.StatusRequestEntityTooLarge, "Обложка слишком большая. Сожмите изображение и повторите.")
			return
		}
		var rid string
		var sourceKind *string
		if err := a.DB.QueryRow(r.Context(),
			`SELECT id, source_kind FROM playlists WHERE id = $1 AND user_id = $2`, id, uid,
		).Scan(&rid, &sourceKind); err != nil {
			httpx.Err(w, http.StatusNotFound, "Плейлист не найден")
			return
		}
		if sourceKind != nil && *sourceKind != "" {
			httpx.Err(w, http.StatusBadRequest, "Обложку сохранённого плейлиста нельзя менять")
			return
		}
		if _, err := a.DB.Exec(r.Context(),
			`UPDATE playlists SET cover_url = $1, updated_at = $2 WHERE id = $3`,
			dataURL, nowSec(), id); err != nil {
			httpx.Internal(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]any{"ok": true, "coverUrl": dataURL})
	}
}

func playlistCoverDelete(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		uid := httpx.UserID(r)
		id := chi.URLParam(r, "id")
		var rid string
		if err := a.DB.QueryRow(r.Context(),
			`SELECT id FROM playlists WHERE id = $1 AND user_id = $2`, id, uid).Scan(&rid); err != nil {
			httpx.Err(w, http.StatusNotFound, "Плейлист не найден")
			return
		}
		if _, err := a.DB.Exec(r.Context(),
			`UPDATE playlists SET cover_url = NULL, updated_at = $1 WHERE id = $2`,
			nowSec(), id); err != nil {
			httpx.Internal(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]any{"ok": true})
	}
}

func validShareToken(token string) bool {
	return len(token) >= 16 && shareTokenRe.MatchString(token)
}

// playlistSharedByToken mirrors GET /playlists/shared/:token.
func playlistSharedByToken(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		requester := httpx.UserID(r)
		token := chi.URLParam(r, "token")
		if !validShareToken(token) {
			httpx.Err(w, http.StatusBadRequest, "Неверная ссылка")
			return
		}
		var (
			pid, name, cover, share, ownerID    string
			isLiked, isPublic                   int
			pinned                              *int64
			updated, created                    int64
			sourceKind, sourcePID, sourceUserID *string
		)
		err := a.DB.QueryRow(r.Context(),
			`SELECT id, user_id, name, COALESCE(cover_url,''), COALESCE(share_token,''),
			        is_liked, is_public, pinned_at, updated_at, created_at,
			        source_kind, source_playlist_id, source_user_id
			   FROM playlists WHERE share_token = $1 AND is_public = 1`, token,
		).Scan(&pid, &ownerID, &name, &cover, &share, &isLiked, &isPublic, &pinned,
			&updated, &created, &sourceKind, &sourcePID, &sourceUserID)
		if err != nil {
			httpx.Err(w, http.StatusNotFound, "Плейлист недоступен или больше не публичный")
			return
		}

		var ownerName *string
		_ = a.DB.QueryRow(r.Context(),
			`SELECT tg_name FROM users WHERE id = $1`, ownerID).Scan(&ownerName)

		rows, err := a.DB.Query(r.Context(),
			`SELECT track_id, source, COALESCE(snapshot,''), added_at, position
			   FROM playlist_tracks WHERE playlist_id = $1 ORDER BY position ASC`, pid)
		tracks := []map[string]any{}
		if err == nil {
			defer rows.Close()
			for rows.Next() {
				var tid, src, snap string
				var added, pos int64
				if err := rows.Scan(&tid, &src, &snap, &added, &pos); err == nil {
					tracks = append(tracks, rowToPlaylistTrack(tid, src, snap, added, pos))
				}
			}
		}

		var savedID *string
		_ = a.DB.QueryRow(r.Context(),
			`SELECT id FROM playlists WHERE user_id = $1 AND source_kind = 'user' AND source_playlist_id = $2 LIMIT 1`,
			requester, pid).Scan(&savedID)

		out := playlistRowToMap(pid, name, cover, share, isLiked, isPublic, pinned,
			updated, created, int64(len(tracks)), sourceKind, sourcePID, sourceUserID)
		out["tracks"] = tracks
		out["trackCount"] = len(tracks)
		out["readOnly"] = ownerID != requester
		out["isOwner"] = ownerID == requester
		if ownerName != nil {
			out["owner"] = map[string]any{"name": *ownerName}
		} else if ownerID != "" {
			out["owner"] = map[string]any{"name": "Пользователь"}
		} else {
			out["owner"] = nil
		}
		out["savedPlaylistId"] = derefStr(savedID)
		httpx.JSON(w, http.StatusOK, out)
	}
}

// playlistSharedSave mirrors POST /playlists/shared/:token/save.
func playlistSharedSave(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		uid := httpx.UserID(r)
		token := chi.URLParam(r, "token")
		if !validShareToken(token) {
			httpx.Err(w, http.StatusBadRequest, "Неверная ссылка")
			return
		}
		var srcID, srcUser, srcName string
		var srcCover *string
		if err := a.DB.QueryRow(r.Context(),
			`SELECT id, user_id, name, cover_url FROM playlists WHERE share_token = $1 AND is_public = 1`,
			token).Scan(&srcID, &srcUser, &srcName, &srcCover); err != nil {
			httpx.Err(w, http.StatusNotFound, "Плейлист недоступен")
			return
		}
		if srcUser == uid {
			httpx.Err(w, http.StatusBadRequest, "Это ваш плейлист")
			return
		}
		var existingID string
		if err := a.DB.QueryRow(r.Context(),
			`SELECT id FROM playlists WHERE user_id = $1 AND source_kind = 'user' AND source_playlist_id = $2 LIMIT 1`,
			uid, srcID).Scan(&existingID); err == nil && existingID != "" {
			if m, ok := fetchPlaylistMap(r.Context(), a.DB, existingID); ok {
				httpx.JSON(w, http.StatusOK, m)
				return
			}
		}
		now := nowSec()
		id := uuid.NewString()
		if _, err := a.DB.Exec(r.Context(),
			`INSERT INTO playlists(id, user_id, name, is_liked, cover_url, created_at, updated_at,
			        source_kind, source_playlist_id, source_user_id)
			 VALUES ($1, $2, $3, 0, $4, $5, $5, 'user', $6, $7)`,
			id, uid, srcName, srcCover, now, srcID, srcUser); err != nil {
			httpx.Internal(w, err)
			return
		}
		if m, ok := fetchPlaylistMap(r.Context(), a.DB, id); ok {
			httpx.JSON(w, http.StatusCreated, m)
			return
		}
		httpx.JSON(w, http.StatusCreated, map[string]any{"id": id})
	}
}

// playlistExternalTidal mirrors POST /playlists/external/tidal.
func playlistExternalTidal(a *app.App) http.HandlerFunc {
	tidalUUIDRe := regexp.MustCompile(`^[a-fA-F0-9-]{36}$`)
	return func(w http.ResponseWriter, r *http.Request) {
		uid := httpx.UserID(r)
		var body struct {
			TidalID    string   `json:"tidalId"`
			Name       string   `json:"name"`
			CoverURL   *string  `json:"coverUrl"`
			Curator    *string  `json:"curator"`
			TrackCount *float64 `json:"trackCount"`
		}
		if err := httpx.BindJSON(r, &body, 16*1024); err != nil {
			httpx.Err(w, http.StatusBadRequest, "Некорректное тело")
			return
		}
		name := strings.TrimSpace(body.Name)
		if body.TidalID == "" || name == "" {
			httpx.Err(w, http.StatusBadRequest, "tidalId и name обязательны")
			return
		}
		if !tidalUUIDRe.MatchString(body.TidalID) {
			httpx.Err(w, http.StatusBadRequest, "Неверный UUID Tidal-плейлиста")
			return
		}
		var existingID string
		if err := a.DB.QueryRow(r.Context(),
			`SELECT id FROM playlists WHERE user_id = $1 AND source_kind = 'tidal' AND source_playlist_id = $2 LIMIT 1`,
			uid, body.TidalID).Scan(&existingID); err == nil && existingID != "" {
			if m, ok := fetchPlaylistMap(r.Context(), a.DB, existingID); ok {
				httpx.JSON(w, http.StatusOK, m)
				return
			}
		}
		var seedCount any
		if body.TrackCount != nil && *body.TrackCount >= 0 {
			seedCount = int64(*body.TrackCount)
		}
		now := nowSec()
		id := uuid.NewString()
		if _, err := a.DB.Exec(r.Context(),
			`INSERT INTO playlists(id, user_id, name, is_liked, cover_url, created_at, updated_at,
			        source_kind, source_playlist_id, source_track_count)
			 VALUES ($1, $2, $3, 0, $4, $5, $5, 'tidal', $6, $7)`,
			id, uid, name, body.CoverURL, now, body.TidalID, seedCount); err != nil {
			httpx.Internal(w, err)
			return
		}
		if m, ok := fetchPlaylistMap(r.Context(), a.DB, id); ok {
			httpx.JSON(w, http.StatusCreated, m)
			return
		}
		httpx.JSON(w, http.StatusCreated, map[string]any{"id": id})
	}
}
