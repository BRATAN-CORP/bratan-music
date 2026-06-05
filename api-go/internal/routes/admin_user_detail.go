package routes

import (
	"encoding/json"
	"net/http"

	"github.com/bratan-corp/bratan-music/api-go/internal/app"
	"github.com/bratan-corp/bratan-music/api-go/internal/httpx"
	"github.com/go-chi/chi/v5"
)

// adminUserDetail — GET /admin/users/:id. Mirrors the heavy drill-down in
// admin.ts, returning the AdminUserStats payload the detail dialog renders.
func adminUserDetail(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		targetID := chi.URLParam(r, "id")
		nowSecVal := nowSec()
		nowMsVal := nowMs()

		var (
			id                                            string
			username, name, email, bannedBy, bannedReason *string
			isAdmin, isBanned                             int
			bannedAt, tourCompletedAt                     *int64
			createdAt, updatedAt                          int64
		)
		err := a.DB.QueryRow(ctx,
			`SELECT id, tg_username, tg_name, email, is_admin, is_banned, banned_at,
			        banned_by, banned_reason, tour_completed_at, created_at, updated_at
			   FROM users WHERE id = $1 LIMIT 1`, targetID,
		).Scan(&id, &username, &name, &email, &isAdmin, &isBanned, &bannedAt,
			&bannedBy, &bannedReason, &tourCompletedAt, &createdAt, &updatedAt)
		if err != nil {
			httpx.Err(w, http.StatusNotFound, "Пользователь не найден")
			return
		}

		// Subscriptions (history + current).
		type subRow struct {
			id, status                string
			expires, created, updated int64
			paymentMethod, starsTxID  *string
		}
		var subs []subRow
		if rows, err := a.DB.Query(ctx,
			`SELECT id, status, expires_at, payment_method, stars_tx_id, created_at, updated_at
			   FROM subscriptions WHERE user_id = $1 ORDER BY expires_at DESC LIMIT 50`, targetID); err == nil {
			for rows.Next() {
				var s subRow
				if rows.Scan(&s.id, &s.status, &s.expires, &s.paymentMethod, &s.starsTxID, &s.created, &s.updated) == nil {
					subs = append(subs, s)
				}
			}
			rows.Close()
		}
		subToMap := func(s subRow, withUpdated bool) map[string]any {
			m := map[string]any{
				"id": s.id, "status": s.status, "expiresAt": s.expires,
				"paymentMethod": derefStr(s.paymentMethod), "starsTxId": derefStr(s.starsTxID),
				"createdAt": s.created,
			}
			if withUpdated {
				m["updatedAt"] = s.updated
			}
			return m
		}
		var current any
		history := []map[string]any{}
		for _, s := range subs {
			history = append(history, subToMap(s, true))
			if current == nil && s.status == "active" && s.expires > nowSecVal {
				current = subToMap(s, false)
			}
		}

		// Storage.
		var upCount, upBytes, ovCount, ovBytes int64
		_ = a.DB.QueryRow(ctx, `SELECT COUNT(1), COALESCE(SUM(size_bytes),0) FROM user_tracks WHERE user_id = $1`, targetID).Scan(&upCount, &upBytes)
		_ = a.DB.QueryRow(ctx, `SELECT COUNT(1), COALESCE(SUM(size_bytes),0) FROM track_overrides WHERE user_id = $1`, targetID).Scan(&ovCount, &ovBytes)

		// Library.
		var plTotal, plLiked, plTracks, libAlbums, libArtists, dislikes int64
		_ = a.DB.QueryRow(ctx, `SELECT COUNT(1), COALESCE(SUM(CASE WHEN is_liked=1 THEN 1 ELSE 0 END),0) FROM playlists WHERE user_id = $1`, targetID).Scan(&plTotal, &plLiked)
		_ = a.DB.QueryRow(ctx, `SELECT COUNT(1) FROM playlist_tracks WHERE playlist_id IN (SELECT id FROM playlists WHERE user_id = $1)`, targetID).Scan(&plTracks)
		_ = a.DB.QueryRow(ctx, `SELECT COALESCE(SUM(CASE WHEN type='album' THEN 1 ELSE 0 END),0), COALESCE(SUM(CASE WHEN type='artist' THEN 1 ELSE 0 END),0) FROM library_items WHERE user_id = $1`, targetID).Scan(&libAlbums, &libArtists)
		_ = a.DB.QueryRow(ctx, `SELECT COUNT(1) FROM user_dislikes WHERE user_id = $1`, targetID).Scan(&dislikes)
		created := plTotal - plLiked
		if created < 0 {
			created = 0
		}

		// Play history aggregates.
		var phTotal, ph7, ph30 int64
		_ = a.DB.QueryRow(ctx, `SELECT COUNT(1) FROM play_history WHERE user_id = $1`, targetID).Scan(&phTotal)
		_ = a.DB.QueryRow(ctx, `SELECT COUNT(1) FROM play_history WHERE user_id = $1 AND played_at >= $2`, targetID, nowMsVal-7*86_400_000).Scan(&ph7)
		_ = a.DB.QueryRow(ctx, `SELECT COUNT(1) FROM play_history WHERE user_id = $1 AND played_at >= $2`, targetID, nowMsVal-30*86_400_000).Scan(&ph30)
		var lastPlayed *int64
		_ = a.DB.QueryRow(ctx, `SELECT MAX(played_at) FROM play_history WHERE user_id = $1`, targetID).Scan(&lastPlayed)
		var lastPlayedOut any
		if lastPlayed != nil {
			lastPlayedOut = *lastPlayed / 1000
		}
		bySource := []map[string]any{}
		if rows, err := a.DB.Query(ctx, `SELECT source, COUNT(1) FROM play_history WHERE user_id = $1 GROUP BY source ORDER BY COUNT(1) DESC`, targetID); err == nil {
			for rows.Next() {
				var src string
				var cnt int64
				if rows.Scan(&src, &cnt) == nil {
					bySource = append(bySource, map[string]any{"source": src, "count": cnt})
				}
			}
			rows.Close()
		}
		recent := []map[string]any{}
		if rows, err := a.DB.Query(ctx,
			`SELECT track_id, source, title, artist_name, cover_url, duration, listened_seconds, completed, played_at
			   FROM play_history WHERE user_id = $1 ORDER BY played_at DESC LIMIT 20`, targetID); err == nil {
			for rows.Next() {
				var tid, src, title, artistName string
				var cover *string
				var duration, listened, completed, playedAt int64
				if rows.Scan(&tid, &src, &title, &artistName, &cover, &duration, &listened, &completed, &playedAt) == nil {
					recent = append(recent, map[string]any{
						"trackId": tid, "source": src, "title": title, "artistName": artistName,
						"coverUrl": derefStr(cover), "duration": duration, "listenedSeconds": listened,
						"completed": completed == 1, "playedAt": playedAt / 1000,
					})
				}
			}
			rows.Close()
		}

		// Sessions.
		var sessActive int64
		var sessLast *int64
		_ = a.DB.QueryRow(ctx,
			`SELECT COALESCE(SUM(CASE WHEN expires_at > $1 THEN 1 ELSE 0 END),0), MAX(created_at) FROM sessions WHERE user_id = $2`,
			nowSecVal, targetID).Scan(&sessActive, &sessLast)

		// Preferences.
		var prefsRaw string
		_ = a.DB.QueryRow(ctx, `SELECT COALESCE(prefs,'') FROM user_preferences WHERE user_id = $1 LIMIT 1`, targetID).Scan(&prefsRaw)
		var prefs any
		if prefsRaw != "" {
			_ = json.Unmarshal([]byte(prefsRaw), &prefs)
		}

		httpx.JSON(w, http.StatusOK, map[string]any{
			"user": map[string]any{
				"id": id, "username": derefStr(username), "name": derefStr(name),
				"email": derefStr(email), "isAdmin": isAdmin == 1, "isBanned": isBanned == 1,
				"bannedAt": derefInt(bannedAt), "bannedBy": derefStr(bannedBy),
				"bannedReason": derefStr(bannedReason), "tourCompletedAt": derefInt(tourCompletedAt),
				"createdAt": createdAt, "updatedAt": updatedAt,
			},
			"subscription": map[string]any{"current": current, "history": history},
			"storage": map[string]any{
				"uploads":    map[string]any{"count": upCount, "bytes": upBytes},
				"overrides":  map[string]any{"count": ovCount, "bytes": ovBytes},
				"totalBytes": upBytes + ovBytes,
			},
			"library": map[string]any{
				"playlists":      map[string]any{"total": plTotal, "liked": plLiked, "created": created},
				"playlistTracks": plTracks, "libraryAlbums": libAlbums, "libraryArtists": libArtists,
				"dislikes": dislikes,
			},
			"playHistory": map[string]any{
				"total": phTotal, "last7d": ph7, "last30d": ph30, "lastPlayedAt": lastPlayedOut,
				"bySource": bySource, "recent": recent,
			},
			"sessions":    map[string]any{"active": sessActive, "lastCreatedAt": derefInt(sessLast)},
			"preferences": prefs,
		})
	}
}
