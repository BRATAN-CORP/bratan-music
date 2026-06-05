package tidal

import (
	"context"
	"database/sql"

	"github.com/bratan-corp/bratan-music/api-go/internal/authz"
)

// InstallPoolAccount validates a refresh token by performing a refresh,
// then upserts it as an enabled pool account (keyed by Tidal user_id).
// Mirrors TidalAuth.installRefreshToken + pool upsert.
func (a *Auth) InstallPoolAccount(ctx context.Context, refreshToken, label string) (*Tokens, error) {
	t, err := a.refreshSession(ctx, refreshToken)
	if err != nil {
		return nil, err
	}
	if err := a.upsertPoolAccount(ctx, t, label); err != nil {
		return nil, err
	}
	a.InvalidateCache()
	return t, nil
}

func (a *Auth) upsertPoolAccount(ctx context.Context, t *Tokens, label string) error {
	key := a.cfg.SessionEncryptionKey
	access, err := authz.EncryptSession(key, t.AccessToken)
	if err != nil {
		return err
	}
	refresh, err := authz.EncryptSession(key, t.RefreshToken)
	if err != nil {
		return err
	}
	var clientSecretEnc *string
	if t.ClientSecret != "" {
		s, err := authz.EncryptSession(key, t.ClientSecret)
		if err != nil {
			return err
		}
		clientSecretEnc = &s
	}
	var clientIDPtr *string
	if t.ClientID != "" {
		clientIDPtr = &t.ClientID
	}
	var labelPtr *string
	if label != "" {
		labelPtr = &label
	}
	now := nowSec()
	_, err = a.db.Exec(ctx, `
		INSERT INTO tidal_accounts
			(label, access_token, refresh_token, expires_at, user_id, country_code,
			 client_id, client_secret, enabled, created_at, updated_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,1,$9,$9)
		ON CONFLICT (user_id) DO UPDATE SET
			label         = COALESCE(EXCLUDED.label, tidal_accounts.label),
			access_token  = EXCLUDED.access_token,
			refresh_token = EXCLUDED.refresh_token,
			expires_at    = EXCLUDED.expires_at,
			country_code  = EXCLUDED.country_code,
			client_id     = EXCLUDED.client_id,
			client_secret = EXCLUDED.client_secret,
			enabled       = 1,
			updated_at    = EXCLUDED.updated_at
	`, labelPtr, access, refresh, t.ExpiresAt, t.UserID, t.CountryCode, clientIDPtr, clientSecretEnc, now)
	return err
}

// RefreshPoolAccount re-refreshes a stored pool account's tokens by id and
// returns the refreshed token metadata.
func (a *Auth) RefreshPoolAccount(ctx context.Context, id int64) (*Tokens, error) {
	var refreshEnc sql.NullString
	if err := a.db.QueryRow(ctx,
		`SELECT refresh_token FROM tidal_accounts WHERE id = $1`, id).Scan(&refreshEnc); err != nil {
		return nil, err
	}
	refresh, err := authz.DecryptSession(a.cfg.SessionEncryptionKey, refreshEnc.String)
	if err != nil {
		return nil, err
	}
	t, err := a.refreshSession(ctx, refresh)
	if err != nil {
		return nil, err
	}
	accessEnc, err := authz.EncryptSession(a.cfg.SessionEncryptionKey, t.AccessToken)
	if err != nil {
		return nil, err
	}
	refreshEnc2, err := authz.EncryptSession(a.cfg.SessionEncryptionKey, t.RefreshToken)
	if err != nil {
		return nil, err
	}
	if _, err := a.db.Exec(ctx,
		`UPDATE tidal_accounts SET access_token=$1, refresh_token=$2, expires_at=$3,
		        country_code=$4, updated_at=$5, last_error=NULL, last_error_at=NULL, consecutive_errors=0
		  WHERE id=$6`,
		accessEnc, refreshEnc2, t.ExpiresAt, t.CountryCode, nowSec(), id); err != nil {
		return nil, err
	}
	a.InvalidateCache()
	return t, nil
}
