#!/bin/sh
set -e

cd "$(dirname "$0")"
PROJECT="socialradio_e2e"
COMPOSE="docker compose -p $PROJECT -f ../docker/docker-compose.yml -f docker-compose.test.yml"
export COMPOSE_PROGRESS=auto

cleanup() {
  STATUS=$?
  if [ $STATUS -ne 0 ]; then
    echo "=== App Container Logs (Failure Diagnosis) ==="
    $COMPOSE logs app 2>&1 | grep -v '"/healthcheck"' | tail -100 || true
  fi
  echo "=== Clean Up ==="
  $COMPOSE down -v >/dev/null 2>&1 || true
}
# A failed run must still tear down: volumes leaking into the next run make
# it non-clean (e.g. a dead-sub row surviving a crashed suite).
trap cleanup EXIT

TARGET="${1:-all}"
echo "=== E2E Test Suite: $TARGET ==="
# Pre-flight amnesiac wipe: ensure zero volume leakage from aborted prior runs
$COMPOSE down -v >/dev/null 2>&1 || true
TEST_SUITE="$TARGET" $COMPOSE run --build --rm -e TEST_SUITE="$TARGET" tests
