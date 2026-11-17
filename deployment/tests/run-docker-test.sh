#!/bin/sh
set -e

cd "$(dirname "$0")"
PROJECT="socialradio_e2e"
# The engine is overridable so the same suites can run elsewhere:
#   COMPOSE_BIN="podman compose" deployment/tests/run-docker-test.sh
COMPOSE_BIN="${COMPOSE_BIN:-docker compose}"
COMPOSE="$COMPOSE_BIN -p $PROJECT -f ../docker/docker-compose.yml -f docker-compose.test.yml"
export COMPOSE_PROGRESS=auto

cleanup() {
  STATUS=$?
  trap - EXIT
  if [ $STATUS -ne 0 ]; then
    echo "=== App Container Logs (Failure Diagnosis) ==="
    $COMPOSE logs app 2>&1 | grep -v '"/healthcheck"' | tail -100 || true
    # The one-shot services run before the app is up, and their output is the
    # only evidence of why the stack failed to come up.
    for SERVICE in promote-fixture migration bucket-init; do
      echo "=== $SERVICE Logs ==="
      $COMPOSE logs "$SERVICE" 2>&1 | tail -40 || true
    done
  fi
  echo "=== Clean Up ==="
  $COMPOSE down -v >/dev/null 2>&1 || true
  # Without this the trap's last command decided the exit status, so a failed
  # run reported 0 and a broken stack looked like a green one.
  exit "$STATUS"
}
# A failed run must still tear down: volumes leaking into the next run make
# it non-clean (e.g. a dead-sub row surviving a crashed suite).
trap cleanup EXIT

TARGET="${1:-all}"
echo "=== E2E Test Suite: $TARGET ==="
# Pre-flight amnesiac wipe: ensure zero volume leakage from aborted prior runs
$COMPOSE down -v >/dev/null 2>&1 || true
TEST_SUITE="$TARGET" $COMPOSE run --build --rm -e TEST_SUITE="$TARGET" tests
