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
| `/health/tidal`   | ✅      | Mints a real Tidal token via `Auth.GetAccessToken`; returns `{status,hasToken,countryCode}`, 503 on error. 1:1 with worker node-entry.ts. |
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
| `/tracks/*`       | ✅      | GET track, lyrics, override (50 MiB cap, MIME allowlist, sub-gated), `/audio` CDN proxy (#478), `/{id}/radio` fallback chain (#485+#487), worker-shape stream JSON `{url(proxied),direct,source,quality}`. **`ResolveStream` is now a FULL port of `TidalWeb.ts`** — discovery quality-cache + self-heal (#488), BTS **and** DASH/HI_RES manifest decoding, 5-rung legacy ladder fallback + quality memo, discovery circuit breaker. See "Streaming parity" below. |
| `/covers/*`       | ✅      | `GET /covers/proxy?url=…` host-allowlisted Tidal image proxy with edge-cache headers.       |
| `/albums/*`       | ✅      | GET album (with tracks) + GET album tracks.                                                |
| `/artists/*`      | ✅      | GET artist + top-tracks + albums + singles + releases (concatenated).                      |
| `/uploads/*`      | ✅      | list/get/create(multipart)/updateMeta/replaceFile/delete/stream; 50 MiB cap, MIME allowlist. |
| `/webhook/*`      | ✅      | POST /telegram (constant-time HMAC, async BotService dispatch: /start auth_/link_ deeplinks, /login, /app, /subscribe Stars invoice, /status, /help, /admin_*, pre_checkout validation, idempotent successful_payment). |
| `/admin/*`        | ✅     | Tidal device-flow, daily-playlists/reset, /grant, /users/{id}/ban, /users/{id}/unban, /health (parallel tidal/db/r2/cron probes). |
| `/explore/*`      | ✅      | Home/page/list/playlists ported via Tidal pages API; explicit-twin swap deferred until recs. |
| `/recommendations`| ✅      | wave / continue / dislikes (CRUD + details) / seed-artists / genre-seeds / artists search+suggested ported. TasteService + RecommendationService recreated in Go with the same JSON shape — endpoint contracts 1:1 with worker. Rerank now FULL: taste / novelty / seen-penalty / familiar (+character familiar/discover bias) / mood / genre / **language-script penalty** (`wLangMismatch=-0.40`, gated to ≥50 plays, scaled by deficit below `langMinShare=0.10`). |
| `/daily-playlists`| ✅      | GET /today (lazy generate) + POST /save/{id}. 3 variants, cross-variant claim, 4-phase backfill, mood-quadrant pick. Cron RegenerateForActive wired. |
| `/rooms/*`        | ✅      | REST + WS chat hub; stream proxy gated to currently-playing track.                         |
| `/ai/playlists`   | ✅      | POST /generate (Yandex gpt-oss-120b plan → parallel tidal.Search → round-robin merge + dislike filter) + POST /save. |
| Cron orchestrator | ✅     | Loop runs at 04:30 UTC: Taste.RecomputeActive → Daily.RegenerateForActive → Recs.GCStale. |

## Streaming parity (RESOLVED — full TidalWeb.ts port)

The Go `tidal.ResolveStream` (`internal/tidal/stream.go` + `discovery.go`
+ `kv.go`) is now a full port of the TS worker's `TidalWeb.ts` (~600
lines). All previously-deferred pieces have landed and are unit-tested
(`stream_test.go`, 10 cases, all green):

1. **DASH / HI_RES manifest decoding** — `decodeManifest` now handles both
   `application/vnd.tidal.bts` (LOSSLESS/HIGH/LOW) **and**
   `application/dash+xml` (HI_RES / HI_RES_LOSSLESS): extracts `<BaseURL>`
   or the `initialization` template (`$RepresentationID$`→`audio`) + codec.
2. **Discovery quality-cache + self-heal (#488)** — `discoverQualities`
   probes `openapi.tidal.com/v2/trackManifests/:id`, maps formats →
   QualityLadder, caches in Redis (30d populated / **10min negative** so a
   transient openapi blip self-heals instead of poisoning the cache for 24h
   — the `PIPELINE_ERROR_READ: FFmpegDemuxer: demuxer seek failed`
   incident). Includes a 1h global circuit breaker tripped on 401/403
   (never on 404 — that's per-track). `drmData != null` → treated as
   no-discovery so the legacy ladder can still find a clear rung.
3. **Legacy quality-ladder fallback + `tidal-track-quality:` memo** —
   `legacyResolveStream` walks the full 5-rung ladder
   (HI_RES_LOSSLESS→HI_RES→LOSSLESS→HIGH→LOW) from the requested cap (or a
   memoised lower rung), returns the first clean (non-empty, non-encrypted)
   manifest and memoises it. Discovery-miss memos use the short self-heal
   TTL.
4. **Resolved-URL proxying** — stream + room-stream wrap the CDN URL in
   `/tracks/audio` (route implemented this pass).

Caching is wired through `*redisx.Client` (satisfies the new `tidal.KV`
interface); a nil cache is fully nil-safe (degrades to no-memo, never
panics). Worker's `skipCacheWrites` (a Cloudflare-KV-quota optimisation)
is intentionally dropped — Redis has no per-day write cap and the Go API
is a singleton, so a mutable per-request flag would be a data race.

## Cut-over plan

Streaming + recs parity gaps are now closed; PR is mergeable.

1. ✅ All rows are `✅` — no remaining ⚠️/❌.
2. Validate `api-go:3001` side-by-side against prod traffic (stream
   resolution across BTS + DASH tracks, and during a Tidal blip) — Go runs
   side-by-side, nginx stays on `api:3000` (TS) until validated.
3. Drop `worker/` directory + worker-specific CI bits.
4. Point nginx upstream from `api:3000` → `api-go:3000`, delete the
   side-by-side `api-go:3001` port mapping.
5. **NOTE:** merging this PR to `main` triggers `deploy-selfhosted.yml`,
   but nginx still routes to `api:3000` (TS) per docker-compose; Go runs at
   `:3001` side-by-side, so the merge is safe for prod playback. Do NOT cut
   nginx to Go until step 2 passes.
