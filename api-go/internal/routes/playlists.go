package routes

import (
	"net/http"

	"github.com/bratan-corp/bratan-music/api-go/internal/app"
	"github.com/bratan-corp/bratan-music/api-go/internal/httpx"
	"github.com/bratan-corp/bratan-music/api-go/internal/middleware"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

func mountPlaylists(a *app.App) func(chi.Router) {
	return func(r chi.Router) {
		// Public — share-token lookup.
		r.Get("/share/{token}", playlistByShareToken(a))

		r.Group(func(r chi.Router) {
			r.Use(middleware.JWTAuth(a.Cfg.JWTSecret, a.DB))
			r.Get("/", listPlaylists(a))
			r.Post("/", createPlaylist(a))
			r.Get("/{id}", getPlaylist(a))
			r.Put("/{id}", updatePlaylist(a))
			r.Delete("/{id}", deletePlaylist(a))
			r.Post("/{id}/tracks", addPlaylistTrack(a))
			r.Delete("/{id}/tracks/{trackId}", removePlaylistTrack(a))
			r.Put("/{id}/order", reorderPlaylistTracks(a))
			r.Post("/{id}/pin", pinPlaylist(a))
			r.Post("/{id}/share", sharePlaylist(a))
		}) //nolint:wsl
	}
}

func listPlaylists(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		uid := httpx.UserID(r)
		rows, err := a.DB.Query(r.Context(),
			`SELECT id, name, is_liked, created_at, updated_at,
			        COALESCE(cover_url,''), COALESCE(pinned_at, 0),
			        is_public, COALESCE(share_token,''), COALESCE(description,'')
			   FROM playlists
			  WHERE user_id = $1
			  ORDER BY is_liked DESC, pinned_at DESC NULLS LAST, updated_at DESC`, uid)
		if err != nil {
			httpx.Internal(w, err)
			return
		}
		defer rows.Close()
		out := []map[string]any{}
		for rows.Next() {
			var (
				id, name, cover, share, desc string
				isLiked, isPublic            int
				created, updated, pinned     int64
			)
			if err := rows.Scan(&id, &name, &isLiked, &created, &updated, &cover, &pinned, &isPublic, &share, &desc); err != nil {
				continue
			}
			out = append(out, map[string]any{
				"id":          id,
				"name":        name,
				"is_liked":    isLiked == 1,
				"created_at":  created,
				"updated_at":  updated,
				"cover_url":   cover,
				"pinned_at":   pinned,
				"is_public":   isPublic == 1,
				"share_token": share,
				"description": desc,
			})
		}
		httpx.JSON(w, http.StatusOK, map[string]any{"playlists": out})
	}
}

func createPlaylist(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Name        string `json:"name"`
			Description string `json:"description"`
		}
		if err := httpx.BindJSON(r, &body, 8*1024); err != nil {
			httpx.Err(w, http.StatusBadRequest, "Некорректное тело")
			return
		}
		if body.Name == "" {
			httpx.Err(w, http.StatusBadRequest, "Название обязательно")
			return
		}
		id := uuid.NewString()
		now := nowMs()
		_, err := a.DB.Exec(r.Context(),
			`INSERT INTO playlists(id, user_id, name, is_liked, created_at, updated_at, is_public, description)
			 VALUES ($1, $2, $3, 0, $4, $4, 0, $5)`,
			id, httpx.UserID(r), body.Name, now, body.Description,
		)
		if err != nil {
			httpx.Internal(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]any{
			"id":          id,
			"name":        body.Name,
			"description": body.Description,
			"created_at":  now,
		})
	}
}

func getPlaylist(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := chi.URLParam(r, "id")
		uid := httpx.UserID(r)
		var (
			name, cover, share, desc string
			isLiked, isPublic        int
			created, updated, pinned int64
		)
		err := a.DB.QueryRow(r.Context(),
			`SELECT name, is_liked, created_at, updated_at, COALESCE(cover_url,''),
			        COALESCE(pinned_at,0), is_public, COALESCE(share_token,''),
			        COALESCE(description,'')
			   FROM playlists WHERE id = $1 AND user_id = $2`, id, uid,
		).Scan(&name, &isLiked, &created, &updated, &cover, &pinned, &isPublic, &share, &desc)
		if err != nil {
			httpx.Err(w, http.StatusNotFound, "Плейлист не найден")
			return
		}

		trows, err := a.DB.Query(r.Context(),
			`SELECT track_id, source, position, added_at, COALESCE(snapshot,'')
			   FROM playlist_tracks WHERE playlist_id = $1
			   ORDER BY position ASC, added_at ASC`, id)
		if err != nil {
			httpx.Internal(w, err)
			return
		}
		defer trows.Close()
		tracks := []map[string]any{}
		for trows.Next() {
			var (
				tid, source, snapshot string
				position              int
				addedAt               int64
			)
			if err := trows.Scan(&tid, &source, &position, &addedAt, &snapshot); err != nil {
				continue
			}
			tracks = append(tracks, map[string]any{
				"track_id": tid,
				"source":   source,
				"position": position,
				"added_at": addedAt,
				"snapshot": snapshot,
			})
		}

		httpx.JSON(w, http.StatusOK, map[string]any{
			"id":          id,
			"name":        name,
			"is_liked":    isLiked == 1,
			"created_at":  created,
			"updated_at":  updated,
			"cover_url":   cover,
			"pinned_at":   pinned,
			"is_public":   isPublic == 1,
			"share_token": share,
			"description": desc,
			"tracks":      tracks,
		})
	}
}

func updatePlaylist(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := chi.URLParam(r, "id")
		var body struct {
			Name        *string `json:"name"`
			Description *string `json:"description"`
		}
		if err := httpx.BindJSON(r, &body, 8*1024); err != nil {
			httpx.Err(w, http.StatusBadRequest, "Некорректное тело")
			return
		}
		uid := httpx.UserID(r)
		if body.Name != nil {
			if _, err := a.DB.Exec(r.Context(),
				`UPDATE playlists SET name = $1, updated_at = $2 WHERE id = $3 AND user_id = $4`,
				*body.Name, nowMs(), id, uid); err != nil {
				httpx.Internal(w, err)
				return
			}
		}
		if body.Description != nil {
			if _, err := a.DB.Exec(r.Context(),
				`UPDATE playlists SET description = $1, updated_at = $2 WHERE id = $3 AND user_id = $4`,
				*body.Description, nowMs(), id, uid); err != nil {
				httpx.Internal(w, err)
				return
			}
		}
		httpx.JSON(w, http.StatusOK, map[string]any{"ok": true})
	}
}

func deletePlaylist(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := chi.URLParam(r, "id")
		uid := httpx.UserID(r)
		_, err := a.DB.Exec(r.Context(),
			`DELETE FROM playlists WHERE id = $1 AND user_id = $2 AND is_liked = 0`,
			id, uid)
		if err != nil {
			httpx.Internal(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]any{"ok": true})
	}
}

func addPlaylistTrack(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := chi.URLParam(r, "id")
		uid := httpx.UserID(r)
		var body struct {
			TrackID  string `json:"track_id"`
			Source   string `json:"source"`
			Snapshot string `json:"snapshot"`
		}
		if err := httpx.BindJSON(r, &body, 32*1024); err != nil {
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
		// Ownership check.
		var owner string
		if err := a.DB.QueryRow(r.Context(),
			`SELECT user_id FROM playlists WHERE id = $1`, id).Scan(&owner); err != nil {
			httpx.Err(w, http.StatusNotFound, "Плейлист не найден")
			return
		}
		if owner != uid {
			httpx.Err(w, http.StatusForbidden, "Чужой плейлист")
			return
		}
		// Position = max + 1.
		var maxPos int
		_ = a.DB.QueryRow(r.Context(),
			`SELECT COALESCE(MAX(position), -1) FROM playlist_tracks WHERE playlist_id = $1`,
			id).Scan(&maxPos)
		_, err := a.DB.Exec(r.Context(),
			`INSERT INTO playlist_tracks(playlist_id, track_id, source, position, added_at, snapshot)
			 VALUES ($1, $2, $3, $4, $5, $6)
			 ON CONFLICT (playlist_id, track_id) DO NOTHING`,
			id, body.TrackID, body.Source, maxPos+1, nowMs(), body.Snapshot,
		)
		if err != nil {
			httpx.Internal(w, err)
			return
		}
		_, _ = a.DB.Exec(r.Context(),
			`UPDATE playlists SET updated_at = $1 WHERE id = $2`, nowMs(), id)
		httpx.JSON(w, http.StatusOK, map[string]any{"ok": true})
	}
}

func removePlaylistTrack(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := chi.URLParam(r, "id")
		tid := chi.URLParam(r, "trackId")
		uid := httpx.UserID(r)
		var owner string
		if err := a.DB.QueryRow(r.Context(),
			`SELECT user_id FROM playlists WHERE id = $1`, id).Scan(&owner); err != nil {
			httpx.Err(w, http.StatusNotFound, "Плейлист не найден")
			return
		}
		if owner != uid {
			httpx.Err(w, http.StatusForbidden, "Чужой плейлист")
			return
		}
		_, err := a.DB.Exec(r.Context(),
			`DELETE FROM playlist_tracks WHERE playlist_id = $1 AND track_id = $2`, id, tid)
		if err != nil {
			httpx.Internal(w, err)
			return
		}
		_, _ = a.DB.Exec(r.Context(),
			`UPDATE playlists SET updated_at = $1 WHERE id = $2`, nowMs(), id)
		httpx.JSON(w, http.StatusOK, map[string]any{"ok": true})
	}
}

func reorderPlaylistTracks(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := chi.URLParam(r, "id")
		uid := httpx.UserID(r)
		var body struct {
			Order []string `json:"order"`
		}
		if err := httpx.BindJSON(r, &body, 256*1024); err != nil {
			httpx.Err(w, http.StatusBadRequest, "Некорректное тело")
			return
		}
		var owner string
		if err := a.DB.QueryRow(r.Context(),
			`SELECT user_id FROM playlists WHERE id = $1`, id).Scan(&owner); err != nil {
			httpx.Err(w, http.StatusNotFound, "Плейлист не найден")
			return
		}
		if owner != uid {
			httpx.Err(w, http.StatusForbidden, "Чужой плейлист")
			return
		}
		// Transaction-bounded UPDATE: each track id receives its new
		// position index. Tracks not in `order` keep their old position
		// at the tail (we don't touch them).
		tx, err := a.DB.Begin(r.Context())
		if err != nil {
			httpx.Internal(w, err)
			return
		}
		defer tx.Rollback(r.Context()) //nolint:errcheck
		for i, tid := range body.Order {
			if _, err := tx.Exec(r.Context(),
				`UPDATE playlist_tracks SET position = $1 WHERE playlist_id = $2 AND track_id = $3`,
				i, id, tid); err != nil {
				httpx.Internal(w, err)
				return
			}
		}
		if err := tx.Commit(r.Context()); err != nil {
			httpx.Internal(w, err)
			return
		}
		_, _ = a.DB.Exec(r.Context(),
			`UPDATE playlists SET updated_at = $1 WHERE id = $2`, nowMs(), id)
		httpx.JSON(w, http.StatusOK, map[string]any{"ok": true})
	}
}

func pinPlaylist(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := chi.URLParam(r, "id")
		uid := httpx.UserID(r)
		var body struct {
			Pinned bool `json:"pinned"`
		}
		_ = httpx.BindJSON(r, &body, 1024)
		val := any(nil)
		if body.Pinned {
			val = nowMs()
		}
		_, err := a.DB.Exec(r.Context(),
			`UPDATE playlists SET pinned_at = $1 WHERE id = $2 AND user_id = $3`,
			val, id, uid)
		if err != nil {
			httpx.Internal(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]any{"ok": true})
	}
}

func sharePlaylist(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := chi.URLParam(r, "id")
		uid := httpx.UserID(r)
		token := uuid.NewString()
		_, err := a.DB.Exec(r.Context(),
			`UPDATE playlists SET share_token = $1, is_public = 1, updated_at = $2
			   WHERE id = $3 AND user_id = $4`,
			token, nowMs(), id, uid)
		if err != nil {
			httpx.Internal(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]any{"share_token": token})
	}
}

func playlistByShareToken(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		token := chi.URLParam(r, "token")
		var id, name, desc string
		err := a.DB.QueryRow(r.Context(),
			`SELECT id, name, COALESCE(description,'') FROM playlists
			  WHERE share_token = $1 AND is_public = 1 LIMIT 1`,
			token,
		).Scan(&id, &name, &desc)
		if err != nil {
			httpx.Err(w, http.StatusNotFound, "Плейлист недоступен")
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]any{
			"id":          id,
			"name":        name,
			"description": desc,
		})
	}
}
