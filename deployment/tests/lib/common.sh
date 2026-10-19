#!/bin/sh
set -e

# ── Core Assertion Helpers ─────────────────────────────────────────────

fail() {
  echo "  FAIL: $*" >&2
  exit 1
}

# ── Instances ──────────────────────────────────────────────────────────
#
# The stack runs more than one app process on one database, and which one answers
# is not left to a load balancer. Every request made through `req` is routed to the
# next instance in turn, so a suite crosses the process boundary on every second
# call without saying anything about it: a value written by one process is read
# back from another, and state that only lived in memory would fail here.
#
# Rotation is by call order, so a given suite always sends the same request to the
# same instance. Nothing is random, and every status line names the process that
# answered. A URL that does not point at the first instance is left alone, which is
# how a suite pins a call to a particular process on purpose.

INSTANCE_ONE_URL="${INSTANCE_ONE_URL:-${TARGET_URL:?TARGET_URL is required}}"
INSTANCE_URLS="${INSTANCE_URLS:-$INSTANCE_ONE_URL}"
INSTANCE_TWO_URL=$(echo "$INSTANCE_URLS" | awk '{print $2}')
INSTANCE_TWO_URL="${INSTANCE_TWO_URL:-$INSTANCE_ONE_URL}"
INSTANCE_ROTATION=0

instance_name() {
  case "$1" in
    "$INSTANCE_ONE_URL") echo "app" ;;
    "$INSTANCE_TWO_URL") echo "app2" ;;
    *) echo "$1" ;;
  esac
}

# The nth instance, for a burst that has to name its targets before it fires.
instance_at() {
  if [ "$(( $1 % 2 ))" = "0" ]; then
    echo "$INSTANCE_ONE_URL"
  else
    echo "$INSTANCE_TWO_URL"
  fi
}

# A suite that needs a particular process says so for one call, and the rotation
# leaves it alone. Used where the identity of the instance is the subject.
ON_ONE() { ROUTE_PIN="$INSTANCE_ONE_URL"; }
ON_TWO() { ROUTE_PIN="$INSTANCE_TWO_URL"; }

# Sets ROUTED_URL and INSTANCE_NAME. It assigns rather than echoes on purpose: the
# rotation counter is the state that makes the alternation work, and a command
# substitution would run this in a subshell where the increment is thrown away.
route_url() {
  if [ -n "$ROUTE_PIN" ]; then
    ROUTED_INSTANCE="$ROUTE_PIN"
    ROUTE_PIN=""
  else
    case "$1" in
      "$INSTANCE_ONE_URL"*)
        if [ "$(( INSTANCE_ROTATION % 2 ))" = "0" ]; then
          ROUTED_INSTANCE="$INSTANCE_ONE_URL"
        else
          ROUTED_INSTANCE="$INSTANCE_TWO_URL"
        fi
        INSTANCE_ROTATION=$((INSTANCE_ROTATION + 1))
        ;;
      *)
        ROUTED_INSTANCE="$1"
        ;;
    esac
  fi

  INSTANCE_NAME=$(instance_name "$ROUTED_INSTANCE")
  if [ -n "$INSTANCE_LOG" ]; then
    echo "$INSTANCE_NAME" >> "$INSTANCE_LOG"
  fi

  case "$1" in
    "$INSTANCE_ONE_URL"*) ROUTED_URL="$ROUTED_INSTANCE${1#"$INSTANCE_ONE_URL"}" ;;
    *) ROUTED_URL="$1" ;;
  esac
}

req() {
  METHOD="$1"
  route_url "$2"
  URL="$ROUTED_URL"
  shift 2

  HEADER_FILE=$(mktemp)
  BODY_FILE=$(mktemp)

  REQ_TIME=$(curl -s --max-time 600 -w "%{time_total}" -X "$METHOD" "$URL" "$@" \
    -D "$HEADER_FILE" \
    -o "$BODY_FILE")

  STATUS=$(grep -i '^HTTP/' "$HEADER_FILE" | tail -1 | awk '{print $2}')
  HEADERS=$(cat "$HEADER_FILE")
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
        fail "expected 2xx status from $INSTANCE_NAME, got $STATUS"
        ;;
    esac
    echo "  Status: $STATUS (expected 2xx) [$INSTANCE_NAME ${REQ_TIME}s]"
  else
    if [ "$STATUS" != "$EXPECTED" ]; then
      echo "  Body: $BODY"
      fail "expected $EXPECTED from $INSTANCE_NAME, got $STATUS"
    fi
    echo "  Status: $STATUS (expected $EXPECTED) [$INSTANCE_NAME ${REQ_TIME}s]"
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
STORAGE_URL="${STORAGE_ENDPOINT:-http://seaweedfs:9000}"
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
  
  if [ ! -f /tmp/synth-fixture.mp3 ]; then
    ffmpeg -y -f lavfi -i "sine=frequency=440:duration=5" -c:a libmp3lame -b:a 128k /tmp/synth-fixture.mp3 >/dev/null 2>&1 || true
  fi
  if [ -f /tmp/synth-fixture.mp3 ]; then
    for path in "music/neon-waves.mp3" "music/midnight-drive.mp3" "liners/seed-back-01.mp3" "liners/seed-back-02.mp3" "jingles/station-id.mp3" "jingles/intro.mp3"; do
      curl -s -X PUT -T /tmp/synth-fixture.mp3 "$STORAGE_URL/$BUCKET/$path" >/dev/null 2>&1 || true
    done
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
