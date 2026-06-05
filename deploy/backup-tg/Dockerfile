# ── Postgres → Telegram backup ──────────────────────────────────────
# A tiny cron container that dumps the bratan-music Postgres database
# once a day and ships the gzipped dump to the bot's admin chat via
# Telegram's Bot API. No local persistence — the dump lives in
# `/tmp/dump.sql.gz` for the duration of the upload and is rm'd right
# after. Replaces the previous `prodrigestivill/postgres-backup-local`
# service which kept rotating dumps on a `pgbackups:` volume on disk
# (the user explicitly asked to stop "разрисывать место на сервере").
FROM alpine:3.21

RUN apk add --no-cache \
      postgresql16-client \
      ca-certificates \
      curl \
      bash \
      gzip \
      tzdata

WORKDIR /app

# Use a cron-like loop in bash instead of a real crond — alpine's
# busybox crond is fine but a single-file bash loop is easier to
# eyeball in `docker compose logs` and survives a `compose up -d`
# without losing the next-run timer to a crond-state restart.
COPY backup.sh /app/backup.sh
COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/backup.sh /app/entrypoint.sh

# Health: the script touches a sentinel file on every successful
# upload. The healthcheck just verifies the file's mtime is younger
# than 26h — wider than the 24h schedule so a slow upstream Tidal
# Telegram outage doesn't flap the container. On first boot before
# any backup has run the sentinel is missing → healthcheck reports
# unhealthy until the first scheduled (or manually-triggered) run.
HEALTHCHECK --interval=1h --timeout=10s --start-period=30s --retries=2 \
  CMD test "$(find /tmp/last-backup-ok -mmin -1560 2>/dev/null | wc -l)" -eq 1 || exit 1

ENTRYPOINT ["/app/entrypoint.sh"]
