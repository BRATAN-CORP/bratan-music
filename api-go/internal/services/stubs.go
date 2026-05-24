package services

import (
	"github.com/bratan-corp/bratan-music/api-go/internal/app"
	"github.com/bratan-corp/bratan-music/api-go/internal/tidal"
)

// ---- AuthService ------------------------------------------------------
//
// Issues access/refresh JWT pairs, rotates them on refresh, mints
// single-use 5-min nonces for the Telegram deeplink-login flow, and
// owns the sessions row that JWT `sid` claims point at.
type AuthService struct{ A *app.App }

func NewAuthService(a *app.App) *AuthService { return &AuthService{A: a} }

// ---- UserService ------------------------------------------------------
//
// Reads/writes the `users` table plus the daily-listen quota counter
// (free-tier users get 3 full tracks per UTC day).
type UserService struct{ A *app.App }

func NewUserService(a *app.App) *UserService { return &UserService{A: a} }

// ---- SubscriptionService ----------------------------------------------
//
// Activates Telegram Stars receipts. Idempotency is enforced by the
// (user_id, stars_tx_id) unique constraint so retries from Telegram
// never duplicate a grant.
type SubscriptionService struct{ A *app.App }

func NewSubscriptionService(a *app.App) *SubscriptionService { return &SubscriptionService{A: a} }

// ---- SessionService ---------------------------------------------------
type SessionService struct{ A *app.App }

func NewSessionService(a *app.App) *SessionService { return &SessionService{A: a} }

// ---- EmailOtpService --------------------------------------------------
type EmailOtpService struct{ A *app.App }

func NewEmailOtpService(a *app.App) *EmailOtpService { return &EmailOtpService{A: a} }

// ---- BrevoService -----------------------------------------------------
//
// Thin wrapper over the Brevo transactional email API. Skips sending
// silently when BREVO_API_KEY is empty so non-production deployments
// don't fail health-check on the email path.
type BrevoService struct{ A *app.App }

func NewBrevoService(a *app.App) *BrevoService { return &BrevoService{A: a} }

// ---- HistoryService ---------------------------------------------------
type HistoryService struct{ A *app.App }

func NewHistoryService(a *app.App) *HistoryService { return &HistoryService{A: a} }

// ---- PlaylistService --------------------------------------------------
type PlaylistService struct{ A *app.App }

func NewPlaylistService(a *app.App) *PlaylistService { return &PlaylistService{A: a} }

// ---- LibraryService ---------------------------------------------------
type LibraryService struct{ A *app.App }

func NewLibraryService(a *app.App) *LibraryService { return &LibraryService{A: a} }

// ---- HealthService ----------------------------------------------------
type HealthService struct{ A *app.App }

func NewHealthService(a *app.App) *HealthService { return &HealthService{A: a} }

// ---- TidalService -----------------------------------------------------
//
// Thin facade around internal/tidal. Held on App so handlers can reach
// the catalogue / stream / device-flow surfaces without re-plumbing
// constructors. Mirrors worker/TidalService.ts' role.
type TidalService struct {
	A    *app.App
	Auth *tidal.Auth
	API  *tidal.API
}

func NewTidalService(a *app.App) *TidalService {
	auth := tidal.NewAuth(a.DB, tidal.AuthConfig{
		SessionEncryptionKey: a.Cfg.SessionEncryptionKey,
		RefreshTokenFallback: a.Cfg.TidalRefreshToken,
		CountryCodeFallback:  a.Cfg.TidalCountryCode,
		ConfiguredClientID:   a.Cfg.TidalClientID,
		ConfiguredSecret:     a.Cfg.TidalClientSecret,
	})
	return &TidalService{
		A:    a,
		Auth: auth,
		API:  tidal.NewAPI(auth),
	}
}

// AIPlaylistService is implemented in internal/services/ai_playlist.go.

// ---- RoomService ------------------------------------------------------
type RoomService struct{ A *app.App }

func NewRoomService(a *app.App) *RoomService { return &RoomService{A: a} }

// BotService is implemented in internal/services/bot.go.
