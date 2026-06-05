#!/bin/bash
set -euo pipefail

# ─────────────────────────────────────────────────────────────
# BRATAN MUSIC — Server Setup & Deploy Script
# Run as root on the server: bash setup.sh
# ─────────────────────────────────────────────────────────────

DOMAIN="bratan-music.eu.cc"
PROJECT_DIR="/opt/bratan-music"
REPO_URL="https://github.com/BRATAN-CORP/bratan-music.git"
BRANCH="main"

echo "╔═══════════════════════════════════════════════╗"
echo "║   BRATAN MUSIC — Server Setup                ║"
echo "╚═══════════════════════════════════════════════╝"

# ── 1. Install Docker if missing ─────────────────────────
if ! command -v docker &>/dev/null; then
    echo "[1/8] Installing Docker..."
    curl -fsSL https://get.docker.com | sh
    systemctl enable docker
    systemctl start docker
else
    echo "[1/8] Docker already installed: $(docker --version)"
fi

# ── 2. Install Docker Compose plugin if missing ─────────
if ! docker compose version &>/dev/null; then
    echo "[2/8] Installing Docker Compose..."
    apt-get update -qq && apt-get install -y docker-compose-plugin
else
    echo "[2/8] Docker Compose ready: $(docker compose version --short)"
fi

# ── 3. Clone/update repo ────────────────────────────────
echo "[3/8] Setting up project at $PROJECT_DIR..."
if [ -d "$PROJECT_DIR/app" ]; then
    echo "  Updating existing repo..."
    cd "$PROJECT_DIR/app" && git fetch origin && git reset --hard "origin/$BRANCH"
else
    mkdir -p "$PROJECT_DIR"
    git clone --depth 1 -b "$BRANCH" "$REPO_URL" "$PROJECT_DIR/app"
fi

# ── 4. Generate secrets (once) ───────────────────────────
ENV_FILE="$PROJECT_DIR/deploy/.env"
if [ ! -f "$ENV_FILE" ]; then
    echo "[4/8] Generating .env with secrets..."
    mkdir -p "$PROJECT_DIR/deploy"
    cat > "$ENV_FILE" << ENVEOF
# ── Database ──
POSTGRES_PASSWORD=$(openssl rand -hex 20)

# ── MinIO ──
MINIO_ACCESS_KEY=$(openssl rand -hex 12)
MINIO_SECRET_KEY=$(openssl rand -hex 24)

# ── Domain ──
DOMAIN=$DOMAIN

# ── JWT ──
JWT_SECRET=$(openssl rand -hex 32)
JWT_REFRESH_SECRET=$(openssl rand -hex 32)
SESSION_ENCRYPTION_KEY=$(openssl rand -hex 16)

# ── Tidal ── (fill these in!)
TIDAL_CLIENT_ID=
TIDAL_CLIENT_SECRET=
TIDAL_SESSION_TOKEN=

# ── Telegram ──
TELEGRAM_BOT_TOKEN=
TELEGRAM_BOT_USERNAME=
TELEGRAM_ADMIN_IDS=
TELEGRAM_WEBHOOK_SECRET=$(openssl rand -hex 16)

# ── Brevo (email) ──
BREVO_API_KEY=
BREVO_SENDER_EMAIL=noreply.bratanmusic@gmail.com
BREVO_SENDER_NAME=BRATAN MUSIC

# ── Yandex AI (optional) ──
YANDEX_API_TOKEN=
YANDEX_FOLDER_ID=
YANDEX_MODEL_URI=
ENVEOF
    echo "  Created $ENV_FILE — edit it to add Tidal/Telegram secrets!"
else
    echo "[4/8] .env already exists, keeping current secrets"
fi

# ── 5. Copy deploy files ────────────────────────────────
echo "[5/8] Copying deploy config..."
cp -r "$PROJECT_DIR/app/deploy/." "$PROJECT_DIR/deploy/" 2>/dev/null || true
cp "$PROJECT_DIR/app/deploy/docker-compose.yml" "$PROJECT_DIR/deploy/docker-compose.yml"
cp -r "$PROJECT_DIR/app/deploy/nginx" "$PROJECT_DIR/deploy/"

# ── 6. Build frontend ───────────────────────────────────
echo "[6/8] Building frontend..."
if command -v node &>/dev/null && [ "$(node -v | cut -d. -f1 | tr -d v)" -ge 18 ]; then
    NODE_CMD="node"
    NPM_CMD="npm"
else
    # Use Docker to build frontend
    echo "  Using Docker for Node.js build..."
    docker run --rm -v "$PROJECT_DIR/app:/app" -w /app \
        -e VITE_API_URL="https://$DOMAIN/api" \
        node:20-alpine sh -c "npm ci && npm run build"
fi

if [ -d "$PROJECT_DIR/app/dist" ]; then
    echo "  Copying built frontend to nginx/html..."
    rm -rf "$PROJECT_DIR/deploy/nginx/html"
    cp -r "$PROJECT_DIR/app/dist" "$PROJECT_DIR/deploy/nginx/html"
else
    echo "  WARNING: Frontend dist/ not found. Building locally..."
    docker run --rm -v "$PROJECT_DIR/app:/app" -w /app \
        -e VITE_API_URL="https://$DOMAIN/api" \
        node:20-alpine sh -c "npm ci && npx vite build --base=/"
    if [ -d "$PROJECT_DIR/app/dist" ]; then
        rm -rf "$PROJECT_DIR/deploy/nginx/html"
        cp -r "$PROJECT_DIR/app/dist" "$PROJECT_DIR/deploy/nginx/html"
    fi
fi

# ── 7. Start infrastructure (no SSL yet) ────────────────
echo "[7/8] Starting services..."
cd "$PROJECT_DIR/deploy"

# First, start without SSL (use temp self-signed for nginx to boot)
mkdir -p "$PROJECT_DIR/deploy/nginx/certbot-webroot"

# Create a temp nginx config for cert issuance (HTTP only)
cat > "$PROJECT_DIR/deploy/nginx/conf.d/default.conf" << 'TMPNGINX'
server {
    listen 80;
    server_name bratan-music.eu.cc;

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location /api/ {
        rewrite ^/api/(.*) /$1 break;
        proxy_pass http://api-go:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header CF-Connecting-IP $remote_addr;
    }

    location / {
        root /usr/share/nginx/html;
        index index.html;
        try_files $uri $uri/ /index.html;
    }
}
TMPNGINX

docker compose up -d postgres redis minio
echo "  Waiting for databases..."
sleep 10
docker compose up -d api nginx

# ── 8. Obtain SSL certificate ───────────────────────────
echo "[8/8] Obtaining SSL certificate..."
sleep 5

docker compose run --rm certbot certonly \
    --webroot \
    --webroot-path /var/www/certbot \
    -d "$DOMAIN" \
    --email admin@bratan-music.eu.cc \
    --agree-tos \
    --no-eff-email \
    --force-renewal

# Now switch to full HTTPS config
cat > "$PROJECT_DIR/deploy/nginx/conf.d/default.conf" << 'SSLNGINX'
server {
    listen 80;
    server_name bratan-music.eu.cc;

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location / {
        return 301 https://$server_name$request_uri;
    }
}

server {
    listen 443 ssl http2;
    server_name bratan-music.eu.cc;

    ssl_certificate /etc/letsencrypt/live/bratan-music.eu.cc/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/bratan-music.eu.cc/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers on;

    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    client_max_body_size 50m;

    location /api/ {
        rewrite ^/api/(.*) /$1 break;
        proxy_pass http://api-go:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header CF-Connecting-IP $remote_addr;
    }

    location /api/rooms/ {
        rewrite ^/api/(.*) /$1 break;
        proxy_pass http://api-go:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header CF-Connecting-IP $remote_addr;
        proxy_read_timeout 3600s;
    }

    location /webhook/ {
        proxy_pass http://api-go:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header CF-Connecting-IP $remote_addr;
    }

    location / {
        root /usr/share/nginx/html;
        index index.html;
        try_files $uri $uri/ /index.html;
    }

    location ~* \.(js|css|png|jpg|jpeg|gif|svg|ico|woff2?|ttf|eot)$ {
        root /usr/share/nginx/html;
        expires 365d;
        add_header Cache-Control "public, immutable";
    }
}
SSLNGINX

docker compose restart nginx

echo ""
echo "╔═══════════════════════════════════════════════╗"
echo "║   ✅ Setup complete!                          ║"
echo "║                                               ║"
echo "║   Site: https://$DOMAIN                       ║"
echo "║   API:  https://$DOMAIN/api/health            ║"
echo "╚═══════════════════════════════════════════════╝"
