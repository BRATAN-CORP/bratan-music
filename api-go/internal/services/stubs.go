package services

import (
	"context"

	"github.com/bratan-corp/bratan-music/api-go/internal/app"
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
type TidalService struct{ A *app.App }

func NewTidalService(a *app.App) *TidalService { return &TidalService{A: a} }

// ---- TasteService -----------------------------------------------------
type TasteService struct{ A *app.App }

func NewTasteService(a *app.App) *TasteService { return &TasteService{A: a} }

// RecomputeActive walks active users and refreshes their taste vector.
// Stub during the first PR — to be ported from the TS service in a
// follow-up commit. Idempotent and safe to call on schedule.
func (s *TasteService) RecomputeActive(ctx context.Context) {
	_ = ctx
	s.A.Logger.Info("taste.RecomputeActive: stub, skipping")
}

// ---- RecommendationService --------------------------------------------
type RecommendationService struct{ A *app.App }

func NewRecommendationService(a *app.App) *RecommendationService { return &RecommendationService{A: a} }

// GCStale removes recommendation_seen rows older than 30 days.
func (s *RecommendationService) GCStale(ctx context.Context) {
	_, err := s.A.DB.Exec(ctx,
		`DELETE FROM recommendation_seen WHERE last_seen_at < $1`,
		(timeNowMs() - 30*24*60*60*1000),
	)
	if err != nil {
		s.A.Logger.Error("gc stale", "err", err)
	}
}

// ---- DailyPlaylistService ---------------------------------------------
type DailyPlaylistService struct{ A *app.App }

func NewDailyPlaylistService(a *app.App) *DailyPlaylistService { return &DailyPlaylistService{A: a} }

// RegenerateForActive walks the active users set and regenerates the
// three variants per user. Stub for now; ported from TS in a follow-up.
func (s *DailyPlaylistService) RegenerateForActive(ctx context.Context) {
	_ = ctx
	s.A.Logger.Info("daily.RegenerateForActive: stub, skipping")
}

// ---- AIPlaylistService ------------------------------------------------
type AIPlaylistService struct{ A *app.App }

func NewAIPlaylistService(a *app.App) *AIPlaylistService { return &AIPlaylistService{A: a} }

// ---- RoomService ------------------------------------------------------
type RoomService struct{ A *app.App }

func NewRoomService(a *app.App) *RoomService { return &RoomService{A: a} }

// ---- BotService -------------------------------------------------------
type BotService struct{ A *app.App }

func NewBotService(a *app.App) *BotService { return &BotService{A: a} }
