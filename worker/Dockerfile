# ── Build stage ────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package.json ./

# Install all deps (including dev for esbuild)
RUN npm install

# Copy source
COPY tsconfig.node.json ./
COPY src/ src/

# Bundle with esbuild — single output file, all deps external (resolved at runtime)
RUN npx esbuild src/node-entry.ts \
    --bundle \
    --platform=node \
    --target=node20 \
    --format=esm \
    --outfile=dist/node-entry.mjs \
    --external:pg \
    --external:ioredis \
    --external:minio \
    --external:ws \
    --external:@hono/node-server \
    --external:hono \
    --banner:js="import{createRequire}from'module';const require=createRequire(import.meta.url);"

# ── Production stage ──────────────────────────────────
FROM node:20-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY --from=builder /app/dist/ dist/

# Copy init-db for potential use
COPY init-db/ init-db/

EXPOSE 3000

CMD ["node", "--experimental-specifier-resolution=node", "dist/node-entry.mjs"]
