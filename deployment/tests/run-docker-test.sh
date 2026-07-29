#!/bin/sh
set -e

echo "========================================================="
echo "   LAUNCHING CONTAINERIZED BLACKBOX E2E TEST RUNNER      "
echo "========================================================="

export ADMIN_EMAIL=${ADMIN_EMAIL:-admin@socialradio.com}
export ADMIN_PASSWORD=${ADMIN_PASSWORD:-AdminPass123!}
PROJECT_NAME="socialradio_e2e"

CLEANUP() {
  echo "Cleaning up container test resources..."
  docker compose -p "$PROJECT_NAME" -f deployment/docker/docker-compose.yml -f deployment/tests/docker-compose.test.yml down -v --remove-orphans || true
}

CLEANUP
trap CLEANUP EXIT

echo "Building NestJS production bundle..."
npm run build

echo "Spinning up containerized blackbox E2E test stack..."
docker compose -p "$PROJECT_NAME" -f deployment/docker/docker-compose.yml -f deployment/tests/docker-compose.test.yml up --exit-code-from tests
