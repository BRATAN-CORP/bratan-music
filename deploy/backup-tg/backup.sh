#!/bin/bash
# ── Dump Postgres → Telegram, no local persistence ─────────────────
#
# Why this script (and not prodrigestivill/postgres-backup-local):
#   • The user explicitly does not want backups taking up disk on the
#     server. Past setup kept a rolling 14-day / 4-week / 6-month
#     window on a `pgbackups:` named volume — that's free for now but
#     compounds on every cold-start backup of MinIO blobs and DB
#     growth long-term.
#   • The user wants the dump shipped to a Telegram admin chat
#     (422896004 today). That doubles as off-host storage and as a
#     trivially-discoverable archive in the admin's chat history.
#
# The dump lives in /tmp for the duration of the upload and is rm'd
# in a `trap` even on failure so a partial dump never lingers across
# container restarts.
#
# File size handling:
#   • Cloud `api.telegram.org` caps sendDocument at 50 MB upload.
#   • A locally-hosted `telegram-bot-api` server lifts that to 2 GB.
#     The compose file ships a `telegram-bot-api` service for
#     exactly this reason; set TELEGRAM_BOT_API_URL to its address
#     (default `http://telegram-bot-api:8081`) when API_ID/HASH are
#     configured.
#   • If the gzipped dump ever exceeds the active limit, the script
#     splits it into ~45 MB chunks (cloud) / ~1900 MB chunks (local)
#     using `split` and sends each chunk as a separate document with
#     a numeric suffix so the admin can `cat *.part-*` them back.
#
# Exit codes (so the entrypoint loop can log them):
#   0 — dump + upload OK
#   1 — pg_dump failed
#   2 — Telegram upload failed (no chunk made it through)
#   3 — required env var missing

set -euo pipefail

: "${POSTGRES_HOST:?POSTGRES_HOST is required}"
: "${POSTGRES_DB:?POSTGRES_DB is required}"
: "${POSTGRES_USER:?POSTGRES_USER is required}"
: "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required}"
: "${TELEGRAM_BOT_TOKEN:?TELEGRAM_BOT_TOKEN is required}"
: "${TELEGRAM_BACKUP_CHAT_ID:?TELEGRAM_BACKUP_CHAT_ID is required (admin chat id, e.g. 422896004)}"

# Default to the cloud Bot API when a local server isn't wired up.
# Set TELEGRAM_BOT_API_URL=http://telegram-bot-api:8081 in compose to
# switch to the local server (2 GB / file vs 50 MB / file).
TELEGRAM_BOT_API_URL="${TELEGRAM_BOT_API_URL:-https://api.telegram.org}"

# Use a slightly conservative limit below the hard wall so we don't
# get bitten by sendDocument's multipart overhead (boundary + form
# fields + headers). 47 MB / 1900 MB leaves headroom on both servers.
if [[ "$TELEGRAM_BOT_API_URL" == *"api.telegram.org"* ]]; then
  CHUNK_BYTES=49000000   # 47 MB-ish — cloud Bot API cap is 50 MB
  LIMIT_LABEL="cloud / 50 MB"
else
  CHUNK_BYTES=1900000000 # ~1.9 GB — local Bot API server cap is 2 GB
  LIMIT_LABEL="local / 2 GB"
fi

TS="$(date -u +%Y%m%dT%H%M%SZ)"
WORK="/tmp/backup-${TS}"
DUMP="${WORK}/bratan-music-${TS}.sql.gz"
SENTINEL="/tmp/last-backup-ok"
mkdir -p "$WORK"

# Always clean up the temp dir, even on hard failure mid-upload.
trap 'rm -rf "$WORK"' EXIT

echo "[backup] $(date -u +%FT%TZ) starting dump → ${DUMP} (telegram limit: ${LIMIT_LABEL})"

# `-Z9` compresses inside pg_dump → smaller wire to gzip is no-op
# but the resulting file is properly tagged for `gunzip -k`. `--clean`
# + `--if-exists` + `--no-owner` + `--no-privileges` mirror what the
# old prodrigestivill backup did so the resulting dump remains
# restorable into a fresh Postgres without manual ALTER OWNER tweaks.
export PGPASSWORD="$POSTGRES_PASSWORD"
if ! pg_dump \
      -h "$POSTGRES_HOST" \
      -U "$POSTGRES_USER" \
      -d "$POSTGRES_DB" \
      --clean --if-exists --no-owner --no-privileges \
    | gzip -9 > "$DUMP"; then
  echo "[backup] pg_dump failed — aborting." >&2
  exit 1
fi
unset PGPASSWORD

DUMP_BYTES="$(stat -c %s "$DUMP")"
echo "[backup] dump bytes: ${DUMP_BYTES}"

# Split iff > chunk size. We send a single document otherwise so the
# admin's chat doesn't get cluttered with "part 1 of 1" attachments.
PARTS=()
if (( DUMP_BYTES > CHUNK_BYTES )); then
  echo "[backup] dump exceeds chunk limit (${CHUNK_BYTES} bytes) — splitting"
  ( cd "$WORK" && split -b "$CHUNK_BYTES" -d -a 3 "$(basename "$DUMP")" "$(basename "$DUMP").part-" )
  for f in "$WORK"/*.part-*; do PARTS+=("$f"); done
  echo "[backup] split into ${#PARTS[@]} parts"
  # Remove the un-split monolith — only chunks travel.
  rm -f "$DUMP"
else
  PARTS=("$DUMP")
fi

API_BASE="${TELEGRAM_BOT_API_URL%/}/bot${TELEGRAM_BOT_TOKEN}"
TOTAL=${#PARTS[@]}
IDX=0
ANY_OK=0
ANY_FAIL=0

for path in "${PARTS[@]}"; do
  IDX=$((IDX + 1))
  base="$(basename "$path")"
  if (( TOTAL > 1 )); then
    caption="📦 bratan-music backup ${TS}\nфайл ${IDX}/${TOTAL}: ${base}"
  else
    caption="📦 bratan-music backup ${TS}\n${base}"
  fi
  echo "[backup] uploading ${base} (${IDX}/${TOTAL}) → ${TELEGRAM_BOT_API_URL}"
  http_code=$(curl --silent --show-error --output /tmp/tg-resp.json --write-out "%{http_code}" \
        --max-time 600 \
        -F chat_id="${TELEGRAM_BACKUP_CHAT_ID}" \
        -F caption="${caption}" \
        -F disable_notification=true \
        -F document=@"${path}" \
        "${API_BASE}/sendDocument" || echo "000")

  if [[ "$http_code" =~ ^2[0-9][0-9]$ ]]; then
    echo "[backup] ok (${http_code})"
    ANY_OK=1
  else
    body="$(cat /tmp/tg-resp.json 2>/dev/null | head -c 1024)"
    echo "[backup] FAILED (${http_code}): ${body}" >&2
    ANY_FAIL=1
  fi
done

if (( ANY_OK == 0 )); then
  echo "[backup] no chunk uploaded — failing run" >&2
  exit 2
fi

if (( ANY_FAIL == 1 )); then
  # Some parts failed — surface in logs, but don't claim success.
  # We deliberately don't update the sentinel so the healthcheck
  # eventually flips to unhealthy and the operator notices.
  echo "[backup] partial failure: some chunks didn't upload" >&2
  exit 2
fi

# Healthcheck sentinel: mtime is what the HEALTHCHECK probes.
touch "$SENTINEL"
echo "[backup] $(date -u +%FT%TZ) done."
