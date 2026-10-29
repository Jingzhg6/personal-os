#!/bin/sh
# Automation worker for Docker Compose (ADR 0020, ADR 0026): calls the app's tick endpoint every
# minute, like `pnpm automation:worker` does in development. Needs APP_URL and
# AUTOMATION_WORKER_SECRET; without the secret, scheduled rules simply do not run.
set -u
url="${APP_URL:-http://app:3000}/api/automation/tick"
interval="${AUTOMATION_TICK_SECONDS:-60}"

if [ -z "${AUTOMATION_WORKER_SECRET:-}" ]; then
  echo "AUTOMATION_WORKER_SECRET is not set: the worker is idle (scheduled rules will not run)."
  # Stay up quietly so `docker compose ps` shows why instead of a restart loop.
  exec sleep infinity
fi

echo "automation worker: calling ${url} every ${interval}s"
while true; do
  result=$(wget -q -O - --header "Authorization: Bearer ${AUTOMATION_WORKER_SECRET}" \
    --post-data "" "${url}" 2>&1) || result="tick failed: ${result}"
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) ${result}"
  sleep "${interval}"
done
