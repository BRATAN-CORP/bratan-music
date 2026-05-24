package routes

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"io"
	"net/http"

	"github.com/bratan-corp/bratan-music/api-go/internal/app"
	"github.com/bratan-corp/bratan-music/api-go/internal/httpx"
	"github.com/bratan-corp/bratan-music/api-go/internal/services"
)

// POST /webhook/telegram
//
// Mirrors worker/src/routes/webhook.ts:
//   1. Verify X-Telegram-Bot-Api-Secret-Token against
//      cfg.TelegramWebhookSecret in constant time.
//   2. Decode the JSON body.
//   3. Spawn HandleUpdate on a background goroutine so we always ack
//      Telegram in <100ms — otherwise every sendMessage / setChatMenuButton
//      round-trip inside the handler blocks the webhook response.
//   4. Return {"ok": true}.
//
// The detached goroutine deliberately doesn't inherit the request
// context: chi cancels the request ctx as soon as we return, but we
// still want the Telegram API calls + DB writes to finish.
func telegramWebhookImpl(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		secret := r.Header.Get("X-Telegram-Bot-Api-Secret-Token")
		expected := a.Cfg.TelegramWebhookSecret
		if expected == "" || len(secret) != len(expected) ||
			subtle.ConstantTimeCompare([]byte(secret), []byte(expected)) != 1 {
			httpx.Err(w, http.StatusForbidden, "Неверный секрет")
			return
		}

		raw, err := io.ReadAll(io.LimitReader(r.Body, 1<<20)) // 1 MiB cap
		if err != nil {
			httpx.Err(w, http.StatusBadRequest, "Не удалось прочитать тело")
			return
		}
		var update services.TelegramUpdate
		if err := json.Unmarshal(raw, &update); err != nil {
			// Telegram sends well-formed JSON; treat malformed
			// payloads as a soft 400 instead of dispatching.
			httpx.Err(w, http.StatusBadRequest, "Невалидный JSON")
			return
		}

		go func(u services.TelegramUpdate) {
			defer func() {
				if rec := recover(); rec != nil {
					a.Logger.Error("bot HandleUpdate panic", "rec", rec)
				}
			}()
			services.NewBotService(a).HandleUpdate(context.Background(), u)
		}(update)

		httpx.JSON(w, http.StatusOK, map[string]any{"ok": true})
	}
}
