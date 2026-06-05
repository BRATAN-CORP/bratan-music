package routes

import (
	"encoding/json"
	"net/http"

	"github.com/bratan-corp/bratan-music/api-go/internal/app"
	"github.com/bratan-corp/bratan-music/api-go/internal/httpx"
	"github.com/bratan-corp/bratan-music/api-go/internal/middleware"
	"github.com/go-chi/chi/v5"
)

func mountUser(a *app.App) func(chi.Router) {
	return func(r chi.Router) {
		r.Use(middleware.JWTAuth(a.Cfg.JWTSecret, a.DB))
		r.Get("/me", userMe(a))
		r.Put("/settings", userUpdateSettings(a))
		r.Get("/settings", userGetSettings(a))
		r.Get("/quota", userQuota(a))
		r.Get("/sessions", userListSessions(a))
		r.Delete("/sessions/{id}", userRevokeSession(a))
		r.Post("/sessions/logout-all", userLogoutAll(a))
	}
}

// userMe returns the full user model used by the frontend `useUser`
// hook to bootstrap the app shell.
func userMe(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		uid := httpx.UserID(r)
		var (
			id, tgName, tgUsername, email, tgID string
			isAdminInt, isBannedInt             int
			createdAt, tourCompletedAt          int64
		)
		err := a.DB.QueryRow(r.Context(),
			`SELECT id, COALESCE(tg_name,''), COALESCE(tg_username,''),
			        is_admin, is_banned, COALESCE(email,''),
			        COALESCE(tg_id,''), created_at, COALESCE(tour_completed_at,0)
			   FROM users WHERE id = $1`, uid,
		).Scan(&id, &tgName, &tgUsername, &isAdminInt, &isBannedInt, &email, &tgID, &createdAt, &tourCompletedAt)
		if err != nil {
			httpx.Err(w, http.StatusNotFound, "Пользователь не найден")
			return
		}
		// Has-active-subscription rollup.
		var hasSub int
		_ = a.DB.QueryRow(r.Context(),
			`SELECT COUNT(*) FROM subscriptions
			  WHERE user_id = $1 AND status IN ('active','manual') AND expires_at > $2`,
			uid, nowMs(),
		).Scan(&hasSub)

		httpx.JSON(w, http.StatusOK, map[string]any{
			"id":                id,
			"tg_name":           tgName,
			"tg_username":       tgUsername,
			"is_admin":          isAdminInt == 1,
			"is_banned":         isBannedInt == 1,
			"email":             email,
			"tg_id":             tgID,
			"created_at":        createdAt,
			"tour_completed_at": tourCompletedAt,
			"has_subscription":  hasSub > 0,
		})
	}
}

// userGetSettings returns the JSON blob stored in user_preferences.prefs.
func userGetSettings(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var raw string
		err := a.DB.QueryRow(r.Context(),
			`SELECT COALESCE(prefs,'{}') FROM user_preferences WHERE user_id = $1`,
			httpx.UserID(r),
		).Scan(&raw)
		if err != nil {
			// No row yet — return empty object.
			raw = "{}"
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_, _ = w.Write([]byte(raw))
	}
}

// userUpdateSettings PUTs the entire preferences blob. The frontend
// is the source of truth for the schema (crossfade / EQ / theme /
// language / quality / tour state).
func userUpdateSettings(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		if err := httpx.BindJSON(r, &body, 256*1024); err != nil {
			httpx.Err(w, http.StatusBadRequest, "Некорректное тело запроса")
			return
		}
		raw, _ := json.Marshal(body)
		_, err := a.DB.Exec(r.Context(),
			`INSERT INTO user_preferences(user_id, prefs, updated_at)
			 VALUES ($1, $2, $3)
			 ON CONFLICT (user_id) DO UPDATE SET prefs = EXCLUDED.prefs, updated_at = EXCLUDED.updated_at`,
			httpx.UserID(r), string(raw), nowMs(),
		)
		if err != nil {
			httpx.Internal(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]any{"ok": true})
	}
}

// userQuota returns the free-tier daily-listen counter for today.
func userQuota(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var count int
		_ = a.DB.QueryRow(r.Context(),
			`SELECT COALESCE(count,0) FROM daily_listens
			  WHERE user_id = $1 AND date = (CURRENT_DATE)::text`,
			httpx.UserID(r),
		).Scan(&count)
		httpx.JSON(w, http.StatusOK, map[string]any{
			"used":  count,
			"limit": 3,
		})
	}
}

func userListSessions(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		uid := httpx.UserID(r)
		curSid := httpx.SessionID(r)
		rows, err := a.DB.Query(r.Context(),
			`SELECT id, created_at, last_used_at, COALESCE(client_label,''), COALESCE(user_agent,''), COALESCE(ip_hash,'')
			   FROM sessions WHERE user_id = $1
			   ORDER BY last_used_at DESC, created_at DESC`, uid)
		if err != nil {
			httpx.Internal(w, err)
			return
		}
		defer rows.Close()
		out := []map[string]any{}
		for rows.Next() {
			var (
				id, label, ua, ipHash string
				created, lastUsed     int64
			)
			if err := rows.Scan(&id, &created, &lastUsed, &label, &ua, &ipHash); err != nil {
				continue
			}
			out = append(out, map[string]any{
				"id":           id,
				"created_at":   created,
				"last_used_at": lastUsed,
				"client_label": label,
				"user_agent":   ua,
				"ip_hash":      ipHash,
				"current":      id == curSid,
			})
		}
		httpx.JSON(w, http.StatusOK, map[string]any{"sessions": out})
	}
}

func userRevokeSession(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sid := chi.URLParam(r, "id")
		uid := httpx.UserID(r)
		ct, err := a.DB.Exec(r.Context(),
			`DELETE FROM sessions WHERE id = $1 AND user_id = $2`, sid, uid)
		if err != nil {
			httpx.Internal(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]any{"revoked": ct.RowsAffected()})
	}
}

func userLogoutAll(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		uid := httpx.UserID(r)
		curSid := httpx.SessionID(r)
		// Keep the calling session, drop the rest, and bump min_token_iat
		// so any leaked access token issued before now becomes invalid.
		ct, err := a.DB.Exec(r.Context(),
			`DELETE FROM sessions WHERE user_id = $1 AND id <> $2`, uid, curSid)
		if err != nil {
			httpx.Internal(w, err)
			return
		}
		_, _ = a.DB.Exec(r.Context(),
			`UPDATE users SET min_token_iat = $1 WHERE id = $2`,
			nowSec(), uid)
		httpx.JSON(w, http.StatusOK, map[string]any{"revoked": ct.RowsAffected()})
	}
}
