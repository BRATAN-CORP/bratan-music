# API (Go) — `/api-go`

Go-порт бекенда, который постепенно замещает [`/worker/`](../worker/).
Запускается отдельным контейнером `api-go` на порту 3001 рядом с
TS-сервисом до тех пор, пока не достигнет paritynt-я. После cut-over —
становится единственным backend'ом, nginx переключается на `api-go:3000`,
директория `worker/` удаляется.

См. [`api-go/STATUS.md`](../../../api-go/STATUS.md) — живой статус
по каждому маршруту.

## Зачем переписываем

- Бинарный single-binary deploy, без npm-runtime / esbuild bundle.
- Меньше cold-start surface (Hono → chi, ws → coder/websocket, pg → pgx).
- Строгие типы на DB-границе вместо `as any` casts.
- Возможность кросс-инстансной синхронизации WS-комнат через Redis pub/sub
  без миграции на Durable Objects.

## Дерево директорий

```
api-go/
├── cmd/api/             entrypoint (main.go) — config load → DB/Redis/MinIO
│                        → migrations → router → http.Server → cron loop
├── internal/
│   ├── app/             *app.App контейнер зависимостей (DB, Redis, Store,
│   │                    Cfg, Logger, + late-bound сервисы как any)
│   ├── authz/           JWT (HS256, sid claim, AccessTTL=1h / RefreshTTL=30d),
│   │                    Telegram WebApp HMAC verify, session AES-GCM
│   ├── config/          Load() из env, требует JWT/SESSION/TELEGRAM_*
│   ├── db/              pgxpool wrapper (Open, Query, Exec, Begin)
│   ├── httpx/           JSON / Err / Internal / NotFound / BindJSON /
│   │                    request-scoped context (UserID / IsAdmin / SessionID)
│   ├── middleware/      CORS (allow-list) / RateLimit (IP 200/min + user
│   │                    600/min via Redis IncrWithTTL) / JWTAuth (verify +
│   │                    ban + min_token_iat + session row) / AdminOnly
│   ├── migrations/      embedded *.sql + on-disk loader (worker/src/db/migrations),
│   │                    идемпотентно через `d1_migrations` таблицу
│   ├── redisx/          go-redis v9 wrapper + IncrWithTTL helper
│   ├── router/          Wire() — собирает все сервисы;
│   │                    Build() — chi mux, 19 mount points;
│   │                    RunCronLoop — 04:30 UTC daily
│   ├── routes/          один файл на ресурс (auth / user / history /
│   │                    playlists / library / search / tracks / ...) —
│   │                    либо реальные хендлеры, либо 501-стабы
│   ├── services/        AuthService / UserService / SubscriptionService /
│   │                    SessionService / EmailOtpService / BrevoService /
│   │                    HistoryService / PlaylistService / LibraryService /
│   │                    HealthService / TidalService / TasteService /
│   │                    RecommendationService / DailyPlaylistService /
│   │                    AIPlaylistService / RoomService / BotService
│   └── storage/         MinIO Put/Get/Delete/PresignGet + ensureBucket
├── Dockerfile           multi-stage: alpine builder → alpine:3.20 runtime
│                        (CGO=0, -trimpath -ldflags="-s -w")
└── go.mod               chi/v5, pgx/v5, go-redis/v9, minio-go/v7,
                         coder/websocket, golang-jwt/v5, google/uuid
```

## Hard constraints (что нельзя сломать)

- Telegram WebApp HMAC — алгоритм бит-в-бит как в TS (`internal/authz/telegram.go`,
  юнит-тесты на положительный кейс / tampered hash / stale auth_date).
- JWT iat / min_token_iat — после logout-all все access-токены, выписанные
  до `nowSec()`, должны отклоняться.
- Refresh rotation — refresh-токен можно использовать ровно один раз;
  старый hash в `sessions` вытесняется новым.
- Telegram Stars billing — идемпотентно по `telegram_payment_charge_id`.
- CORS — allow-list, без `*`, без `null`.
- SQL — только параметризованные запросы (pgx плейсхолдеры `$1, $2, ...`).
