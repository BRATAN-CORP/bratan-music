package services

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/bratan-corp/bratan-music/api-go/internal/app"
	"github.com/bratan-corp/bratan-music/api-go/internal/authz"
)

// TokenPair is what /auth/telegram, /auth/email/verify, /auth/refresh,
// and the nonce confirmation flow return to the client.
type TokenPair struct {
	AccessToken  string `json:"accessToken"`
	RefreshToken string `json:"refreshToken"`
	ExpiresIn    int    `json:"expiresIn"`
	SessionID    string `json:"sessionId"`
}

// SessionMetadata captures the per-request signin context persisted
// on the `sessions` row. Matches the worker SessionMetadata shape so
// the "Сессии" UI populates the same fields it used to.
type SessionMetadata struct {
	UserAgent   string
	IPHash      string
	ClientLabel string
}

// GenerateTokens mints a fresh JWT pair and records the session row.
// Mirrors AuthService.generateTokens from worker/.
func (s *AuthService) GenerateTokens(ctx context.Context, userID string, isAdmin bool, md SessionMetadata) (*TokenPair, error) {
	sessionID := uuid.NewString()
	now := time.Now().Unix()
	expRefresh := now + int64(authz.RefreshTTL/time.Second)

	access, _, err := authz.SignAccess(s.A.Cfg.JWTSecret, userID, isAdmin, sessionID)
	if err != nil {
		return nil, fmt.Errorf("sign access: %w", err)
	}
	refresh, _, err := authz.SignRefresh(s.A.Cfg.JWTRefreshSecret, userID, isAdmin, sessionID)
	if err != nil {
		return nil, fmt.Errorf("sign refresh: %w", err)
	}
	tokenHash := authz.HashRefresh(refresh)
	if _, err := s.A.DB.Exec(ctx, `
		INSERT INTO sessions
		  (id, user_id, token_hash, expires_at, created_at,
		   last_used_at, user_agent, ip_hash, client_label)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
	`,
		sessionID, userID, tokenHash, expRefresh, now, now,
		md.UserAgent, md.IPHash, md.ClientLabel,
	); err != nil {
		return nil, fmt.Errorf("insert session: %w", err)
	}
	return &TokenPair{
		AccessToken:  access,
		RefreshToken: refresh,
		ExpiresIn:    int(authz.AccessTTL / time.Second),
		SessionID:    sessionID,
	}, nil
}

// VerifyRefreshToken parses the refresh JWT and confirms the matching
// `sessions` row still exists. Bumps last_used_at on the way out so
// the Сессии list orders devices by recency. Mirrors AuthService.verifyRefreshToken.
func (s *AuthService) VerifyRefreshToken(ctx context.Context, raw string) (*authz.Claims, error) {
	claims, err := authz.Verify(s.A.Cfg.JWTRefreshSecret, raw)
	if err != nil {
		return nil, err
	}
	tokenHash := authz.HashRefresh(raw)
	now := time.Now().Unix()
	var sid string
	err = s.A.DB.QueryRow(ctx,
		`SELECT id FROM sessions
		  WHERE user_id = $1 AND token_hash = $2 AND expires_at > $3`,
		claims.Subject, tokenHash, now,
	).Scan(&sid)
	if err != nil {
		return nil, errors.New("session not found")
	}
	_, _ = s.A.DB.Exec(ctx,
		`UPDATE sessions SET last_used_at = $1 WHERE id = $2`, now, sid)
	// Backfill sid claim for legacy tokens (pre-0028).
	if claims.SID == "" {
		claims.SID = sid
	}
	return claims, nil
}

// RotateSession rotates the access+refresh JWT pair on an existing
// session row, keeping the same SID so the per-session revoke model
// (`SELECT 1 FROM sessions WHERE id = sid` in middleware) stays
// stable across refreshes. Mirrors AuthService.rotateSession.
func (s *AuthService) RotateSession(ctx context.Context, sessionID, userID string, isAdmin bool, md SessionMetadata) (*TokenPair, error) {
	now := time.Now().Unix()
	expRefresh := now + int64(authz.RefreshTTL/time.Second)
	access, _, err := authz.SignAccess(s.A.Cfg.JWTSecret, userID, isAdmin, sessionID)
	if err != nil {
		return nil, err
	}
	refresh, _, err := authz.SignRefresh(s.A.Cfg.JWTRefreshSecret, userID, isAdmin, sessionID)
	if err != nil {
		return nil, err
	}
	tokenHash := authz.HashRefresh(refresh)
	if md.UserAgent != "" || md.IPHash != "" || md.ClientLabel != "" {
		_, err = s.A.DB.Exec(ctx, `
			UPDATE sessions
			   SET token_hash = $1, expires_at = $2, last_used_at = $3,
			       user_agent = $4, ip_hash = $5, client_label = $6
			 WHERE id = $7 AND user_id = $8
		`,
			tokenHash, expRefresh, now,
			md.UserAgent, md.IPHash, md.ClientLabel,
			sessionID, userID,
		)
	} else {
		_, err = s.A.DB.Exec(ctx, `
			UPDATE sessions
			   SET token_hash = $1, expires_at = $2, last_used_at = $3
			 WHERE id = $4 AND user_id = $5
		`, tokenHash, expRefresh, now, sessionID, userID)
	}
	if err != nil {
		return nil, fmt.Errorf("rotate session: %w", err)
	}
	return &TokenPair{
		AccessToken:  access,
		RefreshToken: refresh,
		ExpiresIn:    int(authz.AccessTTL / time.Second),
		SessionID:    sessionID,
	}, nil
}

// RevokeRefreshToken deletes the session row matching the refresh
// token. Mirrors AuthService.revokeRefreshToken.
func (s *AuthService) RevokeRefreshToken(ctx context.Context, raw string) error {
	tokenHash := authz.HashRefresh(raw)
	_, err := s.A.DB.Exec(ctx, `DELETE FROM sessions WHERE token_hash = $1`, tokenHash)
	return err
}

// IsAdmin returns whether the user has admin flag set.
func (s *AuthService) IsAdmin(ctx context.Context, userID string) bool {
	var v int
	err := s.A.DB.QueryRow(ctx, `SELECT is_admin FROM users WHERE id = $1`, userID).Scan(&v)
	if err != nil {
		return false
	}
	return v == 1
}

// ---- helpers shared with handlers --------------------------------------

// ClientLabelFromUA is a cheap browser/os heuristic for the "Сессии"
// UI. Port of worker/SessionService.clientLabelFromUa.
func ClientLabelFromUA(ua string) string {
	if ua == "" {
		return "Неизвестное устройство"
	}
	low := strings.ToLower(ua)
	browser := "Браузер"
	switch {
	case strings.Contains(low, "telegram"):
		browser = "Telegram WebApp"
	case strings.Contains(low, "edg/"):
		browser = "Edge"
	case strings.Contains(low, "opr/"), strings.Contains(low, "opera"):
		browser = "Opera"
	case strings.Contains(low, "yabrowser"):
		browser = "Yandex Browser"
	case strings.Contains(low, "firefox"):
		browser = "Firefox"
	case strings.Contains(low, "chrome"):
		browser = "Chrome"
	case strings.Contains(low, "safari"):
		browser = "Safari"
	}
	os := ""
	switch {
	case strings.Contains(low, "iphone"):
		os = "iPhone"
	case strings.Contains(low, "ipad"):
		os = "iPad"
	case strings.Contains(low, "android"):
		os = "Android"
	case strings.Contains(low, "mac os"):
		os = "Mac"
	case strings.Contains(low, "windows"):
		os = "Windows"
	case strings.Contains(low, "linux"):
		os = "Linux"
	}
	if os != "" {
		return browser + " · " + os
	}
	return browser
}

// HashIP hashes the request IP for storage in `sessions.ip_hash`.
// Mirrors worker/SessionService.hashIp.
func HashIP(ip string) string {
	if ip == "" {
		return ""
	}
	sum := sha256.Sum256([]byte(ip))
	return hex.EncodeToString(sum[:])
}

// ExtractIP picks the best-guess client IP from the usual proxy
// headers. Mirrors worker/SignupLogService.extractIp.
func ExtractIP(getHeader func(string) string, remoteAddr string) string {
	if v := strings.TrimSpace(getHeader("CF-Connecting-IP")); v != "" {
		return v
	}
	if v := strings.TrimSpace(getHeader("X-Forwarded-For")); v != "" {
		if i := strings.Index(v, ","); i > 0 {
			return strings.TrimSpace(v[:i])
		}
		return v
	}
	if v := strings.TrimSpace(getHeader("X-Real-IP")); v != "" {
		return v
	}
	if remoteAddr != "" {
		if i := strings.LastIndex(remoteAddr, ":"); i > 0 {
			return remoteAddr[:i]
		}
		return remoteAddr
	}
	return "unknown"
}

// ---- signup_log --------------------------------------------------------

const (
	signupsPerIPPerDay  = 5
	signupWindowSeconds = 24 * 60 * 60
)

// CanSignup returns false when the IP has already minted
// signupsPerIPPerDay accounts in the rolling 24h window.
func (s *AuthService) CanSignup(ctx context.Context, ip string) bool {
	if ip == "" || ip == "unknown" {
		return true
	}
	since := time.Now().Unix() - signupWindowSeconds
	var n int
	if err := s.A.DB.QueryRow(ctx,
		`SELECT COUNT(*) FROM signup_log WHERE ip = $1 AND created_at >= $2`,
		ip, since,
	).Scan(&n); err != nil {
		return true
	}
	return n < signupsPerIPPerDay
}

// LogSignup appends to signup_log. `source` is "telegram" or "email".
func (s *AuthService) LogSignup(ctx context.Context, userID, ip, source string) {
	if ip == "" {
		ip = "unknown"
	}
	_, _ = s.A.DB.Exec(ctx,
		`INSERT INTO signup_log (user_id, ip, source, created_at)
		 VALUES ($1, $2, $3, $4)`,
		userID, ip, source, time.Now().Unix())
}

// ---- user upsert (Telegram flow) --------------------------------------

// User is the row shape returned by Telegram / nonce / email-verify
// handlers. Subset of the legacy worker User shape.
type User struct {
	ID              string
	TGUsername      string
	TGName          string
	Email           string
	IsAdmin         bool
	TourCompletedAt int64
}

// FindUserByTGID looks up by `tg_id` first, then falls back to
// `users.id` for legacy tg-first rows. Port of UserService.findByTgId.
func (s *AuthService) FindUserByTGID(ctx context.Context, tgID string) (*User, error) {
	row := s.A.DB.QueryRow(ctx, `
		SELECT id, COALESCE(tg_username,''), COALESCE(tg_name,''),
		       COALESCE(email,''), is_admin, COALESCE(tour_completed_at, 0)
		  FROM users WHERE tg_id = $1 LIMIT 1`, tgID)
	u, err := scanUser(row)
	if err == nil {
		return u, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return nil, err
	}
	row = s.A.DB.QueryRow(ctx, `
		SELECT id, COALESCE(tg_username,''), COALESCE(tg_name,''),
		       COALESCE(email,''), is_admin, COALESCE(tour_completed_at, 0)
		  FROM users WHERE id = $1`, tgID)
	u, err = scanUser(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return u, err
}

// FindUserByID is the plain "look up by users.id".
func (s *AuthService) FindUserByID(ctx context.Context, id string) (*User, error) {
	row := s.A.DB.QueryRow(ctx, `
		SELECT id, COALESCE(tg_username,''), COALESCE(tg_name,''),
		       COALESCE(email,''), is_admin, COALESCE(tour_completed_at, 0)
		  FROM users WHERE id = $1`, id)
	u, err := scanUser(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return u, err
}

func scanUser(row pgx.Row) (*User, error) {
	var u User
	var isAdmin int
	if err := row.Scan(&u.ID, &u.TGUsername, &u.TGName, &u.Email, &isAdmin, &u.TourCompletedAt); err != nil {
		return nil, err
	}
	u.IsAdmin = isAdmin == 1
	return &u, nil
}

// UpsertTelegramUser inserts or refreshes a row keyed by Telegram id.
// Mirrors UserService.upsert.
func (s *AuthService) UpsertTelegramUser(ctx context.Context, tgID, username, name string) (*User, error) {
	existing, err := s.FindUserByTGID(ctx, tgID)
	if err != nil {
		return nil, err
	}
	now := time.Now().Unix()
	if existing != nil {
		un := username
		if un == "" {
			un = existing.TGUsername
		}
		nm := name
		if nm == "" {
			nm = existing.TGName
		}
		_, err := s.A.DB.Exec(ctx, `
			UPDATE users
			   SET tg_username = $1, tg_name = $2,
			       tg_id = COALESCE(tg_id, $3), updated_at = $4
			 WHERE id = $5
		`, un, nm, tgID, now, existing.ID)
		if err != nil {
			return nil, err
		}
		return s.FindUserByID(ctx, existing.ID)
	}
	isAdmin := 0
	for _, adminID := range s.A.Cfg.TelegramAdminIDs {
		if strings.TrimSpace(adminID) == tgID {
			isAdmin = 1
			break
		}
	}
	_, err = s.A.DB.Exec(ctx, `
		INSERT INTO users (id, tg_id, tg_username, tg_name, is_admin, created_at, updated_at)
		VALUES ($1, $1, $2, $3, $4, $5, $5)
	`, tgID, nullIfEmpty(username), nullIfEmpty(name), isAdmin, now)
	if err != nil {
		return nil, err
	}
	return s.FindUserByID(ctx, tgID)
}

func nullIfEmpty(s string) any {
	if s == "" {
		return nil
	}
	return s
}

// SessionIDForRefreshToken returns the sessions.id for a refresh
// token, useful when the handler needs the id without re-verifying.
func (s *AuthService) SessionIDForRefreshToken(ctx context.Context, raw string) (string, error) {
	tokenHash := authz.HashRefresh(raw)
	var sid string
	err := s.A.DB.QueryRow(ctx,
		`SELECT id FROM sessions WHERE token_hash = $1 LIMIT 1`, tokenHash,
	).Scan(&sid)
	return sid, err
}

// --- internal: ensure context-aware app reference -----------------

var _ = app.App{} // keep the import even if no methods reach for it directly
