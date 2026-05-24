package routes

import (
	"net/http"

	"github.com/bratan-corp/bratan-music/api-go/internal/app"
	"github.com/bratan-corp/bratan-music/api-go/internal/httpx"
	"github.com/bratan-corp/bratan-music/api-go/internal/middleware"
	"github.com/go-chi/chi/v5"
)

func mountAuth(a *app.App) func(chi.Router) {
	return func(r chi.Router) {
		r.Post("/telegram", authTelegram(a))
		r.Post("/refresh", authRefresh(a))
		r.Post("/logout", authLogout(a))
		r.Post("/nonce", authNonce(a))
		r.Post("/nonce/confirm", authNonceConfirm(a))

		// Email-OTP flow.
		r.Post("/email/start", authEmailStart(a))
		r.Post("/email/verify", authEmailVerify(a))

		// Authenticated whoami used by clients to refresh the user model.
		r.Group(func(r chi.Router) {
			r.Use(middleware.JWTAuth(a.Cfg.JWTSecret, a.DB))
			r.Get("/whoami", authWhoami(a))
		})
	}
}

// authTelegram verifies the WebApp initData HMAC, upserts the user
// row, and mints a fresh JWT pair.
func authTelegram(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			InitData string `json:"initData"`
		}
		if err := httpx.BindJSON(r, &body, 32*1024); err != nil {
			httpx.Err(w, http.StatusBadRequest, "initData обязателен")
			return
		}
		if body.InitData == "" {
			httpx.Err(w, http.StatusBadRequest, "initData обязателен")
			return
		}
		// Full Telegram flow lives in services.AuthService and is
		// being ported alongside this commit. For now respond 501.
		httpx.Err(w, http.StatusNotImplemented, "Telegram auth — в процессе порта на Go (см. PR)")
		_ = a
	}
}

func authRefresh(a *app.App) http.HandlerFunc       { _ = a; return notImplemented }
func authLogout(a *app.App) http.HandlerFunc        { _ = a; return notImplemented }
func authNonce(a *app.App) http.HandlerFunc         { _ = a; return notImplemented }
func authNonceConfirm(a *app.App) http.HandlerFunc  { _ = a; return notImplemented }
func authEmailStart(a *app.App) http.HandlerFunc    { _ = a; return notImplemented }
func authEmailVerify(a *app.App) http.HandlerFunc   { _ = a; return notImplemented }

// authWhoami returns the current user model. Useful for clients that
// hold on to a stale `users` snapshot after settings change.
func authWhoami(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		uid := httpx.UserID(r)
		var u struct {
			ID        string `json:"id"`
			TGName    string `json:"tg_name"`
			Username  string `json:"tg_username"`
			IsAdmin   bool   `json:"is_admin"`
			Email     string `json:"email"`
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
