# Bratan Music API — Go rewrite

This directory contains the Go port of `worker/` (the Hono/TypeScript
backend that originally ran on Cloudflare Workers and now runs on
Node.js on the self-hosted server).

The rewrite is being delivered in a single draft PR
(`feat/go-backend-rewrite`) with commits per feature block. While the
port is in progress, the legacy TypeScript service stays in
`worker/` as a fallback — both binaries build off the same git revision
so deployments can flip back to TS in seconds if a regression slips in.

## Quickstart

```bash
cd api-go
go run ./cmd/api
```

Required environment variables are listed in
[`internal/config/config.go`](./internal/config/config.go) — the
worker's `.env.example` is a superset of what Go needs.

## Project layout

```
api-go/
├── cmd/api/             # entrypoint (main.go)
├── internal/
│   ├── app/             # dependency container shared by handlers
│   ├── authz/           # JWT, Telegram HMAC, session AES-GCM
│   ├── config/          # env-based configuration
│   ├── db/              # pgx pool wrapper
│   ├── httpx/           # JSON helpers + request-scoped context
│   ├── middleware/      # CORS, rate-limit, JWT auth
│   ├── migrations/      # embedded + on-disk SQL migrations
│   ├── redisx/          # go-redis wrapper
│   ├── router/          # chi mux + cron loop
│   ├── routes/          # HTTP handlers (one file per resource)
│   ├── services/        # business logic (one struct per file)
│   └── storage/         # MinIO wrapper
├── Dockerfile           # multi-stage build, ~25 MB final image
└── go.mod
```

## Status (live)

See [`./STATUS.md`](./STATUS.md) for the up-to-date port progress per
route and per service. Anything not yet ported responds with HTTP 501
plus a clear message so the frontend can fall back to the TS API.

## Tests

```bash
go test ./...
```

Security-critical paths (Telegram HMAC verify, JWT sign/verify,
session AES-GCM) have unit tests in `internal/authz/`.
