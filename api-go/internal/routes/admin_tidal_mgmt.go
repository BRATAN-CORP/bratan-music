package routes

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/bratan-corp/bratan-music/api-go/internal/app"
	"github.com/bratan-corp/bratan-music/api-go/internal/httpx"
	"github.com/go-chi/chi/v5"
)

// adminTidalAccountsList — GET /admin/tidal/accounts. Lists the multi-account
// pool from tidal_accounts (metadata only; raw secrets never leave the box).
func adminTidalAccountsList(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		rows, err := a.DB.Query(r.Context(),
			`SELECT id, label, user_id, country_code, enabled, subscription_type,
			        subscription_valid_until, expires_at, last_used_at, usage_count,
			        last_error, last_error_at, consecutive_errors, created_at, updated_at
			   FROM tidal_accounts ORDER BY id ASC`)
		items := []map[string]any{}
		if err == nil {
			defer rows.Close()
			for rows.Next() {
				var (
					id, userID, expiresAt, lastUsedAt, createdAt, updatedAt int64
					usageCount, enabled, consecutiveErrors                  int64
					subValidUntil, lastErrorAt                              *int64
					label, countryCode, subscriptionType, lastError         *string
				)
				if err := rows.Scan(&id, &label, &userID, &countryCode, &enabled, &subscriptionType,
					&subValidUntil, &expiresAt, &lastUsedAt, &usageCount, &lastError, &lastErrorAt,
					&consecutiveErrors, &createdAt, &updatedAt); err != nil {
					continue
				}
				items = append(items, map[string]any{
					"id": id, "label": derefStr(label), "userId": userID,
					"countryCode": derefStr(countryCode), "enabled": enabled == 1,
					"subscriptionType": derefStr(subscriptionType), "subscriptionValidUntil": derefInt(subValidUntil),
					"expiresAt": expiresAt, "lastUsedAt": lastUsedAt, "usageCount": usageCount,
					"lastError": derefStr(lastError), "lastErrorAt": derefInt(lastErrorAt),
					"consecutiveErrors": consecutiveErrors, "createdAt": createdAt, "updatedAt": updatedAt,
					"accessTokenPreview": nil, "refreshTokenPreview": nil,
				})
			}
		}
		httpx.JSON(w, http.StatusOK, map[string]any{"items": items})
	}
}

// adminTidalAccountAdd — POST /admin/tidal/accounts {refreshToken, label?}
func adminTidalAccountAdd(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			RefreshToken string `json:"refreshToken"`
			Label        string `json:"label"`
		}
		_ = httpx.BindJSON(r, &body, 8192)
		token := strings.TrimSpace(body.RefreshToken)
		if token == "" {
			httpx.Err(w, http.StatusBadRequest, "refreshToken обязателен")
			return
		}
		tokens, err := tidalSvc(a).Auth.InstallPoolAccount(r.Context(), token, strings.TrimSpace(body.Label))
		if err != nil {
			httpx.Err(w, http.StatusBadRequest, "Ошибка установки токена: "+err.Error())
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]any{
			"ok": true, "userId": tokens.UserID, "countryCode": tokens.CountryCode, "expiresAt": tokens.ExpiresAt,
		})
	}
}

// adminTidalAccountPatch — PATCH /admin/tidal/accounts/:id {label?, enabled?}
func adminTidalAccountPatch(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
		if err != nil || id <= 0 {
			httpx.Err(w, http.StatusBadRequest, "invalid id")
			return
		}
		var body struct {
			Label   *string `json:"label"`
			Enabled *bool   `json:"enabled"`
		}
		_ = httpx.BindJSON(r, &body, 4096)
		if body.Label != nil {
			var labelArg any
			if l := strings.TrimSpace(*body.Label); l != "" {
				labelArg = l
			}
			if _, err := a.DB.Exec(r.Context(),
				`UPDATE tidal_accounts SET label = $1, updated_at = $2 WHERE id = $3`,
				labelArg, nowSec(), id); err != nil {
				httpx.Internal(w, err)
				return
			}
		}
		if body.Enabled != nil {
			en := 0
			if *body.Enabled {
				en = 1
			}
			if _, err := a.DB.Exec(r.Context(),
				`UPDATE tidal_accounts SET enabled = $1, updated_at = $2 WHERE id = $3`,
				en, nowSec(), id); err != nil {
				httpx.Internal(w, err)
				return
			}
		}
		tidalSvc(a).Auth.InvalidateCache()
		httpx.JSON(w, http.StatusOK, map[string]any{"ok": true})
	}
}

// adminTidalAccountDelete — DELETE /admin/tidal/accounts/:id
func adminTidalAccountDelete(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
		if err != nil || id <= 0 {
			httpx.Err(w, http.StatusBadRequest, "invalid id")
			return
		}
		if _, err := a.DB.Exec(r.Context(), `DELETE FROM tidal_accounts WHERE id = $1`, id); err != nil {
			httpx.Internal(w, err)
			return
		}
		tidalSvc(a).Auth.InvalidateCache()
		httpx.JSON(w, http.StatusOK, map[string]any{"ok": true})
	}
}

// adminTidalAccountRefresh — POST /admin/tidal/accounts/:id/refresh
func adminTidalAccountRefresh(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
		if err != nil || id <= 0 {
			httpx.Err(w, http.StatusBadRequest, "invalid id")
			return
		}
		tokens, err := tidalSvc(a).Auth.RefreshPoolAccount(r.Context(), id)
		if err != nil {
			httpx.Err(w, http.StatusBadGateway, "Не удалось обновить подписку")
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]any{
			"ok": true, "userId": tokens.UserID, "countryCode": tokens.CountryCode, "expiresAt": tokens.ExpiresAt,
		})
	}
}
