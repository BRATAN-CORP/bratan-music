#!/usr/bin/env bash
#
# Restore the Postgres database from a Telegram-delivered backup.
#
# Backups are produced by the `postgres-backup-tg` service and shipped
# directly to the bot's admin chat (default: 422896004). They are
# named `bratan-music-YYYYMMDDTHHMMSSZ.sql.gz`. To restore:
#
#   1. Save the .sql.gz file from your Telegram chat to disk on the
#      server (e.g. `/tmp/bratan-music-...sql.gz`). If the dump was
#      large enough to be split, concatenate the `.part-NNN` files
#      first: `cat *.part-* > bratan-music-...sql.gz`.
#   2. Run this script with the path as the first argument:
#         ./restore.sh /tmp/bratan-music-20260524T043000Z.sql.gz
#
# The previous Postgres database is wiped before the restore — the
# script prompts for explicit "yes" confirmation before doing so.

set -euo pipefail

cd "$(dirname "$0")"

BACKUP_PATH="${1:-}"
if [[ -z "$BACKUP_PATH" ]]; then
  echo "Usage: $0 /path/to/bratan-music-YYYYMMDDTHHMMSSZ.sql.gz" >&2
  echo "(save the backup from your Telegram admin chat first)" >&2
  exit 1
fi
if [[ ! -f "$BACKUP_PATH" ]]; then
  echo "Backup file not found: $BACKUP_PATH" >&2
  exit 1
fi

echo "==> Restoring Postgres from: $BACKUP_PATH"
read -rp "This will WIPE the current 'bratan_music' DB. Continue? [yes/N] " confirm
[[ "$confirm" == "yes" ]] || { echo "aborted"; exit 1; }

echo "==> Stopping API to release connections"
docker compose stop api

echo "==> Dropping & recreating database"
docker compose exec -T postgres psql -U bratan -d postgres -c \
  "DROP DATABASE IF EXISTS bratan_music WITH (FORCE); CREATE DATABASE bratan_music OWNER bratan;"

echo "==> Loading dump"
gunzip -c "$BACKUP_PATH" | docker compose exec -T postgres psql -U bratan -d bratan_music

echo "==> Restarting API"
docker compose start api

echo "==> Done. Verify with: docker compose exec postgres psql -U bratan -d bratan_music -c '\\dt'"
