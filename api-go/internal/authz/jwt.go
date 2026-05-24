// Package authz handles JWT signing/verification and Telegram WebApp
// HMAC validation.
//
// Tokens are HS256 with the same claim shape as the legacy worker
// (`sub`, `iat`, `exp`, `admin`, `sid`) so the wire format stays
// consistent between back-ends. JWT_SECRET is rotated on every
// deployment per ops policy, so this Go service does NOT need to
// honour tokens minted by the old TS service.
package authz

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

const (
	// AccessTTL — short-lived access token, matches the legacy 1h window.
	AccessTTL = time.Hour
	// RefreshTTL — long-lived refresh token (30 days).
	RefreshTTL = 30 * 24 * time.Hour
)

// Claims is the strongly-typed JWT body our middleware understands.
// `Admin` and `SID` are present in both access and refresh tokens so
// the refresh-rotation flow can preserve the same session row.
type Claims struct {
	Admin bool   `json:"admin"`
	SID   string `json:"sid,omitempty"`
	jwt.RegisteredClaims
}

// SignAccess produces a new access token for the given user.
func SignAccess(secret string, userID string, isAdmin bool, sessionID string) (string, time.Time, error) {
	return sign(secret, userID, isAdmin, sessionID, AccessTTL)
}

// SignRefresh produces a new refresh token.
func SignRefresh(secret string, userID string, isAdmin bool, sessionID string) (string, time.Time, error) {
	return sign(secret, userID, isAdmin, sessionID, RefreshTTL)
}

func sign(secret, userID string, isAdmin bool, sessionID string, ttl time.Duration) (string, time.Time, error) {
	if secret == "" {
		return "", time.Time{}, errors.New("authz: empty secret")
	}
	now := time.Now()
	exp := now.Add(ttl)
	tok := jwt.NewWithClaims(jwt.SigningMethodHS256, Claims{
		Admin: isAdmin,
		SID:   sessionID,
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   userID,
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(exp),
		},
	})
	signed, err := tok.SignedString([]byte(secret))
	if err != nil {
		return "", time.Time{}, err
	}
	return signed, exp, nil
}

// Verify parses+validates a token signed with `secret`. The caller is
// responsible for any DB-level checks (ban, min_token_iat, session
// row presence) — see middleware.JWTAuth.
func Verify(secret, raw string) (*Claims, error) {
	if secret == "" {
		return nil, errors.New("authz: empty secret")
	}
	t, err := jwt.ParseWithClaims(raw, &Claims{}, func(t *jwt.Token) (any, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", t.Header["alg"])
		}
		return []byte(secret), nil
	})
	if err != nil {
		return nil, err
	}
	c, ok := t.Claims.(*Claims)
	if !ok || !t.Valid {
		return nil, errors.New("invalid token")
	}
	return c, nil
}

// HashRefresh returns a hex-sha256 of the refresh token used as the
// `sessions.token_hash` column value. Storing only the hash means a DB
// breach can't replay live sessions.
func HashRefresh(raw string) string {
	sum := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(sum[:])
}

// HashHMAC returns HMAC-SHA256(key, body) hex-encoded. Used for IP
// hashing and assorted webhook-signature work where we need a keyed
// hash, not a bare digest.
func HashHMAC(key, body string) string {
	mac := hmac.New(sha256.New, []byte(key))
	_, _ = mac.Write([]byte(body))
	return hex.EncodeToString(mac.Sum(nil))
}

// SplitBearer returns the token portion of an Authorization header of
// the form `Bearer <token>`. Empty string if the header is missing or
// malformed; the caller decides how to react.
func SplitBearer(h string) string {
	const p = "bearer "
	if len(h) < len(p) {
		return ""
	}
	if !strings.EqualFold(h[:len(p)], p) {
		return ""
	}
	return strings.TrimSpace(h[len(p):])
}
