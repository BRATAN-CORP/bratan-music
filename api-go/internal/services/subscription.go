package services

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// Ported from worker/src/services/SubscriptionService.ts. The worker
// schema stores expires_at in **unix seconds**, so we compare against
// `timeNowSec()` here — not `timeNowMs()` like a few other tables.

// Subscription mirrors the TS shape (snake_case JSON not needed here:
// callers never serialise it directly).
type Subscription struct {
	ID            string
	UserID        string
	Status        string
	ExpiresAt     int64
	PaymentMethod string
	StarsTxID     string
	CreatedAt     int64
	UpdatedAt     int64
}

// GetActive returns the live `status=active` subscription with the
// furthest expiry, or nil when none exists. Mirrors TS
// SubscriptionService.getActive.
func (s *SubscriptionService) GetActive(ctx context.Context, userID string) (*Subscription, error) {
	now := time.Now().Unix()
	row := s.A.DB.QueryRow(ctx,
		`SELECT id, user_id, status, expires_at,
		        COALESCE(payment_method,''), COALESCE(stars_tx_id,''),
		        created_at, updated_at
		   FROM subscriptions
		  WHERE user_id = $1 AND status = 'active' AND expires_at > $2
		  ORDER BY expires_at DESC LIMIT 1`,
		userID, now,
	)
	var out Subscription
	if err := row.Scan(&out.ID, &out.UserID, &out.Status, &out.ExpiresAt,
		&out.PaymentMethod, &out.StarsTxID, &out.CreatedAt, &out.UpdatedAt); err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	return &out, nil
}

// Activate writes a fresh 30-day `active` subscription. starsTxID may
// be empty for non-Stars payment methods.
func (s *SubscriptionService) Activate(ctx context.Context, userID, paymentMethod, starsTxID string) (*Subscription, error) {
	now := time.Now().Unix()
	expires := now + subDurationDays*24*60*60
	id := uuid.NewString()
	var txArg any
	if starsTxID != "" {
		txArg = starsTxID
	}
	if _, err := s.A.DB.Exec(ctx,
		`INSERT INTO subscriptions
		   (id, user_id, status, expires_at, payment_method, stars_tx_id, created_at, updated_at)
		 VALUES ($1, $2, 'active', $3, $4, $5, $6, $6)`,
		id, userID, expires, paymentMethod, txArg, now,
	); err != nil {
		return nil, err
	}
	return &Subscription{
		ID:            id,
		UserID:        userID,
		Status:        "active",
		ExpiresAt:     expires,
		PaymentMethod: paymentMethod,
		StarsTxID:     starsTxID,
		CreatedAt:     now,
		UpdatedAt:     now,
	}, nil
}

// ActivateManual is the admin-only grant path: same row shape as
// Activate but with payment_method='manual' and a caller-supplied
// duration in days.
func (s *SubscriptionService) ActivateManual(ctx context.Context, userID string, days int) (*Subscription, error) {
	if days <= 0 {
		days = subDurationDays
	}
	now := time.Now().Unix()
	expires := now + int64(days)*24*60*60
	id := uuid.NewString()
	if _, err := s.A.DB.Exec(ctx,
		`INSERT INTO subscriptions
		   (id, user_id, status, expires_at, payment_method, created_at, updated_at)
		 VALUES ($1, $2, 'active', $3, 'manual', $4, $4)`,
		id, userID, expires, now,
	); err != nil {
		return nil, err
	}
	return &Subscription{
		ID:            id,
		UserID:        userID,
		Status:        "active",
		ExpiresAt:     expires,
		PaymentMethod: "manual",
		CreatedAt:     now,
		UpdatedAt:     now,
	}, nil
}

// HasActive reports whether the user holds an unexpired, non-cancelled
// subscription right now. Used by gated features (overrides upload,
// AI playlists, daily-playlist preview limits).
func (s *SubscriptionService) HasActive(ctx context.Context, userID string) (bool, error) {
	if userID == "" {
		return false, nil
	}
	var n int
	err := s.A.DB.QueryRow(ctx,
		`SELECT COUNT(*) FROM subscriptions
		   WHERE user_id = $1
		     AND status IN ('active','manual')
		     AND expires_at > $2`,
		userID, timeNowSec(),
	).Scan(&n)
	if err != nil {
		return false, err
	}
	return n > 0, nil
}
