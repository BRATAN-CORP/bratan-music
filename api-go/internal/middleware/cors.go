// Package middleware contains HTTP middleware shared across all routes:
// CORS, rate-limiting, JWT auth, admin checks.
package middleware

import (
	"net/http"
	"strings"
)

// CORS implements an allow-list based CORS handler that matches the
// behaviour of the legacy worker's `corsMiddleware`. Wild-card
// origins are explicitly NOT allowed; if an origin isn't on the list
// we still pass the request through without CORS headers (so non-
// browser clients keep working) but the browser will block it.
func CORS(allowedOrigins []string) func(http.Handler) http.Handler {
	allow := make(map[string]struct{}, len(allowedOrigins))
	for _, o := range allowedOrigins {
		allow[strings.TrimSpace(o)] = struct{}{}
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			origin := r.Header.Get("Origin")
			if origin != "" {
				if _, ok := allow[origin]; ok {
					setCORSHeaders(w, origin)
				}
			}
			if r.Method == http.MethodOptions {
				w.WriteHeader(http.StatusNoContent)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

func setCORSHeaders(w http.ResponseWriter, origin string) {
	h := w.Header()
	h.Set("Access-Control-Allow-Origin", origin)
	h.Set("Access-Control-Allow-Credentials", "true")
	h.Set("Vary", "Origin")
	h.Set("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS")
	h.Set("Access-Control-Allow-Headers", "Authorization,Content-Type,X-Requested-With,X-Client-Label,X-Telegram-Init-Data")
	h.Set("Access-Control-Max-Age", "600")
}
