package routes

import (
	"encoding/json"
	"net/http"

	"github.com/bratan-corp/bratan-music/api-go/internal/app"
	"github.com/bratan-corp/bratan-music/api-go/internal/httpx"
	"github.com/bratan-corp/bratan-music/api-go/internal/middleware"
	"github.com/bratan-corp/bratan-music/api-go/internal/services"
	"github.com/go-chi/chi/v5"
)

func mountUser(a *app.App) func(chi.Router) {
	return func(r chi.Router) {
		r.Use(middleware.JWTAuth(a.Cfg.JWTSecret, a.DB))
		r.Get("/me", userMe(a))
		r.Put("/settings", userUpdateSettings(a))
		r.Get("/settings", userGetSettings(a))
		// Frontend (useSettingsSync / page.tsx / OnboardingTour) calls these
		// TS-contract paths — see user_prefs.go.
		r.Get("/preferences", userGetPreferences(a))
		r.Put("/preferences", userPutPreferences(a))
		r.Get("/limits", userLimits(a))
		r.Post("/reset-recommendations", userResetRecommendations(a))
		r.Post("/me/tour/complete", userTourComplete(a))
		r.Post("/me/tour/reset", userTourReset(a))
		// Account-linking (email + telegram) for the settings panel.
		r.Post("/me/email/request", userEmailLinkRequest(a))
		r.Post("/me/email/verify", userEmailLinkVerify(a))
		r.Post("/me/telegram/link/start", userTelegramLinkStart(a))
		r.Get("/me/telegram/link/status/{nonce}", userTelegramLinkStatus(a))
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
		_ = isBannedInt
		_ = tgID
		_ = createdAt

		// Active subscription, mirroring worker SubscriptionService.getActive:
		// status='active' (NOT 'manual') and expires_at (stored in SECONDS)
		// still in the future. The frontend renders subscription.expiresAt as
		// unix-seconds, so the comparison MUST use nowSec() — the old nowMs()
		// rollup compared seconds against milliseconds and was always false.
		var subExpiresAt int64
		var subObj any // null unless an active sub exists
		if err := a.DB.QueryRow(r.Context(),
			`SELECT expires_at FROM subscriptions
			  WHERE user_id = $1 AND status = 'active' AND expires_at > $2
			  ORDER BY expires_at DESC LIMIT 1`,
			uid, nowSec(),
		).Scan(&subExpiresAt); err == nil {
			subObj = map[string]any{"status": "active", "expiresAt": subExpiresAt}
		}

		// camelCase contract expected by src/store/auth.ts + profile/admin
		// pages. The previous snake_case body broke `isAdmin` (admin panel
		// never rendered), `username`/`name`/`email` and the subscription card.
		var tourCompleted any
		if tourCompletedAt > 0 {
			tourCompleted = tourCompletedAt
		}
		httpx.JSON(w, http.StatusOK, map[string]any{
			"id":              id,
			"username":        nilIfEmpty(tgUsername),
			"name":            nilIfEmpty(tgName),
			"email":           nilIfEmpty(email),
			"isAdmin":         isAdminInt == 1,
			"tourCompletedAt": tourCompleted,
			"subscription":    subObj,
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
			`SELECT id, created_at, last_used_at, expires_at, COALESCE(client_label,''), COALESCE(user_agent,'')
			   FROM sessions WHERE user_id = $1
			   ORDER BY last_used_at DESC, created_at DESC`, uid)
		if err != nil {
			httpx.Internal(w, err)
			return
		}
		defer rows.Close()
		// camelCase SessionListItem to match SessionsPanel.tsx
		// ({id, createdAt, lastUsedAt, expiresAt, label, current}) and the
		// `{sessions, currentSessionId}` envelope. The old body shipped
		// snake_case keys, leaked user_agent/ip_hash, and omitted both
		// expiresAt and currentSessionId — the Сессии tab rendered blank rows.
		out := []map[string]any{}
		for rows.Next() {
			var (
				id, label, ua             string
				created, lastUsed, expire int64
			)
			if err := rows.Scan(&id, &created, &lastUsed, &expire, &label, &ua); err != nil {
				continue
			}
			if label == "" {
				label = services.ClientLabelFromUA(ua)
			}
			out = append(out, map[string]any{
				"id":         id,
				"createdAt":  created,
				"lastUsedAt": lastUsed,
				"expiresAt":  expire,
				"label":      label,
				"current":    id == curSid,
			})
		}
		var curOut any
		if curSid != "" {
			curOut = curSid
		}
		httpx.JSON(w, http.StatusOK, map[string]any{"sessions": out, "currentSessionId": curOut})
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
