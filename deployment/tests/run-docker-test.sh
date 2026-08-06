#!/bin/sh
set -e

cd "$(dirname "$0")"
PROJECT="socialradio_e2e"
COMPOSE="docker compose -p $PROJECT -f ../docker/docker-compose.yml -f docker-compose.test.yml"
export COMPOSE_PROGRESS=auto

cleanup() {
  echo "=== Clean Up ==="
  $COMPOSE down -v >/dev/null 2>&1 || true
}
# A failed run must still tear down: volumes leaking into the next run make
# it non-clean (e.g. a dead-sub row surviving a crashed suite).
trap cleanup EXIT

echo "=== E2E Test ==="
$COMPOSE run --build --rm tests
