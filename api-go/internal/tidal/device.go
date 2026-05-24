package tidal

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
)

// DeviceAuthorization is what /v1/oauth2/device_authorization returns.
type DeviceAuthorization struct {
	DeviceCode              string `json:"deviceCode"`
	UserCode                string `json:"userCode"`
	VerificationURI         string `json:"verificationUri"`
	VerificationURIComplete string `json:"verificationUriComplete"`
	ExpiresIn               int    `json:"expiresIn"`
	Interval                int    `json:"interval"`
}

// PollResult is what PollDeviceAuth returns to the admin handler.
type PollResult struct {
	OK           bool
	Pending      bool
	Error        string
	AccessToken  string
	RefreshToken string
	ExpiresIn    int
}

// StartDeviceAuth kicks off the device authorization flow. Tries each
// candidate client in order; the picked client_id/secret are stashed
// in `tidal_device_codes` so PollDeviceAuth uses the matching pair.
func (a *Auth) StartDeviceAuth(ctx context.Context) (*DeviceAuthorization, error) {
	candidates := a.candidateClients()
	var lastErr error
	for _, c := range candidates {
		if !c.SupportsDevice {
			continue
		}
		body := url.Values{
			"client_id": {c.ID},
			"scope":     {"r_usr w_usr w_sub"},
		}
		req, err := http.NewRequestWithContext(ctx, http.MethodPost,
			"https://auth.tidal.com/v1/oauth2/device_authorization",
			strings.NewReader(body.Encode()))
		if err != nil {
			return nil, err
		}
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		res, err := a.http.Do(req)
		if err != nil {
			lastErr = err
			continue
		}
		respBytes, _ := io.ReadAll(io.LimitReader(res.Body, 1<<14))
		res.Body.Close()
		if res.StatusCode != 200 {
			lastErr = fmt.Errorf("client %s: %d %s", c.ID, res.StatusCode, string(respBytes))
			continue
		}
		var data DeviceAuthorization
		if err := json.Unmarshal(respBytes, &data); err != nil {
			lastErr = err
			continue
		}
		expiresIn := data.ExpiresIn
		if expiresIn < 60 {
			expiresIn = 300
		}
		expiresAt := nowSec() + int64(expiresIn)
		// Remember the picked client so PollDeviceAuth uses the same
		// pair. ON CONFLICT keeps the latest mapping.
		_, dbErr := a.db.Exec(ctx, `
			INSERT INTO tidal_device_codes (device_code, client_id, client_secret, expires_at)
			VALUES ($1, $2, $3, $4)
			ON CONFLICT (device_code) DO UPDATE SET
				client_id     = EXCLUDED.client_id,
				client_secret = EXCLUDED.client_secret,
				expires_at    = EXCLUDED.expires_at
		`, data.DeviceCode, c.ID, c.Secret, expiresAt)
		if dbErr != nil {
			return nil, fmt.Errorf("persist device code: %w", dbErr)
		}
		// Opportunistic GC of stale codes.
		_, _ = a.db.Exec(ctx, `DELETE FROM tidal_device_codes WHERE expires_at < $1`, nowSec())
		return &data, nil
	}
	if lastErr == nil {
		lastErr = errors.New("no candidate clients")
	}
	return nil, fmt.Errorf("device_authorization failed: %w", lastErr)
}

// PollDeviceAuth polls the OAuth token endpoint for a device code.
// Returns OK=true with tokens on success, OK=false with Pending=true
// while the user hasn't approved yet, OK=false with Pending=false and
// Error populated on terminal failures.
func (a *Auth) PollDeviceAuth(ctx context.Context, deviceCode string) (*PollResult, error) {
	// Look up the matching client; fall back to the configured pair.
	var clientID, clientSecret string
	if err := a.db.QueryRow(ctx,
		`SELECT client_id, client_secret FROM tidal_device_codes WHERE device_code = $1`,
		deviceCode,
	).Scan(&clientID, &clientSecret); err != nil {
		clientID = a.cfg.ConfiguredClientID
		clientSecret = a.cfg.ConfiguredSecret
	}
	if clientID == "" || clientSecret == "" && len(knownClients) > 0 {
		clientID = knownClients[0].ID
		clientSecret = knownClients[0].Secret
	}

	body := url.Values{
		"client_id":     {clientID},
		"client_secret": {clientSecret},
		"device_code":   {deviceCode},
		"grant_type":    {"urn:ietf:params:oauth:grant-type:device_code"},
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
	raw, _ := io.ReadAll(io.LimitReader(res.Body, 1<<14))
	var data struct {
		AccessToken  string `json:"access_token"`
		RefreshToken string `json:"refresh_token"`
		ExpiresIn    int    `json:"expires_in"`
		Error        string `json:"error"`
		Description  string `json:"error_description"`
	}
	_ = json.Unmarshal(raw, &data)

	if res.StatusCode == 200 && data.AccessToken != "" && data.RefreshToken != "" {
		// Persist the new session synchronously.
		info := a.fetchSessionInfo(ctx, data.AccessToken)
		t := &Tokens{
			AccessToken:  data.AccessToken,
			RefreshToken: data.RefreshToken,
			ExpiresAt:    nowSec() + int64(data.ExpiresIn),
			UserID:       info.UserID,
			CountryCode:  info.CountryCode,
			ClientID:     clientID,
			ClientSecret: clientSecret,
		}
		if err := a.cacheSession(ctx, t); err != nil {
			return nil, fmt.Errorf("cache session: %w", err)
		}
		a.InvalidateCache()
		return &PollResult{
			OK:           true,
			AccessToken:  data.AccessToken,
			RefreshToken: data.RefreshToken,
			ExpiresIn:    data.ExpiresIn,
		}, nil
	}
	// authorization_pending is the only retryable state in OAuth
	// device flow.
	if data.Error == "authorization_pending" {
		return &PollResult{OK: false, Pending: true, Error: data.Error}, nil
	}
	return &PollResult{OK: false, Pending: false, Error: data.Error + ": " + data.Description}, nil
}
