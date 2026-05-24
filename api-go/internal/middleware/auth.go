package middleware

import (
	"context"
	"errors"
	"net/http"

	"github.com/bratan-corp/bratan-music/api-go/internal/authz"
	"github.com/bratan-corp/bratan-music/api-go/internal/db"
	"github.com/bratan-corp/bratan-music/api-go/internal/httpx"
	"github.com/jackc/pgx/v5"
)

// JWTAuth validates the bearer access token, enforces ban and
// per-session revoke checks, and attaches userId/isAdmin/sessionId
// to the request context.
func JWTAuth(secret string, database *db.DB) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			raw := authz.SplitBearer(r.Header.Get("Authorization"))
			if raw == "" {
				httpx.Err(w, http.StatusUnauthorized, "Требуется авторизация")
				return
			}
			claims, err := authz.Verify(secret, raw)
			if err != nil {
				httpx.Err(w, http.StatusUnauthorized, "Недействительный токен")
				return
			}

			if err := enforceBanAndSession(r.Context(), database, claims); err != nil {
				httpx.Err(w, http.StatusUnauthorized, "Сессия недействительна")
				return
			}

			ctx := r.Context()
			ctx = httpx.WithUserID(ctx, claims.Subject)
			ctx = httpx.WithIsAdmin(ctx, claims.Admin)
			ctx = httpx.WithSessionID(ctx, claims.SID)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

func enforceBanAndSession(ctx context.Context, database *db.DB, claims *authz.Claims) error {
	// Ban check + min_token_iat check in one query.
	var isBanned int
	var minTokenIat int64
	err := database.QueryRow(ctx,
		`SELECT is_banned, min_token_iat FROM users WHERE id = $1`,
		claims.Subject,
	).Scan(&isBanned, &minTokenIat)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return errors.New("user missing")
		}
		return err
	}
	if isBanned == 1 {
		return errors.New("banned")
	}
	if claims.IssuedAt != nil && claims.IssuedAt.Unix() < minTokenIat {
		return errors.New("token revoked by min_iat")
	}

	// Session row presence check (when token carries sid).
	if claims.SID != "" {
		var got string
		err := database.QueryRow(ctx,
			`SELECT id FROM sessions WHERE id = $1 AND user_id = $2 LIMIT 1`,
			claims.SID, claims.Subject,
		).Scan(&got)
		if err != nil {
			return errors.New("session revoked")
		}
	}
	return nil
}

// AdminOnly wraps a handler so non-admin users get a 403. Assumes
// JWTAuth has already populated `IsAdmin` on the context.
func AdminOnly(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !httpx.IsAdmin(r) {
			httpx.Err(w, http.StatusForbidden, "Доступ запрещён")
			return
		}
		next.ServeHTTP(w, r)
	})
}
