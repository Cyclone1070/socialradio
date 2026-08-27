#!/bin/sh
set -e

# ── Core Assertion Helpers ─────────────────────────────────────────────

fail() {
  echo "  FAIL: $*" >&2
  exit 1
}

req() {
  METHOD="$1"
  URL="$2"
  shift 2

  HEADER_FILE=$(mktemp)
  BODY_FILE=$(mktemp)

  curl -s --max-time 600 -X "$METHOD" "$URL" "$@" \
    -D "$HEADER_FILE" \
    -o "$BODY_FILE"

  STATUS=$(grep -i '^HTTP/' "$HEADER_FILE" | tail -1 | awk '{print $2}')
  BODY=$(cat "$BODY_FILE")

  rm -f "$HEADER_FILE" "$BODY_FILE"
}

assert_status() {
  METHOD="$1"
  URL="$2"
  EXPECTED="$3"
  shift 3

  req "$METHOD" "$URL" "$@"
  if [ "$EXPECTED" = "2xx" ]; then
    case "$STATUS" in
      2*) ;;
      *)
        echo "  Body: $BODY"
        fail "expected 2xx status, got $STATUS"
        ;;
    esac
    echo "  Status: $STATUS (expected 2xx)"
  else
    if [ "$STATUS" != "$EXPECTED" ]; then
      echo "  Body: $BODY"
      fail "expected $EXPECTED, got $STATUS"
    fi
    echo "  Status: $STATUS (expected $EXPECTED)"
  fi
}

assert_jq() {
  expr="$1"
  desc="$2"
  if ! echo "$BODY" | jq -e "$expr" >/dev/null 2>&1; then
    echo "  Body: $BODY"
    fail "jq assertion failed: $expr ($desc)"
  fi
  echo "  ✓ $desc"
}

assert_empty_body() {
  if [ -n "$BODY" ]; then
    fail "expected empty body, got: $BODY"
  fi
  echo "  ✓ empty body"
}

# ── Configuration & Credentials ────────────────────────────────────────

EMAIL="${ADMIN_EMAIL:?ADMIN_EMAIL is required}"
PASSWORD="${ADMIN_PASSWORD:?ADMIN_PASSWORD is required}"
BASE_URL="${TARGET_URL:?TARGET_URL is required}"
SECRET="${INTERNAL_SERVICE_SECRET:-secret}"
MINIO_URL="${STORAGE_ENDPOINT:-http://minio:9000}"
BUCKET="${STORAGE_BUCKET:-socialradio-media}"

# ── SQL Execution ──────────────────────────────────────────────────────

psql_run() {
  PGPASSWORD=postgres psql -h db -U postgres -d socialradio \
    -v ON_ERROR_STOP=1 "$@"
}

# ── Base Fixtures & Token Caching ──────────────────────────────────────

ensure_base_fixtures() {
  USER_COUNT=$(psql_run -t -A -c "SELECT COUNT(*) FROM \"user\" WHERE \"email\" = 'user@socialradio.com';" 2>/dev/null || echo "0")
  if [ "$USER_COUNT" = "0" ]; then
    psql_run -f /scripts/fixtures/seed-base.sql >/dev/null || fail "seed-base.sql failed"
  fi
}

get_admin_token() {
  if [ -z "$ADMIN_TOKEN" ]; then
    req POST "$BASE_URL/auth/login" \
      -H "Content-Type: application/json" \
      -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}"
    ADMIN_TOKEN=$(echo "$BODY" | jq -r '.accessToken')
    [ -n "$ADMIN_TOKEN" ] && [ "$ADMIN_TOKEN" != "null" ] || fail "failed to acquire admin token"
  fi
  echo "$ADMIN_TOKEN"
}

get_user_token() {
  ensure_base_fixtures
  if [ -z "$USER_TOKEN" ]; then
    req POST "$BASE_URL/auth/login" \
      -H "Content-Type: application/json" \
      -d '{"email":"user@socialradio.com","password":"UserPass123!"}'
    USER_TOKEN=$(echo "$BODY" | jq -r '.accessToken')
    [ -n "$USER_TOKEN" ] && [ "$USER_TOKEN" != "null" ] || fail "failed to acquire user token"
  fi
  echo "$USER_TOKEN"
}
