<div align="center">

# 🎧 BRATAN MUSIC

### Tidal-grade streaming. Inside your Telegram. With your own files. Together with your friends.

**Lossless · HiRes · Crossfade · 10-band EQ · Live Rooms · AI Playlists · Telegram Stars**

[![CI](https://github.com/BRATAN-CORP/bratan-music/actions/workflows/ci.yml/badge.svg)](https://github.com/BRATAN-CORP/bratan-music/actions/workflows/ci.yml)
[![Deploy Pages](https://github.com/BRATAN-CORP/bratan-music/actions/workflows/deploy-pages.yml/badge.svg)](https://github.com/BRATAN-CORP/bratan-music/actions/workflows/deploy-pages.yml)
[![Deploy Worker](https://github.com/BRATAN-CORP/bratan-music/actions/workflows/deploy-worker.yml/badge.svg)](https://github.com/BRATAN-CORP/bratan-music/actions/workflows/deploy-worker.yml)

[**🚀 Live App**](https://bratan-corp.github.io/bratan-music/) · [**🤖 Telegram Bot**](https://t.me/bratan_music_bot) · [**📡 API**](https://bratan-music-api.bratan-corp.workers.dev) · [**🇷🇺 Русский ↓**](#-русский)

</div>

---

## 🌍 English

### TL;DR

**BRATAN MUSIC** is a serverless, Telegram-native, Tidal-powered music player that runs entirely on Cloudflare's edge — for **the price of zero servers and 99 Telegram Stars per month**. Lossless audio, gapless crossfade, AI-curated playlists, custom uploads, real-time listening rooms, all wrapped in a PWA you can install from a single tap inside Telegram.

> Spotify-grade UX. Tidal-grade audio. Telegram-grade onboarding. Cloudflare-grade reliability. **Zero infrastructure.**

### Why does this exist?

The streaming market today asks you to solve four problems at once:

1. **Quality** — most apps ship 320 kbps MP3 or AAC and call it "HD". Real lossless (FLAC) and HiRes (24-bit) are paywalled or absent.
2. **Onboarding** — every service wants email + password + credit card + email confirmation + region check.
3. **Cost & friction** — most quality services cost $10–20/mo and only accept Visa/Mastercard, which is a non-starter in many regions.
4. **Lock-in** — your library is theirs. You cannot upload your own track, share a playlist with someone outside the platform, or listen together with friends in real time without a separate app.

**BRATAN MUSIC** solves all four at once:

| Problem | Our solution |
| --- | --- |
| 🎵 Audio quality | **Lossless / HiRes** out of Tidal CDN with automatic quality fallback ladder |
| 🚪 Onboarding | **One-tap Telegram login** — no email, no password, no captcha |
| 💸 Payment friction | **99 Telegram Stars/month** — pay from your Telegram balance, no card needed |
| 📂 Lock-in | **Upload your own files** to R2, **override** any Tidal track with your version, **share** playlists by link, **listen together** in synced rooms |

### ✨ Feature Showcase

#### 🔊 Audio engine that doesn't compromise

- **Dual-slot HTML5 Audio + Web Audio API** signal chain (`MediaElementAudioSource → BiquadFilter ×N → AnalyserNode → Destination`). Two audio elements share the same graph so the next track is fully decoded **before** the current one ends — true gapless playback with sample-accurate crossfade.
- **Quality ladder** — `LOW` → `HIGH` (AAC) → `LOSSLESS` (FLAC) → `HI_RES_LOSSLESS` (24-bit FLAC). If a track isn't available at the chosen quality (regional limits, FLAC missing for old uploads), the player **transparently falls back** down the ladder — you never see a "track unavailable" error.
- **10-band parametric EQ** with presets (Bass Boost, Vocal, Classical, …) and per-band manual control. Settings persist per-device.
- **Cross-tab sync** via `BroadcastChannel` — pause in one tab, all your tabs pause; switch tracks anywhere, all tabs follow.
- **Media Session API** — lock-screen controls, headphone buttons, Control Center, Bluetooth car interfaces all "just work".
- **Synchronized lyrics** with line-by-line highlighting and right-to-left language support.
- **Real-time visualizer** (FFT-based, configurable bands) and a fullscreen player with 3D **TiltCard** album art.

#### 📚 Library that respects you

- **Personal playlists**: create, rename, custom cover (auto-resize + WebP compression), pin to top, drag-reorder tracks, share by link, like/dislike for AI feedback.
- **Public sharing** — every playlist gets an unguessable share token (`/p/<token>`); other users save it as a **linked, read-only** playlist that auto-syncs when the original changes.
- **Tidal curator playlists** are saveable the same way — they live as `source_kind = 'tidal'` references and stream tracks on demand.
- **Likes** for tracks, albums, and artists, accessible via a dedicated "My Library" page.
- **Custom uploads** — push your own MP3/M4A/FLAC/WAV/OGG to R2 (50 MB cap). Upload tracks behave identically to Tidal tracks: queue them, pin them in playlists, like them, share them.
- **Track override** — for paid subscribers and admins. Have a better version of a Tidal track? Upload your file and the player will stream **your** version on every device, transparently. Original Tidal metadata stays.
- **Listening history** with playback context (album/playlist/radio) and 90-day retention.

#### 🤖 AI playlists that actually understand you

- Daily nightly cron (`30 4 * * *` UTC) regenerates a **fresh "Playlist of the Day"** for every user using their **taste vector** (computed from likes, plays, skips, dislikes).
- On-demand **AI playlist generator** — tell it "лоу-фай для работы вечером" or "synth-pop with female vocals like CHVRCHES", and the worker uses Yandex AI Studio (`gpt-oss-120b`) to expand your prompt into 8–12 search queries, fans them out to Tidal in parallel, dedupes, and returns a coherent playlist.
- **Recommendation seen-list** — once you've seen a track in a daily playlist, it won't reappear for 30 days, so the daily picks always feel fresh.
- **Track radio** — pick any track, get a context-aware queue of similar tracks (Tidal's track-radio API).

#### 👥 Live listening rooms

- **Synchronized playback** with up to 32 friends via WebSocket fanout through a Cloudflare **Durable Object**.
- Server-anchored time + monotonic version counter — clients reconcile clock skew on every poll, so even users on flaky LTE stay in sync within ~200 ms of the host.
- **Anyone in the room can take control** by default ("Маша поставила на паузу"); the host can toggle host-only mode.
- Built-in **chat** with persistent history (D1) and live broadcast (DO).
- **Anti-abuse stream proxy** — hosts' personal uploads are streamed via the worker only while the track is the room's *currently-playing* track; switch tracks and the previous URL stops working immediately. No "free file leech" surface.

#### 🔐 Authentication that takes one tap

- **Telegram WebApp login** — open the app from inside Telegram, `Telegram.WebApp.initData` is verified server-side via HMAC-SHA256 and you're in. No password, no email.
- **Deep-link login** — outside Telegram? Tap "Open BRATAN" in the bot, get a single-use 5-minute nonce that signs you in on the website.
- **JWT pair** — 1-hour access + 30-day refresh, refresh tokens hashed at rest in D1, automatic rotation on every refresh, in-flight refresh deduping for parallel API calls.
- **Per-device sessions** — sign out a single device without invalidating the others.

#### 💎 Subscription powered by Telegram Stars

- **Free tier**: 3 unique tracks per day (per-track dedup, replays don't count).
- **Premium**: **99 Telegram Stars / month** ($1.50 ≈), paid from your Telegram balance — no credit card, no Stripe, no chargebacks. Telegram handles billing.
- **Idempotent activation** — Telegram retries `successful_payment` webhooks; we dedupe by `telegram_payment_charge_id`. One payment = one 30-day extension, period.
- **Admin grant** for testers and partners (`/admin_grant <user_id> <days>` in the bot).

#### 🛠️ Admin panel

- In-app admin UI at `/admin/*` (Tidal session status, refresh-token rotation, device-flow re-auth, multi-account pool management, user lookup, subscription grant/revoke, full data purge).
- **Tidal account pool** — run multiple Tidal sub accounts side-by-side, label them, enable/disable individually, rotate refresh tokens without downtime.
- **Service health & log ring** — `/admin/health` aggregates D1/R2/KV liveness checks; `/admin/logs` is a bounded ring buffer with filters by level/source.

#### 📱 PWA polish

- **Installable as a standalone app** on iOS, Android, desktop. Custom splash, theme color matches dark/light mode, native-feeling navigation.
- **Workbox precache** for the app shell — opens instantly even on a flaky connection.
- **GitHub Pages SPA decoder** — deep-links like `/playlist/abc123` survive a hard refresh on GitHub Pages (which normally 404s on subpaths).
- **Cyrillic-aware Marquee** — clip-path passes ascenders/descenders vertically so Cyrillic doesn't get clipped.
- **`hover:` only when hover is supported** — Tailwind config wraps `:hover` in `@media (hover: hover)`, so touch devices don't get stuck in hover state after a tap.

### 🏗️ Architecture

```
┌────────────────────────┐         ┌──────────────────────────┐
│  React 18 + Vite 6     │         │   Cloudflare Worker      │
│  PWA, Tailwind, SCSS   │  HTTPS  │   (Hono 4 router)        │
│  Zustand + TanStack Q  │ ──────► │                          │
│  GitHub Pages CDN      │         │   ┌────────┬────────┐    │
└────────────────────────┘         │   │  Auth  │ Tracks │    │
                                   │   │  JWT   │ Stream │    │
                                   │   ├────────┼────────┤    │
┌────────────────────────┐         │   │ Rooms  │ Admin  │    │
│  Telegram Bot          │  Webhook│   │ DO+WS  │ Pool   │    │
│  @bratan_music_bot     │ ──────► │   └────┬───┴────┬───┘    │
│  Stars Payments        │         │        │        │        │
└────────────────────────┘         │   ┌────▼────┐ ┌─▼──────┐ │
                                   │   │   D1    │ │   KV   │ │
                                   │   │ SQLite  │ │ session│ │
                                   │   └─────────┘ └────────┘ │
┌────────────────────────┐         │                          │
│  Yandex AI Studio      │  HTTPS  │   ┌──────────────────┐   │
│  gpt-oss-120b          │ ◄───────┤   │   Tidal Pool     │   │
└────────────────────────┘         │   │  refresh + token │   │
                                   │   └────────┬─────────┘   │
                                   └────────────┼─────────────┘
                                                │
                                   ┌────────────▼─────────────┐
                                   │   R2 (uploads, covers,   │
                                   │   overrides, 50MB cap)   │
                                   │           │              │
                                   │  ┌────────▼─────┐        │
                                   │  │ Tidal CDN    │        │
                                   │  │ (audio.tidal,│        │
                                   │  │  fa-v3.tidal)│        │
                                   │  └──────────────┘        │
                                   └──────────────────────────┘
```

**Everything runs at the edge.** No origin servers, no Kubernetes, no Docker. Deploy time: ~30 seconds. Cold start: ~5 ms.

### 🧰 Tech Stack

#### Frontend (`/`)

| Layer | Technology | Why |
| --- | --- | --- |
| Framework | **React 18** | Concurrent rendering, Suspense, ecosystem |
| Build | **Vite 6** | Sub-second HMR, native ESM, Rollup output |
| Language | **TypeScript 5.7** | Strict mode, no `any` in app code |
| Styling | **Tailwind CSS 3.4 + SCSS** | Utility-first + design tokens |
| State | **Zustand 5** | 1 KB, no boilerplate, with `persist` middleware |
| Server state | **TanStack Query 5** | Background revalidation, optimistic updates |
| Routing | **React Router 6** | `createBrowserRouter`, `basename` for GH Pages |
| Animations | **motion** (Framer Motion 12) | Layout animations, spring physics |
| Icons | **lucide-react** | 1000+ icons, tree-shakeable |
| PWA | **vite-plugin-pwa + Workbox 7** | Service worker, precache, autoupdate |
| UI primitives | **@radix-ui/react-slot** + custom shadcn-style | Accessible, headless |

#### Backend (`worker/`)

| Layer | Technology | Why |
| --- | --- | --- |
| Runtime | **Cloudflare Workers** | Global edge, V8 isolates, 0 cold start |
| Router | **Hono 4** | 14 KB, fast, TypeScript-first |
| Database | **Cloudflare D1** (SQLite) | 23 migrations, parameterized queries everywhere |
| Cache / sessions | **Cloudflare KV** | Tidal session, stream URL memo, auth nonces |
| Object storage | **Cloudflare R2** (S3-compatible) | Custom uploads, covers, overrides |
| Realtime | **Durable Objects** (`new_sqlite_classes`) | Per-room WebSocket fanout |
| AI | **Yandex AI Studio** (`gpt-oss-120b`) | OpenAI-compatible chat completion |
| Music backend | **Tidal API** (OAuth + device flow) | Lossless / HiRes streaming |

#### Auth & Crypto

- **JWT (HS256)** — signed via WebCrypto SubtleCrypto.
- **HMAC-SHA256** — for Telegram WebApp `initData` verification (24h max age, 5min skew).
- **AES-GCM** — for Tidal session token encryption at rest in D1.
- **Refresh-token hashing** (SHA-256) before D1 storage.
- **`crypto.randomUUID()`** for all primary keys, **`crypto.getRandomValues`** for share tokens (~154 bits entropy).

#### CI / CD

- **GitHub Actions** (`.github/workflows/`):
  - `ci.yml` — lint + typecheck + build on every PR.
  - `deploy-pages.yml` — deploy `/` to GitHub Pages on `main` push.
  - `deploy-worker.yml` — `wrangler deploy` to Cloudflare on `main` push.
  - `apply-d1-migrations.yml` — manual + automatic D1 migration application with self-heal for already-applied migrations.

### 🚀 Quick Start

#### Prerequisites

- **Node.js 20+** (we test on 20.x).
- **npm 10+**.
- **Cloudflare account** (free tier is enough for hobby use; D1 / KV / R2 / Workers all have generous free quotas).
- **Telegram bot** created via [@BotFather](https://t.me/botfather) — copy the bot token.
- **Tidal account** — Individual / HiFi / HiFi Plus subscription (any paid tier).
- *(optional)* **Yandex Cloud** account with AI Studio enabled, for AI playlist generation.

#### 1. Clone & install

```bash
git clone https://github.com/BRATAN-CORP/bratan-music.git
cd bratan-music

# Frontend deps
npm ci

# Worker deps
cd worker
npm ci
cd ..
```

#### 2. Configure environment

Copy the example and fill in your own values:

```bash
cp .env.example .env
# edit .env — see field-by-field comments inside
```

Key variables (see `.env.example` for the full list):

| Variable | Where to get it |
| --- | --- |
| `TIDAL_USERNAME` / `TIDAL_PASSWORD` | Your Tidal credentials |
| `TIDAL_CLIENT_ID` / `TIDAL_CLIENT_SECRET` | Reverse-engineer from `tidal.com` (DevTools → Network → look at the OAuth request). The worker also has fallback mobile clients. See `worker/docs/tidal-api-research.md`. |
| `TELEGRAM_BOT_TOKEN` | [@BotFather](https://t.me/botfather) → `/newbot` |
| `TELEGRAM_BOT_USERNAME` | The bot's username, without `@` |
| `TELEGRAM_ADMIN_IDS` | Your Telegram user ID (get via [@userinfobot](https://t.me/userinfobot)). Comma-separated for multiple admins. |
| `TELEGRAM_WEBHOOK_SECRET` | `openssl rand -hex 32` |
| `JWT_SECRET` / `JWT_REFRESH_SECRET` | `openssl rand -hex 64` (different values!) |
| `SESSION_ENCRYPTION_KEY` | `openssl rand -hex 32` |
| `CLOUDFLARE_ACCOUNT_ID` / `CLOUDFLARE_API_TOKEN` | Cloudflare dashboard → API Tokens. Token needs Workers + D1 + KV + R2 permissions. |
| `YANDEX_API_TOKEN` / `YANDEX_FOLDER_ID` | *(optional)* [Yandex Cloud](https://console.cloud.yandex.ru/) → AI Studio. Without these, AI playlists fall back to "feature unavailable". |

#### 3. Provision Cloudflare resources

```bash
cd worker

# Create D1 database
npx wrangler d1 create bratan-music-db
# → copy the printed database_id into wrangler.toml

# Create KV namespace
npx wrangler kv:namespace create SESSIONS
# → copy the printed id into wrangler.toml

# Create R2 bucket
npx wrangler r2 bucket create bratanmusic-tracks

# Apply D1 migrations
npx wrangler d1 migrations apply bratan-music-db --remote
# (omit --remote for local-only dev DB)
```

#### 4. Push secrets to Cloudflare

`wrangler.toml` only stores non-secret config. Secrets go separately:

```bash
cd worker
npx wrangler secret put TIDAL_CLIENT_ID
npx wrangler secret put TIDAL_CLIENT_SECRET
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
npx wrangler secret put TELEGRAM_ADMIN_IDS
npx wrangler secret put JWT_SECRET
npx wrangler secret put JWT_REFRESH_SECRET
npx wrangler secret put SESSION_ENCRYPTION_KEY
npx wrangler secret put YANDEX_API_TOKEN          # optional
npx wrangler secret put YANDEX_FOLDER_ID          # optional
```

#### 5. Run locally

```bash
# Terminal 1 — worker (Cloudflare Workers dev server, http://localhost:8787)
cd worker
npm run dev

# Terminal 2 — frontend (Vite, http://localhost:5173/bratan-music/)
npm run dev
```

To make the frontend talk to the local worker, create `.env.local` in repo root:

```bash
VITE_API_URL=http://localhost:8787
```

#### 6. Set the Telegram webhook

Once your worker is deployed (or temporarily exposed via [`cloudflared tunnel`](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/)), point Telegram at it:

```bash
curl -F "url=https://<your-worker>.workers.dev/webhook/telegram" \
     -F "secret_token=<TELEGRAM_WEBHOOK_SECRET>" \
     -F "allowed_updates=[\"message\",\"callback_query\",\"pre_checkout_query\"]" \
     "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook"
```

#### 7. Deploy

```bash
# Frontend → GitHub Pages (automatic on push to main, or manually):
npm run build
# → dist/ ready to serve

# Worker → Cloudflare (automatic on push to main, or manually):
cd worker
npx wrangler deploy
```

### 🧪 Development workflow

```bash
# Frontend
npm run dev          # Vite dev server with HMR
npm run build        # tsc -b + vite build → dist/
npm run preview      # serve dist/ locally
npm run lint         # eslint
npm run typecheck    # tsc --noEmit

# Worker
cd worker
npm run dev          # wrangler dev (local Workers runtime)
npm run deploy       # wrangler deploy
npm run lint         # eslint
npm run typecheck    # tsc --noEmit

# D1 migrations
cd worker
npx wrangler d1 migrations create bratan-music-db <name>
npx wrangler d1 migrations apply bratan-music-db --local   # against local dev DB
npx wrangler d1 migrations apply bratan-music-db --remote  # against production
```

### 📁 Project structure

```
.
├── src/                              ◀── frontend (React + Vite, deployed to GitHub Pages)
│   ├── app/                          page-level routes
│   ├── components/
│   │   ├── layout/                   Sidebar, Player, FullscreenPlayer, MobileBottomDock
│   │   ├── features/                 PlaylistCard, TrackItem, Equalizer, AdminTidalPanel, …
│   │   └── ui/                       Button, Card, Marquee, TiltCard, LiquidGlassButton, …
│   ├── hooks/                        useAudioPlayer (dual-slot engine), useAuth, …
│   ├── store/                        Zustand: player / auth / settings / ui / roomConnection
│   ├── lib/                          api client, motion presets, image-resize, trackActions
│   ├── i18n/                         RU / EN translations
│   └── main.tsx                      QueryClientProvider + StrictMode
│
├── worker/                           ◀── backend (Cloudflare Worker)
│   ├── src/
│   │   ├── index.ts                  Hono root, /health endpoints, cron handler
│   │   ├── routes/                   auth, user, search, tracks, albums, artists,
│   │   │                             playlists, library, explore, overrides,
│   │   │                             uploads, rooms, admin, webhook, ai
│   │   ├── services/
│   │   │   ├── AuthService.ts        JWT signing + verification, refresh rotation
│   │   │   ├── UserService.ts        users CRUD, isAdmin, daily_listens
│   │   │   ├── SubscriptionService.ts Telegram Stars activation, manual grant
│   │   │   ├── StorageService.ts     R2 uploads + key generation
│   │   │   ├── RoomService.ts        listening rooms (state, members, controls)
│   │   │   ├── AiPlaylistService.ts  Yandex GPT → search-query expansion → Tidal fanout
│   │   │   ├── HealthService.ts      D1/KV/R2 probes, log ring buffer
│   │   │   └── tidal/
│   │   │       ├── TidalAuth.ts      OAuth + device flow + refresh + multi-account pool
│   │   │       ├── TidalApi.ts       low-level (search, album, artist, page)
│   │   │       ├── TidalWeb.ts       web fallback (cookie-scrape) for unrouted endpoints
│   │   │       ├── TidalPool.ts      multi-account sub rotation
│   │   │       ├── TidalService.ts   high-level mapping → Track / Album / …
│   │   │       └── sessionCrypto.ts  AES-GCM at rest
│   │   ├── middleware/               cors, rateLimit, jwtAuth, adminOnly
│   │   ├── do/                       ChatRoomDO (per-room WebSocket fanout)
│   │   ├── bot/                      Telegram webhook handler
│   │   ├── db/migrations/            23 D1 migrations
│   │   └── types/                    Env (Cloudflare bindings) + Variables
│   └── wrangler.toml                 worker config (commit-safe; secrets via `wrangler secret`)
│
├── .github/workflows/                CI (lint+typecheck+build) and deploy
├── public/                           static assets (favicon, manifest, 404.html for SPA)
├── docs/                             feature-level documentation
└── README.md                         ◀── you are here
```

### 🗄️ Database schema (highlights)

- `users` — Telegram-id keyed; tracks `tg_username`, `tg_name`, `is_admin`, `is_banned`, `created_at`.
- `sessions` — refresh-token hashes per device, `expires_at`, `last_used_at`.
- `playlists` — owner, name, description, cover URL, public/private, share token, source kind (`user` / `tidal` / null), pinned timestamp.
- `playlist_tracks` — junction table with `position`, `snapshot` (JSON-stored cover + artist + title for offline rendering).
- `library_items` — likes for tracks/albums/artists.
- `user_tracks` — custom uploads (id, R2 key, mime type, size, metadata).
- `track_overrides` — per-user "stream this file instead of the Tidal track" mapping.
- `subscriptions` — active/expired/manual, Telegram Stars charge id (idempotency).
- `daily_listen_tracks` — free-tier 3-track daily quota (deduped per track).
- `play_history` — listening history with playback context.
- `auth_nonces` — single-use 5-min login nonces for the Telegram deeplink flow.
- `listening_rooms`, `listening_room_members`, `listening_room_state`, `room_chat_messages` — live rooms.
- `tidal_pool` — multi-account refresh tokens for horizontal scaling of the music backend.
- `recommendation_seen` — 30-day rolling window of tracks already shown in daily playlists.
- `user_taste_profile`, `user_dislikes` — feature vectors for AI playlist generation.

23 migrations total, applied via `wrangler d1 migrations apply`.

### 🔒 Security

This codebase has been independently security-audited. Highlights:

- ✅ **Zero hardcoded user secrets** — all production secrets live in Cloudflare's Workers Secret store.
- ✅ **Zero npm vulnerabilities** (frontend + worker).
- ✅ **Strict CORS allowlist** — no `*` wildcards.
- ✅ **Parameterized SQL everywhere** — no string interpolation in `prepare()` calls.
- ✅ **Telegram WebApp HMAC verification** with 24h max age + 5min skew.
- ✅ **JWT with HS256**, 1h access + 30d refresh, refresh tokens hashed at rest.
- ✅ **Telegram payment validation** — strict payload + amount + currency checks before pre-checkout approval, idempotent activation by `telegram_payment_charge_id`.
- ✅ **Audio proxy host allowlist** — `*.tidal.com` only, no open relay.
- ✅ **R2 key validation** — `^[a-zA-Z0-9_-]{1,64}$`, no path traversal.
- ✅ **Admin status re-checked from DB** on every admin call, not cached in JWT.
- ✅ **Banned users invalidated immediately** — checked on every request, not just at JWT issue time.

For the full audit, see [SECURITY.md](./SECURITY.md) *(optional, generate from `security-audit.md`)*.

### 🤝 Contributing

PRs are welcome. The basic flow:

1. Fork → branch → push.
2. CI must be green (`npm run lint && npm run typecheck && npm run build` for frontend; same for worker).
3. Open a PR against `dev`. PRs to `main` come from `dev` after release-candidate review.
4. Conventional commits encouraged: `feat:`, `fix:`, `chore:`, `docs:`, with optional scope (`feat(player): …`).

### 📜 License

This project is for **educational and personal use**. The Tidal API integration uses publicly known mobile client credentials reverse-engineered from open-source projects. Compliance with [Tidal's Terms of Service](https://tidal.com/terms) is the operator's responsibility. The authors take no liability for misuse.

If you want a commercial license / partnership, reach out via the Telegram bot.

---

## 🇷🇺 Русский

### TL;DR

**BRATAN MUSIC** — это serverless музыкальный плеер, который живёт **внутри Telegram**, стримит **lossless и HiRes** через Tidal, целиком крутится **на edge-инфре Cloudflare** и стоит **99 Telegram Stars в месяц**. Логин в один тап, никаких email и кредиток. Свои треки можно заливать поверх. Слушать вместе с друзьями — синхронно, в режиме реального времени. Всё это работает как PWA, ставится из Telegram в один тап.

> UX как у Spotify. Звук как у Tidal. Онбординг как у Telegram. Надёжность как у Cloudflare. **Серверов — ноль.**

### Зачем это вообще?

Стриминговый рынок сегодня заставляет вас решать сразу четыре проблемы:

1. **Качество** — большинство сервисов отдают 320 kbps MP3/AAC и называют это "HD". Lossless (FLAC) и HiRes (24-бит) либо за пейволом, либо отсутствуют.
2. **Онбординг** — нужны email + пароль + карта + подтверждение почты + проверка региона.
3. **Цена и трение оплаты** — $10–20/мес, и не каждая страна / не каждая карта проходит.
4. **Lock-in** — ваша медиатека — это **их** медиатека. Свой трек залить нельзя, поделиться плейлистом без аккаунта в этом же сервисе нельзя, синхронно слушать с другом нельзя без отдельного приложения.

**BRATAN MUSIC** закрывает всё это разом:

| Проблема | Как решаем |
| --- | --- |
| 🎵 Качество звука | **Lossless / HiRes** прямо с CDN Tidal, с автоматическим fallback'ом качества |
| 🚪 Онбординг | **Логин в Telegram в один тап** — ни email, ни пароля, ни капчи |
| 💸 Оплата | **99 Telegram Stars в месяц** — оплата с баланса Telegram, карта не нужна |
| 📂 Lock-in | **Свои треки в R2**, **override** любого Tidal-трека своей версией, **публичные ссылки** на плейлисты, **синхронные комнаты** для совместного прослушивания |

### ✨ Все фичи

#### 🔊 Аудио-движок без компромиссов

- **Двухслотный HTML5 Audio + Web Audio API** signal-chain (`MediaElementAudioSource → BiquadFilter ×N → AnalyserNode → Destination`). Два audio-элемента шарят один граф — следующий трек **полностью декодирован** до того, как закончится текущий. Настоящий гэплесс с sample-accurate кроссфейдом.
- **Лестница качества** — `LOW` → `HIGH` (AAC) → `LOSSLESS` (FLAC) → `HI_RES_LOSSLESS` (24-бит FLAC). Если нужное качество не доступно для конкретного трека (региональные ограничения, FLAC отсутствует) — плеер **прозрачно откатывается** ниже. Никаких "трек недоступен" в лицо пользователю.
- **10-полосный параметрический эквалайзер** с пресетами (Bass Boost, Vocal, Classical, …) и ручной настройкой каждой полосы. Сохраняется per-device.
- **Cross-tab sync** через `BroadcastChannel` — пауза в одной вкладке = пауза во всех; переключение трека где угодно = синхронно везде.
- **Media Session API** — кнопки play/pause/next/prev на локскрине, наушниках, в Control Center, в Bluetooth-магнитоле работают из коробки.
- **Синхронизированные лирика** с подсветкой по строкам и поддержкой right-to-left языков.
- **Real-time визуализатор** (FFT, настраиваемые полосы) и полноэкранный плеер с **TiltCard** (3D-обложка).

#### 📚 Библиотека, которая уважает пользователя

- **Свои плейлисты**: создание, переименование, обложка с авто-resize и WebP-сжатием, пин в топ, drag-reorder, share по ссылке, лайк/дизлайк для AI-фидбека.
- **Публичный share** — у каждого плейлиста есть unguessable share-токен (`/p/<token>`); другие пользователи сохраняют его как **linked, read-only** плейлист, который автоматически синхронизируется с оригиналом.
- **Tidal-плейлисты от кураторов** сохраняются точно так же — живут как `source_kind = 'tidal'` ссылка и подгружают треки on-demand.
- **Лайки** треков, альбомов и артистов на отдельной странице "Моя медиатека".
- **Свои загрузки** — заливаешь свой MP3/M4A/FLAC/WAV/OGG в R2 (лимит 50 МБ). Загруженные треки ведут себя ровно как Tidal-треки: в очередь, в плейлисты, в лайки, поделиться.
- **Override Tidal-трека** — для платных подписчиков и админов. Есть лучшая версия трека? Заливаешь свой файл, и плеер на всех твоих устройствах будет стримить **твою** версию вместо Tidal'овской. Метаданные оригинала остаются.
- **История прослушиваний** с playback-контекстом (альбом / плейлист / радио) и ретеншеном 90 дней.

#### 🤖 AI-плейлисты, которые правда понимают вкус

- Ночной cron (`30 4 * * *` UTC) генерирует **свежий "Плейлист дня"** для каждого пользователя на основе его **taste-вектора** (считается из лайков, прослушиваний, скипов, дизлайков).
- **AI-генератор плейлистов on-demand** — пишешь "лоу-фай для работы вечером" или "synth-pop с женским вокалом как CHVRCHES", и worker через Yandex AI Studio (`gpt-oss-120b`) разворачивает запрос в 8–12 поисковых запросов, фанит их в Tidal параллельно, дедупит и возвращает связный плейлист.
- **Recommendation seen-list** — увиденный в дневном плейлисте трек не появится снова 30 дней, поэтому daily-подборки всегда свежие.
- **Track radio** — выбираешь любой трек, получаешь контекстную очередь похожих (Tidal track-radio API).

#### 👥 Live-комнаты (совместное прослушивание)

- **Синхронное воспроизведение** до 32 человек через WebSocket-фанаут на Cloudflare **Durable Object**.
- Server-anchored время + monotonic version counter — клиенты пересчитывают clock skew на каждом polling-tick'е, и даже на flaky LTE рассинхрон с хостом не больше ~200 мс.
- **Управлять может любой участник** комнаты по умолчанию ("Маша поставила на паузу"); хост может включить host-only режим.
- Встроенный **чат** с persistent history (D1) и live-broadcast (DO).
- **Anti-abuse stream proxy** — личные uploads хоста стримятся через worker только пока трек — *currently-playing* в комнате; меняется трек — старая ссылка перестаёт работать. Никакой "free file leech"-поверхности.

#### 🔐 Авторизация в один тап

- **Telegram WebApp login** — открываешь приложение из Telegram, `Telegram.WebApp.initData` верифицируется на сервере через HMAC-SHA256, и ты залогинен. Без пароля и email.
- **Deep-link login** — открыл сайт извне Telegram? Тапаешь "Open BRATAN" в боте, получаешь одноразовый 5-минутный nonce, который логинит тебя на сайте.
- **JWT-пара** — access 1 час + refresh 30 дней, refresh-токены хэшированы при хранении в D1, автоматическая ротация при каждом refresh, dedup параллельных refresh'ей в одном tab'е.
- **Per-device sessions** — отозвать конкретный девайс не инвалидируя остальные.

#### 💎 Подписка на Telegram Stars

- **Бесплатный тариф**: 3 уникальных трека в день (per-track dedup, реплеи бесплатны).
- **Premium**: **99 Telegram Stars в месяц** (~$1.50), оплата с баланса Telegram — никаких карт, никакого Stripe, никакого chargeback'а. Биллинг полностью на Telegram.
- **Идемпотентная активация** — Telegram ретраит `successful_payment` webhooks; мы дедупим по `telegram_payment_charge_id`. Один платёж = одно продление на 30 дней. Точка.
- **Ручное продление** для тестировщиков и партнёров (`/admin_grant <user_id> <days>` в боте).

#### 🛠️ Админ-панель

- Внутри приложения по `/admin/*` (статус Tidal-сессии, ротация refresh-токена, device-flow re-auth, multi-account pool, поиск пользователя, выдача/отзыв подписки, полная очистка данных пользователя).
- **Tidal account pool** — параллельно крутим несколько Tidal-аккаунтов, каждому — лейбл, можно отключать индивидуально, ротировать refresh-токены без даунтайма.
- **Health & log ring** — `/admin/health` агрегирует D1/R2/KV liveness; `/admin/logs` — bounded ring buffer с фильтрами по level/source.

#### 📱 PWA-полировка

- **Standalone-приложение** на iOS, Android, desktop. Кастомный splash, theme color синхронизирован с dark/light, нативная навигация.
- **Workbox precache** для shell'а — открывается мгновенно даже на flaky сети.
- **GitHub Pages SPA decoder** — deep-link'и типа `/playlist/abc123` переживают hard refresh на GitHub Pages (которые обычно отдают 404 на subpath'ах).
- **Cyrillic-aware Marquee** — clip-path пропускает ascender'ы и descender'ы вертикально, поэтому кириллица не обрезается.
- **`hover:` только когда hover поддерживается** — Tailwind конфиг оборачивает `:hover` в `@media (hover: hover)`, и тач-устройства не залипают в hover-состоянии после тапа.

### 🏗️ Архитектура

```
┌────────────────────────┐         ┌──────────────────────────┐
│  React 18 + Vite 6     │         │   Cloudflare Worker      │
│  PWA, Tailwind, SCSS   │  HTTPS  │   (Hono 4 router)        │
│  Zustand + TanStack Q  │ ──────► │                          │
│  GitHub Pages CDN      │         │   ┌────────┬────────┐    │
└────────────────────────┘         │   │  Auth  │ Tracks │    │
                                   │   │  JWT   │ Stream │    │
                                   │   ├────────┼────────┤    │
┌────────────────────────┐         │   │ Rooms  │ Admin  │    │
│  Telegram Bot          │  Webhook│   │ DO+WS  │ Pool   │    │
│  @bratan_music_bot     │ ──────► │   └────┬───┴────┬───┘    │
│  Stars Payments        │         │        │        │        │
└────────────────────────┘         │   ┌────▼────┐ ┌─▼──────┐ │
                                   │   │   D1    │ │   KV   │ │
                                   │   │ SQLite  │ │ session│ │
                                   │   └─────────┘ └────────┘ │
┌────────────────────────┐         │                          │
│  Yandex AI Studio      │  HTTPS  │   ┌──────────────────┐   │
│  gpt-oss-120b          │ ◄───────┤   │   Tidal Pool     │   │
└────────────────────────┘         │   │  refresh + token │   │
                                   │   └────────┬─────────┘   │
                                   └────────────┼─────────────┘
                                                │
                                   ┌────────────▼─────────────┐
                                   │   R2 (uploads, covers,   │
                                   │   overrides, 50MB cap)   │
                                   │           │              │
                                   │  ┌────────▼─────┐        │
                                   │  │ Tidal CDN    │        │
                                   │  │ (audio.tidal,│        │
                                   │  │  fa-v3.tidal)│        │
                                   │  └──────────────┘        │
                                   └──────────────────────────┘
```

**Всё крутится на edge.** Нет origin-серверов, нет Kubernetes, нет Docker. Деплой ~30 секунд. Cold start ~5 мс.

### 🧰 Технологический стек

#### Фронтенд (`/`)

| Слой | Технология | Зачем |
| --- | --- | --- |
| Фреймворк | **React 18** | Concurrent rendering, Suspense, экосистема |
| Сборка | **Vite 6** | Sub-second HMR, нативный ESM, Rollup на выходе |
| Язык | **TypeScript 5.7** | Strict mode, без `any` в продовом коде |
| Стилизация | **Tailwind CSS 3.4 + SCSS** | Utility-first + design tokens |
| State | **Zustand 5** | 1 КБ, без бойлерплейта, с `persist`-middleware |
| Server state | **TanStack Query 5** | Background revalidation, optimistic updates |
| Роутинг | **React Router 6** | `createBrowserRouter`, `basename` для GitHub Pages |
| Анимации | **motion** (Framer Motion 12) | Layout-анимации, spring-физика |
| Иконки | **lucide-react** | 1000+ иконок, tree-shakeable |
| PWA | **vite-plugin-pwa + Workbox 7** | Service worker, precache, autoupdate |
| UI-примитивы | **@radix-ui/react-slot** + кастомные shadcn-style | Доступные, headless |

#### Бэкенд (`worker/`)

| Слой | Технология | Зачем |
| --- | --- | --- |
| Runtime | **Cloudflare Workers** | Глобальный edge, V8 isolates, 0 cold start |
| Роутер | **Hono 4** | 14 КБ, быстрый, TypeScript-first |
| База | **Cloudflare D1** (SQLite) | 23 миграции, везде параметризованные запросы |
| Cache / sessions | **Cloudflare KV** | Tidal-сессия, stream-URL memo, auth-nonces |
| Object storage | **Cloudflare R2** (S3-compatible) | Свои загрузки, обложки, overrides |
| Realtime | **Durable Objects** (`new_sqlite_classes`) | Per-room WebSocket fanout |
| AI | **Yandex AI Studio** (`gpt-oss-120b`) | OpenAI-совместимый chat completion |
| Music backend | **Tidal API** (OAuth + device flow) | Lossless / HiRes стриминг |

#### Auth & Crypto

- **JWT (HS256)** — подпись через WebCrypto SubtleCrypto.
- **HMAC-SHA256** — для верификации Telegram WebApp `initData` (24h max age, 5min skew).
- **AES-GCM** — для шифрования Tidal session token at-rest в D1.
- **Refresh-token hashing** (SHA-256) перед записью в D1.
- **`crypto.randomUUID()`** для всех primary keys, **`crypto.getRandomValues`** для share-токенов (~154 бита энтропии).

#### CI / CD

- **GitHub Actions** (`.github/workflows/`):
  - `ci.yml` — lint + typecheck + build на каждом PR.
  - `deploy-pages.yml` — деплой `/` на GitHub Pages при push в `main`.
  - `deploy-worker.yml` — `wrangler deploy` на Cloudflare при push в `main`.
  - `apply-d1-migrations.yml` — ручной + автоматический apply D1-миграций с self-heal для уже применённых.

### 🚀 Быстрый старт

#### Требования

- **Node.js 20+** (тестируем на 20.x).
- **npm 10+**.
- **Cloudflare аккаунт** (бесплатного тарифа достаточно для хобби; D1 / KV / R2 / Workers — все имеют щедрые free-квоты).
- **Telegram-бот** через [@BotFather](https://t.me/botfather) — забрать токен.
- **Tidal-аккаунт** — Individual / HiFi / HiFi Plus подписка (любой платный тариф).
- *(опционально)* **Yandex Cloud** аккаунт с AI Studio для генерации AI-плейлистов.

#### 1. Клонировать и установить зависимости

```bash
git clone https://github.com/BRATAN-CORP/bratan-music.git
cd bratan-music

# Зависимости фронтенда
npm ci

# Зависимости воркера
cd worker
npm ci
cd ..
```

#### 2. Настроить env

Скопировать пример и заполнить своими значениями:

```bash
cp .env.example .env
# редактируй .env — комментарии по полям внутри
```

Основные переменные (полный список — в `.env.example`):

| Переменная | Где взять |
| --- | --- |
| `TIDAL_USERNAME` / `TIDAL_PASSWORD` | Креды твоего Tidal-аккаунта |
| `TIDAL_CLIENT_ID` / `TIDAL_CLIENT_SECRET` | Reverse-engineer из `tidal.com` (DevTools → Network → OAuth-запрос). У воркера есть fallback на mobile-клиенты. См. `worker/docs/tidal-api-research.md`. |
| `TELEGRAM_BOT_TOKEN` | [@BotFather](https://t.me/botfather) → `/newbot` |
| `TELEGRAM_BOT_USERNAME` | Username бота, без `@` |
| `TELEGRAM_ADMIN_IDS` | Твой Telegram user-id (через [@userinfobot](https://t.me/userinfobot)). Через запятую для нескольких админов. |
| `TELEGRAM_WEBHOOK_SECRET` | `openssl rand -hex 32` |
| `JWT_SECRET` / `JWT_REFRESH_SECRET` | `openssl rand -hex 64` (разные значения!) |
| `SESSION_ENCRYPTION_KEY` | `openssl rand -hex 32` |
| `CLOUDFLARE_ACCOUNT_ID` / `CLOUDFLARE_API_TOKEN` | Cloudflare dashboard → API Tokens. Токену нужны права на Workers + D1 + KV + R2. |
| `YANDEX_API_TOKEN` / `YANDEX_FOLDER_ID` | *(опционально)* [Yandex Cloud](https://console.cloud.yandex.ru/) → AI Studio. Без них AI-плейлисты отключатся. |

#### 3. Создать ресурсы Cloudflare

```bash
cd worker

# D1 база
npx wrangler d1 create bratan-music-db
# → копируешь напечатанный database_id в wrangler.toml

# KV namespace
npx wrangler kv:namespace create SESSIONS
# → копируешь напечатанный id в wrangler.toml

# R2 bucket
npx wrangler r2 bucket create bratanmusic-tracks

# Применить миграции D1
npx wrangler d1 migrations apply bratan-music-db --remote
# (без --remote — для локальной dev DB)
```

#### 4. Положить секреты в Cloudflare

`wrangler.toml` хранит только не-секретные настройки. Секреты — отдельно:

```bash
cd worker
npx wrangler secret put TIDAL_CLIENT_ID
npx wrangler secret put TIDAL_CLIENT_SECRET
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
npx wrangler secret put TELEGRAM_ADMIN_IDS
npx wrangler secret put JWT_SECRET
npx wrangler secret put JWT_REFRESH_SECRET
npx wrangler secret put SESSION_ENCRYPTION_KEY
npx wrangler secret put YANDEX_API_TOKEN          # опционально
npx wrangler secret put YANDEX_FOLDER_ID          # опционально
```

#### 5. Запустить локально

```bash
# Терминал 1 — worker (Cloudflare Workers dev server, http://localhost:8787)
cd worker
npm run dev

# Терминал 2 — фронт (Vite, http://localhost:5173/bratan-music/)
npm run dev
```

Чтобы фронт ходил в локальный воркер, создай `.env.local` в корне:

```bash
VITE_API_URL=http://localhost:8787
```

#### 6. Настроить Telegram webhook

После того как воркер задеплоен (или временно exposes через [`cloudflared tunnel`](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/)), укажи Telegram'у адрес:

```bash
curl -F "url=https://<your-worker>.workers.dev/webhook/telegram" \
     -F "secret_token=<TELEGRAM_WEBHOOK_SECRET>" \
     -F "allowed_updates=[\"message\",\"callback_query\",\"pre_checkout_query\"]" \
     "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook"
```

#### 7. Деплой

```bash
# Фронт → GitHub Pages (автоматически на push в main, или вручную):
npm run build
# → dist/ готов к раздаче

# Worker → Cloudflare (автоматически на push в main, или вручную):
cd worker
npx wrangler deploy
```

### 🧪 Workflow разработки

```bash
# Фронт
npm run dev          # Vite dev server с HMR
npm run build        # tsc -b + vite build → dist/
npm run preview      # отдать dist/ локально
npm run lint         # eslint
npm run typecheck    # tsc --noEmit

# Worker
cd worker
npm run dev          # wrangler dev (локальный Workers runtime)
npm run deploy       # wrangler deploy
npm run lint         # eslint
npm run typecheck    # tsc --noEmit

# Миграции D1
cd worker
npx wrangler d1 migrations create bratan-music-db <name>
npx wrangler d1 migrations apply bratan-music-db --local   # против локальной dev DB
npx wrangler d1 migrations apply bratan-music-db --remote  # против прода
```

### 📁 Структура проекта

```
.
├── src/                              ◀── фронтенд (React + Vite, деплоится на GitHub Pages)
│   ├── app/                          страницы (роутер-роутируемые)
│   ├── components/
│   │   ├── layout/                   Sidebar, Player, FullscreenPlayer, MobileBottomDock
│   │   ├── features/                 PlaylistCard, TrackItem, Equalizer, AdminTidalPanel, …
│   │   └── ui/                       Button, Card, Marquee, TiltCard, LiquidGlassButton, …
│   ├── hooks/                        useAudioPlayer (двухслотный движок), useAuth, …
│   ├── store/                        Zustand: player / auth / settings / ui / roomConnection
│   ├── lib/                          api клиент, motion-presets, image-resize, trackActions
│   ├── i18n/                         переводы RU / EN
│   └── main.tsx                      QueryClientProvider + StrictMode
│
├── worker/                           ◀── бэкенд (Cloudflare Worker)
│   ├── src/
│   │   ├── index.ts                  Hono root, /health endpoints, cron handler
│   │   ├── routes/                   auth, user, search, tracks, albums, artists,
│   │   │                             playlists, library, explore, overrides,
│   │   │                             uploads, rooms, admin, webhook, ai
│   │   ├── services/
│   │   │   ├── AuthService.ts        JWT signing + verification, refresh-rotation
│   │   │   ├── UserService.ts        users CRUD, isAdmin, daily_listens
│   │   │   ├── SubscriptionService.ts активация Telegram Stars, ручная выдача
│   │   │   ├── StorageService.ts     R2 загрузки + генерация ключей
│   │   │   ├── RoomService.ts        listening rooms (state, members, controls)
│   │   │   ├── AiPlaylistService.ts  Yandex GPT → search-query expansion → Tidal fanout
│   │   │   ├── HealthService.ts      D1/KV/R2 пробы, log-ring буфер
│   │   │   └── tidal/
│   │   │       ├── TidalAuth.ts      OAuth + device flow + refresh + multi-account pool
│   │   │       ├── TidalApi.ts       low-level (search, album, artist, page)
│   │   │       ├── TidalWeb.ts       web fallback (cookie-scrape) для непокрытых endpoints
│   │   │       ├── TidalPool.ts      multi-account ротация
│   │   │       ├── TidalService.ts   high-level mapping → Track / Album / …
│   │   │       └── sessionCrypto.ts  AES-GCM at-rest
│   │   ├── middleware/               cors, rateLimit, jwtAuth, adminOnly
│   │   ├── do/                       ChatRoomDO (per-room WebSocket fanout)
│   │   ├── bot/                      Telegram webhook handler
│   │   ├── db/migrations/            23 D1-миграции
│   │   └── types/                    Env (Cloudflare bindings) + Variables
│   └── wrangler.toml                 worker config (commit-safe; секреты через `wrangler secret`)
│
├── .github/workflows/                CI (lint+typecheck+build) и деплой
├── public/                           статика (favicon, manifest, 404.html для SPA)
├── docs/                             документация по фичам
└── README.md                         ◀── ты тут
```

### 🗄️ Схема базы (главное)

- `users` — keyed по Telegram-id; `tg_username`, `tg_name`, `is_admin`, `is_banned`, `created_at`.
- `sessions` — refresh-token hashes per device, `expires_at`, `last_used_at`.
- `playlists` — owner, name, description, cover URL, public/private, share token, source kind (`user` / `tidal` / null), pinned timestamp.
- `playlist_tracks` — junction-таблица с `position`, `snapshot` (JSON для offline-рендера обложки/артиста/title).
- `library_items` — лайки треков/альбомов/артистов.
- `user_tracks` — свои загрузки (id, R2 key, mime type, size, метаданные).
- `track_overrides` — per-user "стримь этот файл вместо Tidal-трека" mapping.
- `subscriptions` — active/expired/manual, Telegram Stars charge id (idempotency).
- `daily_listen_tracks` — free-tier лимит "3 трека в сутки" (deduped per track).
- `play_history` — история прослушиваний с playback-контекстом.
- `auth_nonces` — single-use 5-минутные nonce для Telegram-deeplink-логина.
- `listening_rooms`, `listening_room_members`, `listening_room_state`, `room_chat_messages` — live-комнаты.
- `tidal_pool` — multi-account refresh-токены для горизонтального масштабирования music backend'а.
- `recommendation_seen` — 30-дневное rolling окно треков, уже показанных в дневных плейлистах.
- `user_taste_profile`, `user_dislikes` — feature-векторы для AI-плейлистов.

Всего 23 миграции, накатываются через `wrangler d1 migrations apply`.

### 🔒 Безопасность

Эта кодбаза прошла независимый security-аудит. Вкратце:

- ✅ **Ноль захардкоженных пользовательских секретов** — все production-секреты лежат в Cloudflare Workers Secret store.
- ✅ **Ноль npm-уязвимостей** (фронт + воркер).
- ✅ **Строгий CORS allowlist** — никаких `*` wildcard'ов.
- ✅ **Везде параметризованный SQL** — никакого string-interpolation в `prepare()`.
- ✅ **Telegram WebApp HMAC-верификация** с 24h max age + 5min skew.
- ✅ **JWT HS256**, 1h access + 30d refresh, refresh-токены хэшированы при хранении.
- ✅ **Telegram payment validation** — строгие проверки payload + amount + currency перед approval pre-checkout, idempotent активация по `telegram_payment_charge_id`.
- ✅ **Audio-proxy host allowlist** — только `*.tidal.com`, никакого open-relay.
- ✅ **R2 key validation** — `^[a-zA-Z0-9_-]{1,64}$`, без path-traversal.
- ✅ **Admin-статус перепроверяется из БД** на каждом admin-вызове, не кешируется в JWT.
- ✅ **Banned-юзеры инвалидируются мгновенно** — проверка на каждом запросе, а не только при выпуске JWT.

### 🤝 Контрибутинг

PR'ы приветствуются. Базовый flow:

1. Fork → branch → push.
2. CI должен быть зелёный (`npm run lint && npm run typecheck && npm run build` для фронта; то же для воркера).
3. PR против `dev`. PR'ы в `main` идут из `dev` после release-candidate ревью.
4. Conventional commits welcome: `feat:`, `fix:`, `chore:`, `docs:`, опциональный scope (`feat(player): …`).

### 📜 Лицензия

Проект — для **образовательного и личного использования**. Интеграция с Tidal API использует публично известные mobile-client credentials, reverse-engineered из open-source проектов. Соблюдение [Tidal Terms of Service](https://tidal.com/terms) — ответственность оператора. Авторы не несут ответственности за нецелевое использование.

Если нужна коммерческая лицензия / партнёрство — пишите через Telegram-бота.

---

<div align="center">

**Made with ❤️ on the edge of the internet.**

Cloudflare Workers · D1 · KV · R2 · Durable Objects · Hono · React · Vite · Tailwind · Tidal · Telegram

</div>
