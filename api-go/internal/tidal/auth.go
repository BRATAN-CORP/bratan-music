package tidal

import (
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/bratan-corp/bratan-music/api-go/internal/authz"
	"github.com/bratan-corp/bratan-music/api-go/internal/db"
)

const (
	authURL              = "https://auth.tidal.com/v1/oauth2/token"
	defaultCountryCode   = "BR"
	defaultLocale        = "en_US"
	defaultClientVersion = "2026.4.23"
)

// clientPair is one of the Tidal OAuth client_id/client_secret pairs
// we try in order when refreshing a session. Mirrors KNOWN_CLIENTS in
// worker/TidalAuth.ts.
type clientPair struct {
	ID             string
	Secret         string
	SupportsDevice bool
}

var knownClients = []clientPair{
	{ID: "aR7gUaTK1ihpXOEP", Secret: "oKOXfJW371cX6xaZ0PyhgGNBdNLlBZd4AKKYougMjik=", SupportsDevice: true},
	{ID: "fX2JxdmntZWK0ixT", Secret: "1Nn9AfDAjxrgJFJbKNWLeAyKGVGmINuXPPLHVXAvxAg=", SupportsDevice: true},
	{ID: "zU4XHVVkc2tDPo4t", Secret: "VJKhDFqJPqvsPVNBV6ukXTJmwlvbttP7wlMlrc72se4=", SupportsDevice: true},
}

// Tokens is the cached Tidal session state.
type Tokens struct {
	AccessToken  string
	RefreshToken string
	ExpiresAt    int64 // unix seconds
	UserID       int64
	CountryCode  string
	ClientID     string
	ClientSecret string
}

// AuthConfig collects the env-derived inputs the Auth needs.
type AuthConfig struct {
	SessionEncryptionKey string // SESSION_ENCRYPTION_KEY (raw, derived via SHA-256 inside authz)
	RefreshTokenFallback string // env TIDAL_REFRESH_TOKEN
	CountryCodeFallback  string // env TIDAL_COUNTRY_CODE
	ConfiguredClientID   string // env TIDAL_CLIENT_ID
	ConfiguredSecret     string // env TIDAL_CLIENT_SECRET
}

// Auth is the Go port of worker/TidalAuth.ts (single-account flavour).
type Auth struct {
	db   *db.DB
	http *http.Client
	cfg  AuthConfig

	mu      sync.Mutex
	cached  *Tokens
	loaded  bool // distinguish "not loaded yet" from "loaded and nil"
}

// NewAuth wires a single-account Tidal auth backed by the
// `tidal_session` table (id=1) with env-token fallback.
func NewAuth(d *db.DB, cfg AuthConfig) *Auth {
	return &Auth{
		db:   d,
		http: &http.Client{Timeout: 20 * time.Second},
		cfg:  cfg,
	}
}

// GetAccessToken returns a non-expired access token, refreshing
// against the candidate-client list if necessary. `force=true` skips
// the freshness check (used when an API call returned 401).
func (a *Auth) GetAccessToken(ctx context.Context, force bool) (string, error) {
	a.mu.Lock()
	cached := a.cached
	loaded := a.loaded
	a.mu.Unlock()

	if !loaded {
		fresh, err := a.loadSession(ctx)
		if err != nil {
			return "", fmt.Errorf("load session: %w", err)
		}
		a.mu.Lock()
		a.cached = fresh
		a.loaded = true
		cached = fresh
		a.mu.Unlock()
	}

	if !force && cached != nil && cached.ExpiresAt > nowSec()+60 {
		return cached.AccessToken, nil
	}

	refreshToken := a.cfg.RefreshTokenFallback
	if cached != nil && cached.RefreshToken != "" {
		refreshToken = cached.RefreshToken
	}
	if refreshToken == "" {
		if cached != nil && cached.AccessToken != "" {
			// Best-effort: return whatever we have. Caller will get a
			// 401 and surface a meaningful error.
			return cached.AccessToken, nil
		}
		return "", errors.New("tidal: no session and no TIDAL_REFRESH_TOKEN set")
	}

	tokens, err := a.refreshSession(ctx, refreshToken)
	if err != nil {
		return "", err
	}
	a.mu.Lock()
	a.cached = tokens
	a.loaded = true
	a.mu.Unlock()
	if err := a.cacheSession(ctx, tokens); err != nil {
		// Don't fail the request — log via err wrap and continue.
		return tokens.AccessToken, fmt.Errorf("cache session (non-fatal): %w", err)
	}
	return tokens.AccessToken, nil
}

// GetCountryCode returns the country code attached to the active
// session (falls back to env / default).
func (a *Auth) GetCountryCode(ctx context.Context) string {
	a.mu.Lock()
	cached := a.cached
	loaded := a.loaded
	a.mu.Unlock()
	if !loaded {
		// Best effort prefetch; ignore error here.
		_, _ = a.GetAccessToken(ctx, false)
		a.mu.Lock()
		cached = a.cached
		a.mu.Unlock()
	}
	if cached != nil && cached.CountryCode != "" {
		return cached.CountryCode
	}
	if a.cfg.CountryCodeFallback != "" {
		return a.cfg.CountryCodeFallback
	}
	return defaultCountryCode
}

// GetLocale returns the locale to thread through API params.
func (a *Auth) GetLocale() string { return defaultLocale }

// GetClientVersion returns the `x-tidal-client-version` header value.
func (a *Auth) GetClientVersion() string { return defaultClientVersion }

// InvalidateCache drops the per-process token memo. Call after writes
// (device-flow finalize, manual swap).
func (a *Auth) InvalidateCache() {
	a.mu.Lock()
	a.cached = nil
	a.loaded = false
	a.mu.Unlock()
}

// loadSession reads the legacy singleton `tidal_session` row (id=1)
// and decrypts the access/refresh tokens with SESSION_ENCRYPTION_KEY.
// Returns (nil, nil) when no row exists — callers fall back to the
// env-configured refresh token.
func (a *Auth) loadSession(ctx context.Context) (*Tokens, error) {
	row := a.db.QueryRow(ctx, `
		SELECT access_token, refresh_token, expires_at, user_id, country_code, client_id, client_secret
		FROM tidal_session WHERE id = 1
	`)
	var accessEnc, refreshEnc sql.NullString
	var expiresAt, userID int64
	var countryCode sql.NullString
	var clientID, clientSecretEnc sql.NullString
	if err := row.Scan(&accessEnc, &refreshEnc, &expiresAt, &userID, &countryCode, &clientID, &clientSecretEnc); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	if !accessEnc.Valid || !refreshEnc.Valid {
		return nil, nil
	}
	access, err := authz.DecryptSession(a.cfg.SessionEncryptionKey, accessEnc.String)
	if err != nil {
		return nil, fmt.Errorf("decrypt access_token: %w", err)
	}
	refresh, err := authz.DecryptSession(a.cfg.SessionEncryptionKey, refreshEnc.String)
	if err != nil {
		return nil, fmt.Errorf("decrypt refresh_token: %w", err)
	}
	var clientSecret string
	if clientSecretEnc.Valid && clientSecretEnc.String != "" {
		clientSecret, err = authz.DecryptSession(a.cfg.SessionEncryptionKey, clientSecretEnc.String)
		if err != nil {
			return nil, fmt.Errorf("decrypt client_secret: %w", err)
		}
	}
	cc := ""
	if countryCode.Valid {
		cc = countryCode.String
	}
	if cc == "" {
		cc = defaultCountryCode
	}
	cid := ""
	if clientID.Valid {
		cid = clientID.String
	}
	return &Tokens{
		AccessToken:  access,
		RefreshToken: refresh,
		ExpiresAt:    expiresAt,
		UserID:       userID,
		CountryCode:  cc,
		ClientID:     cid,
		ClientSecret: clientSecret,
	}, nil
}

// cacheSession persists fresh tokens back to `tidal_session` (id=1),
// encrypting access/refresh/client_secret with SESSION_ENCRYPTION_KEY.
func (a *Auth) cacheSession(ctx context.Context, t *Tokens) error {
	access, err := authz.EncryptSession(a.cfg.SessionEncryptionKey, t.AccessToken)
	if err != nil {
		return fmt.Errorf("encrypt access_token: %w", err)
	}
	refresh, err := authz.EncryptSession(a.cfg.SessionEncryptionKey, t.RefreshToken)
	if err != nil {
		return fmt.Errorf("encrypt refresh_token: %w", err)
	}
	var clientSecretEnc *string
	if t.ClientSecret != "" {
		s, err := authz.EncryptSession(a.cfg.SessionEncryptionKey, t.ClientSecret)
		if err != nil {
			return fmt.Errorf("encrypt client_secret: %w", err)
		}
		clientSecretEnc = &s
	}
	var clientIDPtr *string
	if t.ClientID != "" {
		clientIDPtr = &t.ClientID
	}
	now := nowSec()
	_, err = a.db.Exec(ctx, `
		INSERT INTO tidal_session (id, access_token, refresh_token, expires_at, user_id, country_code, client_id, client_secret, updated_at)
		VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8)
		ON CONFLICT (id) DO UPDATE SET
			access_token  = EXCLUDED.access_token,
			refresh_token = EXCLUDED.refresh_token,
			expires_at    = EXCLUDED.expires_at,
			user_id       = EXCLUDED.user_id,
			country_code  = EXCLUDED.country_code,
			client_id     = EXCLUDED.client_id,
			client_secret = EXCLUDED.client_secret,
			updated_at    = EXCLUDED.updated_at
	`, access, refresh, t.ExpiresAt, t.UserID, t.CountryCode, clientIDPtr, clientSecretEnc, now)
	return err
}

// refreshSession walks the candidate client list and returns the
// first successful refresh. Mirrors TidalAuth.refreshSession.
func (a *Auth) refreshSession(ctx context.Context, refreshToken string) (*Tokens, error) {
	candidates := a.candidateClients()
	var lastErr error
	for _, c := range candidates {
		t, err := a.refreshWithClient(ctx, refreshToken, c)
		if err == nil && t != nil {
			return t, nil
		}
		if err != nil {
			lastErr = err
		}
	}
	if lastErr != nil {
		return nil, fmt.Errorf("tidal: all candidate clients failed (last: %w)", lastErr)
	}
	return nil, errors.New("tidal: refresh failed for every candidate client")
}

// candidateClients picks the configured client (if any) first, then
// falls back to the well-known triple. Matches TS candidateClients.
func (a *Auth) candidateClients() []clientPair {
	out := make([]clientPair, 0, 4)
	seen := map[string]bool{}
	// Cached client (from prior successful refresh) — try first.
	a.mu.Lock()
	cached := a.cached
	a.mu.Unlock()
	if cached != nil && cached.ClientID != "" && cached.ClientSecret != "" {
		out = append(out, clientPair{ID: cached.ClientID, Secret: cached.ClientSecret, SupportsDevice: true})
		seen[cached.ClientID] = true
	}
	if a.cfg.ConfiguredClientID != "" && a.cfg.ConfiguredSecret != "" && !seen[a.cfg.ConfiguredClientID] {
		out = append(out, clientPair{ID: a.cfg.ConfiguredClientID, Secret: a.cfg.ConfiguredSecret, SupportsDevice: false})
		seen[a.cfg.ConfiguredClientID] = true
	}
	for _, c := range knownClients {
		if seen[c.ID] {
			continue
		}
		out = append(out, c)
	}
	return out
}

// refreshWithClient attempts a refresh_token grant against a single
// candidate client. Returns nil tokens on a non-200 response (caller
// walks to the next client).
func (a *Auth) refreshWithClient(ctx context.Context, refreshToken string, c clientPair) (*Tokens, error) {
	body := url.Values{
		"grant_type":    {"refresh_token"},
		"refresh_token": {refreshToken},
		"client_id":     {c.ID},
		"client_secret": {c.Secret},
		"scope":         {"r_usr w_usr w_sub"},
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, authURL, strings.NewReader(body.Encode()))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	res, err := a.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	respBytes, _ := io.ReadAll(io.LimitReader(res.Body, 1<<14))
	if res.StatusCode != 200 {
		return nil, fmt.Errorf("client %s: %d %s", c.ID, res.StatusCode, string(respBytes))
	}
	var data struct {
		AccessToken  string `json:"access_token"`
		RefreshToken string `json:"refresh_token"`
		ExpiresIn    int    `json:"expires_in"`
	}
	if err := json.Unmarshal(respBytes, &data); err != nil {
		return nil, err
	}
	info := a.fetchSessionInfo(ctx, data.AccessToken)
	out := &Tokens{
		AccessToken:  data.AccessToken,
		RefreshToken: data.RefreshToken,
		ExpiresAt:    nowSec() + int64(data.ExpiresIn),
		UserID:       info.UserID,
		CountryCode:  info.CountryCode,
		ClientID:     c.ID,
		ClientSecret: c.Secret,
	}
	if out.RefreshToken == "" {
		out.RefreshToken = refreshToken
	}
	return out, nil
}

// sessionInfo is the `/v1/sessions` shape.
type sessionInfo struct {
	UserID      int64  `json:"userId"`
	CountryCode string `json:"countryCode"`
}

func (a *Auth) fetchSessionInfo(ctx context.Context, accessToken string) sessionInfo {
	fb := a.decodeJwtPayload(accessToken)
	out := sessionInfo{UserID: fb.UID, CountryCode: fb.CC}
	if out.CountryCode == "" {
		if a.cfg.CountryCodeFallback != "" {
			out.CountryCode = a.cfg.CountryCodeFallback
		} else {
			out.CountryCode = defaultCountryCode
		}
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "https://api.tidal.com/v1/sessions", nil)
	if err != nil {
		return out
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "TIDAL/"+defaultClientVersion+" CFNetwork/1494.0.7 Darwin/23.4.0")
	req.Header.Set("x-tidal-client-version", defaultClientVersion)
	res, err := a.http.Do(req)
	if err != nil {
		return out
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		return out
	}
	var data sessionInfo
	if err := json.NewDecoder(res.Body).Decode(&data); err != nil {
		return out
	}
	return data
}

type jwtPayload struct {
	UID int64  `json:"uid"`
	CC  string `json:"cc"`
	EXP int64  `json:"exp"`
}

func (a *Auth) decodeJwtPayload(token string) jwtPayload {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return jwtPayload{}
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return jwtPayload{}
	}
	var p jwtPayload
	_ = json.Unmarshal(payload, &p)
	return p
}

func nowSec() int64 { return time.Now().Unix() }
