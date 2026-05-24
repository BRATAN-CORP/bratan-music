// Package config loads the runtime configuration from environment variables.
//
// All env-vars referenced here mirror the ones the legacy Node-based worker
// consumed (see worker/src/types/env.ts and worker/src/node-entry.ts).
// Any new env-var must be added in BOTH places until the worker/ tree is
// dropped in a follow-up PR.
package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
)

// Config holds every value our API needs at runtime. Values are loaded
// once at startup; nothing here is allowed to mutate during request
// handling.
type Config struct {
	Port int

	DatabaseURL  string
	RedisURL     string
	MinIOEndpoint string
	MinIOPort    int
	MinIOUseSSL  bool
	MinIOAccess  string
	MinIOSecret  string
	MinIOBucket  string

	AppURL string
	Domain string

	JWTSecret             string
	JWTRefreshSecret      string
	SessionEncryptionKey  string

	TidalClientID      string
	TidalClientSecret  string
	TidalSessionToken  string
	TidalRefreshToken  string
	TidalClientVersion string
	TidalCountryCode   string
	TidalLocale        string

	TelegramBotToken       string
	TelegramBotUsername    string
	TelegramAdminIDs       []string
	TelegramWebhookSecret  string

	BrevoAPIKey      string
	BrevoSenderEmail string
	BrevoSenderName  string

	YandexAPIToken  string
	YandexFolderID  string
	YandexModelURI  string

	Environment string
}

// Load reads the configuration from environment variables. Missing required
// secrets cause a fatal error during startup — we explicitly DON'T fall back
// to insecure defaults for JWT_SECRET / SESSION_ENCRYPTION_KEY because
// silent defaults are the worst class of production bug.
func Load() (*Config, error) {
	c := &Config{
		Port:                  envInt("PORT", 3000),
		DatabaseURL:           os.Getenv("DATABASE_URL"),
		RedisURL:              envStr("REDIS_URL", "redis://localhost:6379"),
		MinIOEndpoint:         envStr("MINIO_ENDPOINT", "localhost"),
		MinIOPort:             envInt("MINIO_PORT", 9000),
		MinIOUseSSL:           envBool("MINIO_USE_SSL", false),
		MinIOAccess:           envStr("MINIO_ACCESS_KEY", "minioadmin"),
		MinIOSecret:           envStr("MINIO_SECRET_KEY", "minioadmin"),
		MinIOBucket:           envStr("MINIO_BUCKET", "tracks"),
		Domain:                os.Getenv("DOMAIN"),
		JWTSecret:             os.Getenv("JWT_SECRET"),
		JWTRefreshSecret:      os.Getenv("JWT_REFRESH_SECRET"),
		SessionEncryptionKey:  os.Getenv("SESSION_ENCRYPTION_KEY"),
		TidalClientID:         os.Getenv("TIDAL_CLIENT_ID"),
		TidalClientSecret:     os.Getenv("TIDAL_CLIENT_SECRET"),
		TidalSessionToken:     os.Getenv("TIDAL_SESSION_TOKEN"),
		TidalRefreshToken:     os.Getenv("TIDAL_REFRESH_TOKEN"),
		TidalClientVersion:    os.Getenv("TIDAL_CLIENT_VERSION"),
		TidalCountryCode:      os.Getenv("TIDAL_COUNTRY_CODE"),
		TidalLocale:           os.Getenv("TIDAL_LOCALE"),
		TelegramBotToken:      os.Getenv("TELEGRAM_BOT_TOKEN"),
		TelegramBotUsername:   os.Getenv("TELEGRAM_BOT_USERNAME"),
		TelegramWebhookSecret: os.Getenv("TELEGRAM_WEBHOOK_SECRET"),
		BrevoAPIKey:           os.Getenv("BREVO_API_KEY"),
		BrevoSenderEmail:      envStr("BREVO_SENDER_EMAIL", "noreply.bratanmusic@gmail.com"),
		BrevoSenderName:       envStr("BREVO_SENDER_NAME", "BRATAN MUSIC"),
		YandexAPIToken:        os.Getenv("YANDEX_API_TOKEN"),
		YandexFolderID:        os.Getenv("YANDEX_FOLDER_ID"),
		YandexModelURI:        os.Getenv("YANDEX_MODEL_URI"),
		Environment:           envStr("NODE_ENV", "production"),
	}

	if c.AppURL = os.Getenv("APP_URL"); c.AppURL == "" {
		if c.Domain != "" {
			c.AppURL = "https://" + c.Domain
		} else {
			c.AppURL = "http://localhost"
		}
	}

	c.TelegramAdminIDs = splitCSV(os.Getenv("TELEGRAM_ADMIN_IDS"))

	if err := c.validate(); err != nil {
		return nil, err
	}
	return c, nil
}

func (c *Config) validate() error {
	missing := []string{}
	check := func(name, val string) {
		if strings.TrimSpace(val) == "" {
			missing = append(missing, name)
		}
	}
	check("DATABASE_URL", c.DatabaseURL)
	check("JWT_SECRET", c.JWTSecret)
	check("JWT_REFRESH_SECRET", c.JWTRefreshSecret)
	check("SESSION_ENCRYPTION_KEY", c.SessionEncryptionKey)
	check("TELEGRAM_BOT_TOKEN", c.TelegramBotToken)
	check("TELEGRAM_BOT_USERNAME", c.TelegramBotUsername)
	check("TELEGRAM_WEBHOOK_SECRET", c.TelegramWebhookSecret)
	if len(missing) > 0 {
		return fmt.Errorf("missing required env vars: %s", strings.Join(missing, ", "))
	}
	return nil
}

func envStr(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

func envInt(k string, def int) int {
	if v := os.Getenv(k); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return def
}

func envBool(k string, def bool) bool {
	if v := os.Getenv(k); v != "" {
		switch strings.ToLower(v) {
		case "1", "true", "yes", "on":
			return true
		case "0", "false", "no", "off":
			return false
		}
	}
	return def
}

func splitCSV(s string) []string {
	if s == "" {
		return nil
	}
	parts := strings.Split(s, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if t := strings.TrimSpace(p); t != "" {
			out = append(out, t)
		}
	}
	return out
}

// IsAdminTelegramID returns true if the given Telegram numeric ID is on the
// admin allowlist supplied via TELEGRAM_ADMIN_IDS. Comparison is string-equal
// to avoid integer-overflow surprises on large IDs.
func (c *Config) IsAdminTelegramID(tgID string) bool {
	for _, id := range c.TelegramAdminIDs {
		if id == tgID {
			return true
		}
	}
	return false
}
