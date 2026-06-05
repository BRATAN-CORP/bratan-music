package routes

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/bratan-corp/bratan-music/api-go/internal/app"
	"github.com/bratan-corp/bratan-music/api-go/internal/httpx"
)

// userGetPreferences mirrors `GET /user/preferences` in user.ts — returns
// the roaming preferences JSON blob wrapped as `{ prefs: {...} }`.
func userGetPreferences(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var raw string
		err := a.DB.QueryRow(r.Context(),
			`SELECT COALESCE(prefs,'{}') FROM user_preferences WHERE user_id = $1`,
			httpx.UserID(r)).Scan(&raw)
		prefs := map[string]any{}
		if err == nil && raw != "" {
			_ = json.Unmarshal([]byte(raw), &prefs)
		}
		if prefs == nil {
			prefs = map[string]any{}
		}
		httpx.JSON(w, http.StatusOK, map[string]any{"prefs": prefs})
	}
}

// userPutPreferences mirrors `PUT /user/preferences` — body is `{ prefs: {...} }`.
func userPutPreferences(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Prefs json.RawMessage `json:"prefs"`
		}
		if err := httpx.BindJSON(r, &body, 256*1024); err != nil {
			httpx.Err(w, http.StatusBadRequest, "Некорректный JSON")
			return
		}
		// prefs must be a JSON object (not array / scalar / null).
		var probe map[string]any
		if len(body.Prefs) == 0 || json.Unmarshal(body.Prefs, &probe) != nil {
			httpx.Err(w, http.StatusBadRequest, "prefs должен быть объектом")
			return
		}
		now := nowSec()
		if _, err := a.DB.Exec(r.Context(),
			`INSERT INTO user_preferences(user_id, prefs, updated_at) VALUES ($1, $2, $3)
			 ON CONFLICT(user_id) DO UPDATE SET prefs = EXCLUDED.prefs, updated_at = EXCLUDED.updated_at`,
			httpx.UserID(r), string(body.Prefs), now); err != nil {
			httpx.Internal(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]any{"ok": true})
	}
}

// userLimits mirrors `GET /user/limits` — daily free-tier listen quota.
func userLimits(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		unlimited := map[string]any{
			"daily": map[string]any{"used": 0, "limit": -1, "unlimited": true},
		}
		if httpx.IsAdmin(r) {
			httpx.JSON(w, http.StatusOK, unlimited)
			return
		}
		uid := httpx.UserID(r)
		var hasSub int
		_ = a.DB.QueryRow(r.Context(),
			`SELECT COUNT(*) FROM subscriptions
			  WHERE user_id = $1 AND status IN ('active','manual') AND expires_at > $2`,
			uid, nowMs()).Scan(&hasSub)
		if hasSub > 0 {
			httpx.JSON(w, http.StatusOK, unlimited)
			return
		}
		today := time.Now().UTC().Format("2006-01-02")
		var used int
		_ = a.DB.QueryRow(r.Context(),
			`SELECT COUNT(*) FROM daily_listen_tracks WHERE user_id = $1 AND date = $2`,
			uid, today).Scan(&used)
		remaining := 3 - used
		if remaining < 0 {
			remaining = 0
		}
		httpx.JSON(w, http.StatusOK, map[string]any{
			"daily": map[string]any{
				"used": used, "limit": 3, "unlimited": false, "remaining": remaining,
			},
		})
	}
}

// userResetRecommendations mirrors `POST /user/reset-recommendations` —
// wipes the recommendation state for the caller and stamps a reset
// checkpoint. Listening history is intentionally preserved.
func userResetRecommendations(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		uid := httpx.UserID(r)
		tables := []string{"recommendation_seen", "user_taste_profile", "user_dislikes", "daily_playlists"}
		deleted := map[string]int64{}
		for _, t := range tables {
			tag, err := a.DB.Exec(r.Context(),
				`DELETE FROM `+t+` WHERE user_id = $1`, uid)
			if err != nil {
				httpx.Internal(w, err)
				return
			}
			deleted[t] = tag.RowsAffected()
		}
		if _, err := a.DB.Exec(r.Context(),
			`UPDATE users SET recommendations_reset_at = $1, updated_at = $2 WHERE id = $3`,
			nowMs(), nowSec(), uid); err != nil {
			httpx.Internal(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]any{"ok": true, "deleted": deleted})
	}
}

// userTourComplete mirrors `POST /user/me/tour/complete`.
func userTourComplete(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		now := nowSec()
		if _, err := a.DB.Exec(r.Context(),
			`UPDATE users SET tour_completed_at = COALESCE(tour_completed_at, $1), updated_at = $2 WHERE id = $3`,
			now, now, httpx.UserID(r)); err != nil {
			httpx.Internal(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]any{"ok": true})
	}
}

// userTourReset mirrors `POST /user/me/tour/reset`.
func userTourReset(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if _, err := a.DB.Exec(r.Context(),
			`UPDATE users SET tour_completed_at = NULL, updated_at = $1 WHERE id = $2`,
			nowSec(), httpx.UserID(r)); err != nil {
			httpx.Internal(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]any{"ok": true})
	}
}
