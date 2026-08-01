#!/bin/sh
set -e

fail() {
  echo "  FAIL: $*"
  exit 1
}

assert_200() {
  RESP=$(curl -s -w '\n%{http_code}' "$@")
  HTTP_CODE=$(echo "$RESP" | tail -1)
  BODY=$(echo "$RESP" | sed '$d')
  echo "  Status: $HTTP_CODE"
  if [ "$HTTP_CODE" != "200" ] && [ "$HTTP_CODE" != "201" ]; then
    [ -n "$BODY" ] && echo "  Body: $BODY"
    fail "expected 2xx, got $HTTP_CODE"
  fi
}

assert_status() {
  method="$1"
  url="$2"
  expected="$3"
  shift 3
  RESP=$(curl -s -w '\n%{http_code}' -X "$method" "$url" "$@")
  HTTP_CODE=$(echo "$RESP" | tail -1)
  BODY=$(echo "$RESP" | sed '$d')
  echo "  Status: $HTTP_CODE (expected $expected)"
  if [ "$HTTP_CODE" != "$expected" ]; then
    [ -n "$BODY" ] && echo "  Body: $BODY"
    fail "expected $expected, got $HTTP_CODE"
  fi
}

EMAIL="${ADMIN_EMAIL:?ADMIN_EMAIL is required}"
PASSWORD="${ADMIN_PASSWORD:?ADMIN_PASSWORD is required}"
BASE_URL="${TARGET_URL:?TARGET_URL is required}"

# ── Section 1: Healthcheck ────────────────────────────────────────────

echo ""
echo "=== Section 1: Healthcheck ==="

echo "1. GET /healthcheck"
assert_status GET "$BASE_URL/healthcheck" 200

# ── Section 2: Auth & Identity ────────────────────────────────────────

echo ""
echo "=== Section 2: Auth & Identity ==="

echo "2. POST /auth/login (Admin -> 200/201)"
LOGIN=$(curl -s -w '\n%{http_code}' -X POST "$BASE_URL/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"${EMAIL}\",\"password\":\"${PASSWORD}\"}")
LOGIN_CODE=$(echo "$LOGIN" | tail -1)
LOGIN_BODY=$(echo "$LOGIN" | sed '$d')
[ "$LOGIN_CODE" = "200" ] || [ "$LOGIN_CODE" = "201" ] || fail "expected 200/201, got $LOGIN_CODE"
echo "$LOGIN_BODY" | grep -q '"accessToken"' || fail "missing accessToken"
TOKEN=$(echo "$LOGIN_BODY" | grep -o '"accessToken":"[^"]*"' | cut -d: -f2 | tr -d '"')
echo "  Token acquired (admin)"

echo "3. GET /users/me (Admin -> 200)"
assert_200 -X GET "$BASE_URL/users/me" -H "Authorization: Bearer $TOKEN"

echo "4. POST /auth/login (Regular User -> 200/201)"
REG_LOGIN=$(curl -s -w '\n%{http_code}' -X POST "$BASE_URL/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"user@socialradio.com","password":"UserPass123!"}')
REG_CODE=$(echo "$REG_LOGIN" | tail -1)
REG_BODY=$(echo "$REG_LOGIN" | sed '$d')
[ "$REG_CODE" = "200" ] || [ "$REG_CODE" = "201" ] || fail "expected 200/201, got $REG_CODE"
REG_TOKEN=$(echo "$REG_BODY" | grep -o '"accessToken":"[^"]*"' | cut -d: -f2 | tr -d '"')
echo "  Token acquired (user)"

echo "5. POST /auth/login (Empty JSON Body -> 400)"
assert_status POST "$BASE_URL/auth/login" 400 \
  -H "Content-Type: application/json" -d '{}'

echo "6. POST /auth/login (Invalid Email -> 400)"
assert_status POST "$BASE_URL/auth/login" 400 \
  -H "Content-Type: application/json" -d '{"email":"not-an-email","password":"123"}'

echo "7. POST /auth/login (Wrong Password -> 401)"
assert_status POST "$BASE_URL/auth/login" 401 \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"${EMAIL}\",\"password\":\"WrongPass999!\"}"

echo "8. POST /auth/login (Non-existent Email -> 401)"
assert_status POST "$BASE_URL/auth/login" 401 \
  -H "Content-Type: application/json" \
  -d '{"email":"ghost@nonexistent.com","password":"Password123!"}'

echo "9. GET /users/me (No Auth -> 401)"
assert_status GET "$BASE_URL/users/me" 401

echo "10. GET /users/me (Malformed JWT -> 401)"
assert_status GET "$BASE_URL/users/me" 401 \
  -H "Authorization: Bearer malformed_jwt_garbage_token"

# ── Section 3: Channels & Subreddits ─────────────────────────────────

echo ""
echo "=== Section 3: Channels & Subreddits ==="

echo "11. POST /channels (Create -> 201)"
CHAN=$(curl -s -w '\n%{http_code}' -X POST "$BASE_URL/channels" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Blackbox E2E Station"}')
CHAN_CODE=$(echo "$CHAN" | tail -1)
CHAN_BODY=$(echo "$CHAN" | sed '$d')
[ "$CHAN_CODE" = "200" ] || [ "$CHAN_CODE" = "201" ] || fail "expected 201, got $CHAN_CODE"
echo "$CHAN_BODY" | grep -q '"id"' || fail "missing id"
CHAN_ID=$(echo "$CHAN_BODY" | grep -o '"id":"[^"]*"' | head -1 | cut -d: -f2 | tr -d '"')
echo "  Channel ID: $CHAN_ID"

echo "12. GET /channels (List -> 200)"
assert_200 -X GET "$BASE_URL/channels" -H "Authorization: Bearer $TOKEN"

echo "13. POST /channels/$CHAN_ID/subreddits (Subscribe r/AskReddit -> 200/201)"
assert_200 -X POST "$BASE_URL/channels/$CHAN_ID/subreddits" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -d '{"subredditName":"AskReddit"}'

echo "14. POST /channels/$CHAN_ID/subreddits (Duplicate r/AskReddit -> 200/201)"
assert_200 -X POST "$BASE_URL/channels/$CHAN_ID/subreddits" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -d '{"subredditName":"AskReddit"}'

echo "15. DELETE /channels/$CHAN_ID/subreddits/AskReddit -> 200"
assert_status DELETE "$BASE_URL/channels/$CHAN_ID/subreddits/AskReddit" 200 \
  -H "Authorization: Bearer $TOKEN"

echo "16. POST /channels/$CHAN_ID/subreddits (Subscribe r/technology -> 201)"
assert_status POST "$BASE_URL/channels/$CHAN_ID/subreddits" 201 \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -d '{"subredditName":"technology"}'

echo "17. POST /channels (Empty Name -> 400)"
assert_status POST "$BASE_URL/channels" 400 \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -d '{"name":""}'

echo "18. POST /channels/000.../subreddits (Fake UUID -> 404)"
assert_status POST "$BASE_URL/channels/00000000-0000-0000-0000-000000000000/subreddits" 404 \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -d '{"subredditName":"AskReddit"}'

echo "19. POST /channels (No Auth -> 401)"
assert_status POST "$BASE_URL/channels" 401 \
  -H "Content-Type: application/json" -d '{"name":"Hacker Station"}'

echo "20. POST /channels/$CHAN_ID/subreddits (No Auth -> 401)"
assert_status POST "$BASE_URL/channels/$CHAN_ID/subreddits" 401 \
  -H "Content-Type: application/json" -d '{"subredditName":"AskReddit"}'

echo "21. DELETE /channels/$CHAN_ID/subreddits/AskReddit (No Auth -> 401)"
assert_status DELETE "$BASE_URL/channels/$CHAN_ID/subreddits/AskReddit" 401

# ── Section 4: Admin & Feeds ─────────────────────────────────────────

echo ""
echo "=== Section 4: Admin & Feeds ==="

echo "22. POST /admin/feeds/scrape (Admin Token -> 200/201)"
SCRAPE=$(curl -s -w '\n%{http_code}' -X POST "$BASE_URL/admin/feeds/scrape" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -d '{"subredditName":"technology"}')
SCRAPE_CODE=$(echo "$SCRAPE" | tail -1)
SCRAPE_BODY=$(echo "$SCRAPE" | sed '$d')
[ "$SCRAPE_CODE" = "200" ] || [ "$SCRAPE_CODE" = "201" ] || fail "expected 200/201, got $SCRAPE_CODE"
echo "$SCRAPE_BODY" | grep -q '"scrapedPostsCount"' || fail "missing scrapedPostsCount"
echo "  Scraped posts verified"

echo "23. GET /admin/feeds/subreddits (Admin -> 200)"
assert_200 -X GET "$BASE_URL/admin/feeds/subreddits" -H "Authorization: Bearer $TOKEN"

echo "24. GET /admin/channels/$CHAN_ID/topics (Admin -> 200)"
assert_200 -X GET "$BASE_URL/admin/channels/$CHAN_ID/topics" -H "Authorization: Bearer $TOKEN"

echo "25. DELETE /admin/feeds/cache (Admin -> 200)"
assert_status DELETE "$BASE_URL/admin/feeds/cache" 200 \
  -H "Authorization: Bearer $TOKEN"

echo "26. POST /admin/feeds/scrape (No Auth -> 401)"
assert_status POST "$BASE_URL/admin/feeds/scrape" 401 \
  -H "Content-Type: application/json" -d '{"subredditName":"technology"}'

echo "27. POST /admin/feeds/scrape (Tampered JWT -> 401)"
assert_status POST "$BASE_URL/admin/feeds/scrape" 401 \
  -H "Authorization: Bearer ${TOKEN}tampered" \
  -H "Content-Type: application/json" -d '{"subredditName":"technology"}'

echo "28. POST /admin/feeds/scrape (Regular Token -> 403)"
assert_status POST "$BASE_URL/admin/feeds/scrape" 403 \
  -H "Authorization: Bearer $REG_TOKEN" \
  -H "Content-Type: application/json" -d '{"subredditName":"technology"}'

echo "29. GET /admin/feeds/subreddits (No Auth -> 401)"
assert_status GET "$BASE_URL/admin/feeds/subreddits" 401

echo "30. GET /admin/feeds/subreddits (Regular Token -> 403)"
assert_status GET "$BASE_URL/admin/feeds/subreddits" 403 \
  -H "Authorization: Bearer $REG_TOKEN"

echo "31. DELETE /admin/feeds/cache (No Auth -> 401)"
assert_status DELETE "$BASE_URL/admin/feeds/cache" 401

echo "32. DELETE /admin/feeds/cache (Regular Token -> 403)"
assert_status DELETE "$BASE_URL/admin/feeds/cache" 403 \
  -H "Authorization: Bearer $REG_TOKEN"

echo "33. GET /admin/channels/$CHAN_ID/topics (No Auth -> 401)"
assert_status GET "$BASE_URL/admin/channels/$CHAN_ID/topics" 401

echo "34. GET /admin/channels/$CHAN_ID/topics (Regular Token -> 403)"
assert_status GET "$BASE_URL/admin/channels/$CHAN_ID/topics" 403 \
  -H "Authorization: Bearer $REG_TOKEN"

echo ""
echo "OK - all checks passed"
