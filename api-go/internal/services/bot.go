package services

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/bratan-corp/bratan-music/api-go/internal/app"
)

// BotService — Go port of worker/src/bot/*.ts.
//
// Telegram webhook entry point: HandleUpdate decodes the JSON payload
// the worker route handler already validated (HMAC secret header) and
// dispatches by update kind (message / callback_query /
// pre_checkout_query). All Telegram round-trips and DB writes happen
// here so the webhook handler can `go bot.HandleUpdate(...)` and ack
// Telegram in <100ms.
//
// Replaces the placeholder in stubs.go.

const (
	telegramAPIBase     = "https://api.telegram.org"
	telegramHTTPTimeout = 15 * time.Second
	loginNonceTTLSec    = 300            // 5 minutes; matches /auth/nonce/:nonce.
	subStarsAmount      = 99             // 99 Stars / month, matches worker.
	subStarsCurrency    = "XTR"          // Telegram Stars currency code.
	subDurationDays     = 30             // monthly subscription.
	defaultAppURL       = "https://bratan-music.eu.cc"
)

var subPayloadRE = regexp.MustCompile(`^sub_(\d+)_\d+$`)

// BotService bundles dependencies needed to handle a Telegram update.
type BotService struct {
	A    *app.App
	http *http.Client
}

// NewBotService wires the bot service.
func NewBotService(a *app.App) *BotService {
	return &BotService{
		A:    a,
		http: &http.Client{Timeout: telegramHTTPTimeout},
	}
}

// ──────────────────────────────────────────────────────────────────
// Telegram update types — minimal shape we actually inspect.
// ──────────────────────────────────────────────────────────────────

type TelegramUpdate struct {
	UpdateID         int64                `json:"update_id"`
	Message          *TelegramMessage     `json:"message,omitempty"`
	CallbackQuery    *TelegramCallbackQry `json:"callback_query,omitempty"`
	PreCheckoutQuery *TelegramPreCheckout `json:"pre_checkout_query,omitempty"`
}

type TelegramUser struct {
	ID        int64  `json:"id"`
	IsBot     bool   `json:"is_bot"`
	FirstName string `json:"first_name"`
	LastName  string `json:"last_name,omitempty"`
	Username  string `json:"username,omitempty"`
	LangCode  string `json:"language_code,omitempty"`
}

type TelegramChat struct {
	ID   int64  `json:"id"`
	Type string `json:"type"`
}

type TelegramMessage struct {
	MessageID         int64                      `json:"message_id"`
	From              TelegramUser               `json:"from"`
	Chat              TelegramChat               `json:"chat"`
	Date              int64                      `json:"date"`
	Text              string                     `json:"text,omitempty"`
	SuccessfulPayment *TelegramSuccessfulPayment `json:"successful_payment,omitempty"`
}

type TelegramCallbackQry struct {
	ID      string           `json:"id"`
	From    TelegramUser     `json:"from"`
	Message *TelegramMessage `json:"message,omitempty"`
	Data    string           `json:"data,omitempty"`
}

type TelegramPreCheckout struct {
	ID             string       `json:"id"`
	From           TelegramUser `json:"from"`
	Currency       string       `json:"currency"`
	TotalAmount    int          `json:"total_amount"`
	InvoicePayload string       `json:"invoice_payload"`
}

type TelegramSuccessfulPayment struct {
	Currency                string `json:"currency"`
	TotalAmount             int    `json:"total_amount"`
	InvoicePayload          string `json:"invoice_payload"`
	TelegramPaymentChargeID string `json:"telegram_payment_charge_id"`
	ProviderPaymentChargeID string `json:"provider_payment_charge_id"`
}

// ──────────────────────────────────────────────────────────────────
// Entry points
// ──────────────────────────────────────────────────────────────────

// HandleUpdate routes a decoded Telegram update to its handler.
// Mirrors worker/src/bot/index.ts handleBotUpdate.
func (b *BotService) HandleUpdate(ctx context.Context, u TelegramUpdate) {
	switch {
	case u.PreCheckoutQuery != nil:
		if err := b.handlePreCheckout(ctx, u.PreCheckoutQuery); err != nil {
			b.A.Logger.Error("bot preCheckout", "err", err)
		}
		return
	case u.Message != nil && u.Message.SuccessfulPayment != nil:
		if err := b.handleSuccessfulPayment(ctx, u.Message); err != nil {
			b.A.Logger.Error("bot successfulPayment", "err", err)
		}
		return
	case u.CallbackQuery != nil:
		_ = b.answerCallbackQuery(ctx, u.CallbackQuery.ID, "")
		if u.CallbackQuery.Data == "subscribe" && u.CallbackQuery.Message != nil {
			msg := *u.CallbackQuery.Message
			msg.From = u.CallbackQuery.From
			msg.Text = "/subscribe"
			if err := b.handleSubscribe(ctx, &msg); err != nil {
				b.A.Logger.Error("bot subscribe", "err", err)
			}
		}
		return
	case u.Message != nil && u.Message.Text != "":
		b.dispatchCommand(ctx, u.Message)
		return
	}
}

func (b *BotService) dispatchCommand(ctx context.Context, m *TelegramMessage) {
	cmd := m.Text
	if sp := strings.IndexAny(cmd, " "); sp >= 0 {
		cmd = cmd[:sp]
	}
	if at := strings.Index(cmd, "@"); at >= 0 {
		cmd = cmd[:at]
	}

	var err error
	switch cmd {
	case "/start":
		err = b.handleStart(ctx, m)
	case "/login", "/app":
		err = b.handleLogin(ctx, m)
	case "/subscribe":
		err = b.handleSubscribe(ctx, m)
	case "/status":
		err = b.handleStatus(ctx, m)
	case "/help":
		err = b.handleHelp(ctx, m)
	case "/admin_stats", "/admin_grant", "/admin_help":
		err = b.handleAdmin(ctx, m, cmd)
	}
	if err != nil {
		b.A.Logger.Error("bot command", "cmd", cmd, "err", err)
	}
}

// ──────────────────────────────────────────────────────────────────
// Commands
// ──────────────────────────────────────────────────────────────────

func (b *BotService) handleStart(ctx context.Context, m *TelegramMessage) error {
	// Deeplinks: /start auth_<nonce>  /start link_<nonce>
	args := strings.Fields(m.Text)[1:]
	if len(args) > 0 {
		arg := args[0]
		if strings.HasPrefix(arg, "auth_") {
			return b.handleAuthDeeplink(ctx, m, strings.TrimPrefix(arg, "auth_"))
		}
		if strings.HasPrefix(arg, "link_") {
			return b.handleLinkDeeplink(ctx, m, strings.TrimPrefix(arg, "link_"))
		}
	}

	if _, err := b.ensureUser(ctx, m); err != nil {
		b.A.Logger.Warn("bot ensureUser", "err", err)
	}
	_ = b.setChatMenuButton(ctx, m.Chat.ID, b.appURL())

	kbd, _ := b.buildMainKeyboard(ctx, m.From.ID)
	return b.sendMessage(ctx, m.Chat.ID, "<b>BRATAN MUSIC</b>\n\n"+
		"Добро пожаловать! Это бот для управления подпиской и аккаунтом.\n\n"+
		"Команды:\n"+
		"/login — Войти на сайте\n"+
		"/app — Открыть веб-приложение\n"+
		"/subscribe — Оформить подписку (99 Stars/мес.)\n"+
		"/status — Статус подписки\n"+
		"/help — Помощь", kbd)
}

func (b *BotService) handleAuthDeeplink(ctx context.Context, m *TelegramMessage, nonce string) error {
	expiresAt := time.Now().Unix() + loginNonceTTLSec
	dbOK := true
	if _, err := b.A.DB.Exec(ctx,
		`INSERT INTO auth_nonces (nonce, user_id, expires_at) VALUES ($1, $2, $3)
		 ON CONFLICT (nonce) DO UPDATE SET user_id = EXCLUDED.user_id, expires_at = EXCLUDED.expires_at`,
		nonce, strconv.FormatInt(m.From.ID, 10), expiresAt,
	); err != nil {
		dbOK = false
		b.A.Logger.Error("bot auth nonce insert", "err", err)
	}
	if _, err := b.ensureUser(ctx, m); err != nil {
		b.A.Logger.Warn("bot ensureUser auth-deeplink", "err", err)
	}
	_ = b.setChatMenuButton(ctx, m.Chat.ID, b.appURL())

	reply := "<b>BRATAN MUSIC</b>\n\nВход подтверждён. Вернитесь на сайт — авторизация завершится автоматически."
	if !dbOK {
		reply = "<b>BRATAN MUSIC</b>\n\nВременная техническая ошибка авторизации. Попробуйте ещё раз через минуту."
	}
	return b.sendMessage(ctx, m.Chat.ID, reply, nil)
}

func (b *BotService) handleLinkDeeplink(ctx context.Context, m *TelegramMessage, nonce string) error {
	fullName := strings.TrimSpace(strings.TrimSpace(m.From.FirstName) + " " + strings.TrimSpace(m.From.LastName))
	var fullArg any
	if fullName != "" {
		fullArg = fullName
	}
	var usernameArg any
	if m.From.Username != "" {
		usernameArg = m.From.Username
	}

	dbOK := true
	tag, err := b.A.DB.Exec(ctx,
		`UPDATE tg_link_requests SET tg_id = $1, tg_username = $2, tg_name = $3
		 WHERE nonce = $4 AND tg_id IS NULL AND expires_at > $5`,
		strconv.FormatInt(m.From.ID, 10), usernameArg, fullArg,
		nonce, time.Now().Unix(),
	)
	if err != nil {
		dbOK = false
		b.A.Logger.Error("bot tg link nonce write", "err", err)
	} else if tag.RowsAffected() == 0 {
		dbOK = false
	}

	reply := "<b>BRATAN MUSIC</b>\n\nTelegram привязан. Вернитесь на сайт — карточка аккаунта обновится автоматически."
	if !dbOK {
		reply = "<b>BRATAN MUSIC</b>\n\nСсылка для привязки Telegram устарела или некорректна. Откройте сайт и нажмите «Привязать Telegram» ещё раз."
	}
	return b.sendMessage(ctx, m.Chat.ID, reply, nil)
}

func (b *BotService) handleLogin(ctx context.Context, m *TelegramMessage) error {
	if _, err := b.ensureUser(ctx, m); err != nil {
		b.A.Logger.Warn("bot ensureUser login", "err", err)
	}
	_ = b.setChatMenuButton(ctx, m.Chat.ID, b.appURL())
	kbd, _ := b.buildMainKeyboard(ctx, m.From.ID)
	return b.sendMessage(ctx, m.Chat.ID,
		"<b>Вход в BRATAN MUSIC</b>\n\n"+
			"Нажмите «Войти на сайте» — ссылка действует 5 минут и сгорает после первого входа. "+
			"Внутри Telegram можно также открыть «Веб-приложение» — вход произойдёт автоматически.", kbd)
}

func (b *BotService) handleSubscribe(ctx context.Context, m *TelegramMessage) error {
	userID := strconv.FormatInt(m.From.ID, 10)
	subs := Of(b.A).Subs
	active, err := subs.GetActive(ctx, userID)
	if err == nil && active != nil {
		date := time.Unix(active.ExpiresAt, 0).In(moscowTZ()).Format("02.01.2006")
		return b.sendMessage(ctx, m.Chat.ID, fmt.Sprintf("У вас уже есть активная подписка до <b>%s</b>.", date), nil)
	}
	payload := fmt.Sprintf("sub_%s_%d", userID, time.Now().UnixMilli())
	return b.sendInvoice(ctx, m.Chat.ID, payload)
}

func (b *BotService) handleStatus(ctx context.Context, m *TelegramMessage) error {
	userID := strconv.FormatInt(m.From.ID, 10)
	subs := Of(b.A).Subs
	active, err := subs.GetActive(ctx, userID)
	if err != nil {
		b.A.Logger.Warn("bot status getActive", "err", err)
	}
	if active != nil {
		date := time.Unix(active.ExpiresAt, 0).In(moscowTZ()).Format("02.01.2006")
		return b.sendMessage(ctx, m.Chat.ID,
			fmt.Sprintf("<b>Подписка активна</b>\nДействует до: %s", date), nil)
	}
	return b.sendMessage(ctx, m.Chat.ID, "Подписка не активна. Используйте /subscribe для оформления.", nil)
}

func (b *BotService) handleHelp(ctx context.Context, m *TelegramMessage) error {
	return b.sendMessage(ctx, m.Chat.ID,
		"<b>BRATAN MUSIC</b>\n\n"+
			"/start — Начало\n"+
			"/login — Войти на сайте\n"+
			"/app — Открыть веб-приложение\n"+
			"/subscribe — Оформить подписку (99 Stars/мес.)\n"+
			"/status — Статус подписки\n"+
			"/help — Помощь", nil)
}

func (b *BotService) handleAdmin(ctx context.Context, m *TelegramMessage, cmd string) error {
	if !b.isAdmin(m.From.ID) {
		return b.sendMessage(ctx, m.Chat.ID, "Доступ запрещён.", nil)
	}
	parts := strings.Fields(m.Text)

	switch cmd {
	case "/admin_stats":
		var users, subs int
		_ = b.A.DB.QueryRow(ctx, `SELECT COUNT(*) FROM users`).Scan(&users)
		_ = b.A.DB.QueryRow(ctx, `SELECT COUNT(*) FROM subscriptions WHERE status = 'active'`).Scan(&subs)
		return b.sendMessage(ctx, m.Chat.ID,
			fmt.Sprintf("<b>Статистика</b>\n\nПользователей: %d\nАктивных подписок: %d", users, subs), nil)

	case "/admin_grant":
		if len(parts) < 2 {
			return b.sendMessage(ctx, m.Chat.ID, "Использование: /admin_grant {user_id} [дней]", nil)
		}
		targetID := parts[1]
		days := 30
		if len(parts) >= 3 {
			if d, err := strconv.Atoi(parts[2]); err == nil && d > 0 {
				days = d
			}
		}
		auth := Of(b.A).Auth
		user, err := auth.FindUserByID(ctx, targetID)
		if err != nil {
			return err
		}
		if user == nil {
			return b.sendMessage(ctx, m.Chat.ID, fmt.Sprintf("Пользователь %s не найден.", targetID), nil)
		}
		subs := Of(b.A).Subs
		sub, err := subs.ActivateManual(ctx, targetID, days)
		if err != nil {
			return err
		}
		date := time.Unix(sub.ExpiresAt, 0).In(moscowTZ()).Format("02.01.2006")
		displayName := user.TGUsername
		if displayName == "" {
			displayName = targetID
		}
		return b.sendMessage(ctx, m.Chat.ID,
			fmt.Sprintf("Подписка для %s активирована до %s.", displayName, date), nil)

	case "/admin_help":
		return b.sendMessage(ctx, m.Chat.ID,
			"<b>Админ-команды</b>\n\n"+
				"/admin_stats — Статистика\n"+
				"/admin_grant {user_id} [дней] — Выдать подписку\n"+
				"/admin_help — Эта справка", nil)
	}
	return b.sendMessage(ctx, m.Chat.ID, "Неизвестная команда. /admin_help", nil)
}

func (b *BotService) handlePreCheckout(ctx context.Context, q *TelegramPreCheckout) error {
	fromID := strconv.FormatInt(q.From.ID, 10)
	match := subPayloadRE.FindStringSubmatch(q.InvoicePayload)
	if len(match) != 2 ||
		match[1] != fromID ||
		q.Currency != subStarsCurrency ||
		q.TotalAmount != subStarsAmount {
		b.A.Logger.Error("bot rejecting pre_checkout",
			"payload", q.InvoicePayload,
			"fromId", fromID,
			"currency", q.Currency,
			"amount", q.TotalAmount,
		)
		return b.answerPreCheckoutQuery(ctx, q.ID, false, "Неверный счёт")
	}
	return b.answerPreCheckoutQuery(ctx, q.ID, true, "")
}

func (b *BotService) handleSuccessfulPayment(ctx context.Context, m *TelegramMessage) error {
	userID := strconv.FormatInt(m.From.ID, 10)
	txID := m.SuccessfulPayment.TelegramPaymentChargeID

	// Idempotency: Telegram retries successful_payment on
	// timeout. Match by stars_tx_id and bail early if we already
	// granted this exact transaction.
	if txID != "" {
		var existing string
		err := b.A.DB.QueryRow(ctx,
			`SELECT id FROM subscriptions WHERE stars_tx_id = $1 LIMIT 1`, txID,
		).Scan(&existing)
		if err == nil && existing != "" {
			return b.sendMessage(ctx, m.Chat.ID,
				"<b>Подписка уже активирована.</b>\n\n"+
					"Если вы только что заплатили — спасибо! Подписка действует 30 дней.", nil)
		}
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
	}

	if _, err := Of(b.A).Subs.Activate(ctx, userID, "telegram_stars", txID); err != nil {
		return err
	}
	return b.sendMessage(ctx, m.Chat.ID,
		"<b>Подписка активирована!</b>\n\n"+
			"Безлимитный стриминг на 30 дней. Наслаждайтесь музыкой!", nil)
}

// ──────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────

func (b *BotService) ensureUser(ctx context.Context, m *TelegramMessage) (*User, error) {
	tgID := strconv.FormatInt(m.From.ID, 10)
	name := strings.TrimSpace(strings.TrimSpace(m.From.FirstName) + " " + strings.TrimSpace(m.From.LastName))
	return Of(b.A).Auth.UpsertTelegramUser(ctx, tgID, m.From.Username, name)
}

func (b *BotService) isAdmin(id int64) bool {
	target := strconv.FormatInt(id, 10)
	for _, adminID := range b.A.Cfg.TelegramAdminIDs {
		if strings.TrimSpace(adminID) == target {
			return true
		}
	}
	return false
}

func (b *BotService) appURL() string {
	if b.A.Cfg.AppURL != "" {
		return b.A.Cfg.AppURL
	}
	return defaultAppURL
}

func (b *BotService) buildMainKeyboard(ctx context.Context, userID int64) (map[string]any, error) {
	appURL := b.appURL()
	rows := [][]map[string]any{
		{
			{"text": "Открыть веб-приложение", "web_app": map[string]any{"url": appURL}},
		},
	}
	nonce, err := b.createLoginNonce(ctx, userID)
	if err == nil && nonce != "" {
		rows = append(rows, []map[string]any{
			{"text": "Войти на сайте", "url": loginDeeplink(appURL, nonce)},
		})
	}
	rows = append(rows, []map[string]any{
		{"text": "Оформить подписку", "callback_data": "subscribe"},
	})
	return map[string]any{"inline_keyboard": rows}, nil
}

func loginDeeplink(appURL, nonce string) string {
	u, err := url.Parse(appURL)
	if err != nil {
		return appURL + "?auth_nonce=" + nonce
	}
	q := u.Query()
	q.Set("auth_nonce", nonce)
	u.RawQuery = q.Encode()
	return u.String()
}

func (b *BotService) createLoginNonce(ctx context.Context, tgID int64) (string, error) {
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		// Fall back to uuid (which uses crypto/rand internally too).
		return strings.ReplaceAll(uuid.NewString(), "-", ""), nil
	}
	nonce := hex.EncodeToString(buf)
	expiresAt := time.Now().Unix() + loginNonceTTLSec
	if _, err := b.A.DB.Exec(ctx,
		`INSERT INTO auth_nonces (nonce, user_id, expires_at) VALUES ($1, $2, $3)`,
		nonce, strconv.FormatInt(tgID, 10), expiresAt,
	); err != nil {
		b.A.Logger.Error("bot createLoginNonce", "err", err)
		return "", err
	}
	return nonce, nil
}

// moscowTZ returns Europe/Moscow with a UTC+3 fallback when zoneinfo
// isn't available (some minimal Alpine images strip tzdata).
func moscowTZ() *time.Location {
	if loc, err := time.LoadLocation("Europe/Moscow"); err == nil {
		return loc
	}
	return time.FixedZone("MSK", 3*60*60)
}

// ──────────────────────────────────────────────────────────────────
// Telegram client
// ──────────────────────────────────────────────────────────────────

func (b *BotService) call(ctx context.Context, method string, body map[string]any) error {
	buf, _ := json.Marshal(body)
	url := fmt.Sprintf("%s/bot%s/%s", telegramAPIBase, b.A.Cfg.TelegramBotToken, method)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(buf))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	res, err := b.http.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		raw, _ := io.ReadAll(res.Body)
		b.A.Logger.Error("Telegram API error", "method", method, "status", res.StatusCode, "body", string(raw))
		return fmt.Errorf("telegram %s: %d", method, res.StatusCode)
	}
	// Drain so the connection can be reused.
	_, _ = io.Copy(io.Discard, res.Body)
	return nil
}

func (b *BotService) sendMessage(ctx context.Context, chatID int64, text string, replyMarkup map[string]any) error {
	body := map[string]any{
		"chat_id":    chatID,
		"text":       text,
		"parse_mode": "HTML",
	}
	if replyMarkup != nil {
		body["reply_markup"] = replyMarkup
	}
	return b.call(ctx, "sendMessage", body)
}

func (b *BotService) answerCallbackQuery(ctx context.Context, id, text string) error {
	body := map[string]any{"callback_query_id": id}
	if text != "" {
		body["text"] = text
	}
	return b.call(ctx, "answerCallbackQuery", body)
}

func (b *BotService) answerPreCheckoutQuery(ctx context.Context, id string, ok bool, errMsg string) error {
	body := map[string]any{
		"pre_checkout_query_id": id,
		"ok":                    ok,
	}
	if errMsg != "" {
		body["error_message"] = errMsg
	}
	return b.call(ctx, "answerPreCheckoutQuery", body)
}

func (b *BotService) sendInvoice(ctx context.Context, chatID int64, payload string) error {
	return b.call(ctx, "sendInvoice", map[string]any{
		"chat_id":     chatID,
		"title":       "BRATAN MUSIC — Подписка",
		"description": "Безлимитный стриминг на 30 дней",
		"payload":     payload,
		"currency":    subStarsCurrency,
		"prices":      []map[string]any{{"label": "Подписка 30 дней", "amount": subStarsAmount}},
	})
}

func (b *BotService) setChatMenuButton(ctx context.Context, chatID int64, appURL string) error {
	return b.call(ctx, "setChatMenuButton", map[string]any{
		"chat_id": chatID,
		"menu_button": map[string]any{
			"type":    "web_app",
			"text":    "Открыть BRATAN MUSIC",
			"web_app": map[string]any{"url": appURL},
		},
	})
}
