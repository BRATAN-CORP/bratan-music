package routes

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
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
		// Two-step email-OTP login: request ships a 6-digit code via
		// Brevo, verify constant-time matches the hash and mints the
		// same JWT pair the Telegram path returns.
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

// ---- /auth/email/* -----------------------------------------------------
//
// Two-step OTP login keyed by email. Step 1 (`request`) hashes a fresh
// 6-digit code into `email_otps` and ships the plaintext via Brevo;
// step 2 (`verify`) constant-time-matches the submitted code, looks
// up (or creates) the email-bound user row, and returns the same JWT
// pair as the Telegram path. Both endpoints surface opaque "ok"
// responses on cooldown / non-fatal errors so callers can't use the
// surface to enumerate addresses bound to platform accounts.

// pickEmailLocale picks RU vs EN for the OTP email body. Defaults to
// Russian (primary user base); only flips when the client explicitly
// sets `?lang=en` or sends `Accept-Language: en…`. We deliberately
// don't parse the full q-weighted accept-language list — the OTP
// body is a one-shot transactional email and the only meaningful
// split is RU vs EN.
func pickEmailLocale(r *http.Request) services.Locale {
	q := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("lang")))
	if q == "en" {
		return services.LocaleEN
	}
	if q == "ru" {
		return services.LocaleRU
	}
	if strings.HasPrefix(strings.ToLower(r.Header.Get("Accept-Language")), "en") {
		return services.LocaleEN
	}
	return services.LocaleRU
}

func authEmailStart(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Email string `json:"email"`
		}
		if err := httpx.BindJSON(r, &body, 16*1024); err != nil {
			httpx.Err(w, http.StatusBadRequest, "Некорректный JSON")
			return
		}
		raw := body.Email
		if !services.IsPlausibleEmail(raw) {
			httpx.Err(w, http.StatusBadRequest, "Некорректный email")
			return
		}
		email := services.NormalizeEmail(raw)
		// Reject scraper-grade temp-mail providers up-front so they
		// can't be used to farm fresh user rows past the per-IP
		// signup cap. The 400 surface is deliberately distinct from
		// the opaque "ok" cooldown path — legitimate users on a
		// misclassified domain at least see a hint to retry with
		// their main address.
		if services.IsDisposableEmail(email) {
			httpx.Err(w, http.StatusBadRequest,
				"Одноразовые ящики не поддерживаются. Используйте свою основную почту.")
			return
		}

		otp := a.Email.(*services.EmailOtpService)
		// Best-effort GC; swallow failures so a bloated table never
		// surfaces as a user-visible 500 on the request endpoint.
		otp.Sweep(r.Context())

		issued, err := otp.IssueCode(r.Context(), email, services.OTPPurposeLogin, nil)
		if err != nil {
			httpx.Internal(w, err)
			return
		}
		if issued == nil {
			// Cooldown still in effect from a previous request —
			// pretend we sent another one so an attacker can't time
			// the response to learn the cooldown exists.
			httpx.JSON(w, http.StatusOK, map[string]any{"ok": true})
			return
		}
		brevo := a.Brevo.(*services.BrevoService)
		if !brevo.SendOTP(r.Context(), email, issued.Code, pickEmailLocale(r)) {
			httpx.Err(w, http.StatusBadGateway,
				"Не удалось отправить письмо. Попробуйте ещё раз через минуту.")
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]any{"ok": true})
	}
}

func authEmailVerify(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Email string `json:"email"`
			Code  string `json:"code"`
		}
		if err := httpx.BindJSON(r, &body, 16*1024); err != nil {
			httpx.Err(w, http.StatusBadRequest, "Некорректный JSON")
			return
		}
		rawEmail := body.Email
		rawCode := strings.TrimSpace(body.Code)
		if !services.IsPlausibleEmail(rawEmail) {
			httpx.Err(w, http.StatusBadRequest, "Некорректный email")
			return
		}
		if !isSixDigits(rawCode) {
			httpx.Err(w, http.StatusBadRequest, "Код должен содержать 6 цифр")
			return
		}
		email := services.NormalizeEmail(rawEmail)

		otp := a.Email.(*services.EmailOtpService)
		res, err := otp.VerifyCode(r.Context(), email, rawCode, services.OTPPurposeLogin)
		if err != nil {
			httpx.Internal(w, err)
			return
		}
		switch res.Outcome {
		case services.VerifyOK:
			// fall through
		case services.VerifyExpired:
			httpx.Err(w, http.StatusBadRequest, "Срок действия кода истёк")
			return
		case services.VerifyMissing:
			httpx.Err(w, http.StatusBadRequest, "Код не найден. Запросите новый.")
			return
		case services.VerifyPurpose:
			httpx.Err(w, http.StatusBadRequest, "Несовпадение цели кода")
			return
		default:
			httpx.Err(w, http.StatusBadRequest, "Неверный код")
			return
		}

		// Find existing email-bound user; if none, mint one with a
		// stable `email_…` id prefix so the bot/admin tools can tell
		// it apart from numeric tg-first ids at a glance.
		auth := a.Auth.(*services.AuthService)
		userID, isNew, err := findOrCreateEmailUser(a, r, email)
		if errors.Is(err, errSignupCapped) {
			httpx.Err(w, http.StatusTooManyRequests,
				"Слишком много новых аккаунтов с этого устройства. Попробуйте позже.")
			return
		}
		if err != nil {
			httpx.Internal(w, err)
			return
		}
		if isNew {
			ip := services.ExtractIP(r.Header.Get, r.RemoteAddr)
			auth.LogSignup(r.Context(), userID, ip, "email")
		}

		user, err := auth.FindUserByID(r.Context(), userID)
		if err != nil || user == nil {
			httpx.Err(w, http.StatusInternalServerError, "Не удалось создать пользователя")
			return
		}
		// Banned-user gate at login mirrors the JWT middleware so a
		// banned account can't log in and then get blocked only on
		// the next call.
		if isUserBanned(r.Context(), a, user.ID) {
			httpx.JSON(w, http.StatusForbidden, map[string]any{
				"error":  "Аккаунт заблокирован",
				"banned": true,
			})
			return
		}

		tokens, err := auth.GenerateTokens(r.Context(), user.ID, user.IsAdmin, metaFromRequest(r))
		if err != nil {
			httpx.Internal(w, err)
			return
		}
		resp := map[string]any{
			"accessToken":  tokens.AccessToken,
			"refreshToken": tokens.RefreshToken,
			"expiresIn":    tokens.ExpiresIn,
			"sessionId":    tokens.SessionID,
			"user":         userResponse(user),
		}
		// Force `email` into the user payload — userResponse() omits
		// it on empty, but VerifyOK guarantees we just bound it.
		if u, ok := resp["user"].(map[string]any); ok {
			u["email"] = email
		}
		httpx.JSON(w, http.StatusOK, resp)
	}
}

// findOrCreateEmailUser looks up the email-bound row or mints a new
// `email_…` user when none exists. Returns the user id + isNew so the
// caller can run the per-IP signup gate on fresh rows only.
//
// The per-IP cap fires only on the create branch — already-known
// addresses keep logging in unimpeded, mirroring the Telegram path's
// approach to the same gate.
func findOrCreateEmailUser(a *app.App, r *http.Request, email string) (string, bool, error) {
	ctx := r.Context()
	var id string
	err := a.DB.QueryRow(ctx,
		`SELECT id FROM users WHERE email = $1 LIMIT 1`, email,
	).Scan(&id)
	if err == nil {
		// Refresh updated_at so the row's "last login" is observable.
		now := nowSec()
		_, _ = a.DB.Exec(ctx,
			`UPDATE users SET updated_at = $1 WHERE id = $2`, now, id)
		return id, false, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return "", false, err
	}

	// Fresh row — gate on the per-IP signup cap. Without this the
	// disposable-email blocklist alone wouldn't stop an attacker
	// farming real Gmail / Outlook addresses from a single IP.
	auth := a.Auth.(*services.AuthService)
	ip := services.ExtractIP(r.Header.Get, r.RemoteAddr)
	if !auth.CanSignup(ctx, ip) {
		return "", false, errSignupCapped
	}
	id = "email_" + uuidShort()
	now := nowSec()
	_, err = a.DB.Exec(ctx,
		`INSERT INTO users
		   (id, tg_username, tg_name, email, is_admin, created_at, updated_at)
		 VALUES ($1, NULL, NULL, $2, 0, $3, $3)`,
		id, email, now)
	if err != nil {
		return "", false, err
	}
	return id, true, nil
}

// errSignupCapped is the sentinel returned when findOrCreateEmailUser
// would mint a new row but the per-IP gate blocks it. The handler
// surfaces this as 429 to the client.
var errSignupCapped = errors.New("signup cap reached")

// isSixDigits matches `^\d{6}$` without dragging in regexp for one call.
func isSixDigits(s string) bool {
	if len(s) != 6 {
		return false
	}
	for i := 0; i < 6; i++ {
		if s[i] < '0' || s[i] > '9' {
			return false
		}
	}
	return true
}

// uuidShort returns a 16-char hex slice of a v4 UUID for the user-id
// suffix. Matches the worker's `crypto.randomUUID().replace(/-/g,
// '').slice(0, 16)`.
func uuidShort() string {
	id := uuid.NewString()
	return strings.ReplaceAll(id, "-", "")[:16]
}

// isUserBanned reads the `is_banned` flag for the given user id.
// `is_banned` was added in a later migration and may not exist on
// every row — COALESCE in the select handles legacy rows safely.
func isUserBanned(ctx context.Context, a *app.App, userID string) bool {
	var banned int
	err := a.DB.QueryRow(ctx,
		`SELECT COALESCE(is_banned, 0) FROM users WHERE id = $1`, userID,
	).Scan(&banned)
	if err != nil {
		return false
	}
	return banned == 1
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
