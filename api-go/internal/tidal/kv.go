package tidal

import (
	"context"
	"time"
)

// kvGet / kvSet are nil-safe wrappers around the optional KV cache. A
// nil cache (or any Redis error) is treated as a cache miss / no-op so
// the streaming resolver keeps working without persistence — it just
// loses the discovery memo + self-heal (every cold play re-probes).
func (a *API) kvGet(ctx context.Context, key string) (string, bool) {
	if a.cache == nil {
		return "", false
	}
	v, ok, err := a.cache.KVGet(ctx, key)
	if err != nil || !ok {
		return "", false
	}
	return v, true
}

func (a *API) kvSet(ctx context.Context, key, value string, ttl time.Duration) {
	if a.cache == nil {
		return
	}
	_ = a.cache.KVSet(ctx, key, value, ttl)
}

func (a *API) kvDel(ctx context.Context, key string) {
	if a.cache == nil {
		return
	}
	_ = a.cache.KVDel(ctx, key)
}
