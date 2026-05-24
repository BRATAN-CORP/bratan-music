# Structure

Карта кода. Дерево, повторяющее организацию репозитория, с описанием
**зачем** существует каждый раздел и **что** в нём искать.

## Главные подсистемы

- [[frontend/index|frontend]] (`/src`) — React-приложение, PWA, GitHub
  Pages. Маршрутизация, страницы, layout, компоненты, хуки, store,
  i18n, дизайн-токены.
- [[worker/index|worker]] (`/worker/src`) — **legacy**, Cloudflare
  Worker на Hono. Auth, REST-роуты, сервисы (Tidal pool, AI playlists,
  rooms, ...), middleware, Durable Objects, cron. Замещается Go-портом
  (см. ниже).
- [[api-go/index|api-go]] (`/api-go`) — Go-порт бекенда (chi + pgx +
  go-redis + minio-go + coder/websocket). Запускается рядом с worker'ом
  на отдельном порту до завершения миграции.
- [[telegram-bot/index|telegram-bot]] (`/worker/src/bot`, `/bot`) —
  Telegram Bot webhook handler внутри worker'а: команды, payments,
  deep-link login.
- [[data/index|data]] — D1-схема, KV-неймспейсы, R2-бакет, Durable
  Objects. Мапа таблиц, ключей, миграций.

## Корневые файлы репозитория

| Файл | Зачем |
| --- | --- |
| [`README.md`](../../README.md) | Двуязычный README продукта (EN/RU). Источник правды для маркетинговых описаний и quick-start. |
| [`AGENTS.md`](../../AGENTS.md) | Точка входа для ИИ-агентов. |
| [`package.json`](../../package.json) | Frontend deps + scripts (`dev`, `build`, `lint`, `typecheck`, `preview`). |
| [`vite.config.ts`](../../vite.config.ts) | Vite config + vite-plugin-pwa. |
| [`tsconfig.json`](../../tsconfig.json) / [`tsconfig.node.json`](../../tsconfig.node.json) | TS, strict. |
| [`tailwind.config.js`](../../tailwind.config.js) | Tailwind config (важно: `hover:` гейтится через `@media (hover: hover)`). |
| [`postcss.config.js`](../../postcss.config.js) | PostCSS — Tailwind + autoprefixer. |
| [`eslint.config.mjs`](../../eslint.config.mjs) | ESLint flat config. |
| [`index.html`](../../index.html) | Single HTML entry, мета, PWA-манифест. |
| [`.env.example`](../../.env.example) | Все переменные окружения с комментариями. |
| [`.github/workflows/`](../../.github/workflows/) | CI и деплои. |
| [`worker/`](../../worker) | Backend, см. [[worker/index|worker]]. |
| [`bot/index.ts`](../../bot/index.ts) | Stub. Реальный бот — в `worker/src/bot/`. См. [[telegram-bot/index|telegram-bot]]. |
| [`public/`](../../public) | Статические ассеты для frontend (favicon, manifest, 404.html для SPA). |
| [`REFACTOR_PROGRESS.md`](../../REFACTOR_PROGRESS.md) | Исторический трекер крупного рефакторинга. |
| [`LICENSE`](../../LICENSE) | Source-available лицензия (см. [[../context/index|context]]). |

## Как ориентироваться по задаче

| Задача | Куда смотреть |
| --- | --- |
| UI / страница / компонент | [[frontend/index|frontend]] → `app/` или `components/` |
| Хук, store, query | [[frontend/index|frontend]] → `hooks/` / `store/` / `lib/` |
| API endpoint | [[worker/index|worker]] → `routes/<resource>.ts` + соответствующий `services/<X>Service.ts` |
| Tidal-интеграция | [[worker/index|worker]] → `services/tidal/` |
| Listening room realtime | [[worker/index|worker]] → `services/RoomService.ts` + `do/ChatRoomDO.ts` |
| AI-плейлисты | [[worker/index|worker]] → `services/AiPlaylistService.ts` + `services/RecommendationService.ts` |
| D1 / схема / миграции | [[data/index|data]] |
| Telegram-бот, оплата звёздами | [[telegram-bot/index|telegram-bot]] |
| Стили / токены / цвета | [[frontend/index|frontend]] → `styles/_tokens.scss`, `styles/globals.scss`, `tailwind.config.js` |
| i18n | [[frontend/index|frontend]] → `i18n/`, `i18n/locales/` |
