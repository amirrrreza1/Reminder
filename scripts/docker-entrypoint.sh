#!/bin/sh
set -eu

ROLE="${1:-web}"

case "$ROLE" in
  web)
    exec node apps/web/server.js
    ;;
  worker)
    exec node /app/runtime/worker/dist/index.js
    ;;
  migrate)
    exec node /app/runtime/db/dist/migrate-cli.js
    ;;
  *)
    echo "Unknown role: $ROLE (expected web|worker|migrate)" >&2
    exit 1
    ;;
esac
