package middleware

import (
	"context"
	"log/slog"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/bratan-corp/bratan-music/api-go/internal/httpx"
	"github.com/bratan-corp/bratan-music/api-go/internal/redisx"
)

// RateLimit returns middleware that limits requests by client IP and,
// when present, authenticated user id. Limits and the bucket window
// mirror the legacy worker's KV-based limiter.
//
// `skipPaths` are exempt — primarily the audio-stream proxy, which
// would otherwise be tripped on every range request a media element
// makes.
func RateLimit(r *redisx.Client, skipPaths []string) func(http.Handler) http.Handler {
	skip := make(map[string]struct{}, len(skipPaths))
	for _, p := range skipPaths {
		skip[p] = struct{}{}
	}
	const (
		ipLimit  = 200 // requests / window
		userLim  = 600
		window   = time.Minute
	)
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			path := req.URL.Path
			if shouldSkipPath(path, skip) {
				next.ServeHTTP(w, req)
				return
			}
			ctx, cancel := context.WithTimeout(req.Context(), 200*time.Millisecond)
			defer cancel()

			ip := clientIP(req)
			if ip != "" {
				key := "rl:ip:" + ip + ":" + minuteBucket()
				count, err := r.IncrWithTTL(ctx, key, 2*window)
				if err == nil && count > ipLimit {
					httpx.Err(w, http.StatusTooManyRequests, "Слишком много запросов")
					return
				}
				if err != nil {
					slog.Debug("ratelimit ip incr", "err", err)
				}
			}
			if uid := httpx.UserID(req); uid != "" {
				key := "rl:u:" + uid + ":" + minuteBucket()
				count, err := r.IncrWithTTL(ctx, key, 2*window)
				if err == nil && count > userLim {
					httpx.Err(w, http.StatusTooManyRequests, "Слишком много запросов")
					return
				}
			}
			next.ServeHTTP(w, req)
		})
	}
}

func shouldSkipPath(path string, skip map[string]struct{}) bool {
	if _, ok := skip[path]; ok {
		return true
	}
	for p := range skip {
		if strings.HasPrefix(path, p) {
			return true
		}
	}
	return false
}

func minuteBucket() string {
	return time.Now().UTC().Format("200601021504")
}

func clientIP(r *http.Request) string {
	if v := r.Header.Get("CF-Connecting-IP"); v != "" {
		return v
	}
	if v := r.Header.Get("X-Forwarded-For"); v != "" {
		parts := strings.Split(v, ",")
		return strings.TrimSpace(parts[0])
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}
