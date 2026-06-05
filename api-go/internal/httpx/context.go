package httpx

import (
	"context"
	"net/http"
)

// Per-request context keys. We never expose the keys outside the
// package so callers must go through the typed accessors below.
type ctxKey int

const (
	ctxUserID ctxKey = iota
	ctxIsAdmin
	ctxSessionID
)

// WithUserID returns a context carrying the authenticated user id.
func WithUserID(ctx context.Context, id string) context.Context {
	return context.WithValue(ctx, ctxUserID, id)
}

// WithIsAdmin attaches the admin flag to ctx.
func WithIsAdmin(ctx context.Context, v bool) context.Context {
	return context.WithValue(ctx, ctxIsAdmin, v)
}

// WithSessionID attaches the active sessions.id to ctx.
func WithSessionID(ctx context.Context, id string) context.Context {
	return context.WithValue(ctx, ctxSessionID, id)
}

// UserID returns the authenticated user id, or "" if anonymous.
func UserID(r *http.Request) string {
	if v, ok := r.Context().Value(ctxUserID).(string); ok {
		return v
	}
	return ""
}

// IsAdmin reports whether the request is from an admin user.
func IsAdmin(r *http.Request) bool {
	if v, ok := r.Context().Value(ctxIsAdmin).(bool); ok {
		return v
	}
	return false
}

// SessionID returns the active sessions.id for this request, or "".
func SessionID(r *http.Request) string {
	if v, ok := r.Context().Value(ctxSessionID).(string); ok {
		return v
	}
	return ""
}
