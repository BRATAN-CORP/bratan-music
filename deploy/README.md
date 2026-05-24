# BRATAN MUSIC — Self-hosted Deploy

Полная инструкция по деплою стека на свой VPS. Стек на 100% свой — никаких Cloudflare Workers / D1 / KV / R2.

## Архитектура

```
                 ┌──────────────────────────────┐
   Internet ──▶  │ Cloudflare Tunnel (cloudflared)
                 │  bratan-music.eu.cc ──▶ :80   │
                 └──────────────┬───────────────┘
                                │
                          ┌─────▼──────┐
                          │   nginx    │  reverse proxy + SPA
                          └─┬────────┬─┘
                            │        │ /api, /webhook, /tracks/audio…
                ┌───────────▼─┐  ┌───▼────────┐
                │  static SPA │  │    api     │  Node 22 (Hono)
                └─────────────┘  └─┬───┬───┬──┘
                                   │   │   │
                ┌──────────────────┘   │   └────────────┐
                ▼                      ▼                ▼
        ┌──────────────┐     ┌──────────────┐   ┌──────────────┐
        │  postgres 16 │     │   redis 7    │   │    minio     │
        │  (was D1)    │     │   (was KV)   │   │   (was R2)   │
        └──────┬───────┘     └──────────────┘   └──────────────┘
               │
        ┌──────▼──────────────┐
        │ postgres-backup     │  ежедневный dump, retention 14d / 4w / 6m
        └─────────────────────┘
```

## Первичная настройка сервера

```bash
# 1. SSH в свежий Ubuntu/Debian
ssh root@<server-ip>

# 2. Клонировать репу и запустить setup
git clone https://github.com/BRATAN-CORP/bratan-music.git /opt/bratan-music
cd /opt/bratan-music/deploy
cp .env.example .env
nano .env                  # заполнить все секреты
bash ../deploy/setup.sh    # установит Docker, поднимет стек
```

`setup.sh` ставит Docker, билдит образы и запускает `docker compose up -d`.

## Деплой обновлений

После мержа в `main` GitHub Actions (`.github/workflows/deploy-selfhosted.yml`)
сам:

1. Билдит образы `bratan-music-api` и `bratan-music-web`, пушит в GHCR.
2. Подключается по SSH (через Cloudflare Access) к серверу.
3. `docker compose pull && docker compose up -d` на сервере.
4. Делает health-check на `https://${DOMAIN}/api/health`.

Ручной запуск: GitHub → Actions → *Deploy Self-Hosted* → Run workflow.

## Бэкапы Postgres

Сервис `postgres-backup` (prodrigestivill/postgres-backup-local) хранит
ежедневные `.sql.gz` дампы в Docker-volume `pgbackups`.

| Папка                   | Что          | Retention |
|-------------------------|--------------|-----------|
| `/backups/daily/`       | Ежедневно    | 14 дней   |
| `/backups/weekly/`      | Каждое вс    | 4 недели  |
| `/backups/monthly/`     | 1 числа      | 6 месяцев |
| `/backups/last/`        | latest.sql.gz| всегда    |

### Посмотреть бэкапы

```bash
cd /opt/bratan-music/deploy
docker compose exec postgres-backup ls -lh /backups/daily/
```

### Скачать бэкап на локальную машину

```bash
docker compose cp postgres-backup:/backups/daily/bratan_music-2026-05-24.sql.gz .
```

### Восстановить из бэкапа

```bash
cd /opt/bratan-music/deploy
./restore.sh                                                # из latest
./restore.sh /backups/daily/bratan_music-2026-05-24.sql.gz  # из конкретного
```

Скрипт остановит API, дропнет БД, накатит дамп и перезапустит API.

## Health-checks

Все сервисы имеют встроенный healthcheck. Проверить:

```bash
docker compose ps                       # колонка STATUS показывает (healthy)
docker compose exec api node -e "require('http').get('http://localhost:3000/api/health',r=>console.log(r.statusCode))"
curl -s https://bratan-music.eu.cc/api/health
```

## Логи

JSON-file driver с ротацией: `max-size=10m`, `max-file=5` на каждый сервис.

```bash
docker compose logs api -f --tail 200
docker compose logs nginx --since 1h
```

## Миграция сервера

Если переезжаем на новый VPS:

1. На старом: скачать последний бэкап (см. выше) + `pgbackups` volume.
2. На новом: `bash setup.sh`, отредактировать `.env`, `docker compose up -d postgres`.
3. Закинуть `bratan_music-latest.sql.gz` в volume `pgbackups` и запустить `./restore.sh`.
4. Обновить GitHub Secrets `DEPLOY_HOST` / `DEPLOY_SSH_KEY` если адрес меняется.
5. Обновить Cloudflare Tunnel hostname → новый IP / новый туннель.

## Что мигрировано из Cloudflare

| Было (CF)            | Стало (наше)          |
|----------------------|------------------------|
| Workers (Hono)       | Node 22 в Docker       |
| D1 (SQLite)          | PostgreSQL 16          |
| KV namespace         | Redis 7 (allkeys-lru)  |
| R2 bucket            | MinIO                  |
| Durable Objects (WS) | Локальный WebSocket    |
| Pages                | nginx + статический SPA|
| CF Tunnel            | Остался (для входа)    |

Все адаптеры в `worker/src/cf/` транслируют CF-API → стандартный pg/redis/s3.
