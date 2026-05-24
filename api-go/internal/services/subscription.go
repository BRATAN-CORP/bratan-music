package services

import "context"

// Ported from worker/src/services/SubscriptionService.ts. The worker
// schema stores expires_at in **unix seconds**, so we compare against
// `timeNowSec()` here — not `timeNowMs()` like a few other tables.

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
