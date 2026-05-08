# Telegram Bot (`/worker/src/bot`)

Telegram-бот реализован **внутри Cloudflare Worker** как webhook
handler. Standalone-сервиса нет. Корневой `bot/index.ts` — пустой stub
для возможного будущего standalone.

## Дерево

```
worker/src/bot/
├── index.ts                    handleUpdate(update, env, ctx) — диспатчер
├── telegram.ts                 typed Telegram Bot API client (sendMessage, sendInvoice, ...)
├── types.ts                    Telegram Update / Message / CallbackQuery / PreCheckout / SuccessfulPayment
└── commands/
    ├── start.ts                /start (включая deep-link с auth nonce → выдача single-use ссылки в WebApp)
    ├── subscribe.ts            /subscribe → sendInvoice (Telegram Stars), pre_checkout_query, successful_payment
    └── admin.ts                /admin (panel-link), /grant, /revoke, /stats — только для TELEGRAM_ADMIN_IDS
```

## Webhook entrypoint

`worker/src/routes/webhook.ts` принимает `POST /webhook/telegram`,
проверяет `X-Telegram-Bot-Api-Secret-Token = TELEGRAM_WEBHOOK_SECRET`,
парсит `Update` и зовёт `handleUpdate(update, env, ctx)`.

## Команды

### `/start [nonce]`

- Без аргумента — приветствие + кнопка "Открыть BRATAN" (deep-link на
  WebApp).
- С `?start=<nonce>` — deep-link login. Nonce валиден 5 минут, single-
  use, хранится в `auth_nonces` (D1). После consume — выдаём JWT.

### `/subscribe`

- `sendInvoice` на 99 Telegram Stars / 30 дней.
- На `pre_checkout_query` валидация:
  - `currency === 'XTR'`
  - `total_amount === 99`
  - `invoice_payload` содержит ожидаемый формат
- `answerPreCheckoutQuery` с `ok: true` ИЛИ с `error_message`.
- На `successful_payment` — идемпотентная активация через
  `SubscriptionService.activate()` по `telegram_payment_charge_id`.

### `/admin*`

- `/admin` — ссылка на админ-панель (frontend `/admin`).
- `/grant @user 30` — гранд subscription без оплаты (для тестов /
  поддержки).
- `/revoke @user` — отзыв.
- `/stats` — мини-сводка: пользователи, активные подписки, выручка.

Гейт по `TELEGRAM_ADMIN_IDS` (csv) из env.

## Telegram WebApp integration (`src/hooks/useAuth.ts`)

Frontend читает `window.Telegram.WebApp.initData`, посылает на
`POST /auth/telegram`. Worker делает HMAC-SHA256 от key, проверяет
`auth_date` (24h max age, 5min skew), извлекает `user`, выдаёт
JWT-пару.

## Stars billing — детали

- `currency = "XTR"` (Telegram Stars).
- 99 ⭐ ≈ $1.50 на момент написания.
- В D1 — таблица `subscriptions` с `telegram_payment_charge_id`
  (UNIQUE) для идемпотентности.
- `expires_at = activated_at + 30 days`. На expire — `cron` (опц.)
  переключает на `expired`.

## Ссылки

- Webhook setup curl: см. README → "Set the Telegram webhook"
- Bot username: `@bratan_music_bot` (env `TELEGRAM_BOT_USERNAME`)
- Stars invoice docs: <https://core.telegram.org/bots/payments-stars>
