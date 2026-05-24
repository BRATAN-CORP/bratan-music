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
| `/auth/telegram`  | ❌      | Awaiting AuthService port.                                                                 |
| `/auth/refresh`   | ❌      |                                                                                            |
| `/auth/logout`    | ❌      |                                                                                            |
| `/auth/nonce*`    | ❌      |                                                                                            |
| `/auth/email/*`   | ❌      | Brevo client + OTP service pending.                                                        |
| `/user/me`        | ✅      |                                                                                            |
| `/user/settings`  | ✅      | GET + PUT.                                                                                 |
| `/user/quota`     | ✅      |                                                                                            |
| `/user/sessions`  | ✅      | List, revoke one, logout-all (bumps `min_token_iat`).                                      |
| `/history/*`      | ✅      | Play, recent (DISTINCT ON), clear.                                                         |
| `/playlists/*`    | ✅      | Full CRUD + reorder + pin + share-token.                                                   |
| `/library/*`      | ✅      | Likes for tracks (via liked playlist) / albums / artists (via `library_items`).            |
| `/search/*`       | ❌      | Needs Tidal client.                                                                        |
| `/tracks/*`       | ❌      | Stream proxy, overrides, lyrics — all pending.                                             |
| `/covers/*`       | ❌      |                                                                                            |
| `/albums/*`       | ❌      |                                                                                            |
| `/artists/*`      | ❌      |                                                                                            |
| `/uploads/*`      | ❌      |                                                                                            |
| `/webhook/*`      | ❌      | Telegram bot.                                                                              |
| `/admin/*`        | ❌      |                                                                                            |
| `/explore/*`      | ❌      |                                                                                            |
| `/recommendations`| ❌      |                                                                                            |
| `/daily-playlists`| ❌      |                                                                                            |
| `/rooms/*`        | ❌      | WS hub + REST.                                                                             |
| `/ai/playlists`   | ❌      | Yandex GPT.                                                                                |
| Cron orchestrator | ⚠️     | Loop runs at 04:30 UTC; task bodies are stubs until taste/daily/recs services are ported.  |

## Cut-over plan

1. Land all ❌ rows as `✅` in follow-up commits on this same branch.
2. Drop `worker/` directory + worker-specific CI bits.
3. Point nginx upstream from `api:3000` → `api-go:3000`, delete the
   side-by-side `api-go:3001` port mapping.
4. Unset draft on this PR and merge.
