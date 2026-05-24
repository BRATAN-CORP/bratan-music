package routes

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"

	"github.com/bratan-corp/bratan-music/api-go/internal/app"
	"github.com/bratan-corp/bratan-music/api-go/internal/authz"
	"github.com/bratan-corp/bratan-music/api-go/internal/httpx"
	"github.com/bratan-corp/bratan-music/api-go/internal/middleware"
	"github.com/bratan-corp/bratan-music/api-go/internal/services"
)

func mountAuth(a *app.App) func(chi.Router) {
	return func(r chi.Router) {
		r.Post("/telegram", authTelegram(a))
		r.Post("/refresh", authRefresh(a))
		r.Post("/logout", authLogout(a))
		// Polled by the deeplink-login flow on the web client. Stays
		// GET to match the legacy worker so existing clients keep
		// working post cut-over.
		r.Get("/nonce/{nonce}", authNonce(a))
		// Email-OTP flow is wired but not implemented yet (Brevo +
		// OTP service still TS-only). Stubs returning 501.
		r.Post("/email/request", authEmailStart(a))
		r.Post("/email/verify", authEmailVerify(a))

		// Authenticated whoami used by clients to refresh the user model.
		r.Group(func(r chi.Router) {
			r.Use(middleware.JWTAuth(a.Cfg.JWTSecret, a.DB))
			r.Get("/whoami", authWhoami(a))
		})
	}
}

// metaFromRequest builds the per-signin SessionMetadata persisted on
// the new `sessions` row.
func metaFromRequest(r *http.Request) services.SessionMetadata {
	ua := r.Header.Get("User-Agent")
	ip := services.ExtractIP(r.Header.Get, r.RemoteAddr)
	return services.SessionMetadata{
		UserAgent:   ua,
		IPHash:      services.HashIP(ip),
		ClientLabel: services.ClientLabelFromUA(ua),
	}
}

// userResponse is the user shape returned by every signin response.
func userResponse(u *services.User) map[string]any {
	if u == nil {
		return nil
	}
	out := map[string]any{
		"id":              u.ID,
		"username":        u.TGUsername,
		"name":            u.TGName,
		"isAdmin":         u.IsAdmin,
		"tourCompletedAt": nilIfZero(u.TourCompletedAt),
	}
	if u.Email != "" {
		out["email"] = u.Email
	}
	return out
}

func nilIfZero(v int64) any {
	if v == 0 {
		return nil
	}
	return v
}

// ---- /auth/telegram ----------------------------------------------------

func authTelegram(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			InitData string `json:"initData"`
		}
		if err := httpx.BindJSON(r, &body, 32*1024); err != nil || body.InitData == "" {
			httpx.Err(w, http.StatusBadRequest, "initData обязателен")
			return
		}
		verified, err := authz.VerifyInitData(a.Cfg.TelegramBotToken, body.InitData, 0)
		if err != nil || verified == nil {
			httpx.Err(w, http.StatusUnauthorized, "Невалидные данные Telegram")
			return
		}
		if verified.User.ID == 0 {
			httpx.Err(w, http.StatusBadRequest, "Данные пользователя отсутствуют")
			return
		}

		auth := a.Auth.(*services.AuthService)
		tgID := strings.TrimSpace(formatInt(verified.User.ID))

		// Was the user new? Lookup BEFORE the upsert so the answer
		// reflects pre-call state.
		preExisting, _ := auth.FindUserByTGID(r.Context(), tgID)
		isNew := preExisting == nil

		if isNew {
			ip := services.ExtractIP(r.Header.Get, r.RemoteAddr)
			if !auth.CanSignup(r.Context(), ip) {
				httpx.Err(w, http.StatusTooManyRequests,
					"Слишком много новых аккаунтов с этого устройства. Попробуйте позже.")
				return
			}
		}

		name := strings.TrimSpace(strings.Join([]string{
			verified.User.FirstName,
			verified.User.LastName,
		}, " "))
		user, err := auth.UpsertTelegramUser(r.Context(), tgID, verified.User.Username, name)
		if err != nil || user == nil {
			httpx.Internal(w, err)
			return
		}
		if isNew {
			ip := services.ExtractIP(r.Header.Get, r.RemoteAddr)
			auth.LogSignup(r.Context(), user.ID, ip, "telegram")
		}

		tokens, err := auth.GenerateTokens(r.Context(), user.ID, user.IsAdmin, metaFromRequest(r))
		if err != nil {
			httpx.Internal(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]any{
			"accessToken":  tokens.AccessToken,
			"refreshToken": tokens.RefreshToken,
			"expiresIn":    tokens.ExpiresIn,
			"sessionId":    tokens.SessionID,
			"user":         userResponse(user),
		})
	}
}

// ---- /auth/refresh -----------------------------------------------------

func authRefresh(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			RefreshToken string `json:"refreshToken"`
		}
		if err := httpx.BindJSON(r, &body, 16*1024); err != nil || body.RefreshToken == "" {
			httpx.Err(w, http.StatusBadRequest, "refreshToken обязателен")
			return
		}
		auth := a.Auth.(*services.AuthService)
		claims, err := auth.VerifyRefreshToken(r.Context(), body.RefreshToken)
		if err != nil || claims == nil || claims.SID == "" {
			httpx.Err(w, http.StatusUnauthorized, "Недействительный refresh token")
			return
		}
		isAdmin := auth.IsAdmin(r.Context(), claims.Subject)
		tokens, err := auth.RotateSession(r.Context(), claims.SID, claims.Subject, isAdmin, metaFromRequest(r))
		if err != nil {
			httpx.Internal(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]any{
			"accessToken":  tokens.AccessToken,
			"refreshToken": tokens.RefreshToken,
			"expiresIn":    tokens.ExpiresIn,
			"sessionId":    tokens.SessionID,
		})
	}
}

// ---- /auth/logout ------------------------------------------------------

func authLogout(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			RefreshToken string `json:"refreshToken"`
		}
		_ = httpx.BindJSON(r, &body, 16*1024)
		if body.RefreshToken != "" {
			_ = a.Auth.(*services.AuthService).RevokeRefreshToken(r.Context(), body.RefreshToken)
		}
		httpx.JSON(w, http.StatusOK, map[string]any{"ok": true})
	}
}

// ---- /auth/nonce/:nonce ------------------------------------------------
//
// Polled by the deeplink-login flow on the web client. When the user
// confirms in Telegram, the bot writes a row to `auth_nonces`; this
// endpoint claims the row, mints a JWT pair, and returns the live
// user model.

func authNonce(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		nonce := chi.URLParam(r, "nonce")
		if nonce == "" {
			httpx.Err(w, http.StatusBadRequest, "nonce обязателен")
			return
		}
		now := nowSec()
		var userID string
		var expiresAt int64
		err := a.DB.QueryRow(r.Context(),
			`SELECT user_id, expires_at FROM auth_nonces WHERE nonce = $1`,
			nonce,
		).Scan(&userID, &expiresAt)
		if errors.Is(err, pgx.ErrNoRows) || expiresAt <= now {
			httpx.JSON(w, http.StatusOK, map[string]any{"status": "pending"})
			return
		}
		if err != nil {
			httpx.Internal(w, err)
			return
		}
		_, _ = a.DB.Exec(r.Context(), `DELETE FROM auth_nonces WHERE nonce = $1`, nonce)

		auth := a.Auth.(*services.AuthService)
		user, err := auth.FindUserByID(r.Context(), userID)
		if err != nil || user == nil {
			httpx.Err(w, http.StatusNotFound, "Пользователь не найден")
			return
		}
		tokens, err := auth.GenerateTokens(r.Context(), user.ID, user.IsAdmin, metaFromRequest(r))
		if err != nil {
			httpx.Internal(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]any{
			"status":       "confirmed",
			"accessToken":  tokens.AccessToken,
			"refreshToken": tokens.RefreshToken,
			"expiresIn":    tokens.ExpiresIn,
			"sessionId":    tokens.SessionID,
			"user":         userResponse(user),
		})
	}
}

// ---- /auth/email/* (still stubs) --------------------------------------

func authEmailStart(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		_ = a
		httpx.Err(w, http.StatusNotImplemented,
			"Email login пока обслуживается worker:3000 — порт Brevo+OTP в очереди")
	}
}

func authEmailVerify(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		_ = a
		httpx.Err(w, http.StatusNotImplemented,
			"Email login пока обслуживается worker:3000 — порт Brevo+OTP в очереди")
	}
}

// ---- /auth/whoami -----------------------------------------------------

func authWhoami(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		uid := httpx.UserID(r)
		var u struct {
			ID       string `json:"id"`
			TGName   string `json:"tg_name"`
			Username string `json:"tg_username"`
			IsAdmin  bool   `json:"is_admin"`
			Email    string `json:"email"`
		}
		var isAdminInt int
		err := a.DB.QueryRow(r.Context(),
			`SELECT id, COALESCE(tg_name,''), COALESCE(tg_username,''),
			        is_admin, COALESCE(email,'')
			   FROM users WHERE id = $1`, uid,
		).Scan(&u.ID, &u.TGName, &u.Username, &isAdminInt, &u.Email)
		if err != nil {
			httpx.Err(w, http.StatusNotFound, "Пользователь не найден")
			return
		}
		u.IsAdmin = isAdminInt == 1
		httpx.JSON(w, http.StatusOK, u)
	}
}

func formatInt(v int64) string {
	b, _ := json.Marshal(v)
	return string(b)
}
