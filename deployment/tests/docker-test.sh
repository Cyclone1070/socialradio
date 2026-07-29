#!/bin/sh
set -e

BASE_URL="${TARGET_URL:-http://localhost:3000}"
EMAIL="${ADMIN_EMAIL:-admin@socialradio.com}"
PASSWORD="${ADMIN_PASSWORD:-AdminPass123!}"

echo "========================================================="
echo "   BLACKBOX CONTAINER E2E TEST SUITE (25 CASES)          "
echo "   Target URL: $BASE_URL                                 "
echo "========================================================="

fail() {
  echo "  ❌ FAIL: $*"
  exit 1
}

assert_status() {
  method="$1"
  url="$2"
  expected_code="$3"
  shift 3

  RESP=$(curl -s -w '\n%{http_code}' -X "$method" "$url" "$@")
  HTTP_CODE=$(echo "$RESP" | tail -n 1)
  BODY=$(echo "$RESP" | sed '$d')

  echo "  [$method] $url -> Code: $HTTP_CODE (Expected: $expected_code)"
  if [ "$HTTP_CODE" != "$expected_code" ]; then
    echo "  Body: $BODY"
    fail "expected status $expected_code, got $HTTP_CODE"
  fi
}

echo ""
echo "=== Phase 1: Healthcheck & Unauthenticated Negatives ==="

echo "1. GET /healthcheck"
assert_status GET "$BASE_URL/healthcheck" 200

echo "2. POST /auth/login (Empty JSON Body -> 400 Bad Request)"
assert_status POST "$BASE_URL/auth/login" 400 \
  -H "Content-Type: application/json" \
  -d '{}'

echo "3. POST /auth/login (Invalid Email Format -> 400 Bad Request)"
assert_status POST "$BASE_URL/auth/login" 400 \
  -H "Content-Type: application/json" \
  -d '{"email":"not-an-email","password":"123"}'

echo "4. POST /auth/login (Wrong Password -> 401 Unauthorized)"
assert_status POST "$BASE_URL/auth/login" 401 \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"${EMAIL}\",\"password\":\"WrongPass999!\"}"

echo "5. POST /auth/login (Non-existent Email -> 401 Unauthorized)"
assert_status POST "$BASE_URL/auth/login" 401 \
  -H "Content-Type: application/json" \
  -d '{"email":"ghost@nonexistent.com","password":"Password123!"}'

echo "6. GET /users/me (No Authorization Header -> 401 Unauthorized)"
assert_status GET "$BASE_URL/users/me" 401

echo "7. GET /users/me (Malformed JWT Token -> 401 Unauthorized)"
assert_status GET "$BASE_URL/users/me" 401 \
  -H "Authorization: Bearer malformed_jwt_garbage_token"

echo "8. GET /channels (No Authorization Header -> 401 Unauthorized)"
assert_status GET "$BASE_URL/channels" 401

echo ""
echo "=== Phase 2: Valid Authentication & Profile ==="

echo "9. POST /auth/login (Valid Admin Credentials -> 200/201 OK)"
LOGIN_RESP=$(curl -s -w '\n%{http_code}' -X POST "$BASE_URL/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"${EMAIL}\",\"password\":\"${PASSWORD}\"}")
LOGIN_CODE=$(echo "$LOGIN_RESP" | tail -n 1)
LOGIN_BODY=$(echo "$LOGIN_RESP" | sed '$d')

if [ "$LOGIN_CODE" != "200" ] && [ "$LOGIN_CODE" != "201" ]; then
  echo "  Body: $LOGIN_BODY"
  fail "expected 200/201 on login, got $LOGIN_CODE"
fi

echo "$LOGIN_BODY" | grep -q '"accessToken"' || fail "missing accessToken in login response"
TOKEN=$(echo "$LOGIN_BODY" | grep -o '"accessToken":"[^"]*"' | cut -d: -f2 | tr -d '"')
echo "  ✅ Login successful! Acquired JWT Bearer Token."

echo "10. GET /users/me (Valid Bearer Token -> 200 OK)"
USER_RESP=$(curl -s -w '\n%{http_code}' -X GET "$BASE_URL/users/me" \
  -H "Authorization: Bearer $TOKEN")
USER_CODE=$(echo "$USER_RESP" | tail -n 1)
USER_BODY=$(echo "$USER_RESP" | sed '$d')

[ "$USER_CODE" = "200" ] || fail "expected 200 on /users/me, got $USER_CODE"
echo "$USER_BODY" | grep -q "$EMAIL" || fail "profile email does not match $EMAIL"
echo "  ✅ User profile verified: $EMAIL"

echo ""
echo "=== Phase 3: Channel CRUD & Subreddit Subscriptions ==="

echo "11. GET /channels (Valid Bearer Token -> 200 OK)"
CHANNELS_RESP=$(curl -s -w '\n%{http_code}' -X GET "$BASE_URL/channels" \
  -H "Authorization: Bearer $TOKEN")
CHANNELS_CODE=$(echo "$CHANNELS_RESP" | tail -n 1)
CHANNELS_BODY=$(echo "$CHANNELS_RESP" | sed '$d')

[ "$CHANNELS_CODE" = "200" ] || fail "expected 200 on GET /channels, got $CHANNELS_CODE"
echo "$CHANNELS_BODY" | grep -q 'Tech & Trivia 24/7' || fail "missing seeded channel 'Tech & Trivia 24/7'"
echo "  ✅ Seeded starter channel 'Tech & Trivia 24/7' verified!"

echo "12. POST /channels (Empty Name String -> 400 Bad Request)"
assert_status POST "$BASE_URL/channels" 400 \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":""}'

echo "13. POST /channels (Create New Channel -> 201 Created)"
CREATE_CHAN_RESP=$(curl -s -w '\n%{http_code}' -X POST "$BASE_URL/channels" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Blackbox E2E Station"}')
CREATE_CHAN_CODE=$(echo "$CREATE_CHAN_RESP" | tail -n 1)
CREATE_CHAN_BODY=$(echo "$CREATE_CHAN_RESP" | sed '$d')

[ "$CREATE_CHAN_CODE" = "201" ] || [ "$CREATE_CHAN_CODE" = "200" ] || fail "expected 201 created on POST /channels, got $CREATE_CHAN_CODE"
echo "$CREATE_CHAN_BODY" | grep -q '"id"' || fail "missing id in create channel response"
CHAN_ID=$(echo "$CREATE_CHAN_BODY" | grep -o '"id":"[^"]*"' | head -n 1 | cut -d: -f2 | tr -d '"')
echo "  ✅ Created Channel ID: $CHAN_ID"

echo "14. POST /channels/00000000-0000-0000-0000-000000000000/subreddits (Non-existent Channel UUID -> 404 Not Found)"
assert_status POST "$BASE_URL/channels/00000000-0000-0000-0000-000000000000/subreddits" 404 \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"subredditName":"AskReddit"}'

echo "15. POST /channels/$CHAN_ID/subreddits (Subscribe r/AskReddit -> 200/201 OK)"
SUB_RESP=$(curl -s -w '\n%{http_code}' -X POST "$BASE_URL/channels/$CHAN_ID/subreddits" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"subredditName":"AskReddit"}')
SUB_CODE=$(echo "$SUB_RESP" | tail -n 1)
[ "$SUB_CODE" = "200" ] || [ "$SUB_CODE" = "201" ] || fail "expected 200/201 on subscribe, got $SUB_CODE"
echo "  ✅ Subscribed r/AskReddit to Channel $CHAN_ID"

echo "16. POST /channels/$CHAN_ID/subreddits (Duplicate r/AskReddit Idempotent Check)"
SUB_DUP_RESP=$(curl -s -w '\n%{http_code}' -X POST "$BASE_URL/channels/$CHAN_ID/subreddits" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"subredditName":"AskReddit"}')
SUB_DUP_CODE=$(echo "$SUB_DUP_RESP" | tail -n 1)
[ "$SUB_DUP_CODE" = "200" ] || [ "$SUB_DUP_CODE" = "201" ] || fail "expected 200/201 on duplicate subscribe, got $SUB_DUP_CODE"
echo "  ✅ Idempotent subscription verified"

echo "17. DELETE /channels/$CHAN_ID/subreddits/AskReddit (Unsubscribe r/AskReddit -> 200 OK)"
assert_status DELETE "$BASE_URL/channels/$CHAN_ID/subreddits/AskReddit" 200 \
  -H "Authorization: Bearer $TOKEN"

echo "18. POST /channels/$CHAN_ID/subreddits (Subscribe r/technology -> 200/201 OK)"
assert_status POST "$BASE_URL/channels/$CHAN_ID/subreddits" 201 \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"subredditName":"technology"}'

echo ""
echo "=== Phase 4: Scraper & Feed Admin Integration ==="

echo "19. POST /admin/feed/scrape (No Token -> 401 Unauthorized)"
assert_status POST "$BASE_URL/admin/feed/scrape" 401 \
  -H "Content-Type: application/json" \
  -d '{"subredditName":"technology"}'

echo "20. POST /admin/feed/scrape (Triggers Playwright Scraping r/technology -> 200/201 OK)"
SCRAPE_RESP=$(curl -s -w '\n%{http_code}' -X POST "$BASE_URL/admin/feed/scrape" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"subredditName":"technology"}')
SCRAPE_CODE=$(echo "$SCRAPE_RESP" | tail -n 1)
SCRAPE_BODY=$(echo "$SCRAPE_RESP" | sed '$d')

if [ "$SCRAPE_CODE" != "200" ] && [ "$SCRAPE_CODE" != "201" ]; then
  echo "  Body: $SCRAPE_BODY"
  fail "expected 200/201 on scrape, got $SCRAPE_CODE"
fi
echo "$SCRAPE_BODY" | grep -q '"scrapedPostsCount"' || fail "missing scrapedPostsCount in scrape response"
echo "  ✅ Live Reddit Scraping via Playwright browserless container verified!"

echo "21. GET /admin/feed/subreddits (Inspect Cached Subreddits -> 200 OK)"
FEED_SUBS_RESP=$(curl -s -w '\n%{http_code}' -X GET "$BASE_URL/admin/feed/subreddits" \
  -H "Authorization: Bearer $TOKEN")
FEED_SUBS_CODE=$(echo "$FEED_SUBS_RESP" | tail -n 1)
FEED_SUBS_BODY=$(echo "$FEED_SUBS_RESP" | sed '$d')

[ "$FEED_SUBS_CODE" = "200" ] || fail "expected 200 on GET /admin/feed/subreddits, got $FEED_SUBS_CODE"
echo "$FEED_SUBS_BODY" | grep -q 'technology' || fail "missing technology in cached subreddits"
echo "  ✅ Cached feed subreddits verified!"

echo "22. GET /channels/admin/channels/$CHAN_ID/topics (Inspect Topic Clusters -> 200 OK)"
TOPICS_RESP=$(curl -s -w '\n%{http_code}' -X GET "$BASE_URL/channels/admin/channels/$CHAN_ID/topics" \
  -H "Authorization: Bearer $TOKEN")
TOPICS_CODE=$(echo "$TOPICS_RESP" | tail -n 1)
[ "$TOPICS_CODE" = "200" ] || fail "expected 200 on topic clusters, got $TOPICS_CODE"
echo "  ✅ Channel topic clustering inspect verified!"

echo "23. DELETE /admin/feed/cache (Flush Feed Cache -> 200 OK)"
assert_status DELETE "$BASE_URL/admin/feed/cache" 200 \
  -H "Authorization: Bearer $TOKEN"

echo ""
echo "========================================================="
echo "   🎉 ALL 23 BLACKBOX E2E TEST SCENARIOS PASSED!          "
echo "========================================================="
