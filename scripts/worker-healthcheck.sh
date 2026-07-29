#!/bin/sh
set -eu

# Worker health: heartbeat must be fresher than twice the poll interval,
# and the database must accept a simple query.
# Secrets are never printed.

: "${DATABASE_URL:?DATABASE_URL is required}"
: "${NOTIFICATION_POLL_INTERVAL_SECONDS:=60}"

MAX_AGE_SECONDS=$((NOTIFICATION_POLL_INTERVAL_SECONDS * 2))
if [ "$MAX_AGE_SECONDS" -lt 30 ]; then
  MAX_AGE_SECONDS=30
fi

RESULT="$(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -Atc \
  "select case when exists (
      select 1 from worker_heartbeats
      where updated_at > now() - make_interval(secs => ${MAX_AGE_SECONDS})
    ) then 'ok' else 'stale' end;")"

if [ "$RESULT" = "ok" ]; then
  exit 0
fi

echo "worker heartbeat stale or missing" >&2
exit 1
