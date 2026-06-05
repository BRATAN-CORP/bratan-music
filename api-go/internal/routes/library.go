package routes

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strconv"

	"github.com/bratan-corp/bratan-music/api-go/internal/app"
	"github.com/bratan-corp/bratan-music/api-go/internal/db"
	"github.com/bratan-corp/bratan-music/api-go/internal/httpx"
	"github.com/bratan-corp/bratan-music/api-go/internal/middleware"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

// mountLibrary mirrors the legacy worker `worker/src/routes/library.ts`
// contract exactly — the React frontend was built against those paths and
// response shapes, so they must match byte-for-byte (keys, casing, pagination).
func mountLibrary(a *app.App) func(chi.Router) {
	return func(r chi.Router) {
		r.Use(middleware.JWTAuth(a.Cfg.JWTSecret, a.DB))

		// Liked tracks (rows in the user's `is_liked = 1` playlist).
		r.Get("/liked", listLikedTracks(a))
		r.Get("/likes/ids", likedTrackIDs(a))
		r.Get("/like/{trackId}", likedTrackStatus(a))
		r.Post("/like/{trackId}", likeTrack(a))
		r.Delete("/like/{trackId}", unlikeTrack(a))

		// Saved albums + artists (rows in `library_items`).
		r.Get("/items/{type}/ids", libraryItemIDs(a))
		r.Get("/items/{type}", listLibraryItems(a))
		r.Post("/items/{type}/{itemId}", addLibraryItem(a))
		r.Delete("/items/{type}/{itemId}", removeLibraryItem(a))

		// The user's playlists (incl. the liked playlist), with track counts.
		r.Get("/playlists", listLibraryPlaylists(a))
	}
}

// rawJSONObject reads the request body and returns it as a compact JSON
// string iff it is a non-empty JSON object; otherwise "". Mirrors the
// worker's `c.req.json().catch(() => null)` snapshot handling.
func rawJSONObject(r *http.Request) string {
	body, err := io.ReadAll(io.LimitReader(r.Body, 256*1024))
	if err != nil || len(body) == 0 {
		return ""
	}
	var probe map[string]any
	if json.Unmarshal(body, &probe) != nil {
		return ""
	}
	out, err := json.Marshal(probe)
	if err != nil {
		return ""
	}
	return string(out)
}

// ensureLikedPlaylist resolves (creating if absent) the user's single
// `is_liked = 1` playlist — mirrors ensureLikedPlaylist in library.ts.
func ensureLikedPlaylist(ctx context.Context, database *db.DB, uid string) (string, error) {
	var id string
	err := database.QueryRow(ctx,
		`SELECT id FROM playlists WHERE user_id = $1 AND is_liked = 1 LIMIT 1`, uid,
	).Scan(&id)
	if err == nil && id != "" {
		return id, nil
	}
	id = uuid.NewString()
	now := nowSec()
	if _, err := database.Exec(ctx,
		`INSERT INTO playlists(id, user_id, name, is_liked, created_at, updated_at)
		 VALUES ($1, $2, 'Мне нравится', 1, $3, $3)`,
		id, uid, now); err != nil {
		return "", err
	}
	return id, nil
}

// rowToLikedTrack mirrors rowToTrack() in library.ts — flattens the snapshot
// JSON into a Track-shaped object the frontend consumes.
func rowToLikedTrack(trackID, source, snapshot string, addedAt int64) map[string]any {
	snap := map[string]any{}
	if snapshot != "" {
		_ = json.Unmarshal([]byte(snapshot), &snap)
	}
	str := func(k string) string {
		if v, ok := snap[k].(string); ok {
			return v
		}
		return ""
	}
	num := func(k string) float64 {
		if v, ok := snap[k].(float64); ok {
			return v
		}
		return 0
	}
	out := map[string]any{
		"id":       trackID,
		"source":   source,
		"addedAt":  addedAt,
		"title":    str("title"),
		"artist":   str("artist"),
		"album":    str("album"),
		"coverUrl": str("coverUrl"),
		"duration": num("duration"),
	}
	// Optional fields — only emit when present, matching the worker's
	// `?? undefined` (omitted) semantics so the frontend Track shape lines up.
	if v, ok := snap["artistId"]; ok {
		out["artistId"] = v
	}
	if v, ok := snap["artists"]; ok {
		out["artists"] = v
	}
	if v, ok := snap["coverVideoUrl"]; ok {
		out["coverVideoUrl"] = v
	}
	if v, ok := snap["explicit"]; ok {
		out["explicit"] = v
	}
	return out
}

func listLikedTracks(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		uid := httpx.UserID(r)
		limit := queryIntDefault(r, "limit", 50)
		offset := queryIntDefault(r, "offset", 0)

		pid, err := ensureLikedPlaylist(r.Context(), a.DB, uid)
		if err != nil {
			httpx.Internal(w, err)
			return
		}
		rows, err := a.DB.Query(r.Context(),
			`SELECT track_id, source, COALESCE(snapshot,''), added_at
			   FROM playlist_tracks WHERE playlist_id = $1
			   ORDER BY added_at DESC LIMIT $2 OFFSET $3`, pid, limit, offset)
		if err != nil {
			httpx.Internal(w, err)
			return
		}
		defer rows.Close()
		items := []map[string]any{}
		for rows.Next() {
			var tid, src, snap string
			var added int64
			if err := rows.Scan(&tid, &src, &snap, &added); err != nil {
				continue
			}
			items = append(items, rowToLikedTrack(tid, src, snap, added))
		}
		var total int64
		_ = a.DB.QueryRow(r.Context(),
			`SELECT COUNT(*) FROM playlist_tracks WHERE playlist_id = $1`, pid).Scan(&total)
		httpx.JSON(w, http.StatusOK, map[string]any{
			"items": items, "total": total, "limit": limit, "offset": offset,
		})
	}
}

func likedTrackIDs(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		pid, err := ensureLikedPlaylist(r.Context(), a.DB, httpx.UserID(r))
		if err != nil {
			httpx.Internal(w, err)
			return
		}
		rows, err := a.DB.Query(r.Context(),
			`SELECT track_id FROM playlist_tracks WHERE playlist_id = $1`, pid)
		if err != nil {
			httpx.Internal(w, err)
			return
		}
		defer rows.Close()
		ids := []string{}
		for rows.Next() {
			var id string
			if err := rows.Scan(&id); err == nil {
				ids = append(ids, id)
			}
		}
		httpx.JSON(w, http.StatusOK, map[string]any{"ids": ids})
	}
}

func likedTrackStatus(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid := chi.URLParam(r, "trackId")
		pid, err := ensureLikedPlaylist(r.Context(), a.DB, httpx.UserID(r))
		if err != nil {
			httpx.Internal(w, err)
			return
		}
		var exists string
		_ = a.DB.QueryRow(r.Context(),
			`SELECT track_id FROM playlist_tracks WHERE playlist_id = $1 AND track_id = $2`,
			pid, tid).Scan(&exists)
		httpx.JSON(w, http.StatusOK, map[string]any{"liked": exists != ""})
	}
}

func likeTrack(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		uid := httpx.UserID(r)
		tid := chi.URLParam(r, "trackId")
		source := r.URL.Query().Get("source")
		if source == "" {
			source = "tidal"
		}
		snap := rawJSONObject(r)

		pid, err := ensureLikedPlaylist(r.Context(), a.DB, uid)
		if err != nil {
			httpx.Internal(w, err)
			return
		}
		var exists string
		_ = a.DB.QueryRow(r.Context(),
			`SELECT track_id FROM playlist_tracks WHERE playlist_id = $1 AND track_id = $2`,
			pid, tid).Scan(&exists)
		now := nowSec()
		if exists != "" {
			if snap != "" {
				if _, err := a.DB.Exec(r.Context(),
					`UPDATE playlist_tracks SET snapshot = $1 WHERE playlist_id = $2 AND track_id = $3`,
					snap, pid, tid); err != nil {
					httpx.Internal(w, err)
					return
				}
			}
			httpx.JSON(w, http.StatusOK, map[string]any{"ok": true, "liked": true})
			return
		}
		var maxPos int
		_ = a.DB.QueryRow(r.Context(),
			`SELECT COALESCE(MAX(position),-1) FROM playlist_tracks WHERE playlist_id = $1`, pid,
		).Scan(&maxPos)
		var snapArg any
		if snap != "" {
			snapArg = snap
		}
		if _, err := a.DB.Exec(r.Context(),
			`INSERT INTO playlist_tracks(playlist_id, track_id, source, position, added_at, snapshot)
			 VALUES ($1, $2, $3, $4, $5, $6)
			 ON CONFLICT (playlist_id, track_id) DO NOTHING`,
			pid, tid, source, maxPos+1, now, snapArg); err != nil {
			httpx.Internal(w, err)
			return
		}
		_, _ = a.DB.Exec(r.Context(),
			`UPDATE playlists SET updated_at = $1 WHERE id = $2`, now, pid)
		httpx.JSON(w, http.StatusCreated, map[string]any{"ok": true, "liked": true})
	}
}

func unlikeTrack(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid := chi.URLParam(r, "trackId")
		pid, err := ensureLikedPlaylist(r.Context(), a.DB, httpx.UserID(r))
		if err != nil {
			httpx.Internal(w, err)
			return
		}
		if _, err := a.DB.Exec(r.Context(),
			`DELETE FROM playlist_tracks WHERE playlist_id = $1 AND track_id = $2`,
			pid, tid); err != nil {
			httpx.Internal(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]any{"ok": true, "liked": false})
	}
}

func validItemType(t string) bool { return t == "album" || t == "artist" }

func listLibraryItems(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		kind := chi.URLParam(r, "type")
		if !validItemType(kind) {
			httpx.Err(w, http.StatusBadRequest, "Invalid type")
			return
		}
		rows, err := a.DB.Query(r.Context(),
			`SELECT item_id, COALESCE(snapshot,''), added_at FROM library_items
			  WHERE user_id = $1 AND type = $2 ORDER BY added_at DESC`,
			httpx.UserID(r), kind)
		if err != nil {
			httpx.Internal(w, err)
			return
		}
		defer rows.Close()
		items := []map[string]any{}
		for rows.Next() {
			var id, snap string
			var added int64
			if err := rows.Scan(&id, &snap, &added); err != nil {
				continue
			}
			obj := map[string]any{}
			if snap != "" {
				_ = json.Unmarshal([]byte(snap), &obj)
			}
			obj["id"] = id
			obj["addedAt"] = added
			items = append(items, obj)
		}
		httpx.JSON(w, http.StatusOK, map[string]any{"items": items})
	}
}

func libraryItemIDs(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		kind := chi.URLParam(r, "type")
		if !validItemType(kind) {
			httpx.Err(w, http.StatusBadRequest, "Invalid type")
			return
		}
		rows, err := a.DB.Query(r.Context(),
			`SELECT item_id FROM library_items WHERE user_id = $1 AND type = $2`,
			httpx.UserID(r), kind)
		if err != nil {
			httpx.Internal(w, err)
			return
		}
		defer rows.Close()
		ids := []string{}
		for rows.Next() {
			var id string
			if err := rows.Scan(&id); err == nil {
				ids = append(ids, id)
			}
		}
		httpx.JSON(w, http.StatusOK, map[string]any{"ids": ids})
	}
}

func addLibraryItem(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		kind := chi.URLParam(r, "type")
		if !validItemType(kind) {
			httpx.Err(w, http.StatusBadRequest, "Invalid type")
			return
		}
		id := chi.URLParam(r, "itemId")
		snap := rawJSONObject(r)
		var snapArg any
		if snap != "" {
			snapArg = snap
		}
		if _, err := a.DB.Exec(r.Context(),
			`INSERT INTO library_items(user_id, item_id, type, snapshot, added_at)
			 VALUES ($1, $2, $3, $4, $5)
			 ON CONFLICT (user_id, item_id, type) DO UPDATE SET snapshot = EXCLUDED.snapshot`,
			httpx.UserID(r), id, kind, snapArg, nowSec()); err != nil {
			httpx.Internal(w, err)
			return
		}
		httpx.JSON(w, http.StatusCreated, map[string]any{"ok": true})
	}
}

func removeLibraryItem(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		kind := chi.URLParam(r, "type")
		if !validItemType(kind) {
			httpx.Err(w, http.StatusBadRequest, "Invalid type")
			return
		}
		id := chi.URLParam(r, "itemId")
		if _, err := a.DB.Exec(r.Context(),
			`DELETE FROM library_items WHERE user_id = $1 AND item_id = $2 AND type = $3`,
			httpx.UserID(r), id, kind); err != nil {
			httpx.Internal(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]any{"ok": true})
	}
}

// listLibraryPlaylists mirrors `GET /library/playlists` in library.ts —
// returns rowToPlaylist objects (camelCase) with computed trackCount.
func listLibraryPlaylists(a *app.App) http.HandlerFunc {
	const trackCountSQL = `
		CASE
		  WHEN p.source_kind IS NULL THEN
		    (SELECT COUNT(*) FROM playlist_tracks WHERE playlist_id = p.id)
		  WHEN p.source_kind = 'user' THEN
		    COALESCE((
		      SELECT COUNT(*) FROM playlist_tracks pt
		      JOIN playlists src ON src.id = pt.playlist_id
		      WHERE src.id = p.source_playlist_id AND src.is_public = 1
		    ), 0)
		  ELSE COALESCE(p.source_track_count, 0)
		END`
	return func(w http.ResponseWriter, r *http.Request) {
		rows, err := a.DB.Query(r.Context(),
			`SELECT p.id, p.name, p.is_liked, COALESCE(p.cover_url,''), p.pinned_at,
			        p.updated_at, p.created_at, p.is_public, COALESCE(p.share_token,''),
			        p.source_kind, p.source_playlist_id, p.source_user_id,
			        (`+trackCountSQL+`) AS track_count
			   FROM playlists p WHERE p.user_id = $1
			  ORDER BY p.is_liked DESC, p.updated_at DESC`, httpx.UserID(r))
		if err != nil {
			httpx.Internal(w, err)
			return
		}
		defer rows.Close()
		items := []map[string]any{}
		for rows.Next() {
			var (
				id, name, cover, share              string
				isLiked, isPublic                   int
				pinned                              *int64
				updated, created, trackCount        int64
				sourceKind, sourcePID, sourceUserID *string
			)
			if err := rows.Scan(&id, &name, &isLiked, &cover, &pinned, &updated, &created,
				&isPublic, &share, &sourceKind, &sourcePID, &sourceUserID, &trackCount); err != nil {
				continue
			}
			var coverOut any
			if cover != "" {
				coverOut = cover
			}
			var shareOut any
			if share != "" {
				shareOut = share
			}
			items = append(items, map[string]any{
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
			})
		}
		httpx.JSON(w, http.StatusOK, map[string]any{"items": items})
	}
}

func derefInt(p *int64) any {
	if p == nil {
		return nil
	}
	return *p
}

func derefStr(p *string) any {
	if p == nil {
		return nil
	}
	return *p
}

func queryIntDefault(r *http.Request, key string, def int) int {
	v := r.URL.Query().Get(key)
	if v == "" {
		return def
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		return def
	}
	return n
}
