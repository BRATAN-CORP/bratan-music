# Go port — status board

Updated per commit. Anything `❌` returns HTTP 501 from the Go binary;
the TS `worker/` service remains the source of truth for that endpoint
until parity is reached.

| Area              | Status | Notes                                                                                      |
| ----------------- | ------ | ------------------------------------------------------------------------------------------ |
| Config / env      | ✅      | All env vars validated at startup.                                                         |
| DB (pgx)          | ✅      | Pool + migrations applied on boot (embedded + on-disk).                                    |
| Redis             | ✅      | go-redis client wired.                                                                     |
| MinIO             | ✅      | Bucket auto-created. Put/Get/Delete/PresignGet exposed.                                    |
| CORS              | ✅      | Allow-list mirrors worker.                                                                 |
| Rate-limit        | ✅      | IP 200/min + user 600/min via Redis.                                                       |
| JWT auth          | ✅      | HS256, sid claim, min_token_iat enforcement, session row presence check.                   |
| Telegram HMAC     | ✅      | Verified against spec, unit-tested (`internal/authz/telegram_test.go`).                    |
| Session AES-GCM   | ✅      | Encrypt/decrypt for stored Tidal session payloads.                                         |
| `/health`         | ✅      |                                                                                            |
| `/health/tidal`   | ⚠️     | Returns stub `ok` until Tidal client is ported.                                            |
| `/auth/whoami`    | ✅      |                                                                                            |
| `/auth/telegram`  | ✅      | Full Telegram WebApp login + per-IP signup cap + session metadata.                          |
| `/auth/refresh`   | ✅      | In-place session rotation (same sid), bumps last_used_at.                                   |
| `/auth/logout`    | ✅      | Drops session row by token_hash.                                                            |
| `/auth/nonce/:n`  | ✅      | GET, polled by deeplink-login flow.                                                         |
| `/auth/email/*`   | ✅      | Brevo transactional + OTP service ported. RU/EN body, disposable blocklist, per-IP signup cap. |
| `/user/me`        | ✅      |                                                                                            |
| `/user/settings`  | ✅      | GET + PUT.                                                                                 |
| `/user/quota`     | ✅      |                                                                                            |
| `/user/sessions`  | ✅      | List, revoke one, logout-all (bumps `min_token_iat`).                                      |
| `/history/*`      | ✅      | Play, recent (DISTINCT ON), clear.                                                         |
| `/playlists/*`    | ✅      | Full CRUD + reorder + pin + share-token.                                                   |
| `/library/*`      | ✅      | Likes for tracks (via liked playlist) / albums / artists (via `library_items`).            |
| `/search/*`       | ✅      | tracks/albums/artists/playlists ported via Tidal client (PLAYLISTS bucket on /v1/search).  |
| `/tracks/*`       | ✅      | GET track, stream (302), lyrics + PUT/DELETE/GET/stream override (50 MiB cap, MIME allowlist, sub-gated). |
| `/covers/*`       | ✅      | `GET /covers/proxy?url=…` host-allowlisted Tidal image proxy with edge-cache headers.       |
| `/albums/*`       | ✅      | GET album (with tracks) + GET album tracks.                                                |
| `/artists/*`      | ✅      | GET artist + top-tracks + albums + singles + releases (concatenated).                      |
| `/uploads/*`      | ✅      | list/get/create(multipart)/updateMeta/replaceFile/delete/stream; 50 MiB cap, MIME allowlist. |
| `/webhook/*`      | ✅      | POST /telegram (constant-time HMAC, async BotService dispatch: /start auth_/link_ deeplinks, /login, /app, /subscribe Stars invoice, /status, /help, /admin_*, pre_checkout validation, idempotent successful_payment). |
| `/admin/*`        | ⚠️     | Tidal device-flow + daily-playlists/reset ported. Health, ban/unban, grant still 501.       |
| `/explore/*`      | ✅      | Home/page/list/playlists ported via Tidal pages API; explicit-twin swap deferred until recs. |
| `/recommendations`| ⚠️     | wave / continue / dislikes (CRUD + details) / seed-artists / genre-seeds / artists search+suggested ported. TasteService + RecommendationService recreated in Go with the same JSON shape — endpoint contracts 1:1 with worker. Rerank simplified: language-script penalty + character-bias multipliers deferred (degrade gracefully — only ever subtract score). |
| `/daily-playlists`| ✅      | GET /today (lazy generate) + POST /save/{id}. 3 variants, cross-variant claim, 4-phase backfill, mood-quadrant pick. Cron RegenerateForActive wired. |
| `/rooms/*`        | ✅      | REST + WS chat hub; stream proxy gated to currently-playing track.                         |
| `/ai/playlists`   | ✅      | POST /generate (Yandex gpt-oss-120b plan → parallel tidal.Search → round-robin merge + dislike filter) + POST /save. |
| Cron orchestrator | ⚠️     | Loop runs at 04:30 UTC; task bodies are stubs until taste/daily/recs services are ported.  |

## Cut-over plan

1. Land all ❌ rows as `✅` in follow-up commits on this same branch.
2. Drop `worker/` directory + worker-specific CI bits.
3. Point nginx upstream from `api:3000` → `api-go:3000`, delete the
   side-by-side `api-go:3001` port mapping.
4. Unset draft on this PR and merge.
