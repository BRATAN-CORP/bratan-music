package routes

import (
	"net/http"

	"github.com/bratan-corp/bratan-music/api-go/internal/app"
	"github.com/bratan-corp/bratan-music/api-go/internal/httpx"
	"github.com/bratan-corp/bratan-music/api-go/internal/middleware"
	"github.com/go-chi/chi/v5"
)

func mountLibrary(a *app.App) func(chi.Router) {
	return func(r chi.Router) {
		r.Use(middleware.JWTAuth(a.Cfg.JWTSecret, a.DB))

		// Liked tracks live as rows in the user's `is_liked = 1`
		// playlist (one row per user), matching the legacy worker.
		r.Get("/likes/tracks", listLikedTracks(a))
		r.Post("/likes/track/{id}", likeTrack(a))
		r.Delete("/likes/track/{id}", unlikeTrack(a))

		// Albums + artists live in `library_items`.
		r.Get("/albums", listLikedAlbums(a))
		r.Post("/albums/{id}", likeAlbum(a))
		r.Delete("/albums/{id}", unlikeAlbum(a))

		r.Get("/artists", listLikedArtists(a))
		r.Post("/artists/{id}", likeArtist(a))
		r.Delete("/artists/{id}", unlikeArtist(a))
	}
}

func listLikedTracks(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		uid := httpx.UserID(r)
		var pid string
		_ = a.DB.QueryRow(r.Context(),
			`SELECT id FROM playlists WHERE user_id = $1 AND is_liked = 1 LIMIT 1`, uid,
		).Scan(&pid)
		if pid == "" {
			httpx.JSON(w, http.StatusOK, map[string]any{"items": []any{}})
			return
		}
		rows, err := a.DB.Query(r.Context(),
			`SELECT track_id, source, COALESCE(snapshot,''), added_at
			   FROM playlist_tracks WHERE playlist_id = $1
			   ORDER BY added_at DESC`, pid)
		if err != nil {
			httpx.Internal(w, err)
			return
		}
		defer rows.Close()
		out := []map[string]any{}
		for rows.Next() {
			var tid, src, snap string
			var added int64
			if err := rows.Scan(&tid, &src, &snap, &added); err != nil {
				continue
			}
			out = append(out, map[string]any{
				"track_id": tid, "source": src, "snapshot": snap, "added_at": added,
			})
		}
		httpx.JSON(w, http.StatusOK, map[string]any{"items": out})
	}
}

func likeTrack(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		uid := httpx.UserID(r)
		tid := chi.URLParam(r, "id")
		source := r.URL.Query().Get("source")
		if source == "" {
			source = "tidal"
		}
		snap := r.URL.Query().Get("snapshot")

		// Ensure liked playlist exists.
		pid := "liked_" + uid
		if _, err := a.DB.Exec(r.Context(),
			`INSERT INTO playlists(id, user_id, name, is_liked, created_at, updated_at)
			 VALUES ($1, $2, 'Любимые', 1, $3, $3)
			 ON CONFLICT (id) DO NOTHING`,
			pid, uid, nowMs()); err != nil {
			httpx.Internal(w, err)
			return
		}
		var maxPos int
		_ = a.DB.QueryRow(r.Context(),
			`SELECT COALESCE(MAX(position),-1) FROM playlist_tracks WHERE playlist_id = $1`, pid,
		).Scan(&maxPos)
		_, err := a.DB.Exec(r.Context(),
			`INSERT INTO playlist_tracks(playlist_id, track_id, source, position, added_at, snapshot)
			 VALUES ($1, $2, $3, $4, $5, $6)
			 ON CONFLICT (playlist_id, track_id) DO NOTHING`,
			pid, tid, source, maxPos+1, nowMs(), snap)
		if err != nil {
			httpx.Internal(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]any{"ok": true})
	}
}

func unlikeTrack(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		uid := httpx.UserID(r)
		tid := chi.URLParam(r, "id")
		pid := "liked_" + uid
		_, err := a.DB.Exec(r.Context(),
			`DELETE FROM playlist_tracks WHERE playlist_id = $1 AND track_id = $2`,
			pid, tid)
		if err != nil {
			httpx.Internal(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]any{"ok": true})
	}
}

func listLikedAlbums(a *app.App) http.HandlerFunc {
	return listLibraryItems(a, "album")
}

func listLikedArtists(a *app.App) http.HandlerFunc {
	return listLibraryItems(a, "artist")
}

func listLibraryItems(a *app.App, kind string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		rows, err := a.DB.Query(r.Context(),
			`SELECT item_id, COALESCE(snapshot,''), added_at FROM library_items
			  WHERE user_id = $1 AND type = $2 ORDER BY added_at DESC`,
			httpx.UserID(r), kind)
		if err != nil {
			httpx.Internal(w, err)
			return
		}
		defer rows.Close()
		out := []map[string]any{}
		for rows.Next() {
			var id, snap string
			var added int64
			if err := rows.Scan(&id, &snap, &added); err != nil {
				continue
			}
			out = append(out, map[string]any{
				"id": id, "snapshot": snap, "added_at": added,
			})
		}
		httpx.JSON(w, http.StatusOK, map[string]any{"items": out})
	}
}

func likeAlbum(a *app.App) http.HandlerFunc  { return likeLibraryItem(a, "album") }
func likeArtist(a *app.App) http.HandlerFunc { return likeLibraryItem(a, "artist") }

func likeLibraryItem(a *app.App, kind string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := chi.URLParam(r, "id")
		uid := httpx.UserID(r)
		snap := r.URL.Query().Get("snapshot")
		_, err := a.DB.Exec(r.Context(),
			`INSERT INTO library_items(user_id, item_id, type, snapshot, added_at)
			 VALUES ($1, $2, $3, $4, $5)
			 ON CONFLICT (user_id, item_id, type) DO UPDATE SET snapshot = EXCLUDED.snapshot`,
			uid, id, kind, snap, nowMs())
		if err != nil {
			httpx.Internal(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]any{"ok": true})
	}
}

func unlikeAlbum(a *app.App) http.HandlerFunc  { return unlikeLibraryItem(a, "album") }
func unlikeArtist(a *app.App) http.HandlerFunc { return unlikeLibraryItem(a, "artist") }

func unlikeLibraryItem(a *app.App, kind string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := chi.URLParam(r, "id")
		uid := httpx.UserID(r)
		_, err := a.DB.Exec(r.Context(),
			`DELETE FROM library_items WHERE user_id = $1 AND item_id = $2 AND type = $3`,
			uid, id, kind)
		if err != nil {
			httpx.Internal(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]any{"ok": true})
	}
}
