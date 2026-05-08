# Worker (`/worker/src`)

Cloudflare Worker на Hono 4. Edge-backend: REST API + Telegram webhook +
Durable Objects (per-room WS) + cron (recommendation jobs).

## Дерево директорий

```
worker/src/
├── index.ts                    Hono root + cron handler + DO re-export
├── cron.ts                     scheduled jobs orchestrator
├── routes/                     19 файлов, по resource
├── services/                   бизнес-логика (доменные сервисы)
│   └── tidal/                  Tidal-интеграция (auth, api, web fallback, pool)
├── middleware/                 cors / rateLimit / auth (jwtAuth, adminOnly)
├── do/                         Durable Objects (ChatRoomDO)
├── bot/                        Telegram bot webhook handlers + commands
├── db/
│   ├── schema.sql              snapshot текущей схемы
│   └── migrations/             24 D1 migration файла
└── types/                      Env, Variables, music
```

## `index.ts` (entry)

- Hono с `<{ Bindings: Env, Variables: Variables }>`
- Глобальные middleware: `corsMiddleware`, `rateLimit`
- `/health` (status: ok), `/health/tidal` (без эха токена)
- `app.route()` для каждого resource (см. ниже)
- `notFound` и `onError` — никогда не отдают `error.message` клиенту;
  логируется только в `console.error`
- `export default { fetch, scheduled }` — Workers entry
- `export { ChatRoomDO } from './do/ChatRoomDO'` — DO регистрация

## Routes (`worker/src/routes/`)

| Файл | Mounted at | Что делает |
| --- | --- | --- |
| `auth.ts` | `/auth` | Telegram WebApp HMAC verification, JWT issue/refresh, deeplink-login (5-min nonce), logout. |
| `user.ts` | `/user` | `me`, settings (crossfade / EQ / theme / language / quality / tour-state), avatar, daily-listen quota. |
| `search.ts` | `/search` | Tidal search (всё/треки/альбомы/артисты/плейлисты). |
| `tracks.ts` | `/tracks` | Track metadata, stream URL, lyrics. |
| `covers.ts` | `/covers` | Cover proxy + cache. |
| `albums.ts` | `/albums` | Album metadata, tracks. |
| `artists.ts` | `/artists` | Artist metadata, top tracks, albums, singles. |
| `playlists.ts` | `/playlists` | CRUD, добавить/удалить трек, переименовать, share token, переупорядочивание. |
| `library.ts` | `/library` | Likes (track / album / artist) + listing. |
| `overrides.ts` | `/tracks` (mounted дважды — для override эндпоинтов) | Track override: загрузить свой файл вместо Tidal-трека. |
| `uploads.ts` | `/uploads` | Кастомные user-uploads (custom tracks). |
| `webhook.ts` | `/webhook` | Telegram bot webhook (POST). HMAC verify. |
| `admin.ts` | `/admin` | Admin-only: Tidal pool, user lookup, ban/unban, grant subscription, health, log ring. |
| `explore.ts` | `/explore` | Tidal homepages (mood / genre / "what's new"). |
| `recommendations.ts` | `/recommendations` | Personalized recommendations (taste vector + radio). |
| `dailyPlaylists.ts` | `/daily-playlists` | "Плейлист дня" — список / preview / mark seen. |
| `history.ts` | `/history` | Listening history (read + clear). |
| `rooms.ts` | `/rooms` | Listening rooms — create / join / leave / kick / control / chat. |
| `aiPlaylists.ts` | `/ai/playlists` | On-demand AI playlist generation через Yandex GPT. |

## Services (`worker/src/services/`)

| Файл | Зона ответственности |
| --- | --- |
| `AuthService.ts` | JWT signing + verification (HS256 через WebCrypto), refresh-token rotation, hash refresh tokens перед записью в D1, single-use 5-min auth nonces. |
| `UserService.ts` | Users CRUD, `isAdmin`, `daily_listens` (free-tier 3-track quota), bans. |
| `SubscriptionService.ts` | Telegram Stars activation: idempotent по `telegram_payment_charge_id`, manual grant из админки. |
| `StorageService.ts` | R2 uploads + key generation (`^[a-zA-Z0-9_-]{1,64}$`, без path-traversal). |
| `RoomService.ts` | Listening rooms: state, members, controls, chat. Server-anchored time, monotonic version. |
| `AiPlaylistService.ts` | Yandex GPT → search-query expansion → Tidal fanout → формирование плейлиста. |
| `RecommendationService.ts` | Daily playlist generator (cron): taste-вектор × candidate pool × seen-list → плейлист дня. |
| `TasteService.ts` | `user_taste_profile`, `user_dislikes` — feature vectors. |
| `DailyPlaylistService.ts` | Сборка/отдача дневных плейлистов, mark seen. |
| `HealthService.ts` | D1/KV/R2 probes, log ring buffer, для админ-панели. |
| `dislikes.ts` | API + queries для dislike-системы. |
| `streamCache.ts` | Memo stream-URL + Cache API (с воркараундом для `*.workers.dev` без Cache API). |

### Tidal (`worker/src/services/tidal/`)

| Файл | Назначение |
| --- | --- |
| `TidalAuth.ts` | OAuth + device flow + refresh + multi-account pool. |
| `TidalApi.ts` | Low-level: search, album, artist, page, track. |
| `TidalWeb.ts` | Web fallback (cookie-scrape) для unrouted endpoints. |
| `TidalPool.ts` | Multi-account sub rotation (горизонтальное масштабирование). |
| `TidalService.ts` | High-level mapping → domain `Track` / `Album` / ... |
| `sessionCrypto.ts` | AES-GCM at rest для session token. |

## Middleware (`worker/src/middleware/`)

| Файл | Что делает |
| --- | --- |
| `cors.ts` | Strict allowlist (без `*`), preflight handling. |
| `rateLimit.ts` | Per-IP + per-user (KV-based). Whitelist для room-stream. |
| `auth.ts` | `jwtAuth` (verify HS256, проверка ban из D1 на каждом запросе), `adminOnly` (re-check `is_admin` из D1). |

## Durable Objects (`worker/src/do/`)

| Файл | Назначение |
| --- | --- |
| `ChatRoomDO.ts` | Per-room WS broadcast hub. Stateless (`Set<WebSocket>`). D1 — источник правды для chat history. На Free-плане Cloudflare использует SQLite-backed DO (`new_sqlite_classes`). |

Адресация: `env.CHAT_ROOM.idFromName(roomId)`.

## Bot (`worker/src/bot/`)

См. [[../telegram-bot/index|telegram-bot]].

## Cron (`worker/src/cron.ts`)

`runScheduledJobs(env)` — оркестратор для cron-trigger'а из
`wrangler.toml` (`30 4 * * *` UTC). Внутри:

1. Recompute taste vectors для активных пользователей.
2. Регенерация "Плейлиста дня" для каждого активного.
3. GC stale entries (recommendation_seen за пределами 30 дней).

## DB (`worker/src/db/`)

См. [[../data/index|data]].

## Types (`worker/src/types/`)

| Файл | Что внутри |
| --- | --- |
| `env.ts` | `Env` (Cloudflare bindings + secrets) + `Variables` (Hono context: `userId`, `isAdmin`). |
| `music.ts` | Worker-side music DTO. |

## Wrangler config (`worker/wrangler.toml`)

- `name = "bratan-music-api"`
- `compatibility_date = "2024-12-01"`
- Cron: `30 4 * * *`
- Bindings: `DB` (D1), `SESSIONS` (KV), `TRACKS` (R2), `CHAT_ROOM` (DO)
- DO migrations: `new_sqlite_classes = ["ChatRoomDO"]` (tag `v1-chat-room-do`)
- Secrets — через `wrangler secret put` (см. `.env.example` и
  `worker/wrangler.toml` хвост).
