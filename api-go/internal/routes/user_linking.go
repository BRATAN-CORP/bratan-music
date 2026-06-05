package routes

import (
	"errors"
	"net/http"
	"regexp"
	"strings"

	"github.com/bratan-corp/bratan-music/api-go/internal/app"
	"github.com/bratan-corp/bratan-music/api-go/internal/httpx"
	"github.com/bratan-corp/bratan-music/api-go/internal/services"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
)

// nonceRe bounds the telegram link nonce to lowercase hex, 16–64 chars —
// matching the worker's validation so a malformed nonce never reaches the DB.
var nonceRe = regexp.MustCompile(`^[0-9a-f]{16,64}$`)

// isUniqueViolation reports whether err is a Postgres 23505 unique-constraint
// violation — used to map a racing concurrent link into a clean 409.
func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}

// nilIfEmpty returns nil for an empty string so JSON renders `null` instead of
// `""`, matching the worker's nullable telegram fields.
func nilIfEmpty(s string) any {
	if s == "" {
		return nil
	}
	return s
}

// userEmailLinkRequest — POST /user/me/email/request. Step 1 of binding an
// email to an existing (telegram-first) account: validates, refuses
// re-binding / foreign-owned addresses, then ships a 6-digit OTP via Brevo.
// Mirrors worker user.ts /me/email/request.
func userEmailLinkRequest(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		uid := httpx.UserID(r)
		var body struct {
			Email string `json:"email"`
		}
		if err := httpx.BindJSON(r, &body, 16*1024); err != nil {
			httpx.Err(w, http.StatusBadRequest, "Некорректный JSON")
			return
		}
		if !services.IsPlausibleEmail(body.Email) {
			httpx.Err(w, http.StatusBadRequest, "Некорректный email")
			return
		}
		email := services.NormalizeEmail(body.Email)
		if services.IsDisposableEmail(email) {
			httpx.Err(w, http.StatusBadRequest,
				"Одноразовые ящики не поддерживаются. Используйте свою основную почту.")
			return
		}

		// Refuse re-binding: an account's email is its permanent recovery
		// handle and cannot drift.
		var current string
		_ = a.DB.QueryRow(r.Context(),
			`SELECT COALESCE(email,'') FROM users WHERE id = $1 LIMIT 1`, uid).Scan(&current)
		if current != "" {
			httpx.Err(w, http.StatusConflict, "К аккаунту уже привязан email и его нельзя сменить.")
			return
		}

		// Block linking an address another user already owns.
		var ownerID string
		if err := a.DB.QueryRow(r.Context(),
			`SELECT id FROM users WHERE email = $1 LIMIT 1`, email).Scan(&ownerID); err == nil {
			if ownerID != "" && ownerID != uid {
				httpx.Err(w, http.StatusConflict, "Этот email уже привязан к другому аккаунту")
				return
			}
		}

		otp := a.Email.(*services.EmailOtpService)
		otp.Sweep(r.Context())

		issued, err := otp.IssueCode(r.Context(), email, services.OTPPurposeLink, &uid)
		if err != nil {
			httpx.Internal(w, err)
			return
		}
		if issued == nil {
			// Cooldown still active — behave identically to a fresh send.
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

// userEmailLinkVerify — POST /user/me/email/verify. Step 2: verify the OTP and
// bind the email onto the caller's row. Mirrors worker user.ts /me/email/verify.
func userEmailLinkVerify(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		uid := httpx.UserID(r)
		var body struct {
			Email string `json:"email"`
			Code  string `json:"code"`
		}
		if err := httpx.BindJSON(r, &body, 16*1024); err != nil {
			httpx.Err(w, http.StatusBadRequest, "Некорректный JSON")
			return
		}
		if !services.IsPlausibleEmail(body.Email) {
			httpx.Err(w, http.StatusBadRequest, "Некорректный email")
			return
		}
		code := strings.TrimSpace(body.Code)
		if !isSixDigits(code) {
			httpx.Err(w, http.StatusBadRequest, "Код должен содержать 6 цифр")
			return
		}
		email := services.NormalizeEmail(body.Email)

		otp := a.Email.(*services.EmailOtpService)
		res, err := otp.VerifyCode(r.Context(), email, code, services.OTPPurposeLink)
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
		if res.UserID != "" && res.UserID != uid {
			httpx.Err(w, http.StatusConflict, "Код выдан другому пользователю")
			return
		}

		if _, err := a.DB.Exec(r.Context(),
			`UPDATE users SET email = $1, updated_at = $2 WHERE id = $3`,
			email, nowSec(), uid); err != nil {
			if isUniqueViolation(err) {
				httpx.Err(w, http.StatusConflict, "Этот email уже привязан к другому аккаунту")
				return
			}
			httpx.Internal(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]any{"ok": true, "email": email})
	}
}

// userTelegramLinkStart — POST /user/me/telegram/link/start. Mints a 5-minute
// single-use nonce so the frontend can build a t.me/<bot>?start=link_<nonce>
// deeplink. Mirrors worker user.ts /me/telegram/link/start.
func userTelegramLinkStart(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		uid := httpx.UserID(r)

		var tgID string
		if err := a.DB.QueryRow(r.Context(),
			`SELECT COALESCE(tg_id,'') FROM users WHERE id = $1 LIMIT 1`, uid).Scan(&tgID); err != nil {
			httpx.Err(w, http.StatusNotFound, "Пользователь не найден")
			return
		}
		if tgID != "" {
			httpx.Err(w, http.StatusConflict, "К аккаунту уже привязан Telegram.")
			return
		}

		nonce := strings.ReplaceAll(uuid.NewString(), "-", "")
		now := nowSec()
		expiresAt := now + 5*60

		if _, err := a.DB.Exec(r.Context(),
			`INSERT INTO tg_link_requests (nonce, requester_id, expires_at, created_at)
			 VALUES ($1, $2, $3, $4)`, nonce, uid, expiresAt, now); err != nil {
			httpx.Internal(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]any{"nonce": nonce, "expiresAt": expiresAt})
	}
}

// userTelegramLinkStatus — GET /user/me/telegram/link/status/{nonce}.
// Poll-and-finalise: once the bot has stamped tg_id onto the link row, bind it
// to the caller and one-shot the nonce. Mirrors worker user.ts.
func userTelegramLinkStatus(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		uid := httpx.UserID(r)
		nonce := chi.URLParam(r, "nonce")
		if !nonceRe.MatchString(nonce) {
			httpx.Err(w, http.StatusBadRequest, "Некорректный nonce")
			return
		}

		var (
			requesterID, tgID, tgUsername, tgName string
			expiresAt                             int64
		)
		err := a.DB.QueryRow(r.Context(),
			`SELECT requester_id, COALESCE(tg_id,''), COALESCE(tg_username,''),
			        COALESCE(tg_name,''), expires_at
			   FROM tg_link_requests WHERE nonce = $1 LIMIT 1`, nonce).
			Scan(&requesterID, &tgID, &tgUsername, &tgName, &expiresAt)
		if err != nil {
			httpx.JSON(w, http.StatusOK, map[string]any{"status": "expired"})
			return
		}
		if requesterID != uid {
			httpx.Err(w, http.StatusForbidden, "Nonce принадлежит другому пользователю")
			return
		}
		if expiresAt < nowSec() {
			_, _ = a.DB.Exec(r.Context(), `DELETE FROM tg_link_requests WHERE nonce = $1`, nonce)
			httpx.JSON(w, http.StatusOK, map[string]any{"status": "expired"})
			return
		}
		if tgID == "" {
			httpx.JSON(w, http.StatusOK, map[string]any{"status": "pending"})
			return
		}

		// Bind the telegram identity onto the caller's row. Refuse if some
		// other account already owns this tg_id (explicit pre-check + a
		// race-aware UNIQUE catch).
		var owner string
		if e := a.DB.QueryRow(r.Context(),
			`SELECT id FROM users WHERE tg_id = $1 LIMIT 1`, tgID).Scan(&owner); e == nil {
			if owner != "" && owner != uid {
				_, _ = a.DB.Exec(r.Context(), `DELETE FROM tg_link_requests WHERE nonce = $1`, nonce)
				httpx.JSON(w, http.StatusConflict, map[string]any{"status": "conflict"})
				return
			}
		}
		if _, e := a.DB.Exec(r.Context(),
			`UPDATE users SET tg_id = $1, tg_username = $2, tg_name = $3, updated_at = $4 WHERE id = $5`,
			tgID, nilIfEmpty(tgUsername), nilIfEmpty(tgName), nowSec(), uid); e != nil {
			if isUniqueViolation(e) {
				_, _ = a.DB.Exec(r.Context(), `DELETE FROM tg_link_requests WHERE nonce = $1`, nonce)
				httpx.JSON(w, http.StatusConflict, map[string]any{"status": "conflict"})
				return
			}
			httpx.Internal(w, e)
			return
		}

		_, _ = a.DB.Exec(r.Context(), `DELETE FROM tg_link_requests WHERE nonce = $1`, nonce)
		httpx.JSON(w, http.StatusOK, map[string]any{
			"status": "confirmed",
			"telegram": map[string]any{
				"username": nilIfEmpty(tgUsername),
				"name":     nilIfEmpty(tgName),
			},
		})
	}
}
