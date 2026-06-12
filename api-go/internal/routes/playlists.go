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
			// Share/import routes (static segments outrank /{id}).
			r.Get("/shared/{token}", playlistSharedByToken(a))
			r.Post("/shared/{token}/save", playlistSharedSave(a))
			r.Post("/external/tidal", playlistExternalTidal(a))
			r.Get("/{id}", getPlaylist(a))
			r.Put("/{id}", updatePlaylist(a))
			r.Delete("/{id}", deletePlaylist(a))
			r.Post("/{id}/tracks", addPlaylistTrack(a))
			r.Delete("/{id}/tracks/{trackId}", removePlaylistTrack(a))
			r.Put("/{id}/order", reorderPlaylistTracks(a))
			r.Put("/{id}/reorder", reorderPlaylistTracks(a)) // frontend path
			r.Put("/{id}/cover", playlistCoverPut(a))
			r.Delete("/{id}/cover", playlistCoverDelete(a))
			r.Put("/{id}/pin", pinPlaylist(a))     // frontend uses PUT
			r.Put("/{id}/share", sharePlaylist(a)) // frontend uses PUT
		}) //nolint:wsl
	}
}

func listPlaylists(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		uid := httpx.UserID(r)
		rows, err := a.DB.Query(r.Context(),
			`SELECT id, name, COALESCE(cover_url,''), COALESCE(share_token,''),
			        is_liked, is_public, pinned_at, updated_at, created_at,
			        source_kind, source_playlist_id, source_user_id,
			        (SELECT COUNT(*) FROM playlist_tracks WHERE playlist_id = playlists.id)
			   FROM playlists
			  WHERE user_id = $1
			  ORDER BY is_liked DESC, pinned_at DESC NULLS LAST, updated_at DESC`, uid)
		if err != nil {
			httpx.Internal(w, err)
			return
		}
		defer rows.Close()
		// `items` + camelCase to mirror the worker's `GET /playlists/`
		// (c.json({ items: rows.map(rowToPlaylist) })). The previous body
		// returned `{playlists: [...snake_case]}` so isLiked/coverUrl/etc.
		// arrived undefined on the client.
		out := []map[string]any{}
		for rows.Next() {
			var (
				id, name, cover, share              string
				isLiked, isPublic                   int
				pinned                              *int64
				updated, created, trackCount        int64
				sourceKind, sourcePID, sourceUserID *string
			)
			if err := rows.Scan(&id, &name, &cover, &share, &isLiked, &isPublic, &pinned,
				&updated, &created, &sourceKind, &sourcePID, &sourceUserID, &trackCount); err != nil {
				continue
			}
			out = append(out, playlistRowToMap(id, name, cover, share, isLiked, isPublic,
				pinned, updated, created, trackCount, sourceKind, sourcePID, sourceUserID))
		}
		httpx.JSON(w, http.StatusOK, map[string]any{"items": out})
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
		// Seconds, not millis: the playlists table is shared with rows the
		// TS worker created in seconds, and the frontend renders these
		// timestamps assuming the worker's unit. nowMs() here produced
		// year-50000 dates for Go-created playlists.
		now := nowSec()
		_, err := a.DB.Exec(r.Context(),
			`INSERT INTO playlists(id, user_id, name, is_liked, created_at, updated_at, is_public, description)
			 VALUES ($1, $2, $3, 0, $4, $4, 0, $5)`,
			id, httpx.UserID(r), body.Name, now, body.Description,
		)
		if err != nil {
			httpx.Internal(w, err)
			return
		}
		// Return the full rowToPlaylist (camelCase) with 201, mirroring the
		// worker. The old body returned a 4-field snake_case stub, so the
		// client's optimistic insert had no isLiked/coverUrl/trackCount.
		pl, ok := fetchPlaylistMap(r.Context(), a.DB, id)
		if !ok {
			pl = map[string]any{
				"id": id, "name": body.Name, "isLiked": false,
				"trackCount": 0, "updatedAt": now, "createdAt": now,
			}
		}
		httpx.JSON(w, http.StatusCreated, pl)
	}
}

func getPlaylist(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := chi.URLParam(r, "id")
		uid := httpx.UserID(r)
		// Load the playlist as the camelCase rowToPlaylist map (with live
		// trackCount). The previous body returned snake_case keys AND left
		// each track as the raw {track_id, snapshot:"<json string>"} row —
		// the snapshot was never parsed, so every track had no title /
		// artist / cover on the client. fetchPlaylistMap + rowToPlaylistTrack
		// reproduce the worker's `{ ...rowToPlaylist, tracks: rows.map(rowToTrack) }`.
		pl, ok := fetchPlaylistMap(r.Context(), a.DB, id)
		if !ok {
			httpx.Err(w, http.StatusNotFound, "Плейлист не найден")
			return
		}
		var ownerID string
		if v, isStr := pl["sourceUserId"].(string); isStr {
			ownerID = v
		}
		// Ownership: the detail route is owner-scoped (worker checks
		// user_id = requester). Reject other users' private playlists.
		var rowUser string
		if err := a.DB.QueryRow(r.Context(),
			`SELECT user_id FROM playlists WHERE id = $1`, id).Scan(&rowUser); err != nil || rowUser != uid {
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
				position, addedAt     int64
			)
			if err := trows.Scan(&tid, &source, &position, &addedAt, &snapshot); err != nil {
				continue
			}
			tracks = append(tracks, rowToPlaylistTrack(tid, source, snapshot, addedAt, position))
		}

		pl["tracks"] = tracks
		pl["trackCount"] = len(tracks)
		// source_kind set ⇒ read-only; otherwise the requester is the owner.
		sk, hasSK := pl["sourceKind"].(string)
		pl["readOnly"] = (hasSK && sk != "") || (ownerID != "" && ownerID != uid)
		httpx.JSON(w, http.StatusOK, pl)
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
			TrackID  string `json:"trackId"`
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
			Order    []string `json:"order"`
			TrackIDs []string `json:"trackIds"`
		}
		if err := httpx.BindJSON(r, &body, 256*1024); err != nil {
			httpx.Err(w, http.StatusBadRequest, "Некорректное тело")
			return
		}
		if len(body.Order) == 0 {
			body.Order = body.TrackIDs // frontend sends `trackIds`
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
		body := struct {
			Pinned bool `json:"pinned"`
		}{Pinned: true}
		_ = httpx.BindJSON(r, &body, 1024)

		var exists string
		if err := a.DB.QueryRow(r.Context(),
			`SELECT id FROM playlists WHERE id = $1 AND user_id = $2`, id, uid).Scan(&exists); err != nil {
			httpx.Err(w, http.StatusNotFound, "Плейлист не найден")
			return
		}
		now := nowSec()
		var pinnedAt any
		if body.Pinned {
			pinnedAt = now
		}
		if _, err := a.DB.Exec(r.Context(),
			`UPDATE playlists SET pinned_at = $1, updated_at = $2 WHERE id = $3`,
			pinnedAt, now, id); err != nil {
			httpx.Internal(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]any{"ok": true, "pinnedAt": pinnedAt})
	}
}

func sharePlaylist(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := chi.URLParam(r, "id")
		uid := httpx.UserID(r)
		var body struct {
			Public bool `json:"public"`
		}
		_ = httpx.BindJSON(r, &body, 1024)

		var (
			rid, share string
			isLiked    int
			sourceKind *string
		)
		if err := a.DB.QueryRow(r.Context(),
			`SELECT id, is_liked, COALESCE(share_token,''), source_kind
			   FROM playlists WHERE id = $1 AND user_id = $2`, id, uid,
		).Scan(&rid, &isLiked, &share, &sourceKind); err != nil {
			httpx.Err(w, http.StatusNotFound, "Плейлист не найден")
			return
		}
		if isLiked == 1 {
			httpx.Err(w, http.StatusBadRequest, "Системный плейлист нельзя сделать публичным")
			return
		}
		if sourceKind != nil && *sourceKind != "" {
			httpx.Err(w, http.StatusBadRequest, "Сохранённый плейлист нельзя поделить — поделитесь оригиналом")
			return
		}
		token := share
		if body.Public && token == "" {
			token = generateShareToken()
		}
		var tokenArg any
		if token != "" {
			tokenArg = token
		}
		pub := 0
		if body.Public {
			pub = 1
		}
		if _, err := a.DB.Exec(r.Context(),
			`UPDATE playlists SET is_public = $1, share_token = $2, updated_at = $3 WHERE id = $4`,
			pub, tokenArg, nowSec(), id); err != nil {
			httpx.Internal(w, err)
			return
		}
		var shareOut any
		if token != "" {
			shareOut = token
		}
		httpx.JSON(w, http.StatusOK, map[string]any{
			"ok": true, "isPublic": body.Public, "shareToken": shareOut,
		})
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
