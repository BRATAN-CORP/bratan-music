# Stack

Полный технологический стек проекта с версиями.

## Frontend (`/`)

| Слой | Технология | Версия | Зачем |
| --- | --- | --- | --- |
| Framework | React | ^18.3.0 | Concurrent rendering, Suspense |
| Build | Vite | ^6.0.0 | Sub-second HMR, native ESM, Rollup |
| Language | TypeScript | ^5.7.0 | Strict mode, без `any` в коде приложения |
| Styling | Tailwind CSS | ^3.4.0 | Utility-first |
| Styling | Sass | ^1.83.0 | Дизайн-токены и глобальные стили |
| State | Zustand | ^5.0.0 | 1 KB, persist middleware |
| Server state | TanStack Query | ^5.62.0 | Background revalidation |
| Routing | React Router | ^6.28.0 | `createBrowserRouter`, `basename` для GH Pages |
| Animations | motion | ^12.38.0 | Layout animations, spring physics |
| Icons | lucide-react | ^0.468.0 | Tree-shakeable |
| PWA | vite-plugin-pwa | ^0.21.0 | Service worker, precache, autoupdate |
| PWA | workbox-precaching | ^7.3.0 | App shell caching |
| PWA | workbox-routing | ^7.3.0 | Cache strategies |
| UI primitives | @radix-ui/react-slot | ^1.2.4 | Accessible, headless |
| Class utils | clsx, tailwind-merge | latest | `cn()` helper |
| Variants | class-variance-authority | ^0.7.1 | shadcn-style варианты |

Скрипты:
```
npm run dev         # vite dev server, http://localhost:5173/bratan-music/
npm run build       # tsc -b + vite build
npm run preview     # serve dist/
npm run lint        # eslint
npm run typecheck   # tsc --noEmit
```

## Worker (`worker/`)

| Слой | Технология | Версия | Зачем |
| --- | --- | --- | --- |
| Runtime | Cloudflare Workers | — | V8 isolates, edge |
| Router | Hono | ^4.7.0 | 14 KB, fast, TS-first |
| Database | Cloudflare D1 (SQLite) | — | 24 миграций (`worker/src/db/migrations/`) |
| Cache / sessions | Cloudflare KV | — | Tidal session, stream URL memo, auth nonces |
| Object storage | Cloudflare R2 | — | Custom uploads, covers, overrides |
| Realtime | Durable Objects | `new_sqlite_classes` | Per-room WS fanout (`ChatRoomDO`) |
| AI | Yandex AI Studio | `gpt-oss-120b` | OpenAI-compatible chat completion |
| Music backend | Tidal API | OAuth + device flow | Lossless / HiRes |
| Types | @cloudflare/workers-types | ^4.20250411.0 | bindings |
| CLI | wrangler | ^4.0.0 | dev / deploy / d1 / kv / r2 |

Скрипты:
```
cd worker
npm run dev         # wrangler dev, http://localhost:8787
npm run deploy      # wrangler deploy
npm run lint        # eslint
npm run typecheck   # tsc --noEmit
```

## Auth & Crypto

- **JWT HS256** через WebCrypto SubtleCrypto (без `jsonwebtoken` библиотеки —
  крипто на браузерных API).
- **HMAC-SHA256** — Telegram WebApp `initData` (24h max age, 5min skew).
- **AES-GCM** — encryption at rest для Tidal session token в D1.
- **SHA-256** — хэширование refresh-token'ов перед записью в D1.
- **`crypto.randomUUID()`** — primary keys.
- **`crypto.getRandomValues`** — share tokens (~154 bits entropy).

## CI / CD (GitHub Actions)

- `ci.yml` — на PR: lint + typecheck + build (frontend и worker)
- `deploy-pages.yml` — на push в `main`: build → upload-pages-artifact → deploy-pages
- `deploy-worker.yml` — на push в `main` с paths `worker/**`: `wrangler deploy`
- `apply-d1-migrations.yml` — применение D1-миграций (manual + auto при изменении файлов миграций)

Required CI checks для merge в `main` — `Lint & Typecheck` и `Build`.

## Внешние сервисы и стоимость

| Сервис | Тир | Лимиты |
| --- | --- | --- |
| Cloudflare Workers | Free | 100 000 requests/day |
| Cloudflare D1 | Free | 5 GB storage, 5M reads/day, 100k writes/day |
| Cloudflare KV | Free | 100k reads/day, 1k writes/day, 1 GB storage |
| Cloudflare R2 | Free | 10 GB storage, 1M Class A ops/month |
| Cloudflare DO | Free | через `new_sqlite_classes` (bundled) |
| GitHub Pages | Free | для `/` |
| Telegram Bot | Free | webhook |
| Yandex AI Studio | Pay-as-you-go | `gpt-oss-120b` |
| Tidal | Платная подписка | требуется аккаунт с подпиской |

## Версии Node / npm

- **Node.js 20+** (CI тестируется на 20.x)
- **npm 10+**
