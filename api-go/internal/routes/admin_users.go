package routes

import (
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"

	"github.com/bratan-corp/bratan-music/api-go/internal/app"
	"github.com/bratan-corp/bratan-music/api-go/internal/httpx"
	"github.com/bratan-corp/bratan-music/api-go/internal/services"
)

// Admin moderation endpoints: /grant, /users/{id}/ban, /users/{id}/unban.
// Ported from worker/src/routes/admin.ts (sections starting at L22 and L223).
//
// /admin/health is implemented in admin_health.go.

const (
	banReasonMaxLen = 280
	grantMinDays    = 1
	grantMaxDays    = 3650
)

// ──────────────────────────────────────────────────────────────────
// POST /admin/users/{id}/ban       body: { reason?: string }
// ──────────────────────────────────────────────────────────────────

type banBody struct {
	Reason string `json:"reason"`
}

func adminBanImpl(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		targetID := chi.URLParam(r, "id")
		requesterID := httpx.UserID(r)
		if targetID == requesterID {
			httpx.Err(w, http.StatusBadRequest, "Нельзя забанить самого себя")
			return
		}

		var body banBody
		_ = httpx.BindJSON(r, &body, 1<<12)
		reason := strings.TrimSpace(body.Reason)
		if len(reason) > banReasonMaxLen {
			reason = reason[:banReasonMaxLen]
		}
		var reasonArg any
		if reason != "" {
			reasonArg = reason
		}

		now := time.Now().Unix()
		tag, err := a.DB.Exec(r.Context(),
			`UPDATE users
			   SET is_banned = 1, banned_at = $1, banned_by = $2,
			       banned_reason = $3, updated_at = $4
			 WHERE id = $5`,
			now, requesterID, reasonArg, now, targetID,
		)
		if err != nil {
			httpx.Internal(w, err)
			return
		}
		if tag.RowsAffected() == 0 {
			httpx.Err(w, http.StatusNotFound, "Пользователь не найден")
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]any{"ok": true})
	}
}

// ──────────────────────────────────────────────────────────────────
// POST /admin/users/{id}/unban
// ──────────────────────────────────────────────────────────────────

func adminUnbanImpl(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		targetID := chi.URLParam(r, "id")
		now := time.Now().Unix()
		tag, err := a.DB.Exec(r.Context(),
			`UPDATE users
			   SET is_banned = 0, banned_at = NULL, banned_by = NULL,
			       banned_reason = NULL, updated_at = $1
			 WHERE id = $2`,
			now, targetID,
		)
		if err != nil {
			httpx.Internal(w, err)
			return
		}
		if tag.RowsAffected() == 0 {
			httpx.Err(w, http.StatusNotFound, "Пользователь не найден")
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]any{"ok": true})
	}
}

// ──────────────────────────────────────────────────────────────────
// POST /admin/grant       body: { userId?, tgUsername?, days? }
// ──────────────────────────────────────────────────────────────────

type grantBody struct {
	UserID     string `json:"userId"`
	TGUsername string `json:"tgUsername"`
	Days       int    `json:"days"`
}

type grantResponse struct {
	OK   bool       `json:"ok"`
	User grantUser  `json:"user"`
	Sub  grantSubDT `json:"subscription"`
}

type grantUser struct {
	ID       string `json:"id"`
	Username string `json:"username,omitempty"`
	Name     string `json:"name,omitempty"`
}

type grantSubDT struct {
	ID        string `json:"id"`
	ExpiresAt int64  `json:"expiresAt"`
	Days      int    `json:"days"`
}

func adminGrantImpl(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body grantBody
		_ = httpx.BindJSON(r, &body, 1<<12)
		days := body.Days
		if days <= 0 {
			days = 30
		}
		if days < grantMinDays {
			days = grantMinDays
		}
		if days > grantMaxDays {
			days = grantMaxDays
		}

		if body.UserID == "" && body.TGUsername == "" {
			httpx.Err(w, http.StatusBadRequest, "userId или tgUsername обязателен")
			return
		}

		auth := services.Of(a).Auth

		var (
			userID, tgUsername, tgName string
		)
		if body.UserID != "" {
			u, err := auth.FindUserByID(r.Context(), body.UserID)
			if err != nil {
				httpx.Internal(w, err)
				return
			}
			if u != nil {
				userID = u.ID
				tgUsername = u.TGUsername
				tgName = u.TGName
			}
		}
		if userID == "" && body.TGUsername != "" {
			// Direct lookup mirrors the TS path: case-insensitive
			// match on `tg_username` with optional `@` prefix
			// trimmed.
			handle := strings.TrimPrefix(body.TGUsername, "@")
			var id, un, nm string
			err := a.DB.QueryRow(r.Context(),
				`SELECT id, COALESCE(tg_username,''), COALESCE(tg_name,'')
				   FROM users WHERE LOWER(tg_username) = LOWER($1) LIMIT 1`,
				handle,
			).Scan(&id, &un, &nm)
			if err != nil {
				if !errors.Is(err, pgx.ErrNoRows) {
					httpx.Internal(w, err)
					return
				}
			} else {
				userID = id
				tgUsername = un
				tgName = nm
			}
		}
		if userID == "" {
			httpx.Err(w, http.StatusNotFound, "Пользователь не найден")
			return
		}

		sub, err := services.Of(a).Subs.ActivateManual(r.Context(), userID, days)
		if err != nil {
			httpx.Internal(w, err)
			return
		}

		httpx.JSON(w, http.StatusOK, grantResponse{
			OK: true,
			User: grantUser{
				ID:       userID,
				Username: tgUsername,
				Name:     tgName,
			},
			Sub: grantSubDT{
				ID:        sub.ID,
				ExpiresAt: sub.ExpiresAt,
				Days:      days,
			},
		})
	}
}
