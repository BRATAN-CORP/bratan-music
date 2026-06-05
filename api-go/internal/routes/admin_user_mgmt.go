package routes

import (
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/bratan-corp/bratan-music/api-go/internal/app"
	"github.com/bratan-corp/bratan-music/api-go/internal/httpx"
	"github.com/go-chi/chi/v5"
)

// ---------------------------------------------------------------------------
// Admin user grid — GET /admin/users
// ---------------------------------------------------------------------------

func adminUsersList(a *app.App) http.HandlerFunc {
	allowedSort := map[string]string{
		"created_at":     "u.created_at",
		"last_played_at": "last_played_at",
		"tg_username":    "u.tg_username",
	}
	return func(w http.ResponseWriter, r *http.Request) {
		q := strings.TrimSpace(r.URL.Query().Get("q"))
		role := r.URL.Query().Get("role")
		banned := r.URL.Query().Get("banned")
		sub := r.URL.Query().Get("sub")
		orderCol, ok := allowedSort[r.URL.Query().Get("sort")]
		if !ok {
			orderCol = "u.created_at"
		}
		limit := clampInt(queryIntDefault(r, "limit", 50), 1, 100)
		offset := queryIntDefault(r, "offset", 0)
		if offset < 0 {
			offset = 0
		}

		var where []string
		var args []any
		n := 0
		add := func(v any) string { n++; args = append(args, v); return "$" + strconv.Itoa(n) }
		if q != "" {
			like := "%" + strings.ToLower(q) + "%"
			where = append(where, fmt.Sprintf("(LOWER(u.tg_username) LIKE %s OR LOWER(u.tg_name) LIKE %s OR u.id = %s)", add(like), add(like), add(q)))
		}
		if role == "admin" {
			where = append(where, "u.is_admin = 1")
		} else if role == "user" {
			where = append(where, "u.is_admin = 0")
		}
		if banned == "1" {
			where = append(where, "u.is_banned = 1")
		} else if banned == "0" {
			where = append(where, "u.is_banned = 0")
		}
		nowSecVal := nowSec()
		if sub == "active" {
			where = append(where, fmt.Sprintf("EXISTS (SELECT 1 FROM subscriptions s WHERE s.user_id = u.id AND s.status = 'active' AND s.expires_at > %s)", add(nowSecVal)))
		} else if sub == "none" {
			where = append(where, fmt.Sprintf("NOT EXISTS (SELECT 1 FROM subscriptions s WHERE s.user_id = u.id AND s.status = 'active' AND s.expires_at > %s)", add(nowSecVal)))
		}
		whereClause := ""
		if len(where) > 0 {
			whereClause = "WHERE " + strings.Join(where, " AND ")
		}

		var total int64
		_ = a.DB.QueryRow(r.Context(),
			"SELECT COUNT(1) FROM users u "+whereClause, args...).Scan(&total)

		listArgs := append(append([]any{}, args...), limit, offset)
		sql := fmt.Sprintf(`
			SELECT u.id, u.tg_username, u.tg_name, u.is_admin, u.is_banned,
			       u.banned_at, u.banned_reason, u.created_at,
			       (SELECT s.expires_at FROM subscriptions s WHERE s.user_id = u.id AND s.status='active' ORDER BY s.expires_at DESC LIMIT 1) AS sub_expires_at,
			       (SELECT s.status FROM subscriptions s WHERE s.user_id = u.id ORDER BY s.expires_at DESC LIMIT 1) AS sub_status,
			       (SELECT MAX(p.played_at) FROM play_history p WHERE p.user_id = u.id) AS last_played_at,
			       (SELECT COUNT(1) FROM play_history p WHERE p.user_id = u.id) AS play_count
			FROM users u %s
			ORDER BY %s DESC NULLS LAST
			LIMIT $%d OFFSET $%d`, whereClause, orderCol, n+1, n+2)

		rows, err := a.DB.Query(r.Context(), sql, listArgs...)
		items := []map[string]any{}
		if err == nil {
			defer rows.Close()
			for rows.Next() {
				var (
					id                           string
					username, name, bannedReason *string
					isAdmin, isBanned            int
					bannedAt, subExpires, lastPl *int64
					subStatus                    *string
					createdAt, playCount         int64
				)
				if err := rows.Scan(&id, &username, &name, &isAdmin, &isBanned, &bannedAt,
					&bannedReason, &createdAt, &subExpires, &subStatus, &lastPl, &playCount); err != nil {
					continue
				}
				var subscription any
				if subExpires != nil && subStatus != nil && *subStatus == "active" && *subExpires > nowSecVal {
					subscription = map[string]any{"status": "active", "expiresAt": *subExpires}
				}
				var lastPlayedAt any
				if lastPl != nil {
					lastPlayedAt = *lastPl / 1000 // ms → sec
				}
				items = append(items, map[string]any{
					"id":           id,
					"username":     derefStr(username),
					"name":         derefStr(name),
					"isAdmin":      isAdmin == 1,
					"isBanned":     isBanned == 1,
					"bannedAt":     derefInt(bannedAt),
					"bannedReason": derefStr(bannedReason),
					"subscription": subscription,
					"lastPlayedAt": lastPlayedAt,
					"playCount":    playCount,
					"createdAt":    createdAt,
				})
			}
		}
		httpx.JSON(w, http.StatusOK, map[string]any{"items": items, "total": total, "limit": limit, "offset": offset})
	}
}

// adminUsersSearch — GET /admin/users/search?q=
func adminUsersSearch(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		q := strings.TrimSpace(r.URL.Query().Get("q"))
		if q == "" {
			httpx.JSON(w, http.StatusOK, map[string]any{"items": []any{}})
			return
		}
		like := "%" + strings.ToLower(q) + "%"
		rows, err := a.DB.Query(r.Context(),
			`SELECT id, tg_username, tg_name, is_admin, created_at FROM users
			  WHERE LOWER(tg_username) LIKE $1 OR LOWER(tg_name) LIKE $1 OR id = $2
			  ORDER BY created_at DESC LIMIT 20`, like, q)
		items := []map[string]any{}
		if err == nil {
			defer rows.Close()
			for rows.Next() {
				var id string
				var username, name *string
				var isAdmin int
				var createdAt int64
				if err := rows.Scan(&id, &username, &name, &isAdmin, &createdAt); err == nil {
					items = append(items, map[string]any{
						"id": id, "tg_username": derefStr(username), "tg_name": derefStr(name),
						"is_admin": isAdmin, "created_at": createdAt,
					})
				}
			}
		}
		httpx.JSON(w, http.StatusOK, map[string]any{"items": items})
	}
}

// adminAdminFlag — POST /admin/admin-flag
func adminAdminFlag(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			UserID     string `json:"userId"`
			TgUsername string `json:"tgUsername"`
			IsAdmin    *bool  `json:"isAdmin"`
		}
		_ = httpx.BindJSON(r, &body, 4096)
		isAdmin := true
		if body.IsAdmin != nil {
			isAdmin = *body.IsAdmin
		}
		if body.UserID == "" && body.TgUsername == "" {
			httpx.Err(w, http.StatusBadRequest, "userId или tgUsername обязателен")
			return
		}
		uid, uname, name, found := lookupUser(a, r, body.UserID, body.TgUsername)
		if !found {
			httpx.Err(w, http.StatusNotFound, "Пользователь не найден")
			return
		}
		if uid == httpx.UserID(r) && !isAdmin {
			httpx.Err(w, http.StatusBadRequest, "Нельзя снять админку с самого себя")
			return
		}
		flag := 0
		if isAdmin {
			flag = 1
		}
		if _, err := a.DB.Exec(r.Context(),
			`UPDATE users SET is_admin = $1, updated_at = $2 WHERE id = $3`,
			flag, nowSec(), uid); err != nil {
			httpx.Internal(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]any{
			"ok":   true,
			"user": map[string]any{"id": uid, "username": uname, "name": name, "isAdmin": isAdmin},
		})
	}
}

// lookupUser resolves a user by id or tg_username (without leading @).
func lookupUser(a *app.App, r *http.Request, userID, tgUsername string) (id string, username, name *string, found bool) {
	if userID != "" {
		if err := a.DB.QueryRow(r.Context(),
			`SELECT id, tg_username, tg_name FROM users WHERE id = $1`, userID).Scan(&id, &username, &name); err == nil {
			return id, username, name, true
		}
	}
	if tgUsername != "" {
		clean := strings.TrimPrefix(strings.TrimSpace(tgUsername), "@")
		if err := a.DB.QueryRow(r.Context(),
			`SELECT id, tg_username, tg_name FROM users WHERE LOWER(tg_username) = LOWER($1) LIMIT 1`, clean).Scan(&id, &username, &name); err == nil {
			return id, username, name, true
		}
	}
	return "", nil, nil, false
}

func clampInt(v, lo, hi int) int {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

// adminUserPurge — DELETE /admin/users/:id/data
func adminUserPurge(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		targetID := chi.URLParam(r, "id")
		if targetID == "" {
			httpx.Err(w, http.StatusBadRequest, "id обязателен")
			return
		}
		if targetID == httpx.UserID(r) {
			httpx.Err(w, http.StatusBadRequest, "Нельзя удалить собственные данные через эту ручку")
			return
		}
		var exists string
		if err := a.DB.QueryRow(r.Context(), `SELECT id FROM users WHERE id = $1`, targetID).Scan(&exists); err != nil {
			httpx.Err(w, http.StatusNotFound, "Пользователь не найден")
			return
		}
		// Collect R2 keys (uploads + overrides) for best-effort blob deletion.
		keys := map[string]struct{}{}
		for _, sql := range []string{
			`SELECT r2_key FROM user_tracks WHERE user_id = $1`,
			`SELECT r2_key FROM track_overrides WHERE user_id = $1`,
		} {
			if rows, err := a.DB.Query(r.Context(), sql, targetID); err == nil {
				for rows.Next() {
					var k string
					if rows.Scan(&k) == nil && k != "" {
						keys[k] = struct{}{}
					}
				}
				rows.Close()
			}
		}
		r2Deleted, r2Failed := 0, 0
		for k := range keys {
			if a.Store != nil && a.Store.Delete(r.Context(), k) == nil {
				r2Deleted++
			} else {
				r2Failed++
			}
		}
		// Clean up tables that don't cascade, then delete the user row
		// (FK cascade handles the rest).
		for _, sql := range []string{
			`DELETE FROM auth_nonces WHERE user_id = $1`,
			`DELETE FROM recommendation_seen WHERE user_id = $1`,
		} {
			_, _ = a.DB.Exec(r.Context(), sql, targetID)
		}
		if _, err := a.DB.Exec(r.Context(), `DELETE FROM users WHERE id = $1`, targetID); err != nil {
			httpx.Internal(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]any{
			"ok": true, "r2Deleted": r2Deleted, "r2Failed": r2Failed,
		})
	}
}

// adminLogs — GET /admin/logs
func adminLogs(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		limit := clampInt(queryIntDefault(r, "limit", 100), 1, 500)
		offset := queryIntDefault(r, "offset", 0)
		if offset < 0 {
			offset = 0
		}
		level := r.URL.Query().Get("level")
		source := r.URL.Query().Get("source")

		var where []string
		var args []any
		n := 0
		add := func(v any) string { n++; args = append(args, v); return "$" + strconv.Itoa(n) }
		if level != "" {
			where = append(where, "level = "+add(level))
		}
		if source != "" {
			where = append(where, "source = "+add(source))
		}
		whereClause := ""
		if len(where) > 0 {
			whereClause = "WHERE " + strings.Join(where, " AND ")
		}
		listArgs := append(append([]any{}, args...), limit, offset)
		sql := fmt.Sprintf(`SELECT id, level, source, message, context, user_id, created_at
			FROM service_logs %s ORDER BY created_at DESC, id DESC LIMIT $%d OFFSET $%d`,
			whereClause, n+1, n+2)
		rows, err := a.DB.Query(r.Context(), sql, listArgs...)
		items := []map[string]any{}
		if err == nil {
			defer rows.Close()
			for rows.Next() {
				var id, createdAt int64
				var level, source, message string
				var ctx, userID *string
				if err := rows.Scan(&id, &level, &source, &message, &ctx, &userID, &createdAt); err == nil {
					items = append(items, map[string]any{
						"id": id, "level": level, "source": source, "message": message,
						"context": derefStr(ctx), "userId": derefStr(userID), "createdAt": createdAt,
					})
				}
			}
		}
		sources := []string{}
		if srows, err := a.DB.Query(r.Context(), `SELECT DISTINCT source FROM service_logs ORDER BY source ASC`); err == nil {
			defer srows.Close()
			for srows.Next() {
				var s string
				if srows.Scan(&s) == nil {
					sources = append(sources, s)
				}
			}
		}
		httpx.JSON(w, http.StatusOK, map[string]any{"items": items, "sources": sources})
	}
}
