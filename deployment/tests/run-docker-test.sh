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

echo "Spinning up application stack..."
docker compose -p "$PROJECT_NAME" -f deployment/docker/docker-compose.yml -f deployment/tests/docker-compose.test.yml up -d db minio browserless app

echo "Waiting for NestJS app container to report healthy..."
until docker compose -p "$PROJECT_NAME" -f deployment/docker/docker-compose.yml -f deployment/tests/docker-compose.test.yml exec -T app wget -q --spider http://localhost:3000/healthcheck 2>/dev/null; do
  sleep 1
done

echo "Injecting test-only regular user fixture (seed-test-user.sql)..."
docker compose -p "$PROJECT_NAME" -f deployment/docker/docker-compose.yml -f deployment/tests/docker-compose.test.yml exec -T db psql -U postgres -d socialradio -f - < deployment/tests/seed-test-user.sql

echo "Running containerized blackbox E2E test suite..."
docker compose -p "$PROJECT_NAME" -f deployment/docker/docker-compose.yml -f deployment/tests/docker-compose.test.yml up --exit-code-from tests tests
