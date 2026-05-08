# Context

Глобальная информация о проекте, бизнес-логика, продуктовые требования и
внешние ссылки.

## Что такое BRATAN MUSIC

Serverless музыкальный плеер, живущий **внутри Telegram**, стримит
**lossless / HiRes** через Tidal, целиком на edge-инфре Cloudflare.
Подписка — **99 Telegram Stars / месяц** ($1.50 ≈), оплата с баланса
Telegram. Логин в один тап через Telegram WebApp. PWA, ставится на
домашний экран в один тап.

UX как у Spotify, звук как у Tidal, онбординг как у Telegram, надёжность
как у Cloudflare. Серверов — ноль.

### Ключевые продуктовые фишки

| Подсистема | Что даёт пользователю |
| --- | --- |
| **Audio engine** | Двухслотный HTML5 Audio + Web Audio API, гэплесс, sample-accurate кроссфейд, 10-band параметрический EQ, лестница качества `LOW`→`HIGH`→`LOSSLESS`→`HI_RES_LOSSLESS` с прозрачным fallback'ом, FFT-визуализатор, fullscreen-плеер с TiltCard, синхронизированная лирика. |
| **Library** | Свои плейлисты (cover + share-token), Tidal curator-плейлисты как `source_kind = 'tidal'`, лайки на треки/альбомы/артистов, кастомные загрузки в R2 (50 MB cap), track override (премиум: своя версия Tidal-трека). |
| **AI playlists** | Дневной cron `30 4 * * *` UTC, "Плейлист дня" для каждого пользователя по taste-вектору; on-demand AI-плейлист через Yandex AI Studio (`gpt-oss-120b`), seen-list 30 дней, track radio. |
| **Listening rooms** | До 32 человек, sync через Cloudflare Durable Object (`ChatRoomDO`), server-anchored time + monotonic version, чат с D1-историей, anti-abuse stream proxy. |
| **Auth** | Telegram WebApp HMAC-SHA256 верификация `initData`, JWT-пара 1h/30d, refresh-token hashing в D1, ротация на каждом refresh, single-use 5-min nonce для deeplink-логина. |
| **Subscription** | Telegram Stars, идемпотентная активация по `telegram_payment_charge_id`, free-tier — 3 уникальных трека/день. |
| **Admin panel** | `/admin/*` — Tidal session pool, multi-account rotation, user lookup, grant/revoke, health probes, log ring buffer. |

### Доменные ограничения

- **Tidal credentials** — reverse-engineered с tidal.com (см. [`worker/docs/tidal-api-research.md`](../../worker/docs/tidal-api-research.md)).
  Соблюдение Tidal ToS — на операторе.
- **Лицензия — source-available**, не open-source. Запрещён форк / mirror /
  деривативы / использование как training data / hosting для третьих лиц.
  См. [`LICENSE`](../../LICENSE).
- **R2 50 MB cap** на upload — для бесплатного тира Cloudflare.
- **D1 free tier** — учитывай размер запросов и количество строк.

## Стек (краткая сводка)

### Frontend (`/`)
React 18, Vite 6, TypeScript 5.7 (strict), Tailwind 3.4 + SCSS, Zustand 5,
TanStack Query 5, React Router 6, motion (Framer Motion 12), lucide-react,
vite-plugin-pwa + Workbox 7, `@radix-ui/react-slot` + custom shadcn-style UI.

### Worker (`worker/`)
Cloudflare Workers, Hono 4, D1 (SQLite), KV, R2, Durable Objects
(SQLite-backed), Yandex AI Studio (`gpt-oss-120b`).

### Auth & Crypto
JWT HS256 (WebCrypto), HMAC-SHA256 для Telegram, AES-GCM at rest для Tidal
session, SHA-256 для refresh-token hash.

Полный список — в [[stack|stack.md]].

## CI / CD

- `.github/workflows/ci.yml` — lint + typecheck + build на каждом PR
- `.github/workflows/deploy-pages.yml` — деплой `/` на GitHub Pages при push
  в `main`
- `.github/workflows/deploy-worker.yml` — `wrangler deploy` при push в `main`
  с `paths: worker/**`
- `.github/workflows/apply-d1-migrations.yml` — применение D1-миграций

## Полезные ссылки

- Live App: <https://bratan-corp.github.io/bratan-music/>
- Telegram Bot: <https://t.me/bratan_music_bot>
- API: <https://bratan-music-api.bratan-corp.workers.dev>
- Tidal API research: [`worker/docs/tidal-api-research.md`](../../worker/docs/tidal-api-research.md)
- README (двуязычный): [`README.md`](../../README.md)
- Refactor progress (исторический): [`REFACTOR_PROGRESS.md`](../../REFACTOR_PROGRESS.md)
