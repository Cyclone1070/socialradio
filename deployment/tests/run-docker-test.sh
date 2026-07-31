#!/bin/sh
set -e

cd "$(dirname "$0")"
PROJECT="socialradio_e2e"
COMPOSE="docker compose -p $PROJECT -f ../docker/docker-compose.yml -f docker-compose.test.yml"
export COMPOSE_PROGRESS=plain

echo "=== E2E Test ==="
$COMPOSE run --build --rm tests
result=$?

echo "=== Clean Up ==="
$COMPOSE down -v

exit $result
