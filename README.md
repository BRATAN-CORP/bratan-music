# BRATAN MUSIC

Музыкальный стриминг с интеграцией Tidal, авторизацией через Telegram и
оплатой подписки в Telegram Stars. Полностью serverless: фронт на
GitHub Pages, бэкенд на Cloudflare Workers, всё хранилище — в инфре
Cloudflare (D1 / KV / R2).

| Среда | URL |
| --- | --- |
| App (PWA) | https://bratan-corp.github.io/bratan-music/ |
| API | https://bratan-music-api.bratan-corp.workers.dev |
| Telegram-бот | webhook на `/webhook/telegram` (тот же worker) |

## Что умеет

### Плеер

- HTML Audio + Web Audio API: два `<audio>`-слота через общий
  signal-chain (`MediaElementAudioSourceNode → BiquadFilter ×N → AnalyserNode → Destination`).
  Два слота нужны для **гэплесс-кроссфейда** между треками — пока
  один доигрывает, второй уже заряжен и ramp-ом меняем gain.
- Поддерживаемые качества Tidal: `LOW`, `HIGH`, `LOSSLESS`,
  `HI_RES_LOSSLESS`. Если выбранное качество недоступно для конкретного
  трека (региональные ограничения / FLAC отсутствует) — автоматический
  fallback вниз по цепочке `HI_RES_LOSSLESS → LOSSLESS → HIGH → LOW`.
- 10-band параметрический эквалайзер с пресетами и ручной настройкой
  каждой полосы (`useAudioPlayer` + `Equalizer.tsx`).
- Очередь (`queue`), shuffle, repeat one / repeat all, перетаскивание
  треков в очереди, история проигрывания.
- Cross-tab sync через `BroadcastChannel`: пауза в одной вкладке —
  пауза в остальных, переключение трека синхронно (`usePlaybackSync`).
- Полноэкранный плеер с TiltCard-обложкой (3D-перспектива на десктопе),
  Marquee-прокруткой длинных названий, скрытыми тач-свайпами для
  переключения треков, синхронизированными лириксами и аудио-визуализатором.
- Mini-плеер на десктопе (нижняя панель) и mobile-bottom-dock на телефонах.
- Media Session API: системные кнопки play/pause/next/prev в локскрине
  / на наушниках / в Control Center.

### Библиотека

- Свои плейлисты: создание, переименование, обложка (загрузка картинки
  + автоматический resize / WebP), пин в топ списка, drag-reorder треков,
  share по публичной ссылке (`/p/:token`).
- Сохранённые плейлисты других пользователей (по share-ссылке) и
  Tidal-кураторские плейлисты — хранятся как **linked** строки
  (`source_kind = 'user' | 'tidal'`). Read-only: переименовать, поменять
  обложку и менять состав нельзя ни на сервере, ни в UI; «удалить» убирает
  только локальную ссылку из библиотеки, оригинал остаётся.
- Лайки треков, альбомов и артистов (`library_items`), отдельная страница
  «Моя медиатека».
- **Загрузка собственных треков** в R2 с метаданными (название / артист /
  альбом / обложка / длительность). Обращаются как `upload:<uuid>` и
  работают в плейлистах / очереди / лайках наравне с Tidal-треками.
- **Override** для Tidal-треков: пользователь может загрузить свой файл
  поверх Tidal-трека (например, своя более качественная версия), и
  плеер начнёт стримить из R2 вместо CDN Tidal.

### Поиск и Discover

- Поиск по трекам / альбомам / артистам через Tidal API.
- Фильтры по типу результата, история недавних поисков.
- Explore: главная страница с кураторскими модулями Tidal (страницы по
  жанрам / эпохам / настроениям), переходы на отдельные explore-страницы
  по slug (`/explore/:slug`) и Tidal-плейлисты по UUID
  (`/explore/playlist/:uuid`).
- Странички треков, альбомов, артистов с похожими и переходом в
  «трек-радио» (контекстная очередь от выбранного трека).

### Авторизация

- **Telegram Login** через WebApp (`window.Telegram.WebApp`) или
  deeplink на `bratan_music_bot` с одноразовым `nonce`.
- JWT-пара: access (1 час) + refresh (30 дней). Refresh захэширован
  и хранится в таблице `sessions`, что позволяет инвалидировать
  конкретный девайс.
- Middleware `jwtAuth` принимает и `Authorization: Bearer ...`, и
  `?token=` (для тегов `<audio>` / `<video>` которые не умеют слать
  кастомные заголовки).

### Подписка

- Бесплатный тир: **3 трека в сутки** (`daily_listens`).
- Платная подписка: **99 ⭐ Stars в месяц** через Telegram Payments.
  Поток: бот шлёт `sendInvoice` → Telegram callback `pre_checkout_query`
  → `successful_payment` → worker активирует `subscriptions.status='active'`
  на 30 дней.
- Админ может выдать ручную подписку (`/admin/grant`), любой
  длительности.

### Telegram-бот

- Запущен **внутри того же Cloudflare Worker** (webhook), не отдельный процесс.
  Telegram → `POST /webhook/telegram` → проверка `X-Telegram-Bot-Api-Secret-Token`
  → `executionCtx.waitUntil(handleBotUpdate(...))` чтобы Telegram не ретраил.
- Команды: `/start` (логин-deeplink), `/subscribe` (открыть инвойс),
  `/admin` (управление подписками — только для `TELEGRAM_ADMIN_IDS`).

### Админ-панель

- Внутри приложения (`/admin/*`-роуты + `<AdminTidalPanel>`):
  - Поиск пользователя, выдача / отзыв подписки.
  - Статус сессии Tidal, ручной refresh токена, device-flow re-auth.
  - Логаут Tidal-сессии.

### PWA

- `vite-plugin-pwa` + Workbox. Установка как stand-alone приложение,
  precache манифеста + статики, `registerType: 'autoUpdate'`.
- Offline shell: кешируется фронт, всё что обращается к API
  возвращает онлайн-only ошибки (Tidal CDN не кешируется намеренно).

### UX-детали

- Тёмная / светлая тема через CSS-переменные, без flash-of-light.
- Tailwind с `hoverOnlyWhenSupported` — `hover:` оборачивается в
  `@media (hover: hover)`, чтобы тач-устройства не залипали в hover-состоянии
  после тапа.
- Page transitions через `motion` (бывший Framer Motion 12).
- LiquidGlassButton с SVG-фильтром для glassmorphism-кнопок.
- Cyrillic-friendly typography: clip-path на Marquee пропускает
  ascender'ы и descender'ы вертикально, обрезая только горизонтально.

## Стек

| Слой | Технология |
| --- | --- |
| Фронтенд | React 18, Vite 6, TypeScript 5.7 |
| UI | shadcn/ui-style примитивы, Tailwind CSS 3.4, SCSS-токены |
| Стейт | Zustand 5 (с `persist`-middleware), TanStack Query 5 |
| Анимации | motion (12.x), Web Animations API |
| Роутинг | React Router 6, basename `/bratan-music` для GitHub Pages |
| Иконки | lucide-react |
| Бэкенд | Cloudflare Workers, Hono 4 |
| База | Cloudflare D1 (SQLite) |
| KV | Cloudflare KV (Tidal-сессия, rate-limit, auth-nonce) |
| Файлы | Cloudflare R2 (загрузки + override-файлы) |
| Telegram | Webhook + Telegram Stars (`sendInvoice`/`successfulPayment`) |
| PWA | vite-plugin-pwa, Workbox |
| Деплой фронта | GitHub Pages (`actions/deploy-pages@v4`) |
| Деплой бэка | Wrangler 4 (`wrangler deploy` в GitHub Actions) |
| CI | GitHub Actions: lint + typecheck + build на каждом PR |

## Структура репозитория

```
.
├── src/                                  фронтенд
│   ├── app/                              страницы (router-рутируемые)
│   │   ├── router.tsx                    createBrowserRouter, basename=/bratan-music
│   │   ├── landing/, search/, library/, profile/
│   │   ├── playlist/, shared/            свои + share-by-token
│   │   ├── explore/                      Tidal discover (slug + uuid)
│   │   ├── track/, album/, artist/
│   │   └── library/uploads/              менеджер своих загрузок
│   ├── components/
│   │   ├── layout/                       Sidebar, Player, FullscreenPlayer,
│   │   │                                 MobileBottomDock, SwipeTrackStrip
│   │   ├── features/                     PlaylistCard, TrackItem, SearchBar,
│   │   │                                 SearchResults, AddToPlaylistDialog,
│   │   │                                 RenamePlaylistDialog, SubscriptionDialog,
│   │   │                                 AdminTidalPanel, Equalizer,
│   │   │                                 LyricsPanel, Visualizer, …
│   │   └── ui/                           Button, Card, Input, PopoverMenu,
│   │                                     Marquee, TiltCard, Aurora,
│   │                                     PageTransition, liquid-glass-button
│   ├── hooks/                            useAudioPlayer (двухслотный движок),
│   │                                     useAuth, useLibrary, useSearch,
│   │                                     useExplore, usePlaybackSync,
│   │                                     useTrack, useUploads, useShare, …
│   ├── store/                            Zustand: player / auth / settings / ui
│   ├── lib/                              api клиент, motion-presets, image-resize,
│   │                                     tidal-image, trackActions, trackRadio
│   ├── types/                            публичные доменные типы (Track, Playlist, …)
│   ├── styles/                           globals.scss + design-tokens
│   └── main.tsx                          QueryClientProvider + StrictMode
│
├── worker/                               Cloudflare Worker
│   ├── src/
│   │   ├── index.ts                      Hono root, /health, /health/tidal
│   │   ├── routes/                       auth, user, search, tracks, albums,
│   │   │                                 artists, playlists, library, explore,
│   │   │                                 overrides, uploads, admin, webhook
│   │   ├── services/
│   │   │   ├── AuthService.ts            JWT, refresh-rotation, sessions
│   │   │   ├── UserService.ts            users CRUD, isAdmin, daily_listens
│   │   │   ├── SubscriptionService.ts    активная подписка, активация, manual grant
│   │   │   ├── StorageService.ts         R2 загрузка + signed-URL генерация
│   │   │   └── tidal/
│   │   │       ├── TidalAuth.ts          OAuth + device-flow + refresh
│   │   │       ├── TidalApi.ts           low-level API (search/album/artist/page)
│   │   │       ├── TidalWeb.ts           web fallback (cookies/scrape)
│   │   │       └── TidalService.ts       высокий уровень: маппинг raw → Track/Album/…
│   │   ├── middleware/                   cors, rateLimit, jwtAuth, adminOnly
│   │   ├── bot/                          Telegram webhook handler (start, subscribe, admin)
│   │   ├── db/migrations/                10 миграций (init → source_track_count)
│   │   └── types/                        Env (Cloudflare bindings) + Variables
│   ├── wrangler.toml                     bindings (DB / SESSIONS / TRACKS), secrets-список
│   └── package.json
│
├── bot/                                  legacy stub (живой бот — внутри worker/)
├── public/                               статика для PWA (404, иконки)
├── .github/workflows/                    ci / deploy-pages / deploy-worker /
│                                         apply-d1-migrations
├── .env.example                          список всех переменных окружения
└── eslint.config.mjs                     flat ESLint config
```

## API

Все ответы — JSON. Все защищённые маршруты требуют `Authorization: Bearer <accessToken>`
или `?token=<accessToken>` в query-string (для `<audio>`-элементов).

| Группа | Эндпоинты |
| --- | --- |
| Auth | `POST /auth/telegram` &middot; `GET /auth/nonce/:nonce` &middot; `POST /auth/refresh` |
| User | `GET /user/me` &middot; `GET /user/limits` |
| Search | `GET /search?q=...&type=...` |
| Tracks | `GET /tracks/:id` &middot; `GET /tracks/:id/lyrics` &middot; `GET /tracks/:id/stream?quality=...` &middot; `GET /tracks/:id/download` &middot; `GET /tracks/:id/file` &middot; `GET /tracks/:id/radio` &middot; `GET /tracks/audio` |
| Albums | `GET /albums/:id` |
| Artists | `GET /artists/:id` |
| Explore | `GET /explore` &middot; `GET /explore/page/:slug` &middot; `GET /explore/playlists/:uuid/tracks` |
| Library | `GET /library/playlists` &middot; `GET /library/liked` &middot; `GET /library/likes/ids` &middot; `POST/DELETE /library/like/:trackId` &middot; `GET /library/like/:trackId` &middot; `POST/DELETE /library/items/:type/:itemId` &middot; `GET /library/items/:type[/ids]` |
| Playlists | `GET/POST /playlists` &middot; `GET/PUT/DELETE /playlists/:id` &middot; `PUT/DELETE /playlists/:id/cover` &middot; `PUT /playlists/:id/pin` &middot; `POST /playlists/:id/tracks` &middot; `PUT /playlists/:id/reorder` &middot; `DELETE /playlists/:id/tracks/:trackId` &middot; `PUT /playlists/:id/share` &middot; `POST /playlists/external/tidal` &middot; `GET /playlists/shared/:token` &middot; `POST /playlists/shared/:token/save` |
| Overrides | `PUT/DELETE/GET /tracks/:id/override` &middot; `GET /tracks/:id/override/stream` |
| Uploads | `GET/POST /uploads` &middot; `GET/PUT/DELETE /uploads/:id` &middot; `PUT /uploads/:id/file` &middot; `GET /uploads/:id/stream` |
| Admin | `POST /admin/grant` &middot; `GET /admin/users/search` &middot; `GET /admin/tidal/status` &middot; `POST /admin/tidal/refresh-token` &middot; `POST /admin/tidal/device/{start,poll}` &middot; `POST /admin/tidal/logout` |
| Webhook | `POST /webhook/telegram` |
| Health | `GET /health` &middot; `GET /health/tidal` |

## База данных

D1 (SQLite). 10 миграций в `worker/src/db/migrations/`:

| # | Описание |
| --- | --- |
| 0001 | `users`, `subscriptions`, `daily_listens`, `playlists`, `playlist_tracks`, `track_overrides`, `sessions` |
| 0002 | `track_snapshots` (название/артист/обложка кэшируются для лайков чтобы не дёргать Tidal на каждый рендер либы) |
| 0003 | `auth_nonces` (для deeplink-логина бота) |
| 0004 | `playlists.cover_r2_key` (кастомные обложки в R2) |
| 0005 | `tidal_session` (миграция KV → колонки в D1, потом откачен, реальная сессия живёт в KV `tidal:session`) |
| 0006 | `playlists.pinned_at` |
| 0007 | `user_tracks` (R2-загруженные треки с источником `source='upload'`) |
| 0008 | `library_items` (лайки альбомов и артистов в одной таблице по `type`) |
| 0009 | `playlists.is_public / share_token / source_kind / source_playlist_id / source_user_id` (publish + linked-плейлисты) |
| 0010 | `playlists.source_track_count` (кэш количества треков для linked-плейлистов) |

Применение на удалённой D1 — workflow **Apply D1 Migrations**
(`.github/workflows/apply-d1-migrations.yml`) запускается автоматически
на push в `main` если изменились файлы в `worker/src/db/migrations/`,
или вручную: GitHub → Actions → "Apply D1 Migrations" → Run workflow.

## Cloudflare bindings

Из `worker/wrangler.toml`:

| Binding | Тип | Назначение |
| --- | --- | --- |
| `DB` | D1 | основная база (`bratan-music-db`) |
| `SESSIONS` | KV | Tidal OAuth-сессия, rate-limit-счётчики, auth-nonces |
| `TRACKS` | R2 | объекты пользовательских загрузок и override-файлов |

Секреты задаются через `wrangler secret put <NAME>` — список в
`wrangler.toml` (строки начинающиеся с `# Secrets`).

## Локальная разработка

### Требования

- Node.js 20+
- npm 10+
- (опционально) `wrangler` глобально для локального воркера, либо
  вызывать через `npx wrangler`.

### Установка

```bash
git clone https://github.com/BRATAN-CORP/bratan-music.git
cd bratan-music

# фронтенд
npm install

# воркер
cd worker && npm install && cd ..
```

### Переменные

```bash
cp .env.example .env
# заполни TIDAL_*, TELEGRAM_*, JWT_*, CLOUDFLARE_* — список и комментарии в .env.example
```

Для воркера секреты задаются отдельно:

```bash
cd worker
npx wrangler secret put TIDAL_CLIENT_ID
npx wrangler secret put TIDAL_CLIENT_SECRET
npx wrangler secret put TIDAL_SESSION_TOKEN
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
npx wrangler secret put TELEGRAM_ADMIN_IDS
npx wrangler secret put JWT_SECRET           # openssl rand -hex 64
npx wrangler secret put JWT_REFRESH_SECRET   # openssl rand -hex 64
npx wrangler secret put SESSION_ENCRYPTION_KEY   # openssl rand -hex 32
```

### Запуск

```bash
npm run dev               # vite, http://localhost:5173/bratan-music/
cd worker && npx wrangler dev   # http://localhost:8787
```

Фронт по умолчанию ходит в продовое API
(`https://bratan-music-api.bratan-corp.workers.dev`). Для локального
воркера задай `VITE_API_URL=http://localhost:8787` в `.env.local`.

### Локальная D1

```bash
cd worker
npx wrangler d1 migrations apply bratan-music-db --local
```

### Скрипты

| Папка | Команда | Что делает |
| --- | --- | --- |
| Корень | `npm run dev` | Vite dev-сервер |
| Корень | `npm run build` | `tsc -b && vite build` |
| Корень | `npm run preview` | preview билд из `dist/` |
| Корень | `npm run lint` | `eslint src/` |
| Корень | `npm run typecheck` | `tsc --noEmit` |
| `worker/` | `npm run dev` | `wrangler dev` |
| `worker/` | `npm run deploy` | `wrangler deploy` |
| `worker/` | `npm run lint` | `eslint src/` |
| `worker/` | `npm run typecheck` | `tsc --noEmit` |

## Деплой

- **Фронтенд** — `.github/workflows/deploy-pages.yml` собирает и
  публикует `dist/` в GitHub Pages на каждый push в `main`.
- **Воркер** — `.github/workflows/deploy-worker.yml` запускает
  `wrangler deploy` если в push на `main` изменились файлы в `worker/`.
- **Миграции D1** — `.github/workflows/apply-d1-migrations.yml`,
  автоматически на push с изменениями в `worker/src/db/migrations/` или
  вручную через "Run workflow".

Для деплоев нужны GitHub Actions секреты `CLOUDFLARE_API_TOKEN` (с
правами Workers / D1 / KV / R2) и `CLOUDFLARE_ACCOUNT_ID`.

## CI / лицензионные ограничения

CI блокирует merge: `Lint & Typecheck` (фронт + воркер) и `Build`
запускаются на каждом PR в `main`. Никакого пуша в `main` напрямую —
только через PR.

Проект приватный. Tidal API используется на personal-аккаунте; никакого
публичного `wrangler.toml` с реальными секретами в репозиторий не
коммитится.
