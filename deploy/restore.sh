#!/usr/bin/env bash
#
# Restore the Postgres database from a backup produced by the
# `postgres-backup` service (prodrigestivill/postgres-backup-local).
#
# Backups live in the `pgbackups` Docker volume under one of:
#   /backups/daily/bratan_music-YYYY-MM-DD.sql.gz
#   /backups/weekly/...
#   /backups/monthly/...
#   /backups/last/bratan_music-latest.sql.gz
#
# Usage:
#   ./restore.sh                       # restore latest daily backup
#   ./restore.sh /backups/daily/bratan_music-2026-05-24.sql.gz
#
set -euo pipefail

cd "$(dirname "$0")"

BACKUP_PATH="${1:-/backups/last/bratan_music-latest.sql.gz}"

echo "==> Restoring Postgres from: $BACKUP_PATH"
read -rp "This will WIPE the current 'bratan_music' DB. Continue? [yes/N] " confirm
[[ "$confirm" == "yes" ]] || { echo "aborted"; exit 1; }

echo "==> Verifying backup file exists in postgres-backup container"
docker compose exec -T postgres-backup test -f "$BACKUP_PATH"

echo "==> Stopping API to release connections"
docker compose stop api

echo "==> Dropping and recreating database"
docker compose exec -T postgres psql -U bratan -d postgres -c "DROP DATABASE IF EXISTS bratan_music;"
docker compose exec -T postgres psql -U bratan -d postgres -c "CREATE DATABASE bratan_music OWNER bratan;"

echo "==> Streaming backup into psql"
docker compose exec -T postgres-backup gunzip -c "$BACKUP_PATH" \
  | docker compose exec -T postgres psql -U bratan -d bratan_music

echo "==> Restarting API"
docker compose up -d api

echo "==> Done. Verify with: curl -s https://${DOMAIN:-bratan-music.eu.cc}/api/health"
