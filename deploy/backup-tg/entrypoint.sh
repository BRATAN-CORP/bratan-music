#!/bin/bash
# Wait-for-schedule loop. Runs backup.sh once on boot (so the first
# backup doesn't wait up to 24h after a fresh deploy) and then every
# BACKUP_INTERVAL_SECONDS (default: 86400 = daily).
#
# Why a bash sleep loop rather than crond:
#   • single file, single process — easier to inspect with
#     `docker compose logs postgres-backup-tg`;
#   • no risk of a crond state file (anacron-style "ran at boot")
#     re-triggering on every container restart in a flapping deploy;
#   • the first-boot kick is explicit and predictable.

set -euo pipefail

INTERVAL="${BACKUP_INTERVAL_SECONDS:-86400}"

# Optional initial delay so multiple backup containers don't dogpile
# Postgres at the exact moment compose starts them.
SETTLE="${BACKUP_INITIAL_DELAY_SECONDS:-30}"

echo "[entrypoint] postgres-backup-tg up. interval=${INTERVAL}s. settling ${SETTLE}s before first run."
sleep "$SETTLE"

while true; do
  START="$(date -u +%FT%TZ)"
  echo "[entrypoint] running backup at ${START}"
  if /app/backup.sh; then
    echo "[entrypoint] backup OK at $(date -u +%FT%TZ)"
  else
    rc=$?
    echo "[entrypoint] backup FAILED (rc=${rc}) at $(date -u +%FT%TZ)" >&2
  fi
  echo "[entrypoint] sleeping ${INTERVAL}s until next run"
  sleep "$INTERVAL"
done
