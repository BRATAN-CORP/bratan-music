// Telegram WebApp HMAC verification.
//
// The Mini-App passes a signed `initData` query string when the user
// opens the app. We verify the signature *exactly* as the official
// docs describe; any deviation here is a critical security bug.
//
// Reference: https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
package authz

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"
)

// TelegramInitData holds the parsed payload of a verified initData
// string. We only surface the fields the API actually uses.
type TelegramInitData struct {
	AuthDate int64
	Hash     string
	QueryID  string
	User     TelegramUser
	Raw      url.Values
}

// TelegramUser mirrors the subset of fields Telegram embeds.
type TelegramUser struct {
	ID           int64  `json:"id"`
	IsBot        bool   `json:"is_bot,omitempty"`
	FirstName    string `json:"first_name,omitempty"`
	LastName     string `json:"last_name,omitempty"`
	Username     string `json:"username,omitempty"`
	LanguageCode string `json:"language_code,omitempty"`
	PhotoURL     string `json:"photo_url,omitempty"`
}

// VerifyInitData returns the parsed payload if the HMAC signature is
// valid AND auth_date is within the allowed freshness window
// (default 24h, see Telegram docs).
func VerifyInitData(botToken, raw string, maxAge time.Duration) (*TelegramInitData, error) {
	if botToken == "" {
		return nil, errors.New("telegram: empty bot token")
	}
	if maxAge <= 0 {
		maxAge = 24 * time.Hour
	}

	values, err := url.ParseQuery(raw)
	if err != nil {
		return nil, err
	}
	hash := values.Get("hash")
	if hash == "" {
		return nil, errors.New("telegram: missing hash")
	}

	// Build the data-check string: every key=value sorted alphabetically,
	// excluding "hash", joined by \n.
	keys := make([]string, 0, len(values))
	for k := range values {
		if k != "hash" {
			keys = append(keys, k)
		}
	}
	sort.Strings(keys)
	parts := make([]string, 0, len(keys))
	for _, k := range keys {
		parts = append(parts, k+"="+values.Get(k))
	}
	dataCheck := strings.Join(parts, "\n")

	// secret_key = HMAC_SHA256("WebAppData", bot_token)
	secMac := hmac.New(sha256.New, []byte("WebAppData"))
	_, _ = secMac.Write([]byte(botToken))
	secretKey := secMac.Sum(nil)

	// expected = hex( HMAC_SHA256(secret_key, dataCheck) )
	checkMac := hmac.New(sha256.New, secretKey)
	_, _ = checkMac.Write([]byte(dataCheck))
	expected := hex.EncodeToString(checkMac.Sum(nil))

	if !hmac.Equal([]byte(expected), []byte(hash)) {
		return nil, errors.New("telegram: bad hash")
	}

	authDateStr := values.Get("auth_date")
	authDate, _ := strconv.ParseInt(authDateStr, 10, 64)
	if authDate == 0 {
		return nil, errors.New("telegram: missing auth_date")
	}
	if time.Since(time.Unix(authDate, 0)) > maxAge {
		return nil, errors.New("telegram: stale auth_date")
	}

	out := &TelegramInitData{
		AuthDate: authDate,
		Hash:     hash,
		QueryID:  values.Get("query_id"),
		Raw:      values,
	}
	if userJSON := values.Get("user"); userJSON != "" {
		if err := parseTGUser(userJSON, &out.User); err != nil {
			return nil, err
		}
	}
	return out, nil
}

// VerifyWebhookSecret returns true if the X-Telegram-Bot-Api-Secret-Token
// header on a webhook delivery matches our configured secret. We use
// constant-time comparison to defeat timing attacks.
func VerifyWebhookSecret(expected, got string) bool {
	if expected == "" || got == "" {
		return false
	}
	return hmac.Equal([]byte(expected), []byte(got))
}

func parseTGUser(s string, dst *TelegramUser) error {
	// Local import-free JSON unmarshal to avoid leaking the dependency
	// graph. We rely on the std lib elsewhere; minimal impact.
	return unmarshal([]byte(s), dst)
}
