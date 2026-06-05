# ── Build stage ────────────────────────────────────────
#
# Statically-linked Go binary, multi-stage so the final image is a
# scratch + ca-certs ~25 MB instead of dragging in a 300 MB base.
FROM golang:1.23-alpine AS builder

WORKDIR /src

# Cache go.mod first so a code-only edit doesn't bust the dep cache.
COPY api-go/go.mod api-go/go.sum ./
RUN go mod download

COPY api-go/ ./

# Copy migrations from worker/init-db/ so the binary's embed FS has
# the schema even after we drop the worker/ tree.
COPY worker/init-db/ /init-db/

# CGO disabled so the binary runs on alpine/scratch without glibc.
ENV CGO_ENABLED=0 GOOS=linux GOARCH=amd64
RUN go build -trimpath -ldflags="-s -w" -o /out/api ./cmd/api

# ── Production stage ──────────────────────────────────
FROM alpine:3.20

RUN apk add --no-cache ca-certificates tzdata curl
WORKDIR /app

COPY --from=builder /out/api ./api
COPY worker/src/db/migrations/ ./worker/src/db/migrations/
COPY worker/init-db/ ./worker/init-db/

EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=3s --retries=3 \
  CMD curl -sf http://localhost:3000/health || exit 1

ENTRYPOINT ["/app/api"]
